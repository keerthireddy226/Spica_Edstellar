import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createAndInviteUser } from "../auth/invite.js";
import { moveLearnerSchema, moveLearnerToBatch } from "../batches/moveLearner.js";
import { LicenseError, assignMonths, learnerAccessMap, setBatchBudget, setManagerAllotment, unreservedAvailable } from "../licenses/service.js";
import { assertFeature, assertWithinLimit } from "../plans/service.js";
import { releaseManagerPool, releaseQueuedMonths } from "../licenses/service.js";
import { resendSetPasswordLink } from "../auth/invite.js";
import { HandoverError, newOrgAdminSchema, replaceOrgAdmin } from "./handover.js";
import { ipAllowed, parseAllowlist } from "../auth/policy.js";
import { normalizeTaxId, taxIdProblem } from "../payments/taxId.js";
import { applyLearnerDefaults, getOrgSettings, removeLogo, saveLogo, settingsSchema, updateOrgSettings } from "./settings.js";
import { BATCH_END_SQL, archiveBatch, assertBatchActive, cloneBatch, completeBatch, reopenBatch } from "../batches/lifecycle.js";
import { auditCsv, listAudit } from "../audit/service.js";
import { SESSION_COOKIE } from "../auth/tokens.js";

export const orgAdminRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

// Same completion rule as the Super Admin/Admin consoles — completed_at
// alone also means "skipped every item," so it isn't enough on its own.
const GENUINELY_COMPLETED = `
  completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
`;

