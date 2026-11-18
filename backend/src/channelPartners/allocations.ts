// Channel Partners stage 7: allocating a confirmed order to its organisations,
// the 3-day setup grace, the order's end, and Spica extending it.
//  - Licences go into the organisation's normal licence pool as learner-months
//    (licences x the order's licence length), usable until the order ends. The
//    Org Admin assigns them as usual; a learner assigned during the grace gets
//    access at once and their clock starts when the grace ends.
//  - Credits go into the organisation's credit ledger.
//  - No refunds: unused licences can go to anyone else in the organisation
//    until the order ends, and a licence taken back from a learner who hasn't
//    started returns to the pool (licenses/service.ts reclaimMonths).
import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { recordAudit } from "../audit/service.js";
import { PAYMENT_CONFIG } from "../payments/providers.js";
import { PartnerError } from "./organisations.js";

export const SETUP_GRACE_DAYS = 3;
const DAY = 86400000;
type Actor = { id: string | null; role: string; ip?: string | null };
const shortDate = (d: Date | string | number) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// What an order has, what's been allocated, and each organisation's share.
export async function allocationSummary(orderId: string) {
  const o = (await pool.query(`SELECT * FROM partner_orders WHERE id = $1`, [orderId])).rows[0];
  if (!o) throw new PartnerError("order_not_found", 404);
  const totals = (
    await pool.query(
      `SELECT coalesce(sum(quantity) FILTER (WHERE kind = 'full_access'), 0)::int AS licences, coalesce(sum(credits), 0)::int AS credits FROM partner_order_lines WHERE order_id = $1`,
      [orderId],
    )
  ).rows[0];
  const orgs = await pool.query(
    `SELECT t.id, t.name,
       coalesce((SELECT sum(a.licences) FROM partner_order_allocations a WHERE a.order_id = $1 AND a.tenant_id = t.id), 0)::int AS licences,
       coalesce((SELECT sum(a.credits) FROM partner_order_allocations a WHERE a.order_id = $1 AND a.tenant_id = t.id), 0)::int AS credits,
       (SELECT max(a.grace_ends_at) FROM partner_order_allocations a WHERE a.order_id = $1 AND a.tenant_id = t.id) AS grace_ends_at,
       (SELECT count(DISTINCT la.user_id)::int FROM license_assignments la JOIN license_purchases p ON p.id = la.purchase_id
          WHERE p.partner_order_id = $1 AND p.tenant_id = t.id AND la.reclaimed_at IS NULL) AS assigned
     FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id WHERE x.order_id = $1 ORDER BY t.name`,
    [orderId],
  );
  const allocatedLicences = orgs.rows.reduce((n, r) => n + r.licences, 0);
  const allocatedCredits = orgs.rows.reduce((n, r) => n + r.credits, 0);
  const cap = o.per_org_cap ?? (totals.licences ? Math.ceil(totals.licences / Math.max(1, orgs.rowCount ?? 1)) : 0);
  return {
    order: o,
    licences: totals.licences,
    credits: totals.credits,
    allocatedLicences,
    allocatedCredits,
    perOrgCap: cap,
    organisations: orgs.rows.map((r) => ({ id: r.id, name: r.name, licences: r.licences, credits: r.credits, graceEndsAt: r.grace_ends_at, assigned: r.assigned })),
  };
}

