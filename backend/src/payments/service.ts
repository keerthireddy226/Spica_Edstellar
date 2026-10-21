import { pool } from "../db.js";
import { accessCache } from "../licenses/accessCache.js";
import { includeFinalAssessment } from "../assessment/service.js";
import { POOL_VALIDITY_MONTHS, assignMonths } from "../licenses/service.js";
import { PAYMENT_CONFIG, chooseProvider, type ProviderName } from "./providers.js";
import { getTenantPlan, orgUnitPriceCents, purchaseUpgradesTo, setTier, type TenantPlan } from "../plans/service.js";
import { TIER_LABELS, type PlanTier } from "../plans/config.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { listCreditNotes } from "./invoiceOrders.js";

// product: one of the products (Full access, preparation, assessment, level test), see products.ts.
export type OrderKind = "org_licenses" | "individual_plan" | "product";
export const INDIVIDUAL_PLAN_MONTHS = [1, 3, 6] as const;

export class PaymentError extends Error {
  constructor(public code: "no_provider" | "order_not_found" | "payment_not_verified" | "invalid_quantity") {
    super(code);
  }
}

export interface Quote {
  currency: "INR" | "USD";
  // Full access months: credit for the unused part of a preparation purchase.
  credit?: number;
  provider: ProviderName;
  quantity: number;
  unitAmount: number;
  subtotal: number;
  taxLabel: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  billingCountry: string | null;
  // Organizations only: the rate-card price before tier, volume and education
  // pricing, and the tier this purchase moves them to (if any).
  listUnitAmount: number;
  upgradesTo: PlanTier | null;
}

export interface Buyer {
  tenantId: string;
  userId: string;
  kind: OrderKind;
  billTo: Record<string, string | null>;
  billingCountry: string | null;
  email: string | null;
  plan: TenantPlan | null;
}

// Who is paying, and the bill-to block that goes on the invoice.
export async function resolveBuyer(user: { id: string; role: string; tenantId: string | null }): Promise<Buyer | null> {
  if (user.role === "org_admin" && user.tenantId) {
    const t = (await pool.query(`SELECT * FROM tenants WHERE id = $1 AND type = 'cohort'`, [user.tenantId])).rows[0];
    const u = (await pool.query(`SELECT email, first_name, last_name FROM users WHERE id = $1`, [user.id])).rows[0];
    if (!t) return null;
    return {
      tenantId: t.id,
      userId: user.id,
      kind: "org_licenses",
      plan: await getTenantPlan(t.id),
      billingCountry: t.country,
      email: t.billing_contact_email ?? u.email,
      billTo: {
        name: t.legal_name ?? t.name,
        attention: t.billing_contact_name ?? [u.first_name, u.last_name].filter(Boolean).join(" "),
        email: t.billing_contact_email ?? u.email,
        address: [t.address_line, t.city, t.state, t.postal_code].filter(Boolean).join(", ") || null,
        country: t.country,
        taxId: t.tax_id,
        purchaseOrderRef: t.purchase_order_ref,
      },
    };
  }
  if (user.role === "learner" && user.tenantId) {
    const row = (
      await pool.query(
        `SELECT u.email, u.first_name, u.last_name, t.type, p.country, p.city
         FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN participant_profiles p ON p.user_id = u.id
         WHERE u.id = $1`,
        [user.id],
      )
    ).rows[0];
    if (!row || row.type === "cohort") return null;
    return {
      tenantId: user.tenantId,
      userId: user.id,
      kind: "individual_plan",
      plan: null,
      billingCountry: row.country,
      email: row.email,
      billTo: {
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
        email: row.email,
        address: row.city,
        country: row.country,
      },
    };
  }
  return null;
}

