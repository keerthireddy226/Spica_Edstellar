import { pool } from "../db.js";
import { assertFeature } from "../plans/service.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { PAYMENT_CONFIG } from "./providers.js";
import { PaymentError, fulfillOrder, quote, type Buyer } from "./service.js";

const PAYMENT_TERMS_DAYS = 30;

// An organization asks to pay by bank transfer against its PO: it gets a
// proforma (quote) to raise payment on; licenses arrive when Edstellar marks
// it paid.
export async function requestInvoiceOrder(buyer: Buyer, quantity: number, poNumber: string | null): Promise<{ orderId: string; quoteNumber: string }> {
  await assertFeature(buyer.tenantId, "po_invoicing");
  const q = quote(buyer, quantity, { byInvoice: true });
  const quoteNumber = (
    await pool.query(`SELECT 'Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('quote_number_seq')::text, 5, '0') AS n`)
  ).rows[0].n as string;
  const r = await pool.query(
    `INSERT INTO payment_orders (tenant_id, buyer_id, kind, quantity, currency, unit_amount, subtotal, tax_rate, tax_amount, total, provider, bill_to,
       po_number, quote_number, due_date)
     VALUES ($1, $2, 'org_licenses', $3, $4, $5, $6, $7, $8, $9, 'invoice', $10, $11, $12, current_date + $13::int) RETURNING id`,
    [
      buyer.tenantId,
      buyer.userId,
      q.quantity,
      q.currency,
      q.unitAmount,
      q.subtotal,
      q.taxRate,
      q.taxAmount,
      q.total,
      JSON.stringify({ ...buyer.billTo, purchaseOrderRef: poNumber ?? buyer.billTo.purchaseOrderRef ?? null }),
      poNumber,
      quoteNumber,
      PAYMENT_TERMS_DAYS,
    ],
  );
  const t = (await pool.query(`SELECT name, managed_by, account_manager_id FROM tenants WHERE id = $1`, [buyer.tenantId])).rows[0];
  for (const staff of [...new Set([t.account_manager_id, t.managed_by].filter(Boolean))] as string[]) {
    await notify({
      userId: staff,
      kind: "invoice_requested",
      title: `${t.name} asked to pay by invoice`,
      body: `${poNumber ? `${quantity} licenses, ${quoteNumber}, PO ${poNumber}.` : `${quantity} licenses, ${quoteNumber}.`} Mark it paid when the payment arrives.`,
      link: "/admin/organizations",
      email: true,
    });
  }
  return { orderId: r.rows[0].id, quoteNumber };
}

export async function getQuote(orderId: string, tenantId: string | null, isStaff: boolean) {
  const r = await pool.query(
    `SELECT * FROM payment_orders WHERE id = $1 AND provider = 'invoice' AND ($2::boolean OR tenant_id = $3)`,
    [orderId, isStaff, tenantId],
  );
  const o = r.rows[0];
  if (!o) return null;
  return {
    id: o.id,
    quoteNumber: o.quote_number,
    status: o.status,
    createdAt: o.created_at,
    dueDate: o.due_date,
    poNumber: o.po_number,
    seller: PAYMENT_CONFIG.seller,
    billTo: o.bill_to,
    quantity: o.quantity,
    currency: o.currency,
    unitAmount: o.unit_amount,
    subtotal: o.subtotal,
    taxRate: Number(o.tax_rate),
    taxAmount: o.tax_amount,
    total: o.total,
  };
}

export async function listInvoiceOrders(tenantId: string) {
  const r = await pool.query(
    `SELECT id, quote_number, po_number, quantity, currency, total, status, due_date, created_at FROM payment_orders
     WHERE tenant_id = $1 AND provider = 'invoice' ORDER BY created_at DESC`,
    [tenantId],
  );
  return r.rows.map((o) => ({
    id: o.id,
    quoteNumber: o.quote_number,
    poNumber: o.po_number,
    quantity: o.quantity,
    currency: o.currency,
    total: o.total,
    status: o.status,
    dueDate: o.due_date,
    createdAt: o.created_at,
  }));
}

