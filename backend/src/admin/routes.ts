import { randomUUID } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcrypt";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendAdminInviteEmail } from "../auth/mailer.js";
import { createAndInviteUser, resendSetPasswordLink } from "../auth/invite.js";
import { HandoverError, newOrgAdminSchema, replaceOrgAdmin } from "../orgAdmin/handover.js";
import { auditCsv, listAudit, recordAudit } from "../audit/service.js";
import { queueStats, retryJob } from "../queue/queue.js";
import { orgHealth } from "./health.js";
import { normalizeTaxId, taxIdProblem } from "../payments/taxId.js";
import { clampPermissions, staffPermissions, orgScope, requirePermission, staffCanSeeUser, staffOwnsTenant } from "./staff.js";
import { learnerAccessMap } from "../licenses/service.js";

export const adminRouter = Router();

const ADMIN_INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — longer than a real password reset, since an invite may sit unread a while
const BCRYPT_ROUNDS = 12;
const PG_UNIQUE_VIOLATION = "23505";

// Stricter than requireAdmin (which also lets org_admin through) — these
// endpoints see data across every organization, so only Edstellar's own
// roles may call them, never a client's own org_admin.
function requirePlatformAdmin(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// Only a Super Admin creates new Admins — an Admin manages organizations,
// never other Admin accounts (see the spec's Role & Permission Matrix).
function requireSuperAdmin(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || req.user.role !== "super_admin") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// The inverse of requireSuperAdmin — onboarding an organization is an Admin's
// job, never Super Admin's (same Role & Permission Matrix rule, other direction).
function requireAdminOnly(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

const PERMISSION_KEYS = [
  "manageOrganizations",
  "inviteLearners",
  "viewLearnerInfo",
  "contentReview",
  "scoreReview",
  "viewReports",
  "manageAdmins",
] as const;

const onboardAdminSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.string().trim().optional(),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).toUpperCase().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(1000).optional(),
  // Organizations this Admin owns from day one (Super Admin assigns).
  organizationIds: z.array(z.string().uuid()).max(500).optional(),

  permissions: z.object(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean()]))).partial(),
});

// Email is deliberately not editable here — changing it would orphan the
// account from whatever invite link was already sent.
const editAdminSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.string().trim().optional(),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).toUpperCase().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(1000).optional(),
  // Organizations this Admin owns from day one (Super Admin assigns).
  organizationIds: z.array(z.string().uuid()).max(500).optional(),

  permissions: z.object(Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean()]))).partial(),
});

// Bulk rows skip permissions on purpose — a CSV column per permission would
// be unwieldy to fill in by hand. They're created with none granted; a
// Super Admin edits each one's permissions individually afterward.
const bulkAdminRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.string().trim().optional(),
});

// Shared by the single and bulk onboarding endpoints — creates the account
// (email_verified immediately, placeholder password) and emails an invite.
async function createAndInviteAdmin(row: {
  email: string;
  firstName: string;
  lastName: string;
  department?: string;
  permissions?: Record<string, boolean | undefined>;
  invitedBy: string;
  phone?: string;
  jobTitle?: string;
  region?: string;
  city?: string;
  country?: string;
  notes?: string;
  organizationIds?: string[];
}): Promise<{ id: string }> {
  const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
  const inserted = await pool.query(
    `INSERT INTO users (role, email, password_hash, first_name, last_name, department, permissions, invited_by, phone, job_title, region, city, country, staff_notes, email_verified)
     VALUES ('admin', $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, true)
     RETURNING id`,
    [
      row.email,
      placeholderHash,
      row.firstName,
      row.lastName,
      row.department ?? null,
      JSON.stringify(row.permissions ?? {}),
      row.invitedBy,
      row.phone || null,
      row.jobTitle || null,
      row.region || null,
      row.city || null,
      row.country || null,
      row.notes || null,
    ],
  );
  const userId = inserted.rows[0].id;
  if (row.organizationIds?.length) {
    await pool.query(`UPDATE tenants SET managed_by = $1 WHERE id = ANY($2::uuid[]) AND type = 'cohort'`, [userId, row.organizationIds]);
  }

  const inviteToken = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(inviteToken),
    new Date(Date.now() + ADMIN_INVITE_TOKEN_TTL_MS),
  ]);
  sendAdminInviteEmail(row.email, inviteToken, "an Admin").catch((err) =>
    console.error("failed to send admin invite email:", err),
  );

  return { id: userId };
}

// "Completed" means every item was answered, right or wrong — not skipped.
// Matches the same rule Modules/Practice Tests already use for their own
// set-picker completion checkmarks: completed_at alone only means "reached
// the end of the list," which a run of pure Skips also does.
const GENUINELY_COMPLETED = `
  sessions.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
`;

// Reached the end of the list (completed_at set), but at least one item was
// skipped and at least one was genuinely answered — a learner who started
// and dropped off mid-set, not one who finished for real.
const GENUINELY_PARTIAL = `
  sessions.completed_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND NOT (a.response_text IS NULL AND a.response_uri IS NULL)
  )
`;

