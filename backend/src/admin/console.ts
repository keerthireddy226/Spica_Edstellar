import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createAndInviteUser, resendSetPasswordLink } from "../auth/invite.js";
import { LicenseError, assignMonths, creditPool, learnerAccessMap } from "../licenses/service.js";
import { orgHealth } from "./health.js";
import { learnerDetailsSchema } from "../learners/details.js";
import { isSuperAdmin, orgScope, requirePermission, requireStaff, staffPermissions } from "./staff.js";

// The Edstellar staff consoles: the portfolio dashboard, billing and audit
// across organizations, individual learners, and organization ownership.
export const staffConsoleRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const MAX_BULK_ROWS = 200;

const name = (alias: string) => `coalesce(nullif(concat_ws(' ', ${alias}.first_name, ${alias}.last_name), ''), ${alias}.email)`;

// ---- Portfolio dashboard ----

staffConsoleRouter.get("/portfolio", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const sup = isSuperAdmin(req);
    const scope = orgScope(req);
    const perms = await staffPermissions(req);
    const orgs = (
      await pool.query(
        `SELECT t.id, t.name, t.category, t.plan_tier, t.pilot_ends_at, t.contract_end, t.deactivated_at, t.created_at, t.managed_by,
           (SELECT ${name("oa")} FROM users oa WHERE oa.tenant_id = t.id AND oa.role = 'org_admin' AND oa.deleted_at IS NULL LIMIT 1) AS org_admin_name,
           EXISTS (SELECT 1 FROM users oa WHERE oa.tenant_id = t.id AND oa.role = 'org_admin' AND oa.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = oa.id)) AS org_admin_pending,
           (SELECT ${name("m")} FROM users m WHERE m.id = coalesce(t.account_manager_id, t.managed_by)) AS owner_name
         FROM tenants t WHERE t.type = 'cohort' ${scope.sql}
         ORDER BY t.name`,
        scope.params,
      )
    ).rows;
    const active = orgs.filter((o) => !o.deactivated_at);
    const ids = active.map((o) => o.id);
    const health = await orgHealth(ids);

    const [learners, individuals, licenses, revenue, outstanding, trend, reviews, recent] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS new7,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0 AND d.day > current_date - 7))::int AS active7
         FROM users u WHERE u.role = 'learner' AND u.deleted_at IS NULL AND u.tenant_id = ANY($1::uuid[])`,
        [ids],
      ),
      pool.query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE t.type = 'individual_paid')::int AS paid,
           count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS new7,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0 AND d.day > current_date - 7))::int AS active7
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.role = 'learner' AND u.deleted_at IS NULL AND t.type IN ('individual_free', 'individual_paid')`,
      ),
      pool.query(
        `SELECT coalesce(sum(p.quantity), 0)::int AS bought,
           (SELECT count(*)::int FROM license_assignments a JOIN license_purchases p2 ON p2.id = a.purchase_id
              WHERE p2.tenant_id = ANY($1::uuid[]) AND p2.pool_expires_at > now() AND a.reclaimed_at IS NULL) AS assigned,
           (SELECT coalesce(sum(p3.quantity - (SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p3.id AND a.reclaimed_at IS NULL)), 0)::int
              FROM license_purchases p3 WHERE p3.tenant_id = ANY($1::uuid[]) AND p3.pool_expires_at BETWEEN now() AND now() + interval '30 days') AS expiring_unused
         FROM license_purchases p WHERE p.tenant_id = ANY($1::uuid[]) AND p.pool_expires_at > now()`,
        [ids],
      ),
      // Money in: organizations' license orders and individuals' plans.
      pool.query(
        `SELECT o.currency,
           coalesce(sum(o.total) FILTER (WHERE o.paid_at >= date_trunc('month', now())), 0)::bigint AS this_month,
           coalesce(sum(o.total) FILTER (WHERE o.paid_at >= date_trunc('month', now()) - interval '1 month' AND o.paid_at < date_trunc('month', now())), 0)::bigint AS last_month,
           coalesce(sum(o.total) FILTER (WHERE o.paid_at >= date_trunc('year', now())), 0)::bigint AS this_year
         FROM payment_orders o JOIN tenants t ON t.id = o.tenant_id
         WHERE o.status = 'paid' AND (o.kind = 'individual_plan' OR o.tenant_id = ANY($1::uuid[]))
         GROUP BY o.currency`,
        [ids],
      ),
      pool.query(
        `SELECT o.currency, count(*)::int AS n, coalesce(sum(o.total), 0)::bigint AS total,
           count(*) FILTER (WHERE o.due_date < current_date)::int AS overdue
         FROM payment_orders o
         WHERE o.provider = 'invoice' AND o.status = 'created' AND o.tenant_id = ANY($1::uuid[])
         GROUP BY o.currency`,
        [ids],
      ),
      // Eight weeks: new learners, and learners who practised that week.
      pool.query(
        `SELECT to_char(w, 'YYYY-MM-DD') AS week,
           (SELECT count(*)::int FROM users u JOIN tenants t ON t.id = u.tenant_id
              WHERE u.role = 'learner' AND u.created_at >= w AND u.created_at < w + interval '7 days'
                AND (u.tenant_id = ANY($1::uuid[]) OR t.type <> 'cohort')) AS signups,
           (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN users u ON u.id = d.user_id JOIN tenants t ON t.id = u.tenant_id
              WHERE d.sessions > 0 AND d.day >= w::date AND d.day < (w + interval '7 days')::date
                AND (u.tenant_id = ANY($1::uuid[]) OR t.type <> 'cohort')) AS active
         FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w
         ORDER BY w`,
        [ids],
      ),
      perms.scoreReview
        ? pool.query(
            `SELECT count(*)::int AS n FROM placements p JOIN users u ON u.id = p.user_id JOIN tenants t ON t.id = u.tenant_id
             WHERE p.status = 'pending_review' AND (t.type <> 'cohort' OR t.id = ANY($1::uuid[]) OR $2::boolean)`,
            [ids, sup],
          )
        : Promise.resolve({ rows: [{ n: 0 }] }),
      pool.query(
        `SELECT a.action, a.actor_label, a.actor_role, a.target_label, a.created_at, t.name AS org_name
         FROM audit_log a LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE ($2::boolean OR a.tenant_id = ANY($1::uuid[]) OR a.actor_id = $3)
         ORDER BY a.created_at DESC LIMIT 12`,
        [ids, sup, req.user!.id],
      ),
    ]);

    const now = Date.now();
    const day = 86400000;
    const healthList = active.map((o) => ({ id: o.id, name: o.name, ...health.get(o.id)! })).filter((h) => h.score !== undefined);
    const attention: { kind: string; orgId: string | null; title: string; detail: string }[] = [];
    for (const h of healthList.filter((x) => x.band === "at_risk")) {
      attention.push({ kind: "at_risk", orgId: h.id, title: `${h.name} is at risk`, detail: h.flags.slice(0, 2).join(" · ") || `Health ${h.score}/100` });
    }
    for (const o of active) {
      if (o.org_admin_pending) attention.push({ kind: "invite", orgId: o.id, title: `${o.name}: Org Admin hasn't accepted the invite`, detail: o.org_admin_name ?? "" });
      if (!o.org_admin_name) attention.push({ kind: "no_admin", orgId: o.id, title: `${o.name} has no Org Admin`, detail: "Assign one from the organization." });
      if (o.pilot_ends_at && new Date(o.pilot_ends_at).getTime() - now < 14 * day && new Date(o.pilot_ends_at).getTime() > now) {
        attention.push({ kind: "pilot", orgId: o.id, title: `${o.name}'s pilot ends soon`, detail: new Date(o.pilot_ends_at).toDateString() });
      }
    }
    const overdue = outstanding.rows.reduce((n, r) => n + r.overdue, 0);
    if (overdue) attention.push({ kind: "overdue", orgId: null, title: overdue === 1 ? "1 invoice overdue" : `${overdue} invoices overdue`, detail: "See Billing." });
    if (reviews.rows[0].n) attention.push({ kind: "review", orgId: null, title: reviews.rows[0].n === 1 ? "1 placement waiting for review" : `${reviews.rows[0].n} placements waiting for review`, detail: "Flagged identity checks." });

    const renewals = active
      .filter((o) => o.contract_end && new Date(o.contract_end).getTime() > now - day && new Date(o.contract_end).getTime() - now < 60 * day)
      .map((o) => ({ id: o.id, name: o.name, contractEnd: o.contract_end, ownerName: o.owner_name }))
      .sort((a, b) => +new Date(a.contractEnd) - +new Date(b.contractEnd));

    let admins: unknown[] | null = null;
    let system: unknown = null;
    if (sup) {
      const a = await pool.query(
        `SELECT u.id, ${name("u")} AS name, u.email, u.department, u.deleted_at,
           (SELECT max(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
           coalesce(array_agg(t.id) FILTER (WHERE t.id IS NOT NULL AND t.deactivated_at IS NULL), '{}') AS org_ids
         FROM users u LEFT JOIN tenants t ON t.type = 'cohort' AND (t.managed_by = u.id OR t.account_manager_id = u.id)
         WHERE u.role = 'admin'
         GROUP BY u.id ORDER BY name`,
      );
      const learnerCounts = await pool.query(
        `SELECT tenant_id, count(*)::int AS n FROM users WHERE role = 'learner' AND deleted_at IS NULL AND tenant_id = ANY($1::uuid[]) GROUP BY tenant_id`,
        [ids],
      );
      const lc = new Map(learnerCounts.rows.map((r) => [r.tenant_id, r.n]));
      admins = a.rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        department: r.department,
        active: !r.deleted_at,
        lastLoginAt: r.last_login_at,
        organizations: r.org_ids.length,
        learners: r.org_ids.reduce((n: number, id: string) => n + (lc.get(id) ?? 0), 0),
        atRisk: r.org_ids.filter((id: string) => health.get(id)?.band === "at_risk").length,
      }));
      const jobs = await pool.query(
        `SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'queued' AND run_at <= now())::int AS ready FROM job_queue`,
      );
      system = { failedJobs: jobs.rows[0].failed, readyJobs: jobs.rows[0].ready };
      if (jobs.rows[0].failed) attention.push({ kind: "jobs", orgId: null, title: jobs.rows[0].failed === 1 ? "1 background job failed" : `${jobs.rows[0].failed} background jobs failed`, detail: "See System." });
      const neverIn = a.rows.filter((r) => !r.deleted_at && !r.last_login_at).length;
      if (neverIn) attention.push({ kind: "admin_invite", orgId: null, title: neverIn === 1 ? "1 Admin hasn't signed in yet" : `${neverIn} Admins haven't signed in yet`, detail: "See Admins." });
    }

    const l = learners.rows[0];
    const i = individuals.rows[0];
    const lic = licenses.rows[0];
    res.json({
      scope: sup ? "platform" : "portfolio",
      permissions: perms,
      organizations: {
        active: active.length,
        deactivated: orgs.length - active.length,
        companies: active.filter((o) => o.category !== "university").length,
        universities: active.filter((o) => o.category === "university").length,
        pilots: active.filter((o) => o.pilot_ends_at && new Date(o.pilot_ends_at).getTime() > now).length,
        byTier: ["starter", "business", "enterprise"].map((tier) => ({ tier, count: active.filter((o) => o.plan_tier === tier).length })),
        healthy: healthList.filter((h) => h.band === "healthy").length,
        watch: healthList.filter((h) => h.band === "watch").length,
        atRisk: healthList.filter((h) => h.band === "at_risk").length,
      },
      learners: { total: l.total, active7: l.active7, new7: l.new7 },
      individuals: { total: i.total, paid: i.paid, active7: i.active7, new7: i.new7 },
      licenses: {
        bought: lic.bought,
        assigned: lic.assigned,
        utilization: lic.bought ? lic.assigned / lic.bought : null,
        expiringUnused: lic.expiring_unused,
      },
      revenue: revenue.rows.map((r) => ({ currency: r.currency, thisMonth: Number(r.this_month), lastMonth: Number(r.last_month), thisYear: Number(r.this_year) })),
      outstanding: outstanding.rows.map((r) => ({ currency: r.currency, count: r.n, total: Number(r.total), overdue: r.overdue })),
      pendingReviews: reviews.rows[0].n,
      renewals,
      attention,
      health: healthList
        .sort((a, b) => a.score - b.score)
        .slice(0, 8)
        .map((h) => ({ id: h.id, name: h.name, score: h.score, band: h.band, flags: h.flags, learners: h.learners, active7: h.active7 })),
      trend: trend.rows.map((r) => ({ week: r.week, signups: r.signups, active: r.active })),
      recent: recent.rows.map((r) => ({
        action: r.action,
        actorLabel: r.actor_label,
        actorRole: r.actor_role,
        targetLabel: r.target_label,
        orgName: r.org_name,
        createdAt: r.created_at,
      })),
      admins,
      system,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Organizations: richer list fields, and ownership (Super Admin) ----

staffConsoleRouter.get("/organizations/metrics", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const scope = orgScope(req);
    const r = await pool.query(
      `SELECT t.id, t.created_at, t.contract_end, t.managed_by, t.account_manager_id,
         (SELECT ${name("m")} FROM users m WHERE m.id = t.managed_by) AS owner_name,
         (SELECT ${name("m")} FROM users m WHERE m.id = t.account_manager_id) AS account_manager_name,
         (SELECT count(*)::int FROM batches b WHERE b.tenant_id = t.id AND b.status = 'active') AS active_batches,
         (SELECT count(*)::int FROM users m WHERE m.tenant_id = t.id AND m.role = 'manager' AND m.deleted_at IS NULL) AS managers,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d WHERE d.tenant_id = t.id AND d.sessions > 0 AND d.day > current_date - 7) AS active7,
         (SELECT coalesce(sum(p.quantity), 0)::int FROM license_purchases p WHERE p.tenant_id = t.id AND p.pool_expires_at > now()) AS licenses_bought,
         (SELECT count(*)::int FROM license_assignments a JOIN license_purchases p ON p.id = a.purchase_id
            WHERE p.tenant_id = t.id AND p.pool_expires_at > now() AND a.reclaimed_at IS NULL) AS licenses_assigned,
         (SELECT count(*)::int FROM payment_orders o WHERE o.tenant_id = t.id AND o.provider = 'invoice' AND o.status = 'created') AS unpaid_invoices,
         (SELECT max(le.created_at) FROM login_events le JOIN users u ON u.id = le.user_id WHERE u.tenant_id = t.id) AS last_activity_at
       FROM tenants t WHERE t.type = 'cohort' ${scope.sql}`,
      scope.params,
    );
    res.json({
      metrics: r.rows.map((x) => ({
        id: x.id,
        createdAt: x.created_at,
        contractEnd: x.contract_end,
        owner: x.managed_by ? { id: x.managed_by, name: x.owner_name } : null,
        accountManager: x.account_manager_id ? { id: x.account_manager_id, name: x.account_manager_name } : null,
        activeBatches: x.active_batches,
        managers: x.managers,
        active7: x.active7,
        licensesBought: x.licenses_bought,
        licensesAssigned: x.licenses_assigned,
        unpaidInvoices: x.unpaid_invoices,
        lastActivityAt: x.last_activity_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The Admins an organization can be given to (Super Admin).
staffConsoleRouter.get("/staff", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const r = await pool.query(`SELECT u.id, ${name("u")} AS name, u.email FROM users u WHERE u.role = 'admin' AND u.deleted_at IS NULL ORDER BY name`);
    res.json({ admins: r.rows });
  } catch (err) {
    next(err);
  }
});

// Hand an organization to another Admin (its owner, who manages it).
staffConsoleRouter.patch("/organizations/:id/owner", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  if (!isSuperAdmin(req)) return res.status(403).json({ error: "forbidden" });
  try {
    const { adminId } = z.object({ adminId: z.string().uuid() }).parse(req.body);
    const a = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL`, [adminId]);
    if (a.rowCount === 0) return res.status(400).json({ error: "admin_not_found" });
    const r = await pool.query(`UPDATE tenants SET managed_by = $1 WHERE id = $2 AND type = 'cohort' RETURNING id`, [adminId, req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "organization_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ---- Billing across organizations (and individuals' plan payments) ----

staffConsoleRouter.get("/billing", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const scope = orgScope(req, "t", 1);
    const orders = await pool.query(
      `SELECT o.id, o.kind, o.tenant_id, o.quantity, o.currency, o.total, o.status, o.provider, o.created_at, o.paid_at, o.due_date,
         o.po_number, o.quote_number, o.payment_reference,
         CASE WHEN t.type = 'cohort' THEN t.name END AS org_name,
         ${name("b")} AS buyer_name, b.email AS buyer_email,
         (SELECT i.id FROM invoices i WHERE i.order_id = o.id LIMIT 1) AS invoice_id,
         (SELECT i.invoice_number FROM invoices i WHERE i.order_id = o.id LIMIT 1) AS invoice_number
       FROM payment_orders o
       JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN users b ON b.id = o.buyer_id
       WHERE o.status IN ('created', 'paid') AND (o.kind = 'individual_plan' OR (t.type = 'cohort' ${scope.sql}))
       ORDER BY coalesce(o.paid_at, o.created_at) DESC
       LIMIT 300`,
      scope.params,
    );
    // Twelve months of money in, split by organizations and individuals.
    const monthly = await pool.query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
         coalesce((SELECT sum(o.total) FROM payment_orders o JOIN tenants t ON t.id = o.tenant_id
            WHERE o.status = 'paid' AND o.kind = 'org_licenses' AND o.paid_at >= m AND o.paid_at < m + interval '1 month' AND t.type = 'cohort' ${scope.sql}), 0)::bigint AS orgs,
         coalesce((SELECT sum(o.total) FROM payment_orders o
            WHERE o.status = 'paid' AND o.kind = 'individual_plan' AND o.paid_at >= m AND o.paid_at < m + interval '1 month'), 0)::bigint AS individuals,
         coalesce((SELECT sum(o.quantity) FROM payment_orders o JOIN tenants t ON t.id = o.tenant_id
            WHERE o.status = 'paid' AND o.kind = 'org_licenses' AND o.paid_at >= m AND o.paid_at < m + interval '1 month' AND t.type = 'cohort' ${scope.sql}), 0)::int AS licenses
       FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
       ORDER BY m`,
      scope.params,
    );
    const contracts = await pool.query(
      `SELECT t.id, t.name, t.contract_start, t.contract_end, t.contract_value_cents, t.contract_currency, t.plan_tier,
         (SELECT ${name("m")} FROM users m WHERE m.id = coalesce(t.account_manager_id, t.managed_by)) AS owner_name
       FROM tenants t WHERE t.type = 'cohort' AND t.deactivated_at IS NULL AND t.contract_end IS NOT NULL ${scope.sql}
       ORDER BY t.contract_end`,
      scope.params,
    );
    res.json({
      monthly: monthly.rows.map((m) => ({ month: m.month, orgs: Number(m.orgs), individuals: Number(m.individuals), licenses: m.licenses })),
      orders: orders.rows.map((o) => ({
        id: o.id,
        kind: o.kind,
        tenantId: o.tenant_id,
        orgName: o.org_name,
        buyerName: o.buyer_name,
        buyerEmail: o.buyer_email,
        quantity: o.quantity,
        currency: o.currency,
        total: o.total,
        status: o.status,
        provider: o.provider,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        dueDate: o.due_date,
        overdue: o.status === "created" && o.provider === "invoice" && o.due_date && new Date(o.due_date) < new Date(new Date().toDateString()),
        poNumber: o.po_number,
        quoteNumber: o.quote_number,
        paymentReference: o.payment_reference,
        invoiceId: o.invoice_id,
        invoiceNumber: o.invoice_number,
      })),
      contracts: contracts.rows.map((c) => ({
        id: c.id,
        name: c.name,
        contractStart: c.contract_start,
        contractEnd: c.contract_end,
        valueCents: c.contract_value_cents,
        currency: c.contract_currency,
        planTier: c.plan_tier,
        ownerName: c.owner_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Audit across organizations, plus staff actions ----

staffConsoleRouter.get("/audit", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const q = z
      .object({
        before: z.string().optional(),
        action: z.string().max(60).optional(),
        tenantId: z.string().uuid().optional(),
        actorRole: z.enum(["super_admin", "admin", "org_admin", "manager", "learner", "system"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const sup = isSuperAdmin(req);
    const r = await pool.query(
      `SELECT a.id, a.action, a.actor_label, a.actor_role, a.target_type, a.target_label, a.details, a.created_at, a.tenant_id, t.name AS org_name
       FROM audit_log a LEFT JOIN tenants t ON t.id = a.tenant_id
       WHERE ($1::boolean OR a.actor_id = $2 OR (t.type = 'cohort' AND (t.managed_by = $2 OR t.account_manager_id = $2)))
         AND ($3::timestamptz IS NULL OR a.created_at < $3)
         AND ($4::text IS NULL OR a.action LIKE $4 || '%')
         AND ($5::uuid IS NULL OR a.tenant_id = $5)
         AND ($6::text IS NULL OR coalesce(a.actor_role, 'system') = $6)
         AND ($7::date IS NULL OR a.created_at >= $7)
         AND ($8::date IS NULL OR a.created_at < $8::date + 1)
       ORDER BY a.created_at DESC LIMIT $9`,
      [sup, req.user!.id, q.before ?? null, q.action ?? null, q.tenantId ?? null, q.actorRole ?? null, q.from ?? null, q.to ?? null, q.limit],
    );
    res.json({
      entries: r.rows.map((e) => ({
        id: e.id,
        action: e.action,
        actorLabel: e.actor_label,
        actorRole: e.actor_role,
        targetType: e.target_type,
        targetLabel: e.target_label,
        details: e.details,
        createdAt: e.created_at,
        tenantId: e.tenant_id,
        orgName: e.org_name,
      })),
      hasMore: r.rows.length === q.limit,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Individual learners (no organization) ----

staffConsoleRouter.get("/individuals", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.participant_id, u.created_at, u.deleted_at, u.erased_at, t.type AS tenant_type,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT max(d.day) FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0) AS last_active,
         (SELECT coalesce(sum(d.sessions), 0)::int FROM learner_activity_daily d WHERE d.user_id = u.id) AS sessions,
         (SELECT pl.cefr_level FROM placements pl WHERE pl.user_id = u.id ORDER BY pl.taken_at DESC LIMIT 1) AS cefr,
         (SELECT ${name("ib")} FROM users ib WHERE ib.id = u.invited_by) AS invited_by_name,
         EXISTS (SELECT 1 FROM license_assignments a JOIN license_purchases p ON p.id = a.purchase_id
                 WHERE a.user_id = u.id AND a.reclaimed_at IS NULL AND p.source = 'comp') AS has_comp,
         (SELECT coalesce(sum(o.total), 0)::bigint FROM payment_orders o WHERE o.tenant_id = u.tenant_id AND o.status = 'paid') AS paid_total,
         (SELECT min(o.currency) FROM payment_orders o WHERE o.tenant_id = u.tenant_id AND o.status = 'paid') AS paid_currency
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.role = 'learner' AND t.type IN ('individual_free', 'individual_paid') AND u.erased_at IS NULL
       ORDER BY u.created_at DESC
       LIMIT 1000`,
    );
    const access = await learnerAccessMap(r.rows.map((x) => x.id));
    res.json({
      learners: r.rows.map((x) => ({
        id: x.id,
        email: x.email,
        firstName: x.first_name,
        lastName: x.last_name,
        participantId: x.participant_id,
        plan: x.tenant_type === "individual_paid" ? "paid" : x.has_comp ? "complimentary" : "free",
        active: !x.deleted_at,
        hasLoggedIn: x.has_logged_in,
        lastActiveOn: x.last_active,
        sessions: x.sessions,
        cefr: x.cefr,
        source: x.invited_by_name ? "invited" : "signup",
        invitedByName: x.invited_by_name,
        paidTotal: Number(x.paid_total),
        paidCurrency: x.paid_currency,
        license: access.get(x.id),
        createdAt: x.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const individualSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  // Optional: what we know about them, pre-filled in their onboarding.
  phone: learnerDetailsSchema.shape.phone,
  country: learnerDetailsSchema.shape.country,
  city: learnerDetailsSchema.shape.city,
  jobRole: learnerDetailsSchema.shape.jobRole,
});
const compMonths = z.coerce.number().int().min(0).max(24).default(0);

// One individual learner: their own account (no organization), an invite to
// set a password, and optionally some complimentary months of full access.
async function inviteIndividual(row: z.infer<typeof individualSchema>, months: number, actorId: string): Promise<{ id: string; accessError: string | null }> {
  const t = await pool.query(`INSERT INTO tenants (name, type) VALUES ($1, 'individual_free') RETURNING id`, [`${row.email} (individual)`]);
  const tenantId = t.rows[0].id;
  let id: string;
  try {
    id = (
      await createAndInviteUser({
        role: "learner",
        tenantId,
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        roleLabel: "a learner",
        invitedBy: actorId,
        details: { phone: row.phone, country: row.country, city: row.city, jobRole: row.jobRole },
      })
    ).id;
  } catch (err) {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    throw err;
  }
  return { id, accessError: months ? await grantComp(tenantId, id, months, actorId) : null };
}

async function grantComp(tenantId: string, userId: string, months: number, actorId: string): Promise<string | null> {
  try {
    await creditPool({ tenantId, quantity: months, source: "comp", actorId, note: "Complimentary access from Edstellar" });
    await assignMonths({ tenantId, userId, months, actorId, actorRole: "system" });
    return null;
  } catch (err) {
    return err instanceof LicenseError ? err.code : "access_failed";
  }
}

staffConsoleRouter.post("/individuals", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const body = individualSchema.extend({ compMonths }).parse(req.body);
    const { id, accessError } = await inviteIndividual(body, body.compMonths, req.user!.id);
    res.status(201).json({ id, email: body.email, accessError });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "email_already_registered" });
    next(err);
  }
});

staffConsoleRouter.post("/individuals/bulk", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const body = z.object({ compMonths, rows: z.array(z.unknown()).max(MAX_BULK_ROWS) }).parse(req.body);
    const results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string; licenseError?: string | null }[] = [];
    for (const raw of body.rows) {
      const parsed = individualSchema.safeParse(raw);
      if (!parsed.success) {
        const guess = typeof (raw as Record<string, unknown>)?.email === "string" ? (raw as { email: string }).email : "(unknown)";
        results.push({ email: guess, status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      try {
        const r = await inviteIndividual(parsed.data, body.compMonths, req.user!.id);
        results.push({ email: parsed.data.email, status: "created", licenseError: r.accessError });
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) results.push({ email: parsed.data.email, status: "duplicate" });
        else results.push({ email: parsed.data.email, status: "invalid", message: "Something went wrong creating this account." });
      }
    }
    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});

async function individual(id: string) {
  const r = await pool.query(
    `SELECT u.id, u.email, u.tenant_id, u.deleted_at FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1 AND u.role = 'learner' AND t.type IN ('individual_free', 'individual_paid') AND u.erased_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

staffConsoleRouter.post("/individuals/:id/access", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const { months } = z.object({ months: z.coerce.number().int().min(1).max(24) }).parse(req.body);
    const u = await individual(String(req.params.id));
    if (!u) return res.status(404).json({ error: "learner_not_found" });
    const error = await grantComp(u.tenant_id, u.id, months, req.user!.id);
    if (error) return res.status(400).json({ error });
    res.json({ id: u.id, months });
  } catch (err) {
    next(err);
  }
});

staffConsoleRouter.post("/individuals/:id/deactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const u = await individual(String(req.params.id));
    if (!u || u.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    await pool.query(`UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1`, [u.id]);
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
    res.json({ id: u.id });
  } catch (err) {
    next(err);
  }
});

staffConsoleRouter.post("/individuals/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const u = await individual(String(req.params.id));
    if (!u || !u.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    await pool.query(`UPDATE users SET deleted_at = NULL, updated_at = now() WHERE id = $1`, [u.id]);
    res.json({ id: u.id });
  } catch (err) {
    next(err);
  }
});

staffConsoleRouter.post("/individuals/:id/resend-invite", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "inviteLearners"))) return;
  try {
    const u = await individual(String(req.params.id));
    if (!u || u.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    res.json({ id: u.id, email: await resendSetPasswordLink(u.id, "a learner") });
  } catch (err) {
    next(err);
  }
});

// Emails that already have an account, for the bulk upload preview.
staffConsoleRouter.post("/individuals/bulk/validate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const body = z.object({ emails: z.array(z.string().max(320)).max(MAX_BULK_ROWS) }).parse(req.body);
    const r = await pool.query(`SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])`, [body.emails.map((e) => e.trim().toLowerCase())]);
    res.json({ existing: r.rows.map((x) => x.email), maxRows: MAX_BULK_ROWS });
  } catch (err) {
    next(err);
  }
});

// ---- Insights: how learners are doing across this person's organizations ----

staffConsoleRouter.get("/insights", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "viewReports"))) return;
  try {
    const sup = isSuperAdmin(req);
    const scope = orgScope(req);
    const ids = (await pool.query(`SELECT t.id FROM tenants t WHERE t.type = 'cohort' AND t.deactivated_at IS NULL ${scope.sql}`, scope.params)).rows.map((r) => r.id);
    const L = `WITH l AS (
      SELECT u.id, u.tenant_id, u.batch_id, u.first_name, u.last_name, u.email, t.type AS tenant_type, t.name AS org_name
      FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.role = 'learner' AND u.deleted_at IS NULL AND u.erased_at IS NULL AND (t.type <> 'cohort' OR t.id = ANY($1::uuid[]) OR $2::boolean)
    )`;
    const p = [ids, sup];
    const [funnel, cefr, orgs, inactive, exams] = await Promise.all([
      pool.query(
        `${L} SELECT count(*)::int AS invited,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = l.id))::int AS signed_in,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM participant_profiles pp WHERE pp.user_id = l.id AND pp.onboarding_complete))::int AS onboarded,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM placements pl WHERE pl.user_id = l.id))::int AS placed,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = l.id AND d.sessions > 0 AND d.day > current_date - 7))::int AS practising,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM certificates c WHERE c.user_id = l.id AND c.revoked_at IS NULL))::int AS certified
         FROM l`,
        p,
      ),
      pool.query(
        `${L} SELECT x.cefr_level AS level, count(*)::int AS n FROM l
         JOIN LATERAL (SELECT cefr_level FROM placements pl WHERE pl.user_id = l.id ORDER BY taken_at DESC LIMIT 1) x ON true
         GROUP BY 1 ORDER BY 1`,
        p,
      ),
      pool.query(
        `${L} SELECT l.tenant_id, min(l.org_name) AS name, count(*)::int AS learners,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = l.id))::int AS signed_in,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = l.id AND d.sessions > 0 AND d.day > current_date - 7))::int AS active7,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM placements pl WHERE pl.user_id = l.id))::int AS placed,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM certificates c WHERE c.user_id = l.id AND c.revoked_at IS NULL))::int AS certified,
           coalesce(round(avg((SELECT ps.practice_minutes FROM progress_stats ps WHERE ps.user_id = l.id))), 0)::int AS avg_minutes,
           mode() WITHIN GROUP (ORDER BY (SELECT cefr_level FROM placements pl WHERE pl.user_id = l.id ORDER BY taken_at DESC LIMIT 1)) AS typical_level
         FROM l WHERE l.tenant_type = 'cohort'
         GROUP BY l.tenant_id ORDER BY learners DESC`,
        p,
      ),
      // Licensed learners who haven't practised for two weeks.
      pool.query(
        `${L} SELECT l.id, l.first_name, l.last_name, l.email, CASE WHEN l.tenant_type = 'cohort' THEN l.org_name END AS org_name,
           (SELECT b.name FROM batches b WHERE b.id = l.batch_id) AS batch_name,
           (SELECT max(d.day) FROM learner_activity_daily d WHERE d.user_id = l.id AND d.sessions > 0) AS last_active
         FROM l
         WHERE EXISTS (SELECT 1 FROM license_assignments a WHERE a.user_id = l.id AND a.reclaimed_at IS NULL AND a.ends_at > now())
           AND NOT EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = l.id AND d.sessions > 0 AND d.day > current_date - 14)
         ORDER BY last_active NULLS FIRST LIMIT 50`,
        p,
      ),
      pool.query(
        `${L} SELECT l.id, l.first_name, l.last_name, l.email, CASE WHEN l.tenant_type = 'cohort' THEN l.org_name END AS org_name,
           pp.exam_preference, pp.exam_date, pp.goal_level, pp.score_target,
           (SELECT cefr_level FROM placements pl WHERE pl.user_id = l.id ORDER BY taken_at DESC LIMIT 1) AS level
         FROM l JOIN participant_profiles pp ON pp.user_id = l.id
         WHERE pp.exam_date BETWEEN current_date AND current_date + 60
         ORDER BY pp.exam_date LIMIT 50`,
        p,
      ),
    ]);
    const name = (r: { first_name: string | null; last_name: string | null; email: string }) => [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;
    res.json({
      funnel: funnel.rows[0],
      cefr: cefr.rows,
      organizations: orgs.rows.map((o) => ({
        id: o.tenant_id,
        name: o.name,
        learners: o.learners,
        signedIn: o.signed_in,
        active7: o.active7,
        placed: o.placed,
        certified: o.certified,
        avgMinutes: o.avg_minutes,
        typicalLevel: o.typical_level,
      })),
      inactive: inactive.rows.map((r) => ({ id: r.id, name: name(r), email: r.email, orgName: r.org_name, batchName: r.batch_name, lastActive: r.last_active })),
      exams: exams.rows.map((r) => ({ id: r.id, name: name(r), orgName: r.org_name, exam: r.exam_preference, date: r.exam_date, goal: r.goal_level, scoreTarget: r.score_target, level: r.level })),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Plans and pricing, for conversations with customers ----

staffConsoleRouter.get("/plans-catalog", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const c = await import("../plans/config.js");
    res.json({
      tiers: c.PLAN_TIERS.map((t) => ({
        tier: t,
        label: c.TIER_LABELS[t],
        priceFloorCents: c.TIER_PRICE_FLOOR_CENTS[t],
        limits: c.TIER_LIMITS[t],
        support: c.TIER_SUPPORT[t],
        features: Object.entries(c.FEATURES)
          .filter(([key]) => c.tierIncludes(t, key as never))
          .map(([key, f]) => ({ key, label: f.label, description: f.description, available: f.available })),
      })),
      volumeBands: c.VOLUME_BANDS,
      businessQualifyingQuantity: c.BUSINESS_QUALIFYING_QUANTITY,
      educationDiscountPercent: c.EDUCATION_DISCOUNT_PERCENT,
      pilot: { licenses: c.PILOT_DEFAULT_LICENSES, days: c.PILOT_DEFAULT_DAYS },
      allFeatures: Object.entries(c.FEATURES).map(([key, f]) => ({ key, label: f.label, description: f.description, minTier: f.minTier, available: f.available })),
    });
  } catch (err) {
    next(err);
  }
});
