// Channel Partners stage 6: Finance on partner orders.
//  1. Proforma: Finance checks who is billed and sends the proforma invoice
//     (PF- series) to the billing contact, the organisations' admins and the
//     partner. GST 18% for India; abroad: export of services, no Indian GST.
//  2. Payment: a Stripe payment link (paid automatically through the Stripe
//     webhook) or a bank transfer that Finance records by hand.
//  3. Final tax invoice: issued when the payment is recorded, in the same INV-
//     series as every other Spica invoice.
// A Super Admin or Admin then confirms the order (stage 7 allocates it).
import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { sendNotificationEmail } from "../auth/mailer.js";
import { PAYMENT_CONFIG, stripeEnabled, stripeRequest } from "../payments/providers.js";
import { recordAudit } from "../audit/service.js";
import { changeStatus } from "./orders.js";
import { PartnerError } from "./organisations.js";

export interface BillTo {
  name: string;
  attention?: string | null;
  address?: string | null;
  email: string;
  gstin?: string | null;
  country?: string | null;
}
type Actor = { id: string | null; role: string; ip?: string | null };

const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString(currency === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const docLink = (orderId: string, kind: "proforma" | "invoice") => `${PAYMENT_CONFIG.frontendUrl}/order-document/${orderId}/${kind}`;

async function order(orderId: string) {
  const o = (await pool.query(`SELECT * FROM partner_orders WHERE id = $1`, [orderId])).rows[0];
  if (!o) throw new PartnerError("order_not_found", 404);
  return o;
}

// The Reseller behind an order, if it is one: Resellers are billed themselves.
async function resellerOf(orderId: string) {
  return (await pool.query(`SELECT cp.* FROM partner_orders o JOIN channel_partners cp ON cp.id = o.partner_id WHERE o.id = $1 AND cp.partner_type = 'reseller'`, [orderId])).rows[0] as Record<string, any> | undefined;
}

// Org Admins of every organisation on the order (the Reseller for its orders).
async function orderOrgAdmins(orderId: string): Promise<string[]> {
  const reseller = await resellerOf(orderId);
  if (reseller) return [reseller.user_id];
  const t = await pool.query(`SELECT tenant_id FROM partner_order_organisations WHERE order_id = $1`, [orderId]);
  const ids: string[] = [];
  for (const r of t.rows) ids.push(...(await orgAdminIds(r.tenant_id)));
  return [...new Set(ids)];
}

// Tells the organisations' admins in the app and by email, and the billing
// contact by email when that address isn't one of theirs.
async function tellOrganisations(o: { id: string; order_number: string }, billTo: BillTo, kind: "proforma" | "invoice", title: string, text: string) {
  const admins = await orderOrgAdmins(o.id);
  for (const id of admins) {
    await notify({ userId: id, kind: "partner_order", title, body: text, link: `/order-document/${o.id}/${kind}`, dedupeKey: `porder:${o.id}:${kind}:${id}`, email: true });
  }
  const emails = (await pool.query(`SELECT lower(email) AS e FROM users WHERE id = ANY($1::uuid[])`, [admins])).rows.map((r) => r.e);
  if (billTo.email && !emails.includes(billTo.email.toLowerCase())) {
    await sendNotificationEmail({ to: billTo.email, subject: title, text: `${text}\n\n${docLink(o.id, kind)}` }).catch((err) => console.error("order email failed:", err));
  }
}

// Who to bill, suggested from the first organisation on the order.
export async function suggestedBillTo(orderId: string): Promise<BillTo> {
  const o = await order(orderId);
  if (o.bill_to) return o.bill_to;
  const reseller = await resellerOf(orderId);
  if (reseller) return { name: reseller.full_name, attention: null, address: null, email: reseller.email, gstin: o.gstin ?? null, country: o.in_india ? "IN" : null };
  const t = (
    await pool.query(
      `SELECT t.name, t.tax_id, u.email, u.first_name, u.last_name FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id
       LEFT JOIN LATERAL (SELECT * FROM users a WHERE a.tenant_id = t.id AND a.role = 'org_admin' AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1) u ON true
       WHERE x.order_id = $1 ORDER BY t.name LIMIT 1`,
      [orderId],
    )
  ).rows[0];
  return { name: t?.name ?? "", attention: [t?.first_name, t?.last_name].filter(Boolean).join(" ") || null, address: null, email: t?.email ?? "", gstin: o.gstin ?? t?.tax_id ?? null, country: o.in_india ? "IN" : null };
}

export async function sendProforma(args: { orderId: string; actor: Actor; billTo: BillTo }) {
  const o = await order(args.orderId);
  if (o.status !== "submitted") throw new PartnerError("status_change_not_allowed", 409, { status: o.status });
  const number = (await pool.query(`SELECT 'PF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('proforma_number_seq')::text, 5, '0') AS n`)).rows[0].n as string;
  const billTo = { ...args.billTo, gstin: args.billTo.gstin?.trim() || null };
  await changeStatus({ orderId: o.id, to: "proforma_sent", actor: args.actor as never, note: number, finance: { set: { bill_to: billTo, proforma_number: number, proforma_sent_at: new Date() } } });
  await tellOrganisations(
    o,
    billTo,
    "proforma",
    `Proforma invoice ${number} for order ${o.order_number}`,
    `Spica has sent proforma invoice ${number} for order ${o.order_number}: ${money(o.total, o.currency)}. Pay by bank transfer to the account on the proforma, or with the payment link if Spica sends one. The licences are made available once the payment is confirmed.`,
  );
  return { proformaNumber: number };
}

// A Stripe Checkout link for the order total (valid for 24 hours; make a new
// one if it runs out). The Stripe webhook records the payment.
export async function createPaymentLink(args: { orderId: string; actor: Actor }) {
  const o = await order(args.orderId);
  if (o.status !== "proforma_sent") throw new PartnerError("status_change_not_allowed", 409, { status: o.status });
  if (!stripeEnabled()) throw new PartnerError("stripe_not_configured", 409);
  const ret = `${PAYMENT_CONFIG.frontendUrl}/order-document/${o.id}/proforma`;
  const form: Record<string, string> = {
    mode: "payment",
    success_url: `${ret}?paid=1`,
    cancel_url: ret,
    client_reference_id: o.id,
    "metadata[partner_order_id]": o.id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": String(o.currency).toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(o.subtotal),
    "line_items[0][price_data][product_data][name]": `Spica order ${o.order_number} (${o.proforma_number})`,
  };
  if (o.tax_amount > 0) {
    form["line_items[1][quantity]"] = "1";
    form["line_items[1][price_data][currency]"] = String(o.currency).toLowerCase();
    form["line_items[1][price_data][unit_amount]"] = String(o.tax_amount);
    form["line_items[1][price_data][product_data][name]"] = `GST ${Number(o.tax_rate)}%`;
  }
  if (o.bill_to?.email) form.customer_email = o.bill_to.email;
  const session = await stripeRequest("POST", "/checkout/sessions", form);
  const url = String(session.url);
  await pool.query(`UPDATE partner_orders SET payment_link_url = $2, stripe_session_id = $3, updated_at = now() WHERE id = $1`, [o.id, url, String(session.id)]);
  await pool.query(`INSERT INTO partner_order_events (order_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $2, $3, 'Payment link created')`, [o.id, o.status, args.actor.id]);
  if (o.bill_to?.email) {
    await sendNotificationEmail({
      to: o.bill_to.email,
      subject: `Payment link for order ${o.order_number}`,
      text: `Pay ${money(o.total, o.currency)} for order ${o.order_number} (proforma ${o.proforma_number}) here. The link works for 24 hours.\n\n${url}`,
    }).catch((err) => console.error("payment link email failed:", err));
  }
  return { url };
}

// The payment arrived (Stripe, bank or other): record it and issue the final
// tax invoice.
export async function recordPayment(args: { orderId: string; actor: Actor; method: "stripe" | "bank" | "other"; reference: string | null; amount: number; receivedOn: string }) {
  const o = await order(args.orderId);
  if (o.status !== "proforma_sent") throw new PartnerError("status_change_not_allowed", 409, { status: o.status });
  const invoice = (await pool.query(`SELECT 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 5, '0') AS n`)).rows[0].n as string;
  await changeStatus({
    orderId: o.id,
    to: "payment_received",
    actor: args.actor as never,
    note: [args.method === "stripe" ? "Stripe" : args.method === "bank" ? "Bank transfer" : "Other", args.reference, money(args.amount, o.currency)].filter(Boolean).join(" · "),
    finance: { set: { payment_method: args.method, payment_reference: args.reference, payment_amount: args.amount, payment_received_on: args.receivedOn, invoice_number: invoice, invoice_issued_at: new Date() } },
  });
  if (args.amount !== o.total) {
    await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: "partner_order.payment_amount_differs", targetType: "partner_order", targetId: o.id, targetLabel: o.order_number, details: { expected: o.total, received: args.amount } });
  }
  await tellOrganisations(
    o,
    o.bill_to ?? { name: "", email: "" },
    "invoice",
    `Payment received for order ${o.order_number}`,
    `Spica has received ${money(args.amount, o.currency)} for order ${o.order_number}. Tax invoice ${invoice} is ready. The licences are made available once Spica confirms the order.`,
  );
  return { invoiceNumber: invoice };
}