adminRouter.get("/stats", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const [learners, orgs, admins, sessionsToday, partialToday, signupsThisWeek, activeNow] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'learner' AND deleted_at IS NULL`),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE category != 'university' OR category IS NULL)::int AS org_count,
           count(*) FILTER (WHERE category = 'university')::int AS university_count
         FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL`,
      ),
      pool.query(`SELECT count(*)::int AS n FROM users WHERE role IN ('admin', 'org_admin') AND deleted_at IS NULL`),
      pool.query(`SELECT count(*)::int AS n FROM sessions WHERE completed_at::date = current_date AND ${GENUINELY_COMPLETED}`),
      pool.query(`SELECT count(*)::int AS n FROM sessions WHERE completed_at::date = current_date AND ${GENUINELY_PARTIAL}`),
      pool.query(
        `SELECT count(*)::int AS n FROM users WHERE role = 'learner' AND deleted_at IS NULL AND created_at > now() - interval '7 days'`,
      ),
      pool.query(
        `SELECT count(DISTINCT user_id)::int AS n FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > now()`,
      ),
    ]);
    res.json({
      totalLearners: learners.rows[0].n,
      totalOrganizations: orgs.rows[0].org_count,
      totalUniversities: orgs.rows[0].university_count,
      totalAdmins: admins.rows[0].n,
      sessionsCompletedToday: sessionsToday.rows[0].n,
      partialSessionsToday: partialToday.rows[0].n,
      signupsThisWeek: signupsThisWeek.rows[0].n,
      activeNow: activeNow.rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});

