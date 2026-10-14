import { z } from "zod";
import { assertWithinLimit } from "../plans/service.js";
import { BATCH_END_SQL, assertBatchActive, cloneBatch, completeBatch } from "../batches/lifecycle.js";
import { buildLearnerProfile } from "../learners/profile.js";
import { resendSetPasswordLink } from "../auth/invite.js";
import { createRequest } from "../licenses/requests.js";
import { learnerAccessMap } from "../licenses/service.js";
import { listScopedActivity } from "../audit/service.js";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createAndInviteUser } from "../auth/invite.js";
import { moveLearnerSchema, moveLearnerToBatch } from "../batches/moveLearner.js";

export const managerRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const MAX_BULK_ROWS = 200;

const GENUINELY_COMPLETED = `
  sessions.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
`;

function requireManager(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || req.user.role !== "manager") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// Every batch id a Manager is ever allowed to touch — batch_managers is the
// only source of truth for a Manager's scope, never their tenant_id alone
// (that would also include every other batch in the organization).
async function assignedBatchIds(userId: string): Promise<string[]> {
  const result = await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [userId]);
  return result.rows.map((r) => r.batch_id);
}

managerRouter.get("/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    if (batchIds.length === 0) {
      return res.json({ batches: [], totalLearners: 0, sessionsCompletedToday: 0 });
    }
    const [batches, sessionsToday] = await Promise.all([
      pool.query(
        `SELECT b.id, b.name, b.status, count(l.id)::int AS learner_count
         FROM batches b
         LEFT JOIN users l ON l.batch_id = b.id AND l.role = 'learner' AND l.deleted_at IS NULL
         WHERE b.id = ANY($1::uuid[]) AND b.status <> 'archived'
         GROUP BY b.id
         ORDER BY b.status = 'active' DESC, b.created_at DESC`,
        [batchIds],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.batch_id = ANY($1::uuid[]) AND s.completed_at::date = current_date AND ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")}`,
        [batchIds],
      ),
    ]);
    res.json({
      batches: batches.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, learnerCount: r.learner_count })),
      totalLearners: batches.rows.reduce((sum, r) => sum + r.learner_count, 0),
      sessionsCompletedToday: sessionsToday.rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});

