// Channel Partners stage 5: paid orders.
// A partner (or Spica staff) places an order for up to `max_organisations` of
// their organisations. Prices come from the normal Spica price list:
//  - Full access: licences priced per learner-month (volume bands, 15% off
//    for universities and colleges), for the order's licence length.
//  - A test product (preparation, real test, level test, practice pack) and
//    plain recruitment / admissions credits: paid in credits (credit bands).
// India pays in INR with 18% GST; organisations abroad pay in USD with no
// Indian GST (export of services). Commission = partner's rate x subtotal.
// Statuses: draft -> submitted -> proforma_sent -> payment_received ->
// confirmed -> allocated -> active -> expired, or cancelled. Allocation and
// the clocks running are stage 7; Finance's proforma and invoices stage 6.
import { pool } from "../db.js";
import { notify } from "../notifications/service.js";
import { recordAudit } from "../audit/service.js";
import { VOLUME_BANDS, EDUCATION_DISCOUNT_PERCENT } from "../plans/config.js";
import { ASSESSMENT_BANDS } from "../recruitment/service.js";
import { PAYMENT_CONFIG } from "../payments/providers.js";
import { PartnerError } from "./organisations.js";

export const ORDER_STATUSES = ["draft", "submitted", "proforma_sent", "payment_received", "confirmed", "allocated", "active", "expired", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DAY = 86400000;

export interface LineInput {
  kind: "full_access" | "product" | "credits";
  productId?: string | null;
  level?: string | null;
  quantity: number;
  // Staff only: a negotiated price per unit (per learner-month or per credit).
  unitAmount?: number | null;
}
export interface OrderInput {
  organisationIds: string[];
  lines: LineInput[];
  inIndia: boolean;
  gstin?: string | null;
  maxOrganisations?: number;
  perOrgCap?: number | null;
  validUntil: string; // YYYY-MM-DD
  licenceMonths: 1 | 3 | 6;
  notes?: string | null;
}
type Actor = { id: string; role: string; ip?: string | null };
const isStaff = (a: Actor) => a.role === "admin" || a.role === "super_admin";

const band = (bands: readonly { minQuantity: number; unitPriceCents: number }[], q: number) => {
  let p = bands[0].unitPriceCents;
  for (const b of bands) if (q >= b.minQuantity) p = b.unitPriceCents;
  return p;
};
// USD cents to the order currency's minor unit (INR rounded to whole rupees).
const toCurrency = (usdCents: number, currency: "INR" | "USD") => (currency === "INR" ? Math.round((usdCents * PAYMENT_CONFIG.inrPerUsd) / 100) * 100 : usdCents);

export async function quoteOrder(input: OrderInput, opts: { allowOverride: boolean }) {
  const currency: "INR" | "USD" = input.inIndia ? "INR" : "USD";
  if (!input.lines.length) throw new PartnerError("no_lines");
  const cats = input.organisationIds.length
    ? (await pool.query(`SELECT category FROM tenants WHERE id = ANY($1::uuid[])`, [input.organisationIds])).rows.map((r) => r.category)
    : [];
  const education = cats.length > 0 && cats.every((c) => c === "university");
  const products = new Map(
    (await pool.query(`SELECT id, kind, name, credits FROM products WHERE active AND kind IN ('prep', 'assessment', 'level', 'pack') AND credits IS NOT NULL`)).rows.map((p) => [p.id, p]),
  );
  // Credits needed per line, then one credit price for the whole order.
  const priced = input.lines.map((l) => {
    if (l.kind === "full_access") return { ...l, credits: null as number | null, name: "Full access" };
    if (l.kind === "credits") return { ...l, productId: null, credits: l.quantity, name: "Credits" };
    const p = products.get(l.productId ?? "");
    if (!p) throw new PartnerError("product_not_found");
    if (p.kind === "level" && !LEVELS.includes(l.level ?? "")) throw new PartnerError("level_required");
    const perLearner = p.credits * (p.kind === "prep" || p.kind === "pack" ? input.licenceMonths : 1);
    return { ...l, credits: perLearner * l.quantity, name: p.name as string };
  });
  const totalCredits = priced.reduce((n, l) => n + (l.credits ?? 0), 0);
  const creditUnit = toCurrency(band(ASSESSMENT_BANDS, totalCredits), currency);
  const lines = priced.map((l) => {
    const listUnit =
      l.kind === "full_access"
        ? toCurrency(Math.round((band(VOLUME_BANDS, l.quantity) * (100 - (education ? EDUCATION_DISCOUNT_PERCENT : 0))) / 100), currency)
        : creditUnit;
    const override = opts.allowOverride && l.unitAmount != null && l.unitAmount >= 0 && l.unitAmount !== listUnit;
    const unit = override ? Math.round(l.unitAmount!) : listUnit;
    const amount = l.kind === "full_access" ? unit * l.quantity * input.licenceMonths : unit * (l.credits ?? 0);
    return { kind: l.kind, productId: l.productId ?? null, name: l.name, level: l.level ?? null, quantity: l.quantity, credits: l.credits, unitAmount: unit, listUnitAmount: listUnit, amount, priceOverridden: override };
  });
  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const taxRate = input.inIndia ? PAYMENT_CONFIG.gstRate : 0;
  const taxAmount = Math.round((subtotal * taxRate) / 100);
  const licences = lines.filter((l) => l.kind === "full_access").reduce((n, l) => n + l.quantity, 0);
  return { currency, lines, subtotal, taxRate, taxAmount, total: subtotal + taxAmount, licences, credits: totalCredits, education };
}

function checkInput(input: OrderInput, actor: Actor) {
  const staff = isStaff(actor);
  const days = Math.round((new Date(input.validUntil + "T23:59:59Z").getTime() - Date.now()) / DAY);
  // Partners choose 2 weeks to 6 months; Spica can set any date up to 2 years.
  if (staff ? days < 1 || days > 731 : days < 13 || days > 186) throw new PartnerError("invalid_validity");
  const max = input.maxOrganisations ?? 10;
  if (!input.organisationIds.length) throw new PartnerError("no_organisations");
  if (input.organisationIds.length > max) throw new PartnerError("too_many_organisations", 400, { max });
  if (!staff && input.perOrgCap != null) throw new PartnerError("forbidden", 403);
  if (!staff && input.maxOrganisations != null && input.maxOrganisations > 10) throw new PartnerError("forbidden", 403);
}

// Organisations an order may name: the partner's own (or, for a direct Spica
// order, any active organisation).
async function checkOrganisations(partnerId: string | null, ids: string[]) {
  const r = await pool.query(
    `SELECT id FROM tenants WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL AND type = 'cohort' AND ($2::uuid IS NULL OR channel_partner_id = $2)`,
    [ids, partnerId],
  );
  if (r.rowCount !== new Set(ids).size) throw new PartnerError("organisation_not_found", 404);
}

async function recordEvent(client: { query: typeof pool.query }, orderId: string, from: string | null, to: string, actorId: string, note?: string | null) {
  await client.query(`INSERT INTO partner_order_events (order_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)`, [orderId, from, to, actorId, note ?? null]);
}

async function writeOrder(client: { query: typeof pool.query }, orderId: string, input: OrderInput, q: Awaited<ReturnType<typeof quoteOrder>>, commissionPercent: number) {
  await client.query(
    `UPDATE partner_orders SET in_india = $2, currency = $3, gstin = $4, max_organisations = $5, per_org_cap = $6, valid_until = $7, licence_months = $8,
       subtotal = $9, tax_rate = $10, tax_amount = $11, total = $12, commission_percent = $13, commission_amount = $14, notes = $15, updated_at = now() WHERE id = $1`,
    [orderId, input.inIndia, q.currency, input.gstin?.trim() || null, input.maxOrganisations ?? 10, input.perOrgCap ?? null, input.validUntil, input.licenceMonths, q.subtotal, q.taxRate, q.taxAmount, q.total, commissionPercent, Math.round((q.subtotal * commissionPercent) / 100), input.notes?.trim() || null],
  );
  await client.query(`DELETE FROM partner_order_lines WHERE order_id = $1`, [orderId]);
  for (const l of q.lines) {
    await client.query(
      `INSERT INTO partner_order_lines (order_id, kind, product_id, level, quantity, credits, unit_amount, amount, price_overridden) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [orderId, l.kind, l.productId, l.level, l.quantity, l.credits, l.unitAmount, l.amount, l.priceOverridden],
    );
  }
  await client.query(`DELETE FROM partner_order_organisations WHERE order_id = $1`, [orderId]);
  for (const t of new Set(input.organisationIds)) await client.query(`INSERT INTO partner_order_organisations (order_id, tenant_id) VALUES ($1, $2)`, [orderId, t]);
}

async function commissionFor(partnerId: string | null) {
  if (!partnerId) return 0;
  return Number((await pool.query(`SELECT commission_percent FROM channel_partners WHERE id = $1`, [partnerId])).rows[0]?.commission_percent ?? 0);
}

export async function createOrder(args: { actor: Actor; partnerId: string | null; input: OrderInput; submit: boolean }) {
  checkInput(args.input, args.actor);
  if (args.partnerId) {
    const p = (await pool.query(`SELECT deactivated_at FROM channel_partners WHERE id = $1`, [args.partnerId])).rows[0];
    if (!p) throw new PartnerError("partner_not_found", 404);
    if (p.deactivated_at) throw new PartnerError("partner_deactivated", 409);
  }
  await checkOrganisations(args.partnerId, args.input.organisationIds);
  const q = await quoteOrder(args.input, { allowOverride: isStaff(args.actor) });
  const commission = await commissionFor(args.partnerId);
  const client = await pool.connect();
  let orderId: string, number: string;
  try {
    await client.query("BEGIN");
    const seq = (await client.query(`SELECT nextval('partner_order_seq') AS n`)).rows[0].n;
    number = `SPO-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
    orderId = (
      await client.query(`INSERT INTO partner_orders (order_number, partner_id, currency, valid_until, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [number, args.partnerId, q.currency, args.input.validUntil, args.actor.id])
    ).rows[0].id;
    await writeOrder(client, orderId, args.input, q, commission);
    await recordEvent(client, orderId, null, "draft", args.actor.id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: "partner_order.created", targetType: "partner_order", targetId: orderId, targetLabel: number, details: { total: q.total, currency: q.currency }, ip: args.actor.ip ?? null });
  if (args.submit) await changeStatus({ orderId, to: "submitted", actor: args.actor });
  return { id: orderId, orderNumber: number };
}

// Who may edit: the partner while it's a draft; Spica until it's confirmed.
const STAFF_EDITABLE: OrderStatus[] = ["draft", "submitted", "proforma_sent", "payment_received"];

export async function updateOrder(args: { actor: Actor; orderId: string; partnerId: string | null; input: OrderInput }) {
  const o = await loadOrder(args.orderId, args.partnerId);
  if (!(isStaff(args.actor) ? STAFF_EDITABLE : ["draft"]).includes(o.status)) throw new PartnerError("order_locked", 409);
  checkInput(args.input, args.actor);
  await checkOrganisations(o.partner_id, args.input.organisationIds);
  const q = await quoteOrder(args.input, { allowOverride: isStaff(args.actor) });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeOrder(client, o.id, args.input, q, Number(o.commission_percent));
    await recordEvent(client, o.id, o.status, o.status, args.actor.id, "Order changed");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function loadOrder(orderId: string, partnerId: string | null) {
  const o = (await pool.query(`SELECT * FROM partner_orders WHERE id = $1 AND ($2::uuid IS NULL OR partner_id = $2)`, [orderId, partnerId])).rows[0];
  if (!o) throw new PartnerError("order_not_found", 404);
  return o;
}

// Allowed moves. Partners submit and cancel their own drafts / submitted
// orders; Spica moves an order through the payment steps (stage 6 gives these
// to Finance) and can cancel it until it's allocated.
const NEXT: Record<string, { to: OrderStatus; staff: boolean; partner: boolean }[]> = {
  draft: [{ to: "submitted", staff: true, partner: true }, { to: "cancelled", staff: true, partner: true }],
  submitted: [{ to: "proforma_sent", staff: true, partner: false }, { to: "cancelled", staff: true, partner: true }],
  proforma_sent: [{ to: "payment_received", staff: true, partner: false }, { to: "cancelled", staff: true, partner: false }],
  payment_received: [{ to: "confirmed", staff: true, partner: false }, { to: "cancelled", staff: true, partner: false }],
  confirmed: [{ to: "cancelled", staff: true, partner: false }],
};

const STATUS_TEXT: Record<string, string> = {
  submitted: "submitted",
  proforma_sent: "sent a proforma invoice for",
  payment_received: "received the payment for",
  confirmed: "confirmed",
  cancelled: "cancelled",
};

export async function changeStatus(args: { orderId: string; to: OrderStatus; actor: Actor; partnerId?: string | null; note?: string | null }) {
  const o = await loadOrder(args.orderId, args.partnerId ?? null);
  const staff = isStaff(args.actor);
  const move = (NEXT[o.status] ?? []).find((m) => m.to === args.to && (staff ? m.staff : m.partner));
  if (!move) throw new PartnerError("status_change_not_allowed", 409, { status: o.status });
  if (args.to === "cancelled" && staff && !args.note?.trim()) throw new PartnerError("reason_required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const u = await client.query(`UPDATE partner_orders SET status = $2, cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END, updated_at = now() WHERE id = $1 AND status = $4`, [o.id, args.to, args.note?.trim() || null, o.status]);
    if (!u.rowCount) throw new PartnerError("status_change_not_allowed", 409, { status: o.status });
    await recordEvent(client, o.id, o.status, args.to, args.actor.id, args.note);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: `partner_order.${args.to}`, targetType: "partner_order", targetId: o.id, targetLabel: o.order_number, details: args.note ? { note: args.note } : {}, ip: args.actor.ip ?? null });
  await notifyOrder(o, args.to, args.actor);
}

// Submitted: Super Admins and the Admin who looks after the partner. Spica's
// later steps: the partner. (Finance joins in stage 6.)
async function notifyOrder(o: { id: string; order_number: string; partner_id: string | null; total: number; currency: string }, to: OrderStatus, actor: Actor) {
  const money = `${o.currency} ${(o.total / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const p = o.partner_id ? (await pool.query(`SELECT user_id, full_name, created_by FROM channel_partners WHERE id = $1`, [o.partner_id])).rows[0] : null;
  if (to === "submitted") {
    const staff = await pool.query(
      `SELECT id, role FROM users WHERE deleted_at IS NULL AND (role = 'super_admin' OR (role = 'admin' AND id = $1)) AND id <> $2`,
      [p?.created_by ?? null, actor.id],
    );
    for (const s of staff.rows) {
      await notify({
        userId: s.id,
        kind: "partner_order",
        title: `New order ${o.order_number}`,
        body: `${p ? p.full_name : "Spica"} submitted order ${o.order_number} for ${money}.`,
        link: s.role === "super_admin" ? "/superadmin/partner-orders" : "/admin/partner-orders",
        dedupeKey: `porder:${o.id}:submitted:${s.id}`,
        email: true,
      });
    }
  } else if (p && actor.id !== p.user_id && STATUS_TEXT[to]) {
    await notify({
      userId: p.user_id,
      kind: "partner_order",
      title: `Order ${o.order_number}: ${to.replace("_", " ")}`,
      body: `Spica ${STATUS_TEXT[to]} order ${o.order_number}.`,
      link: "/partner/orders",
      dedupeKey: `porder:${o.id}:${to}`,
      email: true,
    });
  }
}

export async function listOrders(f: { partnerId?: string | null; status?: string | null; id?: string | null }) {
  const r = await pool.query(
    `SELECT o.*, to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until_text, p.full_name AS partner_name, p.code AS partner_code,
       (SELECT coalesce(sum(quantity), 0)::int FROM partner_order_lines l WHERE l.order_id = o.id AND l.kind = 'full_access') AS licences,
       (SELECT coalesce(sum(credits), 0)::int FROM partner_order_lines l WHERE l.order_id = o.id) AS credits,
       (SELECT array_agg(t.name ORDER BY t.name) FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id WHERE x.order_id = o.id) AS organisations
     FROM partner_orders o LEFT JOIN channel_partners p ON p.id = o.partner_id
     WHERE ($1::uuid IS NULL OR o.partner_id = $1) AND ($2::text IS NULL OR o.status = $2) AND ($3::uuid IS NULL OR o.id = $3)
     ORDER BY o.created_at DESC LIMIT 500`,
    [f.partnerId ?? null, f.status ?? null, f.id ?? null],
  );
  return r.rows.map(orderRow);
}

function orderRow(o: any) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status as OrderStatus,
    partner: o.partner_id ? { id: o.partner_id, name: o.partner_name, code: o.partner_code } : null,
    inIndia: o.in_india,
    currency: o.currency,
    gstin: o.gstin,
    maxOrganisations: o.max_organisations,
    perOrgCap: o.per_org_cap,
    validUntil: o.valid_until_text as string,
    licenceMonths: o.licence_months,
    subtotal: o.subtotal,
    taxRate: Number(o.tax_rate),
    taxAmount: o.tax_amount,
    total: o.total,
    commissionPercent: Number(o.commission_percent),
    commissionAmount: o.commission_amount,
    notes: o.notes,
    cancelReason: o.cancel_reason,
    licences: o.licences ?? 0,
    credits: o.credits ?? 0,
    organisations: (o.organisations ?? []) as string[],
    createdAt: o.created_at,
  };
}

export async function getOrder(orderId: string, partnerId: string | null) {
  const o = await loadOrder(orderId, partnerId);
  const [row] = await listOrders({ id: o.id });
  const lines = await pool.query(`SELECT l.*, p.name AS product_name FROM partner_order_lines l LEFT JOIN products p ON p.id = l.product_id WHERE l.order_id = $1 ORDER BY CASE l.kind WHEN 'full_access' THEN 0 WHEN 'product' THEN 1 ELSE 2 END, p.name`, [orderId]);
  const orgs = await pool.query(`SELECT t.id, t.name, t.category FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id WHERE x.order_id = $1 ORDER BY t.name`, [orderId]);
  const events = await pool.query(
    `SELECT e.from_status, e.to_status, e.note, e.created_at, u.first_name, u.last_name, u.email, u.role FROM partner_order_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.order_id = $1 ORDER BY e.created_at`,
    [orderId],
  );
  const licences = row.licences;
  const orgCount = Math.max(1, orgs.rowCount ?? 1);
  return {
    order: row,
    // The cap per organisation: Spica's number, or total licences / organisations.
    effectivePerOrgCap: row.perOrgCap ?? (licences ? Math.ceil(licences / orgCount) : null),
    lines: lines.rows.map((l) => ({ kind: l.kind, productId: l.product_id, name: l.kind === "full_access" ? "Full access" : l.kind === "credits" ? "Credits" : l.product_name, level: l.level, quantity: l.quantity, credits: l.credits, unitAmount: l.unit_amount, amount: l.amount, priceOverridden: l.price_overridden })),
    organisations: orgs.rows.map((t) => ({ id: t.id, name: t.name, category: t.category })),
    history: events.rows.map((e) => ({ from: e.from_status, to: e.to_status, note: e.note, at: e.created_at, by: e.email ? { name: [e.first_name, e.last_name].filter(Boolean).join(" "), email: e.email, role: e.role } : null })),
    nextSteps: NEXT[row.status] ?? [],
  };
}

// The products an order line can name, for the order form.
export async function orderProducts() {
  const r = await pool.query(
    `SELECT p.id, p.kind, p.name, p.credits, tt.name AS test_name FROM products p LEFT JOIN test_types tt ON tt.id = p.test_type_id
     WHERE p.active AND p.kind IN ('prep', 'assessment', 'level', 'pack') AND p.credits IS NOT NULL ORDER BY p.sort_order, p.name`,
  );
  return r.rows.map((p) => ({ id: p.id, kind: p.kind, name: p.name, credits: p.credits, testName: p.test_name }));
}