// The Stripe webhook: a paid Checkout session for a partner order.
export async function stripePartnerOrderPaid(orderId: string, paymentIntent: string | null, amountTotal: number | null) {
  const o = (await pool.query(`SELECT status, total FROM partner_orders WHERE id = $1`, [orderId])).rows[0];
  if (!o || o.status !== "proforma_sent") return; // already recorded, or cancelled
  await recordPayment({ orderId, actor: { id: null, role: "system" }, method: "stripe", reference: paymentIntent, amount: amountTotal ?? o.total, receivedOn: new Date().toISOString().slice(0, 10) });
}

// The proforma or the final invoice, for staff, the order's partner and the
// organisations' admins.
export async function orderDocument(orderId: string, kind: "proforma" | "invoice", viewer: { id: string; role: string; tenantId: string | null; staffOk: boolean }) {
  const o = (await pool.query(`SELECT o.*, to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until_text, to_char(o.payment_received_on, 'YYYY-MM-DD') AS paid_on FROM partner_orders o WHERE o.id = $1`, [orderId])).rows[0];
  if (!o) return null;
  let allowed = viewer.staffOk;
  if (!allowed && viewer.role === "channel_partner") allowed = !!(await pool.query(`SELECT 1 FROM channel_partners WHERE id = $1 AND user_id = $2`, [o.partner_id, viewer.id])).rowCount;
  if (!allowed && viewer.role === "org_admin" && viewer.tenantId && !(await resellerOf(orderId)))
    allowed = !!(await pool.query(`SELECT 1 FROM partner_order_organisations WHERE order_id = $1 AND tenant_id = $2`, [orderId, viewer.tenantId])).rowCount;
  if (!allowed) return null;
  const number = kind === "proforma" ? o.proforma_number : o.invoice_number;
  if (!number) return { available: false as const };
  const lines = await pool.query(
    `SELECT l.kind, l.level, l.quantity, l.credits, l.unit_amount, l.amount, l.list_unit_amount, l.discount_percent, p.name FROM partner_order_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.order_id = $1
     ORDER BY CASE l.kind WHEN 'full_access' THEN 0 WHEN 'product' THEN 1 ELSE 2 END, p.name`,
    [orderId],
  );
  const orgs = await pool.query(`SELECT t.name FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id WHERE x.order_id = $1 ORDER BY t.name`, [orderId]);
  return {
    available: true as const,
    kind,
    number,
    issuedAt: kind === "proforma" ? o.proforma_sent_at : o.invoice_issued_at,
    orderNumber: o.order_number,
    status: o.status,
    seller: PAYMENT_CONFIG.seller,
    bankDetails: process.env.SELLER_BANK_DETAILS ?? "",
    billTo: o.bill_to as BillTo,
    organisations: orgs.rows.map((r) => r.name as string),
    inIndia: o.in_india,
    currency: o.currency,
    validUntil: o.valid_until_text,
    licenceMonths: o.licence_months,
    lines: lines.rows.map((l) => ({ kind: l.kind, name: l.name, level: l.level, quantity: l.quantity, credits: l.credits, unitAmount: l.unit_amount, amount: l.amount, listUnitAmount: l.list_unit_amount, discountPercent: Number(l.discount_percent ?? 0) })),
    subtotal: o.subtotal,
    taxRate: Number(o.tax_rate),
    taxAmount: o.tax_amount,
    total: o.total,
    paymentLinkUrl: kind === "proforma" && o.status === "proforma_sent" ? o.payment_link_url : null,
    payment: o.invoice_number ? { method: o.payment_method, reference: o.payment_reference, amount: o.payment_amount, receivedOn: o.paid_on } : null,
  };
}