function requireOrgAdmin(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || req.user.role !== "org_admin") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// Every endpoint here is scoped to the caller's own tenant — an Org Admin
// never sees another organization's data, unlike Admin/Super Admin.
async function requireOwnTenant(req: AuthedRequest, res: import("express").Response): Promise<string | null> {
  const tenantId = req.user!.tenantId;
  if (!tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return tenantId;
}

orgAdminRouter.get("/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const [tenant, counts, sessionsToday, activityFeed] = await Promise.all([
      pool.query(
        `SELECT t.name, au.id AS admin_id, au.email AS admin_email, au.first_name AS admin_first_name, au.last_name AS admin_last_name
         FROM tenants t LEFT JOIN users au ON au.id = t.managed_by
         WHERE t.id = $1`,
        [tenantId],
      ),
      pool.query(
        `SELECT
           (SELECT count(*)::int FROM batches WHERE tenant_id = $1) AS batch_count,
           (SELECT count(*)::int FROM users WHERE tenant_id = $1 AND role = 'manager' AND deleted_at IS NULL) AS manager_count,
           (SELECT count(*)::int FROM users WHERE tenant_id = $1 AND role = 'learner' AND deleted_at IS NULL) AS learner_count`,
        [tenantId],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.tenant_id = $1 AND s.completed_at::date = current_date AND ${GENUINELY_COMPLETED.replace(/sessions\.id/g, "s.id")}`,
        [tenantId],
      ),
      // Same plain chronological feed as the Admin/Super Admin consoles,
      // scoped to just this tenant's own people.
      pool.query(
        `(SELECT 'signup' AS kind, concat_ws(' ', first_name, last_name) AS who, role AS detail, created_at AS occurred_at
          FROM users WHERE tenant_id = $1 AND role IN ('learner', 'manager') AND deleted_at IS NULL)
         UNION ALL
         (SELECT 'session_completed', concat_ws(' ', u.first_name, u.last_name), s.session_type, s.completed_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE u.tenant_id = $1 AND ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})
         UNION ALL
         (SELECT 'placement', concat_ws(' ', u.first_name, u.last_name), p.status, p.taken_at
          FROM placements p JOIN users u ON u.id = p.user_id WHERE u.tenant_id = $1)
         ORDER BY occurred_at DESC
         LIMIT 15`,
        [tenantId],
      ),
    ]);
    const t = tenant.rows[0];
    res.json({
      organizationName: t?.name ?? null,
      onboardedBy: t?.admin_id
        ? {
            id: t.admin_id,
            email: t.admin_email,
            name: [t.admin_first_name, t.admin_last_name].filter(Boolean).join(" ") || t.admin_email,
          }
        : null,
      totalBatches: counts.rows[0].batch_count,
      totalManagers: counts.rows[0].manager_count,
      totalLearners: counts.rows[0].learner_count,
      sessionsCompletedToday: sessionsToday.rows[0].n,
      activityFeed: activityFeed.rows.map((r) => ({
        kind: r.kind,
        who: r.who,
        detail: r.detail,
        occurredAt: r.occurred_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Editable organization profile fields -> tenants column. Fixed map, so the
// dynamic UPDATE below only ever names known columns.
const ORG_FIELD_COLUMNS = {
  name: "name",
  legalName: "legal_name",
  industry: "industry",
  employeeCountBand: "employee_count_band",
  expectedLearnerCount: "expected_learner_count",
  website: "website",
  phone: "phone",
  addressLine: "address_line",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  country: "country",
  taxId: "tax_id",
  trainingGoal: "training_goal",
  billingContactName: "billing_contact_name",
  billingContactEmail: "billing_contact_email",
  billingContactPhone: "billing_contact_phone",
  purchaseOrderRef: "purchase_order_ref",
} as const;

const optionalText = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));

const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: optionalText(200),
  industry: optionalText(100),
  employeeCountBand: z.enum(["1_50", "51_200", "201_1000", "1001_5000", "5000_plus"]).nullable().optional(),
  expectedLearnerCount: z.coerce.number().int().positive().nullable().optional(),
  website: optionalText(300),
  phone: optionalText(30),
  addressLine: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  taxId: optionalText(50),
  trainingGoal: optionalText(1000),
  billingContactName: optionalText(200),
  billingContactEmail: z.union([z.string().trim().email(), z.literal("")]).nullable().optional().transform((v) => (v === "" ? null : v)),
  billingContactPhone: optionalText(30),
  purchaseOrderRef: optionalText(100),
});

function toOrganizationJson(t: Record<string, unknown>) {
  return {
    name: t.name,
    category: t.category,
    legalName: t.legal_name,
    industry: t.industry,
    employeeCountBand: t.employee_count_band,
    expectedLearnerCount: t.expected_learner_count,
    website: t.website,
    phone: t.phone,
    addressLine: t.address_line,
    city: t.city,
    state: t.state,
    postalCode: t.postal_code,
    country: t.country,
    taxId: t.tax_id,
    trainingGoal: t.training_goal,
    billingContactName: t.billing_contact_name,
    billingContactEmail: t.billing_contact_email,
    billingContactPhone: t.billing_contact_phone,
    purchaseOrderRef: t.purchase_order_ref,
    createdAt: t.created_at,
  };
}

orgAdminRouter.get("/organization", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    res.json(toOrganizationJson(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.patch("/organization", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = updateOrgSchema.parse(req.body);
    if (body.taxId !== undefined || body.country !== undefined) {
      const cur = (await pool.query(`SELECT country, tax_id FROM tenants WHERE id = $1`, [tenantId])).rows[0];
      const problem = taxIdProblem(body.country ?? cur.country, body.taxId ?? cur.tax_id);
      if (problem) return res.status(400).json({ error: "invalid_tax_id", message: problem });
      if (body.taxId) body.taxId = normalizeTaxId(body.taxId);
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(ORG_FIELD_COLUMNS)) {
      const value = body[key as keyof typeof body];
      if (value === undefined) continue;
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length > 0) {
      values.push(tenantId);
      await pool.query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    }
    const result = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    res.json(toOrganizationJson(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// The Org Admin's own contact details (name lives on /auth/me).
orgAdminRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  try {
    const result = await pool.query(`SELECT phone, job_title FROM users WHERE id = $1`, [req.user!.id]);
    res.json({ phone: result.rows[0]?.phone ?? null, jobTitle: result.rows[0]?.job_title ?? null });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.patch("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  try {
    const body = z.object({ phone: optionalText(30), jobTitle: optionalText(100) }).parse(req.body);
    await pool.query(`UPDATE users SET phone = $1, job_title = $2, updated_at = now() WHERE id = $3`, [
      body.phone ?? null,
      body.jobTitle ?? null,
      req.user!.id,
    ]);
    res.json({ phone: body.phone ?? null, jobTitle: body.jobTitle ?? null });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/batches", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT b.id, b.name, b.batch_code, b.start_cefr, b.target_cefr, b.duration_months, b.start_date, b.target_cut_score, b.created_at,
         b.status, b.completed_at, b.archived_at, CASE WHEN b.duration_months IS NOT NULL THEN ${BATCH_END_SQL} END AS end_date,
         count(DISTINCT l.id)::int AS learner_count,
         coalesce(array_agg(DISTINCT m.first_name || ' ' || m.last_name) FILTER (WHERE m.id IS NOT NULL), '{}') AS manager_names
       FROM batches b
       LEFT JOIN users l ON l.batch_id = b.id AND l.role = 'learner' AND l.deleted_at IS NULL
       LEFT JOIN batch_managers bm ON bm.batch_id = b.id
       LEFT JOIN users m ON m.id = bm.user_id AND m.deleted_at IS NULL
       WHERE b.tenant_id = $1
       GROUP BY b.id
       ORDER BY b.created_at DESC`,
      [tenantId],
    );
    res.json({
      batches: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        batchCode: r.batch_code,
        startCefr: r.start_cefr,
        targetCefr: r.target_cefr,
        durationMonths: r.duration_months,
        startDate: r.start_date,
        targetCutScore: r.target_cut_score,
        learnerCount: r.learner_count,
        managerNames: r.manager_names,
        createdAt: r.created_at,
        status: r.status,
        endDate: r.end_date,
        completedAt: r.completed_at,
        archivedAt: r.archived_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const createBatchSchema = z.object({
  name: z.string().min(1),
  durationMonths: z.coerce.number().int().positive().optional(),
  startDate: z.string().optional(),
  targetCutScore: z.coerce.number().min(0).max(100).optional(),
  startCefr: z.enum(CEFR_LEVELS).optional(),
  targetCefr: z.enum(CEFR_LEVELS).optional(),
  // Licenses fixed to this batch, set aside from the unreserved pool.
  licenseAllotment: z.coerce.number().int().min(0).max(100000).optional(),
});

orgAdminRouter.post("/batches", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = createBatchSchema.parse(req.body);
    await assertWithinLimit(tenantId, "batches");
    if (body.licenseAllotment) {
      await assertFeature(tenantId, "batch_allotments");
      if (body.licenseAllotment > (await unreservedAvailable(tenantId))) return res.status(400).json({ error: "insufficient_unreserved" });
    }
    const result = await pool.query(
      `INSERT INTO batches (tenant_id, name, duration_months, start_date, target_cut_score, start_cefr, target_cefr, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        tenantId,
        body.name,
        body.durationMonths ?? null,
        body.startDate ?? null,
        body.targetCutScore ?? null,
        body.startCefr ?? null,
        body.targetCefr ?? null,
        req.user!.id,
      ],
    );
    const batchId = result.rows[0].id;
    // Through setBatchBudget so it takes the tenant's license lock; the check
    // above is only a fast path, this is the one that can't be raced.
    if (body.licenseAllotment) {
      try {
        await setBatchBudget({ tenantId, batchId, budget: body.licenseAllotment, actorId: req.user!.id });
      } catch (err) {
        await pool.query(`DELETE FROM batches WHERE id = $1`, [batchId]);
        if (err instanceof LicenseError) return res.status(400).json({ error: err.code });
        throw err;
      }
    }
    res.status(201).json({ id: batchId });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/batches/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const batch = await pool.query(
      `SELECT b.id, b.name, b.batch_code, b.start_cefr, b.target_cefr, b.duration_months, b.start_date, b.target_cut_score, b.created_at,
         b.license_budget, b.status, b.completed_at, b.archived_at,
         CASE WHEN b.duration_months IS NOT NULL THEN ${BATCH_END_SQL} END AS end_date,
         (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS fixed_used,
         (SELECT json_build_object(
            'total', count(*),
            'fromFixed', count(*) FILTER (WHERE a.source = 'batch'),
            'fromManagerPools', count(*) FILTER (WHERE a.source = 'manager'),
            'fromOrgPool', count(*) FILTER (WHERE a.source = 'org'),
            'used', count(*) FILTER (WHERE a.starts_at <= now()),
            'notStarted', count(*) FILTER (WHERE a.starts_at > now())
          ) FROM license_assignments a
          JOIN users lu ON lu.id = a.user_id
          WHERE lu.batch_id = b.id AND a.reclaimed_at IS NULL) AS assignment_stats,
         coalesce(array_agg(DISTINCT m.first_name || ' ' || m.last_name) FILTER (WHERE m.id IS NOT NULL), '{}') AS manager_names
       FROM batches b
       LEFT JOIN batch_managers bm ON bm.batch_id = b.id
       LEFT JOIN users m ON m.id = bm.user_id AND m.deleted_at IS NULL
       WHERE b.id = $1 AND b.tenant_id = $2
       GROUP BY b.id`,
      [req.params.id, tenantId],
    );
    if (batch.rowCount === 0) return res.status(404).json({ error: "batch_not_found" });
    const b = batch.rows[0];

    const learners = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.batch_id = $1 AND u.role = 'learner'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [req.params.id],
    );
    const access = await learnerAccessMap(learners.rows.map((r) => r.id));
    res.json({
      batch: {
        id: b.id,
        name: b.name,
        batchCode: b.batch_code,
        startCefr: b.start_cefr,
        targetCefr: b.target_cefr,
        durationMonths: b.duration_months,
        startDate: b.start_date,
        targetCutScore: b.target_cut_score,
        managerNames: b.manager_names,
        fixedLicenses: b.license_budget,
        fixedLicensesUsed: b.fixed_used,
        assignments: b.assignment_stats,
        createdAt: b.created_at,
        status: b.status,
        endDate: b.end_date,
        completedAt: b.completed_at,
        archivedAt: b.archived_at,
      },
      learners: learners.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        createdAt: r.created_at,
        license: access.get(r.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const editBatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  durationMonths: z.coerce.number().int().positive().nullable(),
  startDate: z.string().nullable(),
  targetCutScore: z.coerce.number().min(0).max(100).nullable(),
  startCefr: z.enum(CEFR_LEVELS).nullable(),
  targetCefr: z.enum(CEFR_LEVELS).nullable(),
});

orgAdminRouter.patch("/batches/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = editBatchSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE batches SET name = $1, duration_months = $2, start_date = $3, target_cut_score = $4, start_cefr = $5, target_cefr = $6
       WHERE id = $7 AND tenant_id = $8 RETURNING id`,
      [body.name, body.durationMonths, body.startDate || null, body.targetCutScore, body.startCefr, body.targetCefr, String(req.params.id), tenantId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "batch_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.delete("/batches/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(`DELETE FROM batches WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, tenantId]);
    if (result.rowCount === 0) return res.status(404).json({ error: "batch_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/managers", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id,
         coalesce(array_agg(b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names,
         coalesce(array_agg(b.id) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_ids,
         u.license_allotment,
         (SELECT count(*)::int FROM license_assignments a WHERE a.reclaimed_at IS NULL
            AND a.source = 'manager' AND a.source_manager_id = u.id) AS licenses_used,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in
       FROM users u
       LEFT JOIN batch_managers bm ON bm.user_id = u.id
       LEFT JOIN batches b ON b.id = bm.batch_id
       WHERE u.tenant_id = $1 AND u.role = 'manager'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [tenantId],
    );
    res.json({
      managers: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchNames: r.batch_names,
        batchIds: r.batch_ids,
        licensesAllotted: r.license_allotment,
        licensesUsed: r.licenses_used,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const onboardManagerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // May be empty — a Manager can create their own batches.
  batchIds: z.array(z.string().uuid()),
  // The Manager's own pool, usable in any batch they manage.
  licenseAllotment: z.coerce.number().int().min(0).max(100000).nullable().optional(),
});

async function ownsAllBatches(tenantId: string, batchIds: string[]): Promise<boolean> {
  const result = await pool.query(`SELECT id FROM batches WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, batchIds]);
  return result.rows.length === new Set(batchIds).size;
}

orgAdminRouter.post("/managers", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = onboardManagerSchema.parse(req.body);
    // Only batches that are actually this Org Admin's own — never lets a
    // caller sneak a foreign batch id into their own org's manager.
    if (!(await ownsAllBatches(tenantId, body.batchIds))) {
      return res.status(400).json({ error: "invalid_batch" });
    }
    await assertWithinLimit(tenantId, "managers");
    if (body.licenseAllotment) await assertFeature(tenantId, "manager_pools");
    if (body.licenseAllotment && body.licenseAllotment > (await unreservedAvailable(tenantId))) {
      return res.status(400).json({ error: "insufficient_unreserved" });
    }

    const { id: userId } = await createAndInviteUser({
      role: "manager",
      tenantId,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      roleLabel: "a Manager",
    });
    await pool.query(
      `INSERT INTO batch_managers (batch_id, user_id) SELECT unnest($1::uuid[]), $2`,
      [body.batchIds, userId],
    );
    if (body.licenseAllotment !== undefined) {
      await setManagerAllotment({ tenantId, managerId: userId, allotment: body.licenseAllotment, actorId: req.user!.id });
    }
    res.status(201).json({ id: userId, email: body.email });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

// Edit a Manager: name, which batches they manage, and those batches'
// license allotments. Email stays fixed — it's their login.
orgAdminRouter.patch("/managers/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = onboardManagerSchema.omit({ email: true }).parse(req.body);
    const managerId = String(req.params.id);
    const manager = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager'`, [managerId, tenantId]);
    if (manager.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    if (!(await ownsAllBatches(tenantId, body.batchIds))) return res.status(400).json({ error: "invalid_batch" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE users SET first_name = $1, last_name = $2, updated_at = now() WHERE id = $3`, [
        body.firstName,
        body.lastName,
        managerId,
      ]);
      await client.query(`DELETE FROM batch_managers WHERE user_id = $1 AND NOT (batch_id = ANY($2::uuid[]))`, [managerId, body.batchIds]);
      await client.query(
        `INSERT INTO batch_managers (batch_id, user_id) SELECT unnest($1::uuid[]), $2 ON CONFLICT (batch_id, user_id) DO NOTHING`,
        [body.batchIds, managerId],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    if (body.licenseAllotment !== undefined) {
      try {
        await setManagerAllotment({ tenantId, managerId, allotment: body.licenseAllotment, actorId: req.user!.id });
      } catch (err) {
        if (err instanceof LicenseError) return res.status(400).json({ error: err.code });
        throw err;
      }
    }
    res.json({ id: managerId });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/managers/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const manager = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at,
         t.name AS tenant_name, t.category AS tenant_category,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         coalesce(array_agg(DISTINCT b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batch_managers bm ON bm.user_id = u.id
       LEFT JOIN batches b ON b.id = bm.batch_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'manager'
       GROUP BY u.id, t.id`,
      [req.params.id, tenantId],
    );
    if (manager.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    const mgr = manager.rows[0];

    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id, u.batch_id, b.name AS batch_name,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       JOIN batches b ON b.id = u.batch_id
       JOIN batch_managers bm ON bm.batch_id = b.id AND bm.user_id = $1
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.role = 'learner'
       GROUP BY u.id, b.name
       ORDER BY u.created_at DESC`,
      [req.params.id],
    );
    res.json({
      manager: {
        id: mgr.id,
        email: mgr.email,
        firstName: mgr.first_name,
        lastName: mgr.last_name,
        tenantName: mgr.tenant_name,
        tenantCategory: mgr.tenant_category,
        batchNames: mgr.batch_names,
        active: !mgr.deleted_at,
        hasLoggedIn: mgr.has_logged_in,
        createdAt: mgr.created_at,
      },
      learners: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchName: r.batch_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.delete("/managers/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const releasedLicenses = await releaseManagerPool({ tenantId, managerId: String(req.params.id), actorId: req.user!.id });
    const result = await pool.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager' RETURNING id`, [
      req.params.id,
      tenantId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    res.json({ id: req.params.id, releasedLicenses });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/managers/:id/deactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 AND role = 'manager' AND deleted_at IS NULL RETURNING id`,
      [req.params.id, tenantId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.params.id]);
    const releasedLicenses = await releaseManagerPool({ tenantId, managerId: String(req.params.id), actorId: req.user!.id });
    res.json({ id: req.params.id, releasedLicenses });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/managers/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    await assertWithinLimit(tenantId, "managers");
    const result = await pool.query(
      `UPDATE users SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2 AND role = 'manager' AND deleted_at IS NOT NULL RETURNING id`,
      [req.params.id, tenantId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id, u.batch_id, b.name AS batch_name,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.tenant_id = $1 AND u.role = 'learner'
       GROUP BY u.id, b.name
       ORDER BY u.created_at DESC`,
      [tenantId],
    );
    const access = await learnerAccessMap(result.rows.map((r) => r.id));
    res.json({
      learners: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchId: r.batch_id,
        batchName: r.batch_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
        license: access.get(r.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Org Admins can add learners directly — into any of their batches, or with
// no batch yet (moved under a Manager's batch later via /learners/:id/move).
// Optionally gives them licenses straight away so they aren't locked out.
const MAX_BULK_ROWS = 200;

const orgInviteOptionsSchema = z.object({
  batchId: z.string().uuid().nullable().optional(),
  licenseMonths: z.coerce.number().int().min(0).max(24).optional(),
});

const orgInviteLearnerSchema = orgInviteOptionsSchema.extend({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

async function batchBelongsTo(tenantId: string, batchId: string | null | undefined): Promise<boolean> {
  if (!batchId) return true;
  const result = await pool.query(`SELECT 1 FROM batches WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]);
  return (result.rowCount ?? 0) > 0;
}

// Returns null when licenses were assigned (or none requested), otherwise the
// reason — the learner still exists either way.
async function giveLicenses(tenantId: string, userId: string, months: number | undefined, actorId: string): Promise<string | null> {
  if (!months) return null;
  try {
    await assignMonths({ tenantId, userId, months, actorId, actorRole: "org_admin" });
    return null;
  } catch (err) {
    if (err instanceof LicenseError) return err.code;
    throw err;
  }
}

orgAdminRouter.post("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = orgInviteLearnerSchema.parse(req.body);
    if (!(await batchBelongsTo(tenantId, body.batchId))) return res.status(400).json({ error: "invalid_batch" });
    await assertBatchActive(body.batchId);
    const { id } = await createAndInviteUser({
      role: "learner",
      tenantId,
      batchId: body.batchId ?? null,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      roleLabel: "a Learner",
    });
    const licenseError = await giveLicenses(tenantId, id, body.licenseMonths, req.user!.id);
    res.status(201).json({ id, email: body.email, licenseError });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

const bulkRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

orgAdminRouter.post("/learners/bulk", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = orgInviteOptionsSchema.extend({ rows: z.array(z.unknown()).max(MAX_BULK_ROWS) }).parse(req.body);
    if (!(await batchBelongsTo(tenantId, body.batchId))) return res.status(400).json({ error: "invalid_batch" });
    await assertBatchActive(body.batchId);

    const results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string; licenseError?: string | null }[] = [];
    for (const raw of body.rows) {
      const parsed = bulkRowSchema.safeParse(raw);
      if (!parsed.success) {
        const emailGuess = typeof (raw as Record<string, unknown>)?.email === "string" ? (raw as { email: string }).email : "(unknown)";
        results.push({ email: emailGuess, status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      try {
        const { id } = await createAndInviteUser({
          role: "learner",
          tenantId,
          batchId: body.batchId ?? null,
          email: parsed.data.email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          roleLabel: "a Learner",
        });
        const licenseError = await giveLicenses(tenantId, id, body.licenseMonths, req.user!.id);
        results.push({ email: parsed.data.email, status: "created", licenseError });
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
          results.push({ email: parsed.data.email, status: "duplicate" });
        } else {
          results.push({ email: parsed.data.email, status: "invalid", message: "Something went wrong creating this account." });
        }
      }
    }
    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/learners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const learnerResult = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.participant_id,
         t.name AS tenant_name, t.type AS tenant_type, t.category AS tenant_category, b.name AS batch_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'learner'`,
      [req.params.id, tenantId],
    );
    if (learnerResult.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    const learner = learnerResult.rows[0];

    const [onboarding, placement, roadmap, progress, skillStats, sessionTotals, sessionsByType, batchMoves] = await Promise.all([
      pool.query(`SELECT * FROM participant_profiles WHERE user_id = $1`, [req.params.id]),
      pool.query(`SELECT * FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [req.params.id]),
      pool.query(`SELECT * FROM roadmaps WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1`, [req.params.id]),
      pool.query(`SELECT * FROM progress_stats WHERE user_id = $1`, [req.params.id]),
      pool.query(`SELECT skill, minutes, accuracy_correct, accuracy_graded FROM skill_stats WHERE user_id = $1 ORDER BY skill`, [req.params.id]),
      pool.query(
        `SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ${GENUINELY_COMPLETED})::int AS genuinely_completed,
           max(completed_at) AS last_session_at
         FROM sessions WHERE user_id = $1`,
        [req.params.id],
      ),
      pool.query(
        `SELECT session_type, count(*)::int AS n FROM sessions WHERE user_id = $1 GROUP BY session_type`,
        [req.params.id],
      ),
      pool.query(
        `SELECT bm.from_batch_name, bm.to_batch_name, bm.reason, bm.moved_at, concat_ws(' ', mu.first_name, mu.last_name) AS moved_by_name
         FROM batch_moves bm LEFT JOIN users mu ON mu.id = bm.moved_by
         WHERE bm.user_id = $1 ORDER BY bm.moved_at DESC`,
        [req.params.id],
      ),
    ]);

    const p = onboarding.rows[0];
    const pl = placement.rows[0];
    const r = roadmap.rows[0];
    const prog = progress.rows[0];

    res.json({
      learner: {
        id: learner.id,
        participantId: learner.participant_id,
        email: learner.email,
        firstName: learner.first_name,
        lastName: learner.last_name,
        tenantName: learner.tenant_name,
        tenantType: learner.tenant_type,
        tenantCategory: learner.tenant_category,
        batchName: learner.batch_name,
        active: !learner.deleted_at,
        createdAt: learner.created_at,
      },
      onboarding: p
        ? {
            complete: p.onboarding_complete,
            examPreference: p.exam_preference,
            goalLevel: p.goal_level,
            scoreTarget: p.score_target,
            examReason: p.exam_reason,
            hasAppliedForExam: p.has_applied_for_exam,
            examDate: p.exam_date,
            targetPrepDays: p.target_prep_days,
            pastAttemptsStatus: p.past_attempts_status,
            prevScore: p.prev_score,
            prevDate: p.prev_date,
            dailyMinutesPreference: p.daily_minutes_preference,
            country: p.country,
            city: p.city,
            jobRole: p.job_role,
            gender: p.gender,
            ageBand: p.age_band,
          }
        : null,
      placement: pl
        ? {
            cefrLevel: pl.cefr_level,
            overallPercent: pl.overall_percent,
            status: pl.status,
            takenAt: pl.taken_at,
            skillPercents: pl.skill_percents,
          }
        : null,
      roadmap: r ? { pace: r.pace, minutesPerDay: r.minutes_per_day, totalHoursEstimate: r.total_hours_estimate, generatedAt: r.generated_at } : null,
      progress: prog
        ? {
            sessionsCount: prog.sessions_count,
            questionsCompleted: prog.questions_completed,
            practiceMinutes: prog.practice_minutes,
            streakDays: prog.streak_days,
            lastPracticeDate: prog.last_practice_date,
            totalXp: prog.total_xp,
            accuracyGraded: prog.item_accuracy_graded,
            accuracyCorrect: prog.item_accuracy_correct,
          }
        : null,
      skillStats: skillStats.rows.map((s) => ({
        skill: s.skill,
        minutes: s.minutes,
        accuracyCorrect: s.accuracy_correct,
        accuracyGraded: s.accuracy_graded,
      })),
      activity: {
        totalSessions: sessionTotals.rows[0].total,
        genuinelyCompletedSessions: sessionTotals.rows[0].genuinely_completed,
        lastSessionAt: sessionTotals.rows[0].last_session_at,
        sessionsByType: sessionsByType.rows.map((r2) => ({ type: r2.session_type, count: r2.n })),
      },
      batchHistory: batchMoves.rows.map((m) => ({
        fromBatch: m.from_batch_name,
        toBatch: m.to_batch_name,
        reason: m.reason,
        movedBy: m.moved_by_name || null,
        movedAt: m.moved_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.delete("/learners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    // Unstarted months go back to the pool; used and running ones stay counted.
    const reclaimedMonths = await releaseQueuedMonths({
      tenantId,
      userId: String(req.params.id),
      actorId: req.user!.id,
      reason: "Learner deleted",
    });
    const result = await pool.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner' RETURNING id`, [
      req.params.id,
      tenantId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    res.json({ id: req.params.id, reclaimedMonths });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/learners/:id/deactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 AND role = 'learner' AND deleted_at IS NULL RETURNING id`,
      [req.params.id, tenantId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.params.id]);
    const reclaimedMonths = await releaseQueuedMonths({
      tenantId,
      userId: String(req.params.id),
      actorId: req.user!.id,
      reason: "Learner deactivated",
    });
    res.json({ id: req.params.id, reclaimedMonths });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/learners/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = NULL WHERE id = $1 AND tenant_id = $2 AND role = 'learner' AND deleted_at IS NOT NULL RETURNING id`,
      [req.params.id, tenantId],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Shift a learner from one of this org's batches to another. A learner is
// never in two batches at once — this replaces their batch, with history.
orgAdminRouter.post("/learners/:id/move", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = moveLearnerSchema.parse(req.body);
    const [learner, batch] = await Promise.all([
      pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner'`, [req.params.id, tenantId]),
      pool.query(`SELECT 1 FROM batches WHERE id = $1 AND tenant_id = $2`, [body.batchId, tenantId]),
    ]);
    if (learner.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    if (batch.rowCount === 0) return res.status(400).json({ error: "invalid_batch" });
    const result = await moveLearnerToBatch({ learnerId: String(req.params.id), toBatchId: body.batchId, movedBy: req.user!.id, reason: body.reason });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// ---- Invites that expired or got lost ----

for (const role of ["managers", "learners"] as const) {
  orgAdminRouter.post(`/${role}/:id/resend-invite`, requireAuth, async (req: AuthedRequest, res, next) => {
    if (!requireOrgAdmin(req, res)) return;
    const tenantId = await requireOwnTenant(req, res);
    if (!tenantId) return;
    try {
      const dbRole = role === "managers" ? "manager" : "learner";
      const u = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = $3 AND deleted_at IS NULL`, [
        String(req.params.id),
        tenantId,
        dbRole,
      ]);
      if (u.rowCount === 0) return res.status(404).json({ error: `${dbRole}_not_found` });
      const email = await resendSetPasswordLink(String(req.params.id), dbRole === "manager" ? "a Manager" : "a learner");
      res.json({ id: req.params.id, email });
    } catch (err) {
      next(err);
    }
  });
}

// ---- Handing the Org Admin role to someone else ----

// The current Org Admin names their successor. They're signed out straight
// away; the successor gets the usual set-your-password invite.
orgAdminRouter.post("/handover", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = newOrgAdminSchema.extend({ confirm: z.literal(true) }).parse(req.body);
    const { confirm: _confirm, ...next } = body;
    const result = await replaceOrgAdmin({ tenantId, next, actorId: req.user!.id, reason: "handover" });
    res.clearCookie(SESSION_COOKIE);
    res.json({ id: result.newOrgAdminId });
  } catch (err) {
    if (err instanceof HandoverError) return res.status(err.code === "email_already_registered" ? 409 : 404).json({ error: err.code });
    next(err);
  }
});

// ---- Audit log (Business and up) ----

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
  action: z.string().trim().max(60).optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

orgAdminRouter.get("/audit", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    await assertFeature(tenantId, "audit_log");
    const q = auditQuerySchema.parse(req.query);
    const rows = await listAudit({ tenantId, ...q });
    const actors = await pool.query(
      `SELECT DISTINCT u.id, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.role
       FROM audit_log a JOIN users u ON u.id = a.actor_id WHERE a.tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    res.json({ entries: rows, actors: actors.rows, hasMore: rows.length === q.limit });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.get("/audit/export.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    await assertFeature(tenantId, "audit_log");
    const q = auditQuerySchema.parse(req.query);
    const rows = await listAudit({ tenantId, ...q, limit: 1000 });
    res.type("text/csv").attachment(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`).send(auditCsv(rows));
  } catch (err) {
    next(err);
  }
});

// Before a bulk invite: which of these emails already have an account, so the
// preview can flag them instead of the upload failing row by row.
orgAdminRouter.post("/learners/bulk/validate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  try {
    const body = z.object({ emails: z.array(z.string().max(320)).max(MAX_BULK_ROWS) }).parse(req.body);
    const lower = body.emails.map((e) => e.trim().toLowerCase());
    const r = await pool.query(`SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])`, [lower]);
    res.json({ existing: r.rows.map((x) => x.email), maxRows: MAX_BULK_ROWS });
  } catch (err) {
    next(err);
  }
});

// ---- Batch lifecycle ----

orgAdminRouter.post("/batches/:id/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const r = await completeBatch({ tenantId, batchId: String(req.params.id), actorId: req.user!.id });
    res.json({ id: req.params.id, ...r });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/batches/:id/archive", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    // Archiving an active batch completes it first, so its licenses are released.
    const cur = await pool.query(`SELECT status FROM batches WHERE id = $1 AND tenant_id = $2`, [String(req.params.id), tenantId]);
    if (cur.rows[0]?.status === "active") await completeBatch({ tenantId, batchId: String(req.params.id), actorId: req.user!.id });
    await archiveBatch(tenantId, String(req.params.id));
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/batches/:id/reopen", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    await reopenBatch(tenantId, String(req.params.id));
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/batches/:id/clone", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z
      .object({ name: z.string().trim().min(1).max(200), startDate: z.string().optional(), copyManagers: z.boolean().default(true) })
      .parse(req.body);
    const id = await cloneBatch({ tenantId, batchId: String(req.params.id), name: body.name, startDate: body.startDate || null, copyManagers: body.copyManagers, actorId: req.user!.id });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// ---- Organization settings ----

orgAdminRouter.get("/settings", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    res.json(await getOrgSettings(tenantId));
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.patch("/settings", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = settingsSchema.parse(req.body);
    const current = (await getOrgSettings(tenantId))!;
    // Security settings are plan features; only check the ones actually changing.
    if (body.mfaRequired && !current.mfaRequired) await assertFeature(tenantId, "mfa_enforcement");
    if (body.ipAllowlist && body.ipAllowlist.length > 0) {
      await assertFeature(tenantId, "ip_allowlist");
      if (!parseAllowlist(body.ipAllowlist)) return res.status(400).json({ error: "invalid_ip_allowlist" });
      // Never let an Org Admin lock themselves out with their own save.
      if (!ipAllowed(req.ip, body.ipAllowlist)) return res.status(400).json({ error: "allowlist_excludes_you", yourIp: req.ip });
    }
    const changed = (k: "sessionIdleMinutes" | "passwordMinLength" | "inviteExpiryHours") => body[k] !== undefined && body[k] !== current[k];
    if (changed("sessionIdleMinutes") || changed("passwordMinLength") || changed("inviteExpiryHours")) await assertFeature(tenantId, "security_policies");
    if (body.mfaRequired && !current.mfaRequired) {
      // Whoever turns it on must already use it, or they'd be locked out next.
      const me = (await pool.query(`SELECT mfa_enabled_at FROM users WHERE id = $1`, [req.user!.id])).rows[0];
      if (!me?.mfa_enabled_at) return res.status(400).json({ error: "enable_your_mfa_first" });
    }
    if (body.ipAllowlist?.length === 0) body.ipAllowlist = null;
    await updateOrgSettings(tenantId, body);
    res.json(await getOrgSettings(tenantId));
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/settings/logo", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z.object({ imageBase64: z.string().min(10).max(3_000_000) }).parse(req.body);
    try {
      await saveLogo(tenantId, body.imageBase64);
    } catch {
      return res.status(400).json({ error: "invalid_image" });
    }
    res.json(await getOrgSettings(tenantId));
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.delete("/settings/logo", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    await removeLogo(tenantId);
    res.json(await getOrgSettings(tenantId));
  } catch (err) {
    next(err);
  }
});