// Dashboard's two charts + recent-activity table — one combined round trip.
adminRouter.get("/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const [needsAttention, activityFeed, sessionsByType, recentSignups] = await Promise.all([
      // The one real action item on this dashboard — a flagged placement
      // with no verdict yet, sitting in the Review Queue.
      pool.query(`SELECT count(*)::int AS n FROM placements WHERE status = 'pending_review'`),
      // A plain chronological feed, not a chart — signups, admin/org_admin
      // accounts created, genuinely-completed sessions, and placement
      // results, merged and sorted by when they happened.
      pool.query(
        `(SELECT 'signup' AS kind, concat_ws(' ', first_name, last_name) AS who, NULL::text AS detail, created_at AS occurred_at
          FROM users WHERE role = 'learner' AND deleted_at IS NULL)
         UNION ALL
         (SELECT 'admin_created', concat_ws(' ', first_name, last_name), role, created_at
          FROM users WHERE role IN ('admin', 'org_admin') AND deleted_at IS NULL)
         UNION ALL
         (SELECT 'session_completed', concat_ws(' ', u.first_name, u.last_name), s.session_type, s.completed_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.completed_at IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL))
         UNION ALL
         (SELECT 'placement', concat_ws(' ', u.first_name, u.last_name), p.status, p.taken_at
          FROM placements p JOIN users u ON u.id = p.user_id)
         ORDER BY occurred_at DESC
         LIMIT 15`,
      ),
      // Genuinely completed only — otherwise this counts every session ever
      // started, including ones abandoned or skipped through entirely. Every
      // known session_type is listed via unnest, even at 0, rather than
      // silently disappearing when it has no genuine completions yet.
      pool.query(
        `SELECT t.session_type, count(s.id)::int AS n
         FROM unnest(ARRAY['practice', 'placement', 'coach', 'mocktest']) AS t(session_type)
         LEFT JOIN sessions s ON s.session_type = t.session_type
           AND s.completed_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)
         GROUP BY t.session_type
         ORDER BY n DESC`,
      ),
      pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.created_at, u.deleted_at, t.name AS tenant_name, t.type AS tenant_type
         FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE u.role = 'learner'
         ORDER BY u.created_at DESC
         LIMIT 10`,
      ),
    ]);
    res.json({
      needsAttention: needsAttention.rows[0].n,
      activityFeed: activityFeed.rows.map((r) => ({
        kind: r.kind,
        who: r.who,
        detail: r.detail,
        occurredAt: r.occurred_at,
      })),
      sessionsByType: sessionsByType.rows.map((r) => ({ type: r.session_type, count: r.n })),
      recentSignups: recentSignups.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        tenantName: r.tenant_name,
        tenantType: r.tenant_type,
        createdAt: r.created_at,
        active: !r.deleted_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Internal Edstellar staff (role='admin') — Super Admin manages these directly.
adminRouter.get("/admins", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.department, u.permissions, u.created_at, u.deleted_at,
         count(t.id)::int AS managed_org_count,
         coalesce(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS managed_org_names,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT max(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
         u.phone, u.job_title, u.region, u.city, u.country, u.staff_notes,
         coalesce(array_agg(t.id) FILTER (WHERE t.id IS NOT NULL), '{}') AS managed_org_ids
       FROM users u LEFT JOIN tenants t ON t.managed_by = u.id
       WHERE u.role = 'admin'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
    res.json({
      admins: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        department: r.department,
        permissions: r.permissions ?? {},
        managedOrgCount: r.managed_org_count,
        managedOrgNames: r.managed_org_names,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        lastLoginAt: r.last_login_at,
        phone: r.phone,
        jobTitle: r.job_title,
        region: r.region,
        city: r.city,
        country: r.country,
        notes: r.staff_notes,
        managedOrgIds: r.managed_org_ids,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Onboards a new internal Admin account. No self-signup for this role — the
// account is created here, email_verified immediately (Super Admin vouches
// for the address), and the person sets their own password via an emailed
// invite link (same reset-password page/flow everyone else uses).
adminRouter.post("/admins", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const body = onboardAdminSchema.parse(req.body);
    body.permissions = await clampPermissions(req, body.permissions);
    if (req.user!.role !== "super_admin") delete body.organizationIds;
    const { id } = await createAndInviteAdmin({ ...body, invitedBy: req.user!.id });
    res.status(201).json({ id, email: body.email });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

// Bulk CSV onboarding — each row is independent, so one bad/duplicate row
// never blocks the rest of the batch. Capped well above any realistic
// single upload so one request can't be used to hammer the invite-email path.
const MAX_BULK_ROWS = 200;

adminRouter.post("/admins/bulk", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const rows = z.array(z.unknown()).max(MAX_BULK_ROWS).parse(req.body.rows);

    const results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string }[] = [];
    for (const raw of rows) {
      const parsed = bulkAdminRowSchema.safeParse(raw);
      if (!parsed.success) {
        const emailGuess = typeof (raw as Record<string, unknown>)?.email === "string" ? (raw as { email: string }).email : "(unknown)";
        results.push({ email: emailGuess, status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      try {
        await createAndInviteAdmin({ ...parsed.data, invitedBy: req.user!.id });
        results.push({ email: parsed.data.email, status: "created" });
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

// What this specific Admin actually did — every organization they onboarded
// (tenants.managed_by = this admin). Shown as a detail view from the Admins
// table, same shape as the org list anywhere else in this console.
adminRouter.get("/admins/:id/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.category, t.deactivated_at, t.created_at,
         count(DISTINCT l.id)::int AS learner_count,
         count(DISTINCT oa.id)::int AS has_org_admin,
         count(DISTINCT oa.id) FILTER (WHERE EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = oa.id))::int AS org_admin_logged_in,
         (SELECT json_build_object(
            'id', oa2.id, 'email', oa2.email,
            'name', trim(coalesce(oa2.first_name, '') || ' ' || coalesce(oa2.last_name, ''))
          ) FROM users oa2 WHERE oa2.tenant_id = t.id AND oa2.role = 'org_admin' AND oa2.deleted_at IS NULL
          ORDER BY oa2.created_at LIMIT 1
         ) AS org_admin,
         (SELECT coalesce(json_agg(mgr), '[]'::json) FROM (
            SELECT m.id,
              trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) AS name,
              m.email,
              (SELECT count(*)::int FROM users ml
                 JOIN batch_managers bm ON bm.batch_id = ml.batch_id
                 WHERE bm.user_id = m.id AND ml.role = 'learner' AND ml.deleted_at IS NULL) AS learner_count
            FROM users m
            WHERE m.tenant_id = t.id AND m.role = 'manager' AND m.deleted_at IS NULL
            ORDER BY m.created_at
          ) mgr
         ) AS managers
       FROM tenants t
       LEFT JOIN users l ON l.tenant_id = t.id AND l.role = 'learner' AND l.deleted_at IS NULL
       LEFT JOIN users oa ON oa.tenant_id = t.id AND oa.role = 'org_admin' AND oa.deleted_at IS NULL
       WHERE t.managed_by = $1
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [req.params.id],
    );
    res.json({
      organizations: result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        learnerCount: r.learner_count,
        orgAdmin: r.org_admin,
        orgAdminStatus: r.has_org_admin === 0 ? "none" : r.org_admin_logged_in > 0 ? "active" : "pending",
        active: !r.deactivated_at,
        managers: r.managers,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Only a Super Admin edits another Admin's details — same rule as who can create one.
adminRouter.patch("/admins/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const body = editAdminSchema.parse(req.body);
    if (req.user!.role !== "super_admin") {
      // Admins can't change their own permissions or move organizations.
      if (req.params.id === req.user!.id) return res.status(403).json({ error: "cannot_edit_self" });
      delete body.organizationIds;
      // Permissions the editor doesn't hold stay as they were.
      const mine = await staffPermissions(req);
      const current = (await pool.query(`SELECT permissions FROM users WHERE id = $1 AND role = 'admin'`, [req.params.id])).rows[0]?.permissions ?? {};
      body.permissions = Object.fromEntries(
        PERMISSION_KEYS.map((k) => [k, mine[k] ? !!body.permissions[k] : !!current[k]]),
      );
    } else {
      body.permissions = await clampPermissions(req, body.permissions);
    }
    const result = await pool.query(
      `UPDATE users SET first_name = $1, last_name = $2, department = $3, permissions = $4::jsonb,
         phone = $6, job_title = $7, region = $8, city = $9, country = $10, staff_notes = $11, updated_at = now()
       WHERE id = $5 AND role = 'admin' AND deleted_at IS NULL
       RETURNING id`,
      [
        body.firstName,
        body.lastName,
        body.department ?? null,
        JSON.stringify(body.permissions),
        req.params.id,
        body.phone || null,
        body.jobTitle || null,
        body.region || null,
        body.city || null,
        body.country || null,
        body.notes || null,
      ],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "admin_not_found" });
    if (body.organizationIds) {
      await pool.query(`UPDATE tenants SET managed_by = $1 WHERE id = ANY($2::uuid[]) AND type = 'cohort'`, [req.params.id, body.organizationIds]);
    }
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Soft-delete only — keeps the row (and its history/attribution) instead of
// a hard DELETE. Also revokes any active sessions so the account can't keep
// being used right up until its next natural token expiry.
adminRouter.delete("/admins/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "cannot_delete_own_account" });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = now() WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL RETURNING id`,
      [req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "admin_not_found" });
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/admins/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageAdmins"))) return;
  try {
    const result = await pool.query(
      `UPDATE users SET deleted_at = NULL WHERE id = $1 AND role = 'admin' AND deleted_at IS NOT NULL RETURNING id`,
      [req.params.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "admin_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// A real contact at a client org/university (role='org_admin'), with which tenant they belong to.
adminRouter.get("/org-admins", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const scope = orgScope(req);
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.phone, u.job_title,
         t.id AS tenant_id, t.name AS tenant_name, t.category AS tenant_category, t.plan_tier, t.deactivated_at AS org_deactivated_at,
         (SELECT max(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
         (SELECT count(*)::int FROM batches b WHERE b.tenant_id = t.id AND b.status = 'active') AS active_batches,
         (SELECT coalesce(nullif(concat_ws(' ', m.first_name, m.last_name), ''), m.email) FROM users m WHERE m.id = coalesce(t.account_manager_id, t.managed_by)) AS owner_name,
         count(l.id)::int AS learner_count,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT coalesce(json_agg(mgr), '[]'::json) FROM (
            SELECT m.id, trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) AS name,
              (SELECT count(*)::int FROM users ml
                 JOIN batch_managers bm ON bm.batch_id = ml.batch_id
                 WHERE bm.user_id = m.id AND ml.role = 'learner' AND ml.deleted_at IS NULL) AS learner_count
            FROM users m
            WHERE m.tenant_id = t.id AND m.role = 'manager' AND m.deleted_at IS NULL
            ORDER BY m.created_at
          ) mgr
         ) AS managers
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN users l ON l.tenant_id = t.id AND l.role = 'learner' AND l.deleted_at IS NULL
       WHERE u.role = 'org_admin' ${scope.sql}
       GROUP BY u.id, t.id
       ORDER BY u.created_at DESC`,
      scope.params,
    );
    res.json({
      orgAdmins: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        tenantCategory: r.tenant_category,
        learnerCount: r.learner_count,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        managers: r.managers,
        createdAt: r.created_at,
        phone: r.phone,
        jobTitle: r.job_title,
        planTier: r.plan_tier,
        orgActive: !r.org_deactivated_at,
        lastLoginAt: r.last_login_at,
        activeBatches: r.active_batches,
        ownerName: r.owner_name,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// What this specific Org Admin actually did — every Manager they created
// for their organization (batch_managers rows for managers in their tenant).
adminRouter.get("/org-admins/:id/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const orgAdmin = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.tenant_id,
         t.name AS tenant_name, t.category AS tenant_category,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.role = 'org_admin'`,
      [req.params.id],
    );
    if (orgAdmin.rowCount === 0 || !(await staffOwnsTenant(req, orgAdmin.rows[0].tenant_id))) return res.status(404).json({ error: "org_admin_not_found" });
    const oa = orgAdmin.rows[0];
    const tenantId = oa.tenant_id;

    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         coalesce(array_agg(DISTINCT b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names,
         count(DISTINCT l.id)::int AS learner_count
       FROM users u
       LEFT JOIN batch_managers bm ON bm.user_id = u.id
       LEFT JOIN batches b ON b.id = bm.batch_id AND b.tenant_id = $1
       LEFT JOIN users l ON l.batch_id = b.id AND l.role = 'learner' AND l.deleted_at IS NULL
       WHERE u.tenant_id = $1 AND u.role = 'manager'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [tenantId],
    );
    res.json({
      orgAdmin: {
        id: oa.id,
        email: oa.email,
        firstName: oa.first_name,
        lastName: oa.last_name,
        tenantName: oa.tenant_name,
        tenantCategory: oa.tenant_category,
        active: !oa.deleted_at,
        hasLoggedIn: oa.has_logged_in,
        createdAt: oa.created_at,
      },
      managers: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchNames: r.batch_names,
        learnerCount: r.learner_count,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Every Manager account on the platform, across every organization — a
// Manager is invisible nowhere to a Super Admin, even though they're created
// by an Org Admin, never directly by Super Admin/Admin.
adminRouter.get("/managers", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { clause, params } = orgScopeClause(req);
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.job_title, u.license_allotment,
         t.id AS tenant_id, t.name AS tenant_name, t.category AS tenant_category,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT max(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
         (SELECT count(*)::int FROM license_assignments a WHERE a.source = 'manager' AND a.source_manager_id = u.id AND a.reclaimed_at IS NULL) AS licenses_used,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN users x ON x.id = d.user_id
            WHERE x.batch_id IN (SELECT y.batch_id FROM batch_managers y WHERE y.user_id = u.id) AND d.sessions > 0 AND d.day > current_date - 7) AS active7,
         coalesce(array_agg(DISTINCT b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names,
         count(DISTINCT l.id)::int AS learner_count
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batch_managers bm ON bm.user_id = u.id
       LEFT JOIN batches b ON b.id = bm.batch_id
       LEFT JOIN users l ON l.batch_id = b.id AND l.role = 'learner' AND l.deleted_at IS NULL
       WHERE u.role = 'manager' ${clause}
       GROUP BY u.id, t.id
       ORDER BY u.created_at DESC`,
      params,
    );
    res.json({
      managers: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        tenantName: r.tenant_name,
        tenantCategory: r.tenant_category,
        batchNames: r.batch_names,
        learnerCount: r.learner_count,
        active: !r.deleted_at,
        hasLoggedIn: r.has_logged_in,
        createdAt: r.created_at,
        tenantId: r.tenant_id,
        jobTitle: r.job_title,
        lastLoginAt: r.last_login_at,
        licensesAllotted: r.license_allotment,
        licensesUsed: r.licenses_used,
        activeLearners7d: r.active7,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// What this specific Manager actually did — every learner in the batch(es)
// assigned to them (via batch_managers), same GENUINELY_COMPLETED rule used
// everywhere else a session count is shown.
adminRouter.get("/managers/:id/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const manager = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.tenant_id,
         t.name AS tenant_name, t.category AS tenant_category,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         coalesce(array_agg(DISTINCT b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batch_managers bm ON bm.user_id = u.id
       LEFT JOIN batches b ON b.id = bm.batch_id
       WHERE u.id = $1 AND u.role = 'manager'
       GROUP BY u.id, t.id`,
      [req.params.id],
    );
    if (manager.rowCount === 0 || !(await staffOwnsTenant(req, manager.rows[0].tenant_id))) return res.status(404).json({ error: "manager_not_found" });
    const mgr = manager.rows[0];

    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id, b.name AS batch_name,
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

// Learners with no organization — individual_free/individual_paid tenants only.
adminRouter.get("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, t.type AS tenant_type,
         count(s.id)::int AS session_count
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       -- Genuinely completed only — otherwise this counts every session ever
       -- started, including ones abandoned or skipped through entirely.
       LEFT JOIN sessions s ON s.user_id = u.id
         AND s.completed_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)
       WHERE u.role = 'learner' AND t.type IN ('individual_free', 'individual_paid')
       GROUP BY u.id, t.id
       ORDER BY u.created_at DESC
       LIMIT 200`,
    );
    res.json({
      learners: result.rows.map((r) => ({
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        plan: r.tenant_type,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Full detail view of one learner — everything they filled in during
// onboarding, their placement result, their roadmap, their progress, and
// their activity across the platform. Works for any learner (individual or
// org/batch), not just the Individual Learners list — a Manager's or Org
// Admin's learner rows open the same view.
adminRouter.get("/learners/:id/profile", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "viewLearnerInfo"))) return;
  try {
    if (!(await staffCanSeeUser(req, String(req.params.id)))) return res.status(404).json({ error: "learner_not_found" });
    const learnerResult = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.participant_id,
         t.name AS tenant_name, t.type AS tenant_type, t.category AS tenant_category, b.name AS batch_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.role = 'learner'`,
      [req.params.id],
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

// Real per-admin scoping: an Admin only ever sees organizations they
// themselves onboarded (tenants.managed_by). A Super Admin still sees
// every organization, unscoped — the role, not a flag, decides which.
// Orgs with no owning admin (pre-dating this feature) show to nobody in
// the Admin console, only to Super Admin.
function orgScopeClause(req: AuthedRequest): { clause: string; params: string[] } {
  const s = orgScope(req);
  return { clause: s.sql, params: s.params };
}

// An Admin's own dashboard — much smaller than Super Admin's, matching the
// spec's description: "their assigned organizations, each one's learner
// count and activity, and pending invitations not yet accepted."
adminRouter.get("/console/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { clause, params } = orgScopeClause(req);
    const [orgs, pendingInvites] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, t.category, t.deactivated_at, t.industry, t.expected_learner_count, t.country,
           t.billing_contact_name, t.billing_contact_email, t.tax_id, t.legal_name, t.website, t.phone, t.address_line,
           t.city, t.state, t.postal_code, t.employee_count_band, t.training_goal, t.billing_contact_phone, t.purchase_order_ref,
           t.plan_tier, t.pilot_ends_at, t.custom_price_cents,
           count(DISTINCT l.id)::int AS learner_count,
           count(DISTINCT oa.id)::int AS has_org_admin,
           count(DISTINCT oa.id) FILTER (WHERE EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = oa.id))::int AS org_admin_logged_in,
           (SELECT json_build_object(
              'id', oa2.id, 'email', oa2.email,
              'name', trim(coalesce(oa2.first_name, '') || ' ' || coalesce(oa2.last_name, '')),
              'phone', oa2.phone, 'jobTitle', oa2.job_title
            ) FROM users oa2 WHERE oa2.tenant_id = t.id AND oa2.role = 'org_admin' AND oa2.deleted_at IS NULL
            ORDER BY oa2.created_at LIMIT 1
           ) AS org_admin,
           (SELECT coalesce(json_agg(mgr), '[]'::json) FROM (
              SELECT m.id,
                trim(coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) AS name,
                m.email,
                (SELECT count(*)::int FROM users ml
                   JOIN batch_managers bm ON bm.batch_id = ml.batch_id
                   WHERE bm.user_id = m.id AND ml.role = 'learner' AND ml.deleted_at IS NULL) AS learner_count
              FROM users m
              WHERE m.tenant_id = t.id AND m.role = 'manager' AND m.deleted_at IS NULL
              ORDER BY m.created_at
            ) mgr
           ) AS managers
         FROM tenants t
         LEFT JOIN users l ON l.tenant_id = t.id AND l.role = 'learner' AND l.deleted_at IS NULL
         LEFT JOIN users oa ON oa.tenant_id = t.id AND oa.role = 'org_admin' AND oa.deleted_at IS NULL
         WHERE t.type = 'cohort' ${clause}
         GROUP BY t.id
         ORDER BY t.created_at DESC`,
        params,
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM tenant_invitations ti
         JOIN tenants t ON t.id = ti.tenant_id
         WHERE ti.revoked_at IS NULL AND (ti.expires_at IS NULL OR ti.expires_at > now()) ${clause}`,
        params,
      ),
    ]);
    const activeOrgs = orgs.rows.filter((r) => !r.deactivated_at);
    const health = await orgHealth(activeOrgs.map((r) => r.id));
    res.json({
      organizations: orgs.rows.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category,
        learnerCount: r.learner_count,
        hasOrgAdmin: r.has_org_admin > 0,
        // 'none': no org_admin account yet. 'pending': account exists but
        // never logged in (invite not accepted). 'active': has logged in.
        orgAdminStatus: r.has_org_admin === 0 ? "none" : r.org_admin_logged_in > 0 ? "active" : "pending",
        orgAdmin: r.org_admin,
        managers: r.managers,
        planTier: r.plan_tier,
        pilotEndsAt: r.pilot_ends_at,
        health: health.get(r.id) ?? null,
        customPriceCents: r.custom_price_cents,
        industry: r.industry,
        expectedLearnerCount: r.expected_learner_count,
        country: r.country,
        billingContactName: r.billing_contact_name,
        billingContactEmail: r.billing_contact_email,
        taxId: r.tax_id,
        legalName: r.legal_name,
        website: r.website,
        phone: r.phone,
        addressLine: r.address_line,
        city: r.city,
        state: r.state,
        postalCode: r.postal_code,
        employeeCountBand: r.employee_count_band,
        trainingGoal: r.training_goal,
        billingContactPhone: r.billing_contact_phone,
        purchaseOrderRef: r.purchase_order_ref,
        active: !r.deactivated_at,
      })),
      totalOrganizations: activeOrgs.length,
      totalLearners: activeOrgs.reduce((sum, r) => sum + r.learner_count, 0),
      pendingInvitations: pendingInvites.rows[0].n,
      scopedToAssignedOrgs: req.user!.role !== "super_admin",
    });
  } catch (err) {
    next(err);
  }
});