// ---- A Reseller's Payments page (it is billed for its own orders) ----

// Everything the Reseller owes or has paid: orders waiting for a proforma,
// proformas to pay (with how to pay), and payments with their tax invoices.
export async function resellerPayments(partnerId: string) {
  const r = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.currency, o.subtotal, o.tax_rate, o.tax_amount, o.total, to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until,
       o.proforma_number, o.proforma_sent_at, o.payment_link_url, o.payment_method, o.payment_reference, o.payment_amount,
       to_char(o.payment_received_on, 'YYYY-MM-DD') AS payment_received_on, o.invoice_number, o.invoice_issued_at, o.created_at,
       (SELECT max(e.created_at) FROM partner_order_events e WHERE e.order_id = o.id AND e.note = 'Payment link created') AS link_created_at
     FROM partner_orders o WHERE o.partner_id = $1 AND o.status NOT IN ('draft', 'cancelled') ORDER BY o.created_at DESC`,
    [partnerId],
  );
  const linkLive = (at: Date | null) => !!at && Date.now() - new Date(at).getTime() < 23 * 3600 * 1000;
  const row = (o: Record<string, any>) => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    currency: o.currency,
    subtotal: o.subtotal,
    taxRate: Number(o.tax_rate),
    taxAmount: o.tax_amount,
    total: o.total,
    validUntil: o.valid_until,
    proformaNumber: o.proforma_number,
    proformaSentAt: o.proforma_sent_at,
    paymentLinkUrl: o.status === "proforma_sent" && linkLive(o.link_created_at) ? o.payment_link_url : null,
    paymentMethod: o.payment_method,
    paymentReference: o.payment_reference,
    paymentAmount: o.payment_amount,
    paymentReceivedOn: o.payment_received_on,
    invoiceNumber: o.invoice_number,
    invoiceIssuedAt: o.invoice_issued_at,
    submittedAt: o.created_at,
  });
  return {
    bankDetails: process.env.SELLER_BANK_DETAILS ?? "",
    onlinePayment: stripeEnabled(),
    waiting: r.rows.filter((o) => o.status === "submitted").map(row),
    toPay: r.rows.filter((o) => o.status === "proforma_sent").map(row),
    paid: r.rows.filter((o) => o.payment_received_on || o.invoice_number).map(row),
  };
}

// The Reseller pays online itself: reuse a link made in the last 23 hours,
// else make a new one (Stripe links work for 24 hours).
export async function resellerPaymentLink(args: { orderId: string; partnerId: string; actor: Actor }) {
  const o = await order(args.orderId);
  if (o.partner_id !== args.partnerId) throw new PartnerError("order_not_found", 404);
  const at = (await pool.query(`SELECT max(created_at) AS at FROM partner_order_events WHERE order_id = $1 AND note = 'Payment link created'`, [o.id])).rows[0]?.at;
  if (o.status === "proforma_sent" && o.payment_link_url && at && Date.now() - new Date(at).getTime() < 23 * 3600 * 1000) return { url: o.payment_link_url as string };
  return createPaymentLink(args);
}
