// Channel Partners stage 9: partner performance and commission.
//  - Performance (staff): per partner, the organisations they brought, demo
//    use, conversion to paid, orders, revenue and commission, licences and
//    tests completed. Usage counts are all-time; organisations added, orders,
//    revenue and commission follow the chosen period.
//  - Commission: each confirmed order's commission (partner's rate x subtotal,
//    without tax), and whether Finance has paid it to the partner.
import { pool } from "../db.js";
import { notify } from "../notifications/service.js";
import { recordAudit } from "../audit/service.js";
import { PartnerError } from "./organisations.js";

const PAID = ["confirmed", "allocated", "active", "expired"];

export async function partnerPerformance(f: { from: string | null; to: string | null }) {
  const r = await pool.query(
    `WITH orgs AS (SELECT t.id, t.channel_partner_id AS pid, t.created_at FROM tenants t WHERE t.channel_partner_id IS NOT NULL),
     paid_orders AS (
       SELECT o.*, (SELECT min(e.created_at) FROM partner_order_events e WHERE e.order_id = o.id AND e.to_status = 'confirmed') AS confirmed_at
       FROM partner_orders o WHERE o.partner_id IS NOT NULL AND o.status = ANY($3::text[]))
     SELECT p.id, p.full_name, p.code, p.commission_percent, p.demo_licences, p.deactivated_at,
       (SELECT count(*)::int FROM orgs WHERE orgs.pid = p.id AND ($1::date IS NULL OR orgs.created_at >= $1) AND ($2::date IS NULL OR orgs.created_at < $2::date + 1)) AS orgs_added,
       (SELECT count(*)::int FROM orgs WHERE orgs.pid = p.id) AS orgs_total,
       (SELECT coalesce(sum(a.licences), 0)::int FROM partner_allocations a WHERE a.partner_id = p.id AND a.kind = 'demo') AS demo_given,
       (SELECT count(*)::int FROM entitlements e JOIN orgs ON orgs.id = e.tenant_id WHERE orgs.pid = p.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL) AS demo_used,
       (SELECT count(*)::int FROM users u JOIN orgs ON orgs.id = u.tenant_id WHERE orgs.pid = p.id AND u.role = 'learner' AND u.deleted_at IS NULL) AS learners,
       (SELECT count(DISTINCT s.user_id)::int FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs ON orgs.id = u.tenant_id WHERE orgs.pid = p.id) AS learners_started,
       (SELECT count(*)::int FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs ON orgs.id = u.tenant_id
          WHERE orgs.pid = p.id AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL) AS mocks_done,
       (SELECT count(*)::int FROM sessions s JOIN users u ON u.id = s.user_id JOIN orgs ON orgs.id = u.tenant_id
          WHERE orgs.pid = p.id AND s.session_type = 'mocktest' AND s.delivery_mode = 'certified' AND s.completed_at IS NOT NULL) AS real_tests_done,
       (SELECT count(*)::int FROM certificates c JOIN orgs ON orgs.id = c.tenant_id WHERE orgs.pid = p.id AND c.kind = 'result' AND c.revoked_at IS NULL) AS certificates,
       (SELECT count(DISTINCT x.tenant_id)::int FROM partner_order_organisations x JOIN paid_orders po ON po.id = x.order_id WHERE po.partner_id = p.id) AS orgs_converted,
       (SELECT count(*)::int FROM paid_orders po WHERE po.partner_id = p.id AND ($1::date IS NULL OR po.confirmed_at >= $1) AND ($2::date IS NULL OR po.confirmed_at < $2::date + 1)) AS orders_paid,
       (SELECT coalesce(json_object_agg(c, v), '{}') FROM (SELECT po.currency AS c, sum(po.subtotal)::bigint AS v FROM paid_orders po
          WHERE po.partner_id = p.id AND ($1::date IS NULL OR po.confirmed_at >= $1) AND ($2::date IS NULL OR po.confirmed_at < $2::date + 1) GROUP BY po.currency) x) AS revenue,
       (SELECT coalesce(json_object_agg(c, v), '{}') FROM (SELECT po.currency AS c, sum(po.commission_amount)::bigint AS v FROM paid_orders po
          WHERE po.partner_id = p.id AND ($1::date IS NULL OR po.confirmed_at >= $1) AND ($2::date IS NULL OR po.confirmed_at < $2::date + 1) GROUP BY po.currency) x) AS commission,
       (SELECT coalesce(json_object_agg(c, v), '{}') FROM (SELECT po.currency AS c, sum(po.commission_amount)::bigint AS v FROM paid_orders po
          WHERE po.partner_id = p.id AND po.commission_paid_at IS NULL AND po.commission_amount > 0 GROUP BY po.currency) x) AS commission_unpaid,
       (SELECT coalesce(sum(a.licences), 0)::int FROM partner_order_allocations a JOIN partner_orders o ON o.id = a.order_id WHERE o.partner_id = p.id) AS paid_allocated,
       (SELECT count(DISTINCT la.user_id)::int FROM license_assignments la JOIN license_purchases lp ON lp.id = la.purchase_id JOIN partner_orders o ON o.id = lp.partner_order_id
          WHERE o.partner_id = p.id AND la.reclaimed_at IS NULL) AS paid_assigned
     FROM channel_partners p ORDER BY p.full_name`,
    [f.from, f.to, PAID],
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.full_name,
    code: x.code,
    active: !x.deactivated_at,
    commissionPercent: Number(x.commission_percent),
    organisationsAdded: x.orgs_added,
    organisationsTotal: x.orgs_total,
    organisationsConverted: x.orgs_converted,
    demoAllocation: x.demo_licences,
    demoGiven: x.demo_given,
    demoUsed: x.demo_used,
    learners: x.learners,
    learnersStarted: x.learners_started,
    mocksDone: x.mocks_done,
    realTestsDone: x.real_tests_done,
    certificates: x.certificates,
    ordersPaid: x.orders_paid,
    revenue: x.revenue as Record<string, number>,
    commission: x.commission as Record<string, number>,
    commissionUnpaid: x.commission_unpaid as Record<string, number>,
    paidLicencesAllocated: x.paid_allocated,
    paidLicencesAssigned: x.paid_assigned,
  }));
}