export async function allocateOrder(args: { orderId: string; actor: Actor; items: { tenantId: string; licences: number; credits: number }[]; upgradeDemo?: boolean }) {
  const items = args.items.filter((i) => i.licences > 0 || i.credits > 0);
  if (!items.length) throw new PartnerError("nothing_to_allocate");
  const client = await pool.connect();
  let o: any;
  const graceEnds = new Date(Date.now() + SETUP_GRACE_DAYS * DAY);
  try {
    await client.query("BEGIN");
    o = (await client.query(`SELECT *, valid_until < current_date AS ended, to_char(valid_until, 'YYYY-MM-DD') AS vu FROM partner_orders WHERE id = $1 FOR UPDATE`, [args.orderId])).rows[0];
    if (!o) throw new PartnerError("order_not_found", 404);
    if (!["confirmed", "allocated", "active"].includes(o.status)) throw new PartnerError("order_not_confirmed", 409, { status: o.status });
    if (o.ended) throw new PartnerError("order_ended", 409);
    const s = await allocationSummary(o.id);
    const byOrg = new Map(s.organisations.map((x) => [x.id, x]));
    let addL = 0;
    let addC = 0;
    for (const i of items) {
      const org = byOrg.get(i.tenantId);
      if (!org) throw new PartnerError("organisation_not_on_order", 400);
      if (org.licences + i.licences > s.perOrgCap && i.licences > 0) throw new PartnerError("over_org_cap", 409, { cap: s.perOrgCap, organisation: org.name });
      addL += i.licences;
      addC += i.credits;
    }
    if (s.allocatedLicences + addL > s.licences) throw new PartnerError("over_order_licences", 409, { left: s.licences - s.allocatedLicences });
    if (s.allocatedCredits + addC > s.credits) throw new PartnerError("over_order_credits", 409, { left: s.credits - s.allocatedCredits });
    // Price per learner-month, in USD cents for the licence pool's records.
    const line = (await client.query(`SELECT unit_amount FROM partner_order_lines WHERE order_id = $1 AND kind = 'full_access' LIMIT 1`, [o.id])).rows[0];
    const unitUsdCents = line ? (o.currency === "INR" ? Math.round(line.unit_amount / PAYMENT_CONFIG.inrPerUsd) : line.unit_amount) : 0;
    for (const i of items) {
      let purchaseId: string | null = null;
      if (i.licences > 0) {
        const months = i.licences * o.licence_months;
        purchaseId = (
          await client.query(
            `INSERT INTO license_purchases (tenant_id, quantity, unit_price_cents, source, reference, note, created_by, pool_expires_at, partner_order_id, starts_not_before)
             VALUES ($1, $2, $3, 'purchase', $4, $5, $6, ($7::date + 1)::timestamptz, $8, $9) RETURNING id`,
            [i.tenantId, months, unitUsdCents, o.order_number, `Channel Partner order: ${i.licences} licences x ${o.licence_months} months`, args.actor.id, o.vu, o.id, graceEnds],
          )
        ).rows[0].id;
        await client.query(`INSERT INTO license_events (tenant_id, kind, quantity, actor_id, note) VALUES ($1, 'purchase', $2, $3, $4)`, [i.tenantId, months, args.actor.id, `${o.order_number} (${i.licences} licences)`]);
      }
      if (i.credits > 0) {
        await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, note, actor_id) VALUES ($1, $2, 'purchase', $3, $4)`, [i.tenantId, i.credits, `Channel Partner order ${o.order_number}`, args.actor.id]);
      }
      await client.query(
        `INSERT INTO partner_order_allocations (order_id, tenant_id, licences, credits, purchase_id, grace_ends_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [o.id, i.tenantId, i.licences, i.credits, purchaseId, graceEnds, args.actor.id],
      );
    }
    const note = items.map((i) => `${byOrg.get(i.tenantId)!.name}: ${i.licences} licences, ${i.credits} credits`).join("; ");
    if (o.status === "confirmed") await client.query(`UPDATE partner_orders SET status = 'allocated', updated_at = now() WHERE id = $1`, [o.id]);
    await client.query(`INSERT INTO partner_order_events (order_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)`, [o.id, o.status, o.status === "confirmed" ? "allocated" : o.status, args.actor.id, note]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: "partner_order.allocated", targetType: "partner_order", targetId: o.id, targetLabel: o.order_number, details: { items } });
  // Demo to paid: the organisations' demo learners get paid licences now.
  const upgraded = new Map<string, number>();
  if (args.upgradeDemo) {
    const { upgradeDemoLearners } = await import("./demoLicences.js");
    for (const i of items) {
      if (i.licences > 0) upgraded.set(i.tenantId, (await upgradeDemoLearners({ tenantId: i.tenantId, actorId: args.actor.id!, actorRole: "system" })).upgraded);
    }
  }
  // The organisations' admins and the partner.
  for (const i of items) {
    // Whole sentences with the numbers in them, so they translate.
    const got = i.licences && i.credits ? `Order ${o.order_number}: ${i.licences} licences of ${o.licence_months} months and ${i.credits} credits are now in your organisation.` : i.licences ? `Order ${o.order_number}: ${i.licences} licences of ${o.licence_months} months are now in your organisation.` : `Order ${o.order_number}: ${i.credits} credits are now in your organisation.`;
    const up = upgraded.get(i.tenantId);
    for (const id of await orgAdminIds(i.tenantId)) {
      await notify({
        userId: id,
        kind: "partner_order",
        title: "Licences and credits ready to assign",
        body: [got, `Add your learners and assign them by ${shortDate(o.valid_until)}.`, i.licences ? `Licences assigned in the next 3 days start counting on ${shortDate(graceEnds)}.` : null, up ? `${up} demo learners already have a paid licence and keep their history.` : null].filter(Boolean).join(" "),
        link: "/orgadmin/dashboard",
        email: true,
      });
    }
  }
  if (o.partner_id) {
    const p = (await pool.query(`SELECT user_id FROM channel_partners WHERE id = $1`, [o.partner_id])).rows[0];
    if (p && p.user_id !== args.actor.id) {
      await notify({ userId: p.user_id, kind: "partner_order", title: `Order ${o.order_number}: licences allocated`, body: `Spica has allocated order ${o.order_number} to its organisations. Their admins can now assign the licences.`, link: "/partner/orders", email: true });
    }
  }
}