// `byInvoice`: paid by bank transfer, so no card provider is needed; India is
// still invoiced in INR.
export function quote(buyer: Buyer, quantity: number, opts: { byInvoice?: boolean } = {}): Quote {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new PaymentError("invalid_quantity");
  if (buyer.kind === "individual_plan" && !INDIVIDUAL_PLAN_MONTHS.includes(quantity as 1 | 3 | 6)) {
    throw new PaymentError("invalid_quantity");
  }
  const choice = opts.byInvoice
    ? { provider: "invoice" as const, currency: (buyer.billingCountry === "IN" ? "INR" : "USD") as "INR" | "USD" }
    : chooseProvider(buyer.billingCountry);
  if (!choice) throw new PaymentError("no_provider");
  const toCurrency = (usdCents: number) =>
    choice.currency === "INR" ? Math.round((usdCents / 100) * PAYMENT_CONFIG.inrPerUsd * 100) : usdCents;
  const usdUnit = buyer.plan ? orgUnitPriceCents(buyer.plan, quantity) : PAYMENT_CONFIG.priceUsdCents;
  const unitAmount = toCurrency(usdUnit);
  const subtotal = unitAmount * quantity;
  // GST applies to sales billed in India; services exported abroad are zero-rated.
  const taxRate = buyer.billingCountry === "IN" ? PAYMENT_CONFIG.gstRate : 0;
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  return {
    currency: choice.currency,
    provider: choice.provider,
    quantity,
    unitAmount,
    subtotal,
    taxLabel: taxRate > 0 ? `GST ${taxRate}%` : null,
    taxRate,
    taxAmount,
    total: subtotal + taxAmount,
    billingCountry: buyer.billingCountry,
    listUnitAmount: toCurrency(PAYMENT_CONFIG.priceUsdCents),
    upgradesTo: buyer.plan ? purchaseUpgradesTo(buyer.plan, quantity) : null,
  };
}

// Takes an upgrade credit off a quote (never below zero) and works out tax again.
export function withCredit(q: Quote, credit: number): Quote {
  const c = Math.min(credit, q.subtotal);
  if (c <= 0) return q;
  const subtotal = q.subtotal - c;
  const taxAmount = Math.round((subtotal * q.taxRate) / 100);
  return { ...q, credit: c, subtotal, taxAmount, total: subtotal + taxAmount };
}