export async function commissionRows(f: { partnerId?: string | null; unpaidOnly?: boolean }) {
  const r = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.currency, o.subtotal, o.commission_percent, o.commission_amount, o.commission_paid_at, o.commission_paid_reference,
       p.id AS partner_id, p.full_name, p.code,
       (SELECT min(e.created_at) FROM partner_order_events e WHERE e.order_id = o.id AND e.to_status = 'confirmed') AS confirmed_at,
       (SELECT array_agg(t.name ORDER BY t.name) FROM partner_order_organisations x JOIN tenants t ON t.id = x.tenant_id WHERE x.order_id = o.id) AS organisations
     FROM partner_orders o JOIN channel_partners p ON p.id = o.partner_id
     WHERE o.status = ANY($1::text[]) AND ($2::uuid IS NULL OR o.partner_id = $2) AND (NOT $3 OR (o.commission_paid_at IS NULL AND o.commission_amount > 0))
     ORDER BY confirmed_at DESC NULLS LAST LIMIT 1000`,
    [PAID, f.partnerId ?? null, !!f.unpaidOnly],
  );
  return r.rows.map((o) => ({
    orderId: o.id,
    orderNumber: o.order_number,
    status: o.status,
    partner: { id: o.partner_id, name: o.full_name, code: o.code },
    organisations: (o.organisations ?? []) as string[],
    confirmedAt: o.confirmed_at,
    currency: o.currency,
    subtotal: o.subtotal,
    commissionPercent: Number(o.commission_percent),
    commission: o.commission_amount,
    paidAt: o.commission_paid_at,
    paidReference: o.commission_paid_reference,
  }));
}

// Finance pays a partner's commission on one or more orders.
export async function markCommissionPaid(args: { orderIds: string[]; reference: string; actor: { id: string; role: string; ip?: string | null } }) {
  const r = await pool.query(
    `UPDATE partner_orders SET commission_paid_at = now(), commission_paid_reference = $2, commission_paid_by = $3
     WHERE id = ANY($1::uuid[]) AND partner_id IS NOT NULL AND status = ANY($4::text[]) AND commission_paid_at IS NULL AND commission_amount > 0
     RETURNING id, order_number, partner_id, commission_amount, currency`,
    [args.orderIds, args.reference.trim(), args.actor.id, PAID],
  );
  if (!r.rowCount) throw new PartnerError("nothing_to_pay", 409);
  const byPartner = new Map<string, typeof r.rows>();
  for (const o of r.rows) byPartner.set(o.partner_id, [...(byPartner.get(o.partner_id) ?? []), o]);
  for (const [partnerId, orders] of byPartner) {
    const p = (await pool.query(`SELECT user_id FROM channel_partners WHERE id = $1`, [partnerId])).rows[0];
    const totals = new Map<string, number>();
    for (const o of orders) totals.set(o.currency, (totals.get(o.currency) ?? 0) + o.commission_amount);
    const money = [...totals].map(([c, v]) => `${c} ${(v / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" + ");
    if (p) {
      await notify({
        userId: p.user_id,
        kind: "partner_order",
        title: "Commission paid",
        body: `Spica has paid your commission of ${money} for ${orders.map((o) => o.order_number).join(", ")}. Reference: ${args.reference.trim()}.`,
        link: "/partner/commission",
        email: true,
      });
    }
    await recordAudit({ tenantId: null, actorId: args.actor.id, actorRole: args.actor.role, action: "channel_partner.commission_paid", targetType: "channel_partner", targetId: partnerId, details: { orders: orders.map((o) => o.order_number), reference: args.reference }, ip: args.actor.ip ?? null });
  }
  return { paid: r.rowCount };
}