// Spica extends (or shortens) an order's end date: unassigned licences stay
// usable until then.
export async function changeOrderEnd(args: { orderId: string; actor: Actor; validUntil: string }) {
  const o = (await pool.query(`SELECT * FROM partner_orders WHERE id = $1`, [args.orderId])).rows[0];
  if (!o) throw new PartnerError("order_not_found", 404);
  if (!["confirmed", "allocated", "active", "expired"].includes(o.status)) throw new PartnerError("order_not_confirmed", 409);
  const days = (new Date(args.validUntil + "T23:59:59Z").getTime() - Date.now()) / DAY;
  if (days < 1 || days > 731) throw new PartnerError("invalid_validity");
  const next = o.status === "expired" ? ((await pool.query(`SELECT 1 FROM partner_order_allocations WHERE order_id = $1 LIMIT 1`, [o.id])).rowCount ? "active" : "confirmed") : o.status;
  await pool.query(`UPDATE partner_orders SET valid_until = $2, status = $3, updated_at = now() WHERE id = $1`, [o.id, args.validUntil, next]);
  await pool.query(`UPDATE license_purchases SET pool_expires_at = ($2::date + 1)::timestamptz WHERE partner_order_id = $1`, [o.id, args.validUntil]);
  await pool.query(`INSERT INTO partner_order_events (order_id, from_status, to_status, actor_id, note) VALUES ($1, $2, $3, $4, $5)`, [o.id, o.status, next, args.actor.id, `Order end changed to ${args.validUntil}`]);
  await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: "partner_order.end_changed", targetType: "partner_order", targetId: o.id, targetLabel: o.order_number, details: { validUntil: args.validUntil } });
}