// Edstellar staff: the money arrived. Same fulfilment as an online payment.
export async function markInvoiceOrderPaid(args: { orderId: string; tenantId: string; reference: string; actorId: string }) {
  const o = (await pool.query(`SELECT status FROM payment_orders WHERE id = $1 AND tenant_id = $2 AND provider = 'invoice'`, [args.orderId, args.tenantId])).rows[0];
  if (!o) throw new PaymentError("order_not_found");
  if (o.status === "cancelled") throw new PaymentError("order_not_found");
  await pool.query(`UPDATE payment_orders SET marked_paid_by = $2, payment_reference = $3 WHERE id = $1`, [args.orderId, args.actorId, args.reference]);
  const r = await fulfillOrder(args.orderId, args.reference);
  for (const id of await orgAdminIds(args.tenantId)) {
    await notify({
      userId: id,
      kind: "invoice_paid",
      title: "Payment received — your licenses are ready",
      body: `Your invoice payment (${args.reference}) has been received and the licenses are in your pool.`,
      link: "/orgadmin/licenses",
      email: true,
    });
  }
  return r;
}

export async function cancelInvoiceOrder(orderId: string, tenantId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE payment_orders SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2 AND provider = 'invoice' AND status = 'created'`,
    [orderId, tenantId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---- Credit notes ----

export class CreditNoteError extends Error {
  constructor(public code: "invoice_not_found" | "amount_too_high" | "not_enough_unused_licenses") {
    super(code);
  }
}

// Money back against an invoice (paid out in Stripe/Razorpay or by bank
// separately), optionally taking unused licenses from that purchase back out.
export async function issueCreditNote(args: { invoiceId: string; amount: number; licensesToRemove: number; reason: string; actorId: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inv = (
      await client.query(
        `SELECT i.id, i.tenant_id, i.total, i.currency, o.license_purchase_id,
           (SELECT coalesce(sum(amount), 0)::int FROM credit_notes c WHERE c.invoice_id = i.id) AS credited
         FROM invoices i JOIN payment_orders o ON o.id = i.order_id WHERE i.id = $1 FOR UPDATE OF i`,
        [args.invoiceId],
      )
    ).rows[0];
    if (!inv) throw new CreditNoteError("invoice_not_found");
    if (args.amount > inv.total - inv.credited) throw new CreditNoteError("amount_too_high");

    if (args.licensesToRemove > 0) {
      // Same lock every license change takes.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`licenses:${inv.tenant_id}`]);
      const lot = (
        await client.query(
          `SELECT p.quantity - (SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p.id AND a.reclaimed_at IS NULL)::int AS unused
           FROM license_purchases p WHERE p.id = $1 FOR UPDATE`,
          [inv.license_purchase_id],
        )
      ).rows[0];
      if (!lot || lot.unused < args.licensesToRemove) throw new CreditNoteError("not_enough_unused_licenses");
      await client.query(`UPDATE license_purchases SET quantity = quantity - $2 WHERE id = $1`, [inv.license_purchase_id, args.licensesToRemove]);
    }
    const number = (
      await client.query(`SELECT 'CN-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('credit_note_number_seq')::text, 5, '0') AS n`)
    ).rows[0].n as string;
    const cn = await client.query(
      `INSERT INTO credit_notes (credit_note_number, invoice_id, tenant_id, issued_by, licenses_removed, currency, amount, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [number, inv.id, inv.tenant_id, args.actorId, args.licensesToRemove, inv.currency, args.amount, args.reason],
    );
    if (args.licensesToRemove > 0) {
      await client.query(`INSERT INTO license_events (tenant_id, kind, quantity, actor_id, note) VALUES ($1, 'refund', $2, $3, $4)`, [
        inv.tenant_id,
        args.licensesToRemove,
        args.actorId,
        `${number} — ${args.reason}`,
      ]);
    }
    await client.query("COMMIT");
    return { id: cn.rows[0].id as string, creditNoteNumber: number };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listCreditNotes(invoiceId: string) {
  const r = await pool.query(
    `SELECT credit_note_number, issued_at, licenses_removed, currency, amount, reason FROM credit_notes WHERE invoice_id = $1 ORDER BY issued_at`,
    [invoiceId],
  );
  return r.rows.map((c) => ({
    creditNoteNumber: c.credit_note_number,
    issuedAt: c.issued_at,
    licensesRemoved: c.licenses_removed,
    currency: c.currency,
    amount: c.amount,
    reason: c.reason,
  }));
}