// Split by how a learner's tenant was created, so an Admin can see the
// organization/university mix among orgs they onboarded. Individual
// learners aren't owned by any admin (no org, no managed_by), so that count
// stays platform-wide — showing it isn't showing another admin's org data.
adminRouter.get("/console/user-breakdown", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { clause, params } = orgScopeClause(req);
    const result = await pool.query(
      `SELECT
         count(*) FILTER (WHERE t.type = 'cohort' AND t.category = 'company')::int AS company_learners,
         count(*) FILTER (WHERE t.type = 'cohort' AND t.category = 'university')::int AS university_learners,
         count(*) FILTER (WHERE t.type = 'cohort' AND (t.category IS NULL OR t.category NOT IN ('company', 'university')))::int AS other_org_learners,
         count(*) FILTER (WHERE t.type IN ('individual_free', 'individual_paid'))::int AS individual_learners
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.role = 'learner' AND u.deleted_at IS NULL
         AND (t.type != 'cohort' OR (true ${clause}))`,
      params,
    );
    const r = result.rows[0];
    res.json({
      companyLearners: r.company_learners,
      universityLearners: r.university_learners,
      otherOrgLearners: r.other_org_learners,
      individualLearners: r.individual_learners,
    });
  } catch (err) {
    next(err);
  }
});