export async function createOrder(buyer: Buyer, q: Quote): Promise<string> {
  const result = await pool.query(
    `INSERT INTO payment_orders (tenant_id, buyer_id, kind, quantity, currency, unit_amount, subtotal, tax_rate, tax_amount, total, provider, bill_to, credit_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [buyer.tenantId, buyer.userId, buyer.kind, q.quantity, q.currency, q.unitAmount, q.subtotal, q.taxRate, q.taxAmount, q.total, q.provider, JSON.stringify(buyer.billTo), q.credit ?? 0],
  );
  return result.rows[0].id;
}

export async function getOrderForUser(orderId: string, user: { id: string; tenantId: string | null }) {
  const result = await pool.query(`SELECT * FROM payment_orders WHERE id = $1 AND tenant_id = $2`, [orderId, user.tenantId]);
  return result.rows[0] ?? null;
}

// Runs exactly once per order no matter how many times the provider (or the
// browser returning from checkout) confirms it: the row lock + status check
// make a second call a no-op.
export async function fulfillOrder(orderId: string, providerPaymentId: string | null): Promise<{ invoiceId: string; alreadyPaid: boolean }> {
  const client = await pool.connect();
  let order: Record<string, any>;
  let invoiceId: string;
  let upgradedTo: PlanTier | null = null;
  let product: Record<string, any> | null = null;
  try {
    await client.query("BEGIN");
    order = (await client.query(`SELECT * FROM payment_orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!order) throw new PaymentError("order_not_found");
    if (order.status === "paid") {
      const inv = await client.query(`SELECT id FROM invoices WHERE order_id = $1`, [orderId]);
      await client.query("COMMIT");
      return { invoiceId: inv.rows[0].id, alreadyPaid: true };
    }

    const invoiceNumber = (
      await client.query(`SELECT 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 5, '0') AS n`)
    ).rows[0].n;

    // A product becomes the learner's own (an entitlement); months and licences go to the licence pool.
    let purchase: { rows: { id: string }[] } = { rows: [{ id: null as unknown as string }] };
    if (order.kind === "product" && String(order.product_id).startsWith("cert_")) {
      // A certificate extra changes the certificate (or queues a printed copy); nothing is owned.
      product = (await client.query(`SELECT * FROM products WHERE id = $1`, [order.product_id])).rows[0];
      if (product!.kind === "cert_extend") {
        await client.query(`UPDATE certificates SET valid_until = greatest(valid_until, current_date) + interval '12 months' WHERE id = $1 AND valid_until IS NOT NULL`, [order.certificate_id]);
      } else if (product!.kind === "cert_lifetime") {
        await client.query(`UPDATE certificates SET valid_until = NULL WHERE id = $1`, [order.certificate_id]);
      } else if (product!.kind === "cert_print") {
        await client.query(`INSERT INTO certificate_prints (certificate_id, order_id, shipping) VALUES ($1, $2, $3)`, [order.certificate_id, order.id, JSON.stringify(order.shipping ?? {})]);
      }
    } else if (order.kind === "product") {
      product = (await client.query(`SELECT * FROM products WHERE id = $1`, [order.product_id])).rows[0];
      const ent = await client.query(
        `INSERT INTO entitlements (user_id, product_id, test_type_id, level, attempts_total, ends_at, source, tenant_id, order_id)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), 'purchase', $7, $8) RETURNING id`,
        [order.buyer_id, product!.id, product!.test_type_id, order.level, product!.attempts, product!.duration_days, order.tenant_id, order.id],
      );
      await client.query(`UPDATE payment_orders SET entitlement_id = $2 WHERE id = $1`, [order.id, ent.rows[0].id]);
      // A practice pack aims at the level chosen: it becomes the learner's goal.
      if (product!.kind === "pack" && order.level) {
        await client.query(
          `INSERT INTO participant_profiles (user_id, goal_level) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET goal_level = EXCLUDED.goal_level, updated_at = now()`,
          [order.buyer_id, order.level],
        );
      }
    } else {
      purchase = await client.query(
        `INSERT INTO license_purchases (tenant_id, quantity, unit_price_cents, currency, source, reference, note, created_by, pool_expires_at)
         VALUES ($1, $2, $3, $4, 'purchase', $5, $6, $7, now() + make_interval(months => $8)) RETURNING id`,
        [order.tenant_id, order.quantity, order.unit_amount, order.currency, invoiceNumber, order.provider === "invoice" ? "Paid by invoice" : "Online checkout", order.buyer_id, POOL_VALIDITY_MONTHS],
      );
      await client.query(
        `INSERT INTO license_events (tenant_id, kind, quantity, actor_id, note) VALUES ($1, 'purchase', $2, $3, $4)`,
        [order.tenant_id, order.quantity, order.buyer_id, `${invoiceNumber} — ${order.provider === "invoice" ? `paid by invoice${order.po_number ? `, PO ${order.po_number}` : ""}` : "online checkout"}`],
      );
    }

    const description =
      order.kind === "product"
        ? `${product!.name}${order.level ? ` (${order.level})` : ""}${Number(order.credit_amount) > 0 ? " — less credit for unused preparation" : ""}${
            order.discount_reason === "level_retake" ? " — retake at half price" : order.discount_reason === "next_level" ? " — 25% off the next level" : ""
          }`
        : order.kind === "individual_plan"
          ? `Spica learner access — ${order.quantity} month${order.quantity === 1 ? "" : "s"}`
          : `Spica learner licenses (1 license = 1 learner-month)`;
    const invoice = await client.query(
      `INSERT INTO invoices (invoice_number, order_id, tenant_id, seller, bill_to, description, quantity, currency, unit_amount,
         subtotal, tax_label, tax_rate, tax_amount, total, provider, provider_payment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
      [
        invoiceNumber,
        order.id,
        order.tenant_id,
        JSON.stringify(PAYMENT_CONFIG.seller),
        JSON.stringify(order.bill_to),
        description,
        order.quantity,
        order.currency,
        order.unit_amount,
        order.subtotal,
        Number(order.tax_rate) > 0 ? `GST ${Number(order.tax_rate)}%` : null,
        order.tax_rate,
        order.tax_amount,
        order.total,
        order.provider,
        providerPaymentId,
      ],
    );
    invoiceId = invoice.rows[0].id;

    await client.query(
      `UPDATE payment_orders SET status = 'paid', paid_at = now(), provider_payment_id = $2, license_purchase_id = $3 WHERE id = $1`,
      [order.id, providerPaymentId, purchase.rows[0].id ?? null],
    );
    if (order.kind === "individual_plan") {
      await client.query(`UPDATE tenants SET type = 'individual_paid' WHERE id = $1 AND type = 'individual_free'`, [order.tenant_id]);
    } else if (order.kind === "product") {
      // Nothing more: the entitlement is the purchase.
    } else {
      // A purchase is a commitment: a big enough one moves a Starter
      // organization to Business, and any purchase converts a pilot.
      const plan = await getTenantPlan(order.tenant_id, client);
      const to = plan ? purchaseUpgradesTo(plan, order.quantity) : null;
      if (to) {
        await setTier({ tenantId: order.tenant_id, tier: to, actorId: order.buyer_id, note: `${invoiceNumber} — ${order.quantity} licenses`, executor: client });
        upgradedTo = to;
      }
      if (plan?.pilotEndsAt) {
        await client.query(`UPDATE tenants SET pilot_ends_at = NULL WHERE id = $1`, [order.tenant_id]);
        await client.query(
          `INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'pilot_ended', $2, $3)`,
          [order.tenant_id, `Converted with ${invoiceNumber}`, order.buyer_id],
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // An individual's plan is theirs — put the months straight onto their
  // account. Runs after commit (assignMonths has its own transaction); the
  // licenses are already safely in their pool if this ever fails.
  if (upgradedTo) {
    for (const id of await orgAdminIds(order.tenant_id)) {
      await notify({
        userId: id,
        kind: "plan_changed",
        title: `Your organization is now on ${TIER_LABELS[upgradedTo]}`,
        body: `Your purchase of ${order.quantity} licenses unlocked ${TIER_LABELS[upgradedTo]} pricing and features.`,
        link: "/orgadmin/plan",
        email: true,
      });
    }
  }
  // A printed copy to post: Spica staff hear about it.
  if (product?.kind === "cert_print") {
    const code = (await pool.query(`SELECT code FROM certificates WHERE id = $1`, [order.certificate_id])).rows[0]?.code;
    for (const s of (await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows) {
      await notify({
        userId: s.id,
        kind: "invoice_paid",
        title: "A printed certificate to post",
        body: `Print certificate ${code ?? ""} and post it. The address is on the order.`,
        link: "/superadmin/certificates",
        email: true,
      }).catch(() => {});
    }
  }
  if (order.kind === "product" && order.buyer_id) {
    accessCache.delete(order.buyer_id);
    // Full access includes a final assessment.
    if (product?.kind === "full") {
      const e = (await pool.query(`SELECT ends_at FROM entitlements WHERE order_id = $1`, [order.id])).rows[0];
      if (e) await includeFinalAssessment(order.buyer_id, order.tenant_id, e.ends_at).catch((err) => console.error("final assessment not included:", err));
    }
  }
  if (order.kind === "individual_plan" && order.buyer_id) {
    await assignMonths({ tenantId: order.tenant_id, userId: order.buyer_id, months: order.quantity, actorId: order.buyer_id, actorRole: "system" });
  }
  return { invoiceId, alreadyPaid: false };
}

export async function listInvoices(tenantId: string) {
  const result = await pool.query(
    `SELECT id, invoice_number, issued_at, description, quantity, currency, total, provider FROM invoices WHERE tenant_id = $1 ORDER BY issued_at DESC`,
    [tenantId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    issuedAt: r.issued_at,
    description: r.description,
    quantity: r.quantity,
    currency: r.currency,
    total: r.total,
    provider: r.provider,
  }));
}

export async function getInvoice(invoiceId: string, tenantId: string | null, isPlatformStaff: boolean) {
  const result = await pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND ($2::boolean OR tenant_id = $3)`,
    [invoiceId, isPlatformStaff, tenantId],
  );
  const r = result.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    invoiceNumber: r.invoice_number,
    issuedAt: r.issued_at,
    seller: r.seller,
    billTo: r.bill_to,
    description: r.description,
    quantity: r.quantity,
    currency: r.currency,
    unitAmount: r.unit_amount,
    subtotal: r.subtotal,
    taxLabel: r.tax_label,
    taxRate: Number(r.tax_rate),
    taxAmount: r.tax_amount,
    total: r.total,
    provider: r.provider,
    providerPaymentId: r.provider_payment_id,
    creditNotes: await listCreditNotes(r.id),
  };
}