managerRouter.get("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    if (batchIds.length === 0) return res.json({ learners: [] });
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, u.participant_id, u.batch_id, b.name AS batch_name,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.batch_id = ANY($1::uuid[]) AND u.role = 'learner' AND u.erased_at IS NULL
       GROUP BY u.id, b.name
       ORDER BY u.created_at DESC`,
      [batchIds],
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
        hasLoggedIn: r.has_logged_in,
        createdAt: r.created_at,
        license: access.get(r.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const onboardLearnerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  batchId: z.string().uuid(),
});

managerRouter.post("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = onboardLearnerSchema.parse(req.body);
    const batchIds = await assignedBatchIds(req.user!.id);
    if (!batchIds.includes(body.batchId)) {
      return res.status(403).json({ error: "not_your_batch" });
    }
    await assertBatchActive(body.batchId);
    const { id } = await createAndInviteUser({
      role: "learner",
      tenantId: req.user!.tenantId!,
      batchId: body.batchId,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      roleLabel: "a Learner",
    });
    res.status(201).json({ id, email: body.email });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

const bulkLearnerRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

managerRouter.post("/learners/bulk", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = z.object({ batchId: z.string().uuid(), rows: z.array(z.unknown()).max(MAX_BULK_ROWS) }).parse(req.body);
    const batchIds = await assignedBatchIds(req.user!.id);
    if (!batchIds.includes(body.batchId)) {
      return res.status(403).json({ error: "not_your_batch" });
    }
    await assertBatchActive(body.batchId);

    const results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string }[] = [];
    for (const raw of body.rows) {
      const parsed = bulkLearnerRowSchema.safeParse(raw);
      if (!parsed.success) {
        const emailGuess = typeof (raw as Record<string, unknown>)?.email === "string" ? (raw as { email: string }).email : "(unknown)";
        results.push({ email: emailGuess, status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      try {
        await createAndInviteUser({
          role: "learner",
          tenantId: req.user!.tenantId!,
          batchId: body.batchId,
          email: parsed.data.email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          roleLabel: "a Learner",
        });
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

// A Manager can only shift learners between batches they themselves manage —
// both the learner's current batch and the target must be theirs.
managerRouter.post("/learners/:id/move", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = moveLearnerSchema.parse(req.body);
    const batchIds = await assignedBatchIds(req.user!.id);
    if (!batchIds.includes(body.batchId)) return res.status(400).json({ error: "invalid_batch" });
    const learner = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND role = 'learner' AND batch_id = ANY($2::uuid[])`,
      [req.params.id, batchIds],
    );
    if (learner.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    const result = await moveLearnerToBatch({ learnerId: String(req.params.id), toBatchId: body.batchId, movedBy: req.user!.id, reason: body.reason });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// Managers can create their own batches. They're automatically its Manager,
// and it has no fixed allotment — licenses come from the Manager's own pool.
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

managerRouter.post("/batches", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        durationMonths: z.coerce.number().int().positive().optional(),
        startDate: z.string().optional(),
        startCefr: z.enum(CEFR).optional(),
        targetCefr: z.enum(CEFR).optional(),
      })
      .parse(req.body);
    await assertWithinLimit(req.user!.tenantId!, "batches");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const batch = await client.query(
        `INSERT INTO batches (tenant_id, name, duration_months, start_date, start_cefr, target_cefr, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user!.tenantId, body.name, body.durationMonths ?? null, body.startDate || null, body.startCefr ?? null, body.targetCefr ?? null, req.user!.id],
      );
      await client.query(`INSERT INTO batch_managers (batch_id, user_id) VALUES ($1, $2)`, [batch.rows[0].id, req.user!.id]);
      await client.query("COMMIT");
      res.status(201).json({ id: batch.rows[0].id });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// Before a bulk invite: which of these emails already have an account, so the
// preview can flag them instead of the upload failing row by row.
managerRouter.post("/learners/bulk/validate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = z.object({ emails: z.array(z.string().max(320)).max(MAX_BULK_ROWS) }).parse(req.body);
    const lower = body.emails.map((e) => e.trim().toLowerCase());
    const r = await pool.query(`SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])`, [lower]);
    res.json({ existing: r.rows.map((x) => x.email), maxRows: MAX_BULK_ROWS });
  } catch (err) {
    next(err);
  }
});

// ---- Learner management, within the Manager's own batches ----

async function managedLearner(managerId: string, learnerId: string) {
  const batchIds = await assignedBatchIds(managerId);
  const r = await pool.query(
    `SELECT id, email, tenant_id, deleted_at, batch_id FROM users
     WHERE id = $1 AND role = 'learner' AND erased_at IS NULL AND batch_id = ANY($2::uuid[])`,
    [learnerId, batchIds],
  );
  return { learner: r.rows[0] ?? null, batchIds };
}

managerRouter.get("/learners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    const profile = await buildLearnerProfile(String(req.params.id), { tenantId: req.user!.tenantId!, batchIds, includeSensitive: false });
    if (!profile) return res.status(404).json({ error: "learner_not_found" });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

managerRouter.post("/learners/:id/resend-invite", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const { learner } = await managedLearner(req.user!.id, String(req.params.id));
    if (!learner || learner.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    res.json({ id: learner.id, email: await resendSetPasswordLink(learner.id, "a learner") });
  } catch (err) {
    next(err);
  }
});

// Managers can't take licenses back themselves (that's the Org Admin's
// call), so unstarted months become a return request instead.
managerRouter.post("/learners/:id/deactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const { learner, batchIds } = await managedLearner(req.user!.id, String(req.params.id));
    if (!learner || learner.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    await pool.query(`UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1`, [learner.id]);
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [learner.id]);
    const access = (await learnerAccessMap([learner.id])).get(learner.id);
    let returnRequested = 0;
    if (access && access.queuedMonths > 0) {
      try {
        await createRequest({
          tenantId: learner.tenant_id,
          managerId: req.user!.id,
          managerBatchIds: batchIds,
          kind: "unassign_learner",
          quantity: access.queuedMonths,
          learnerId: learner.id,
          reason: "Learner deactivated by their Manager",
        });
        returnRequested = access.queuedMonths;
      } catch {
        // No request flow on this plan; the Org Admin can still reclaim them.
      }
    }
    res.json({ id: learner.id, returnRequested });
  } catch (err) {
    next(err);
  }
});

managerRouter.post("/learners/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const { learner } = await managedLearner(req.user!.id, String(req.params.id));
    if (!learner || !learner.deleted_at) return res.status(404).json({ error: "learner_not_found" });
    await assertBatchActive(learner.batch_id);
    await pool.query(`UPDATE users SET deleted_at = NULL, updated_at = now() WHERE id = $1`, [learner.id]);
    res.json({ id: learner.id });
  } catch (err) {
    next(err);
  }
});

// ---- Batches: the ones they manage ----

async function requireManagedBatch(req: AuthedRequest, res: import("express").Response): Promise<string | null> {
  const id = String(req.params.id);
  if (!(await assignedBatchIds(req.user!.id)).includes(id)) {
    res.status(404).json({ error: "batch_not_found" });
    return null;
  }
  return id;
}

managerRouter.get("/batches/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchId = await requireManagedBatch(req, res);
    if (!batchId) return;
    const b = (
      await pool.query(
        `SELECT b.id, b.name, b.batch_code, b.status, b.start_date, b.duration_months, b.start_cefr, b.target_cefr, b.target_cut_score,
           b.auto_reminders, b.created_at, b.completed_at, b.license_budget,
           CASE WHEN b.duration_months IS NOT NULL THEN ${BATCH_END_SQL} END AS end_date,
           (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS fixed_used,
           (SELECT coalesce(array_agg(concat_ws(' ', m.first_name, m.last_name)), '{}') FROM batch_managers bm JOIN users m ON m.id = bm.user_id
              WHERE bm.batch_id = b.id AND m.deleted_at IS NULL) AS managers
         FROM batches b WHERE b.id = $1`,
        [batchId],
      )
    ).rows[0];
    const learners = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.participant_id, u.deleted_at,
         EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS has_logged_in,
         (SELECT coalesce(sum(d.sessions), 0)::int FROM learner_activity_daily d WHERE d.user_id = u.id) AS sessions
       FROM users u WHERE u.batch_id = $1 AND u.role = 'learner' AND u.erased_at IS NULL ORDER BY u.created_at`,
      [batchId],
    );
    const access = await learnerAccessMap(learners.rows.map((l) => l.id));
    res.json({
      batch: {
        id: b.id,
        name: b.name,
        batchCode: b.batch_code,
        status: b.status,
        startDate: b.start_date,
        durationMonths: b.duration_months,
        endDate: b.end_date,
        startCefr: b.start_cefr,
        targetCefr: b.target_cefr,
        targetCutScore: b.target_cut_score,
        autoReminders: b.auto_reminders,
        createdAt: b.created_at,
        completedAt: b.completed_at,
        fixedLicenses: b.license_budget,
        fixedLicensesUsed: b.fixed_used,
        managerNames: b.managers.filter((n: string) => n.trim()),
      },
      learners: learners.rows.map((l) => ({
        id: l.id,
        email: l.email,
        firstName: l.first_name,
        lastName: l.last_name,
        participantId: l.participant_id,
        active: !l.deleted_at,
        hasLoggedIn: l.has_logged_in,
        sessionCount: l.sessions,
        license: access.get(l.id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Managers can close out and reuse their batches; archiving and reopening
// stay with the Org Admin.
managerRouter.post("/batches/:id/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchId = await requireManagedBatch(req, res);
    if (!batchId) return;
    res.json({ id: batchId, ...(await completeBatch({ tenantId: req.user!.tenantId!, batchId, actorId: req.user!.id })) });
  } catch (err) {
    next(err);
  }
});

managerRouter.post("/batches/:id/clone", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchId = await requireManagedBatch(req, res);
    if (!batchId) return;
    const body = z.object({ name: z.string().trim().min(1).max(200), startDate: z.string().optional() }).parse(req.body);
    // The Manager always manages their own copy.
    const id = await cloneBatch({ tenantId: req.user!.tenantId!, batchId, name: body.name, startDate: body.startDate || null, copyManagers: true, actorId: req.user!.id });
    await pool.query(`INSERT INTO batch_managers (batch_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, req.user!.id]);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// ---- Activity on their batches and learners ----

managerRouter.get("/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    const learnerIds = (await pool.query(`SELECT id FROM users WHERE batch_id = ANY($1::uuid[]) AND role = 'learner'`, [batchIds])).rows.map((r) => r.id);
    const before = typeof req.query.before === "string" ? req.query.before : null;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await listScopedActivity({ tenantId: req.user!.tenantId!, managerId: req.user!.id, batchIds, learnerIds, before, limit });
    res.json({ entries: rows, hasMore: rows.length === limit });
  } catch (err) {
    next(err);
  }
});

// ---- Email preferences ----

managerRouter.get("/preferences", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const r = (await pool.query(`SELECT daily_digest, pool_alerts FROM user_notification_prefs WHERE user_id = $1`, [req.user!.id])).rows[0];
    res.json({ dailyDigest: r?.daily_digest ?? true, poolAlerts: r?.pool_alerts ?? true });
  } catch (err) {
    next(err);
  }
});

managerRouter.put("/preferences", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = z.object({ dailyDigest: z.boolean(), poolAlerts: z.boolean() }).parse(req.body);
    await pool.query(
      `INSERT INTO user_notification_prefs (user_id, daily_digest, pool_alerts) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET daily_digest = $2, pool_alerts = $3, updated_at = now()`,
      [req.user!.id, body.dailyDigest, body.poolAlerts],
    );
    res.json(body);
  } catch (err) {
    next(err);
  }
});