const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));
const onboardOrgSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["company", "university"]),
  legalName: optText(200),
  website: optText(200),
  phone: optText(40),
  addressLine: optText(300),
  city: optText(100),
  state: optText(100),
  postalCode: optText(20),
  employeeCountBand: z.enum(["1_50", "51_200", "201_1000", "1001_5000", "5000_plus"]).optional(),
  trainingGoal: optText(1000),
  billingContactPhone: optText(40),
  purchaseOrderRef: optText(100),
  planTier: z.enum(["starter", "business", "enterprise"]).optional(),
  contractStart: z.string().optional().or(z.literal("").transform(() => undefined)),
  contractEnd: z.string().optional().or(z.literal("").transform(() => undefined)),
  contractValue: z.coerce.number().min(0).max(100000000).optional(),
  contractCurrency: z.string().length(3).toUpperCase().optional(),
  // Super Admin onboarding for an Admin: who will own it (default: themself).
  ownerId: z.string().uuid().optional(),
  industry: z.string().min(1).optional(),
  expectedLearnerCount: z.coerce.number().int().positive().optional(),
  country: z.string().length(2).toUpperCase().optional(),
  billingContactName: z.string().min(1).optional(),
  billingContactEmail: z.string().email().optional(),
  taxId: z.string().min(1).optional(),
  orgAdmin: z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    phone: z.string().min(1).optional(),
    jobTitle: optText(120),
  }),
});

