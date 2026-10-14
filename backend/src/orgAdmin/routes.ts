import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createAndInviteUser } from "../auth/invite.js";

export const orgAdminRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";

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

orgAdminRouter.patch("/organization", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    await pool.query(`UPDATE tenants SET name = $1 WHERE id = $2`, [body.name, tenantId]);
    res.json({ name: body.name });
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
      `SELECT b.id, b.name, b.created_at,
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
        learnerCount: r.learner_count,
        managerNames: r.manager_names,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/batches", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const result = await pool.query(
      `INSERT INTO batches (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [tenantId, body.name, req.user!.id],
    );
    res.status(201).json({ id: result.rows[0].id });
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
      `SELECT b.id, b.name, b.created_at,
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.batch_id = $1 AND u.role = 'learner'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [req.params.id],
    );
    res.json({
      batch: { id: b.id, name: b.name, managerNames: b.manager_names, createdAt: b.created_at },
      learners: learners.rows.map((r) => ({
        id: r.id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
      })),
    });
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at,
         coalesce(array_agg(b.name) FILTER (WHERE b.id IS NOT NULL), '{}') AS batch_names,
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
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchNames: r.batch_names,
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
  batchIds: z.array(z.string().uuid()).min(1),
});

orgAdminRouter.post("/managers", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const body = onboardManagerSchema.parse(req.body);
    // Only batches that are actually this Org Admin's own — never lets a
    // caller sneak a foreign batch id into their own org's manager.
    const ownedBatches = await pool.query(`SELECT id FROM batches WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
      tenantId,
      body.batchIds,
    ]);
    if (ownedBatches.rows.length !== body.batchIds.length) {
      return res.status(400).json({ error: "invalid_batch" });
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
    res.status(201).json({ id: userId, email: body.email });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, b.name AS batch_name,
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
    const result = await pool.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager' RETURNING id`, [
      req.params.id,
      tenantId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "manager_not_found" });
    res.json({ id: req.params.id });
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
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

orgAdminRouter.post("/managers/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
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
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, b.name AS batch_name,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.tenant_id = $1 AND u.role = 'learner'
       GROUP BY u.id, b.name
       ORDER BY u.created_at DESC`,
      [tenantId],
    );
    res.json({
      learners: result.rows.map((r) => ({
        id: r.id,
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

// Org Admins never onboard learners directly — that's a Manager's job,
// scoped to their own batch(es) (see managerRouter's own /learners POST).
orgAdminRouter.get("/learners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireOrgAdmin(req, res)) return;
  const tenantId = await requireOwnTenant(req, res);
  if (!tenantId) return;
  try {
    const learnerResult = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at,
         t.name AS tenant_name, t.type AS tenant_type, t.category AS tenant_category, b.name AS batch_name
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'learner'`,
      [req.params.id, tenantId],
    );
    if (learnerResult.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    const learner = learnerResult.rows[0];

    const [onboarding, placement, roadmap, progress, skillStats, sessionTotals, sessionsByType] = await Promise.all([
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
    ]);

    const p = onboarding.rows[0];
    const pl = placement.rows[0];
    const r = roadmap.rows[0];
    const prog = progress.rows[0];

    res.json({
      learner: {
        id: learner.id,
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
    const result = await pool.query(`DELETE FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner' RETURNING id`, [
      req.params.id,
      tenantId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    res.json({ id: req.params.id });
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
    res.json({ id: req.params.id });
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