// Run with the notification jobs: grace over -> active; order end reminders
// (14 and 3 days before, and at the end) -> expired.
export async function runPartnerOrderJobs(now = Date.now()): Promise<number> {
  let sent = 0;
  // Grace over: tell each organisation once, and the order becomes active.
  const graces = await pool.query(
    `SELECT a.id, a.tenant_id, a.licences, o.id AS order_id, o.order_number, o.status FROM partner_order_allocations a JOIN partner_orders o ON o.id = a.order_id
     WHERE a.grace_ends_at <= now() AND a.grace_ends_at > now() - interval '3 days' AND a.licences > 0 AND o.status IN ('allocated', 'active')`,
  );
  for (const g of graces.rows) {
    for (const id of await orgAdminIds(g.tenant_id)) {
      const r = await notify({ userId: id, kind: "partner_order", title: "Your licences have started", body: `The setup days for order ${g.order_number} are over. Licences now count from the day they're assigned.`, link: "/orgadmin/dashboard", dedupeKey: `palloc:${g.id}:grace`, email: true });
      if (r) sent++;
    }
  }
  await pool.query(
    `UPDATE partner_orders o SET status = 'active', updated_at = now() WHERE o.status = 'allocated'
       AND NOT EXISTS (SELECT 1 FROM partner_order_allocations a WHERE a.order_id = o.id AND a.grace_ends_at > now())`,
  );

  // Order end: the partner, the organisations' admins, Super Admins and the partner's Admin.
  const ending = await pool.query(
    `SELECT o.id, o.order_number, o.valid_until, to_char(o.valid_until, 'YYYY-MM-DD') AS vu, o.status, p.user_id AS partner_user, p.created_by AS partner_admin
     FROM partner_orders o LEFT JOIN channel_partners p ON p.id = o.partner_id
     WHERE o.status IN ('confirmed', 'allocated', 'active') AND o.valid_until <= current_date + 14`,
  );
  for (const o of ending.rows) {
    const ends = new Date(o.valid_until).getTime() + DAY; // end of that day
    const stage = ends <= now ? "ended" : ends - now <= 3 * DAY ? "3d" : "14d";
    const unassigned = (
      await pool.query(
        `SELECT coalesce(sum(p.quantity - (SELECT count(*) FROM license_assignments la WHERE la.purchase_id = p.id AND la.reclaimed_at IS NULL)), 0)::int AS n FROM license_purchases p WHERE p.partner_order_id = $1`,
        [o.id],
      )
    ).rows[0].n;
    const copy =
      stage === "ended"
        ? { title: `Order ${o.order_number} has ended`, body: unassigned ? `${unassigned} unassigned learner-months have expired. Learners keep the licences they already have. Spica can extend the order.` : "Learners keep the licences they already have." }
        : { title: `Order ${o.order_number} ends on ${shortDate(o.valid_until)}`, body: unassigned ? `${unassigned} learner-months are still unassigned. Assign them before the order ends.` : "Every licence on this order is assigned." };
    const staff = (await pool.query(`SELECT id, role FROM users WHERE deleted_at IS NULL AND (role = 'super_admin' OR (role = 'admin' AND id = $1))`, [o.partner_admin])).rows;
    const orgs = (await pool.query(`SELECT tenant_id FROM partner_order_organisations WHERE order_id = $1`, [o.id])).rows;
    const people: { id: string; link: string }[] = [
      ...(o.partner_user ? [{ id: o.partner_user, link: "/partner/orders" }] : []),
      ...staff.map((s) => ({ id: s.id, link: s.role === "super_admin" ? "/superadmin/partner-orders" : "/admin/partner-orders" })),
    ];
    for (const t of orgs) for (const id of await orgAdminIds(t.tenant_id)) people.push({ id, link: "/orgadmin/dashboard" });
    for (const p of people) {
      const r = await notify({ userId: p.id, kind: "partner_order", ...copy, link: p.link, dedupeKey: `porder:${o.id}:${o.vu}:${stage}:${p.id}`, email: true });
      if (r) sent++;
    }
    if (stage === "ended") {
      await pool.query(`UPDATE partner_orders SET status = 'expired', updated_at = now() WHERE id = $1 AND status = $2`, [o.id, o.status]);
      await pool.query(`INSERT INTO partner_order_events (order_id, from_status, to_status, note) VALUES ($1, $2, 'expired', 'Order end date passed')`, [o.id, o.status]);
    }
  }
  return sent;
}