// Mirrors createAndInviteAdmin, but for a brand-new tenant + its org_admin
// contact in one step — the B2B onboarding flow belongs to an Admin, never
// Super Admin (see requireAdminOnly). Setting managed_by here (unlike the
// older seed data, which predates it) means newly onboarded orgs are at
// least attributed to the Admin who created them, even though nothing
// filters by it yet.
adminRouter.post("/organizations", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const body = onboardOrgSchema.parse(req.body);
    const taxProblem = taxIdProblem(body.country, body.taxId);
    if (taxProblem) return res.status(400).json({ error: "invalid_tax_id", message: taxProblem });
    if (body.taxId) body.taxId = normalizeTaxId(body.taxId);
    let owner = req.user!.id;
    if (body.ownerId && req.user!.role === "super_admin") {
      const ok = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'admin' AND deleted_at IS NULL`, [body.ownerId]);
      if (ok.rowCount === 0) return res.status(400).json({ error: "admin_not_found" });
      owner = body.ownerId;
    }
    const tenant = await pool.query(
      `INSERT INTO tenants (name, type, category, managed_by, industry, expected_learner_count, country,
         billing_contact_name, billing_contact_email, tax_id)
       VALUES ($1, 'cohort', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        body.name,
        body.category,
        owner,
        body.industry ?? null,
        body.expectedLearnerCount ?? null,
        body.country ?? null,
        body.billingContactName ?? null,
        body.billingContactEmail ?? null,
        body.taxId ?? null,
      ],
    );
    const tenantId = tenant.rows[0].id;
    await pool.query(
      `UPDATE tenants SET legal_name = $2, website = $3, phone = $4, address_line = $5, city = $6, state = $7, postal_code = $8,
         employee_count_band = $9, training_goal = $10, billing_contact_phone = $11, purchase_order_ref = $12,
         plan_tier = coalesce($13, plan_tier), contract_start = $14, contract_end = $15,
         contract_value_cents = $16, contract_currency = coalesce($17, contract_currency)
       WHERE id = $1`,
      [
        tenantId,
        body.legalName ?? null,
        body.website ?? null,
        body.phone ?? null,
        body.addressLine ?? null,
        body.city ?? null,
        body.state ?? null,
        body.postalCode ?? null,
        body.employeeCountBand ?? null,
        body.trainingGoal ?? null,
        body.billingContactPhone ?? null,
        body.purchaseOrderRef ?? null,
        body.planTier ?? null,
        body.contractStart ?? null,
        body.contractEnd ?? null,
        body.contractValue != null ? Math.round(body.contractValue * 100) : null,
        body.contractCurrency ?? null,
      ],
    );

    const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    const user = await pool.query(
      `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, phone, job_title, invited_by, email_verified)
       VALUES ('org_admin', $1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING id`,
      [tenantId, body.orgAdmin.email, placeholderHash, body.orgAdmin.firstName, body.orgAdmin.lastName, body.orgAdmin.phone ?? null, body.orgAdmin.jobTitle ?? null, req.user!.id],
    );
    const userId = user.rows[0].id;

    const inviteToken = generateToken();
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
      userId,
      hashToken(inviteToken),
      new Date(Date.now() + ADMIN_INVITE_TOKEN_TTL_MS),
    ]);
    sendAdminInviteEmail(body.orgAdmin.email, inviteToken, "an Org Admin").catch((err) =>
      console.error("failed to send org admin invite email:", err),
    );

    res.status(201).json({ tenantId, orgAdminId: userId });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

const editOrgSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["company", "university"]),
});

adminRouter.patch("/organizations/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const body = editOrgSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE tenants SET name = $1, category = $2 WHERE id = $3 AND type = 'cohort' AND ($5::boolean OR managed_by = $4 OR account_manager_id = $4) RETURNING id`,
      [body.name, body.category, req.params.id, req.user!.id, req.user!.role === "super_admin"],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "organization_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Deactivating reuses tenants.deactivated_at (already sat there unused since
// the roles migration) rather than inventing a second soft-delete field.
adminRouter.delete("/organizations/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const result = await pool.query(
      `UPDATE tenants SET deactivated_at = now() WHERE id = $1 AND type = 'cohort' AND deactivated_at IS NULL AND ($3::boolean OR managed_by = $2 OR account_manager_id = $2) RETURNING id`,
      [req.params.id, req.user!.id, req.user!.role === "super_admin"],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "organization_not_found" });
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
      [req.params.id],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/organizations/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const result = await pool.query(
      `UPDATE tenants SET deactivated_at = NULL WHERE id = $1 AND type = 'cohort' AND deactivated_at IS NOT NULL AND ($3::boolean OR managed_by = $2 OR account_manager_id = $2) RETURNING id`,
      [req.params.id, req.user!.id, req.user!.role === "super_admin"],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "organization_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Org-tenant learners only (company/university) — individual learners
// already have their own dedicated Super Admin page; an Admin's job here is
// the organizations' learners, same as the spec's "view/manage learners,
// only learners belonging to organizations" wording.
adminRouter.get("/console/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requirePlatformAdmin(req, res)) return;
  try {
    const { clause, params } = orgScopeClause(req);
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id, u.department, u.employee_id,
         t.id AS tenant_id, t.name AS org_name, t.type AS tenant_type, t.category AS org_category, b.id AS batch_id, b.name AS batch_name,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT max(d.day) FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0) AS last_active,
         (SELECT pl.cefr_level FROM placements pl WHERE pl.user_id = u.id ORDER BY pl.taken_at DESC LIMIT 1) AS cefr,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.role = 'learner' AND t.type = 'cohort' AND u.erased_at IS NULL ${clause}
       GROUP BY u.id, t.id, b.id
       ORDER BY u.created_at DESC`,
      params,
    );
    const access = await learnerAccessMap(result.rows.map((r) => r.id));
    res.json({
      learners: result.rows.map((r) => ({
        license: access.get(r.id),
        id: r.id,
        participantId: r.participant_id ?? null,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        type: r.tenant_type !== "cohort" ? "individual" : r.org_category === "university" ? "university" : "organization",
        orgName: r.org_name,
        batchName: r.batch_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
        tenantId: r.tenant_id,
        batchId: r.batch_id,
        department: r.department,
        employeeId: r.employee_id,
        hasLoggedIn: r.has_logged_in,
        lastActiveOn: r.last_active,
        cefr: r.cefr,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---- One organization, from Edstellar's side: Org Admin recovery, audit ----

// An Admin may act on organizations they manage; a Super Admin on any.
async function staffOrg(req: AuthedRequest, res: import("express").Response): Promise<string | null> {
  if (!requirePlatformAdmin(req, res)) return null;
  const id = String(req.params.id);
  const r = await pool.query(`SELECT 1 FROM tenants WHERE id = $1 AND type = 'cohort' AND ($2::boolean OR managed_by = $3 OR account_manager_id = $3)`, [
    id,
    req.user!.role === "super_admin",
    req.user!.id,
  ]);
  if (r.rowCount === 0) {
    res.status(404).json({ error: "organization_not_found" });
    return null;
  }
  return id;
}

// Replace the Org Admin — they left, or the account is unrecoverable.
adminRouter.post("/organizations/:id/org-admin", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await requirePermission(req, res, "manageOrganizations"))) return;
    const tenantId = await staffOrg(req, res);
    if (!tenantId) return;
    const body = newOrgAdminSchema.parse(req.body);
    const result = await replaceOrgAdmin({ tenantId, next: body, actorId: req.user!.id, reason: "replaced_by_admin" });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "org_admin.replaced",
      targetType: "org_admin",
      targetId: result.newOrgAdminId,
      targetLabel: `${body.firstName} ${body.lastName} (${body.email})`,
      details: { previousOrgAdminId: result.previousOrgAdminId },
      ip: req.ip ?? null,
    });
    res.status(201).json({ id: result.newOrgAdminId });
  } catch (err) {
    if (err instanceof HandoverError) return res.status(err.code === "email_already_registered" ? 409 : 404).json({ error: err.code });
    next(err);
  }
});

// A fresh set-password link for the current Org Admin: the invite expired,
// or they're locked out.
adminRouter.post("/organizations/:id/org-admin/resend", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await requirePermission(req, res, "manageOrganizations"))) return;
    const tenantId = await staffOrg(req, res);
    if (!tenantId) return;
    const oa = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'org_admin' AND deleted_at IS NULL`, [tenantId]);
    if (oa.rowCount === 0) return res.status(404).json({ error: "org_admin_not_found" });
    const email = await resendSetPasswordLink(oa.rows[0].id, "an Org Admin");
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "org_admin.invite_resent",
      targetType: "org_admin",
      targetId: oa.rows[0].id,
      targetLabel: email,
      ip: req.ip ?? null,
    });
    res.json({ email });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/organizations/:id/audit", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffOrg(req, res);
    if (!tenantId) return;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await listAudit({ tenantId, limit, before: typeof req.query.before === "string" ? req.query.before : null });
    if (req.query.format === "csv") {
      return res.type("text/csv").attachment(`audit-${tenantId.slice(0, 8)}.csv`).send(auditCsv(rows));
    }
    res.json({ entries: rows, hasMore: rows.length === limit });
  } catch (err) {
    next(err);
  }
});

// ---- Background jobs (Super Admin) ----

adminRouter.get("/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    res.json(await queueStats());
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/jobs/:id/retry", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireSuperAdmin(req, res)) return;
  try {
    const ok = await retryJob(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "job_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
