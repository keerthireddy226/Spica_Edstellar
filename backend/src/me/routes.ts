import { z } from "zod";
import { activeProgramOf, planMember } from "../programs/service.js";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { learnerAccess } from "../licenses/service.js";
import { getLearnerStats } from "../gamification/stats.js";
import { rebuildRoadmap } from "../roadmap/save.js";
import { learnerBoard } from "../learner/leaderboard.js";
import { overallFromSkills, pathSummary } from "../learner/path.js";

// The signed-in person's own profile extras: work details, what they've
// done recently, a summary of their role, and (for learners) their
// learning setup.
export const meRouter = Router();

const STAFF_ROLES = ["super_admin", "admin", "org_admin", "manager", "recruiter"];
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

meRouter.get("/work", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(`SELECT phone, job_title, department, region, city, country, staff_notes FROM users WHERE id = $1`, [req.user!.id]);
    const u = r.rows[0] ?? {};
    res.json({ phone: u.phone, jobTitle: u.job_title, department: u.department, region: u.region, city: u.city, country: u.country, notes: u.staff_notes });
  } catch (err) {
    next(err);
  }
});

meRouter.patch("/work", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!STAFF_ROLES.includes(req.user!.role)) return res.status(403).json({ error: "forbidden" });
  try {
    const b = z
      .object({
        phone: text(40),
        jobTitle: text(120),
        department: text(120),
        region: text(120),
        city: text(100),
        country: z.string().trim().length(2).toUpperCase().optional().or(z.literal("").transform(() => undefined)),
      })
      .parse(req.body);
    await pool.query(
      `UPDATE users SET phone = $2, job_title = $3, department = $4, region = $5, city = $6, country = $7, updated_at = now() WHERE id = $1`,
      [req.user!.id, b.phone ?? null, b.jobTitle ?? null, b.department ?? null, b.region ?? null, b.city ?? null, b.country ?? null],
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Changes this person made, newest first.
meRouter.get("/activity", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT a.action, a.target_label, a.created_at, t.name AS org_name
       FROM audit_log a LEFT JOIN tenants t ON t.id = a.tenant_id
       WHERE a.actor_id = $1 ORDER BY a.created_at DESC LIMIT 20`,
      [req.user!.id],
    );
    res.json({ entries: r.rows.map((x) => ({ action: x.action, targetLabel: x.target_label, orgName: x.org_name, createdAt: x.created_at })) });
  } catch (err) {
    next(err);
  }
});

// A few numbers about what this person looks after.
meRouter.get("/summary", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const u = req.user!;
    const q1 = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];
    if (u.role === "super_admin") {
      const r = await q1(
        `SELECT (SELECT count(*)::int FROM tenants WHERE type = 'cohort' AND deactivated_at IS NULL) AS organizations,
           (SELECT count(*)::int FROM users WHERE role = 'admin' AND deleted_at IS NULL) AS admins,
           (SELECT count(*)::int FROM users WHERE role = 'learner' AND deleted_at IS NULL) AS learners,
           (SELECT count(*)::int FROM users WHERE invited_by = $1) AS people_added`,
        [u.id],
      );
      return res.json({ items: [["Organizations on Spica", r.organizations], ["Admins", r.admins], ["Learners", r.learners], ["People you added", r.people_added]] });
    }
    if (u.role === "admin") {
      const r = await q1(
        `SELECT count(*)::int AS organizations,
           (SELECT count(*)::int FROM users l JOIN tenants t2 ON t2.id = l.tenant_id
              WHERE l.role = 'learner' AND l.deleted_at IS NULL AND (t2.managed_by = $1 OR t2.account_manager_id = $1)) AS learners,
           (SELECT count(*)::int FROM users WHERE invited_by = $1 AND role = 'learner') AS individuals_invited,
           (SELECT count(*)::int FROM tenants t3 WHERE (t3.managed_by = $1 OR t3.account_manager_id = $1) AND t3.contract_end BETWEEN current_date AND current_date + 60) AS renewals
         FROM tenants t WHERE t.type = 'cohort' AND t.deactivated_at IS NULL AND (t.managed_by = $1 OR t.account_manager_id = $1)`,
        [u.id],
      );
      return res.json({ items: [["Organizations you own", r.organizations], ["Learners in them", r.learners], ["Individuals you invited", r.individuals_invited], ["Renewals in 60 days", r.renewals]] });
    }
    if (u.role === "org_admin" && u.tenantId) {
      const r = await q1(
        `SELECT t.name, t.plan_tier,
           (SELECT count(*)::int FROM batches WHERE tenant_id = t.id AND status = 'active') AS batches,
           (SELECT count(*)::int FROM users WHERE tenant_id = t.id AND role = 'manager' AND deleted_at IS NULL) AS managers,
           (SELECT count(*)::int FROM users WHERE tenant_id = t.id AND role = 'learner' AND deleted_at IS NULL) AS learners
         FROM tenants t WHERE t.id = $1`,
        [u.tenantId],
      );
      return res.json({ heading: `${r.name} · ${r.plan_tier}`, items: [["Active batches", r.batches], ["Managers", r.managers], ["Learners", r.learners]] });
    }
    if (u.role === "manager") {
      const r = await q1(
        `SELECT (SELECT count(*)::int FROM batch_managers bm JOIN batches b ON b.id = bm.batch_id WHERE bm.user_id = $1 AND b.status = 'active') AS batches,
           (SELECT count(*)::int FROM users l WHERE l.role = 'learner' AND l.deleted_at IS NULL AND l.batch_id IN (SELECT batch_id FROM batch_managers WHERE user_id = $1)) AS learners,
           u.license_allotment,
           (SELECT count(*)::int FROM license_assignments a WHERE a.source = 'manager' AND a.source_manager_id = $1 AND a.reclaimed_at IS NULL) AS used,
           (SELECT name FROM tenants WHERE id = u.tenant_id) AS org
         FROM users u WHERE u.id = $1`,
        [u.id],
      );
      return res.json({
        heading: r.org,
        items: [
          ["Active batches", r.batches],
          ["Learners", r.learners],
          ["Pool licenses left", r.license_allotment == null ? "—" : Math.max(0, r.license_allotment - r.used)],
        ],
      });
    }
    res.json({ items: [] });
  } catch (err) {
    next(err);
  }
});

// A learner's own setup: their goals, organization and batch (with who to
// contact), progress, certificates and access.
meRouter.get("/learning", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    const id = req.user!.id;
    const [u, prog, place, certs] = await Promise.all([
      pool.query(
        `SELECT u.created_at, u.participant_id, t.type AS tenant_type, t.name AS org_name, t.category,
           b.id AS batch_id, b.name AS batch_name, b.start_date, b.duration_months, b.start_cefr, b.target_cefr, b.target_cut_score,
           b.weekly_minutes_goal, b.exam_focus, b.description AS batch_description,
           (SELECT coalesce(json_agg(json_build_object('name', concat_ws(' ', m.first_name, m.last_name), 'email', m.email)), '[]')
              FROM batch_managers bm JOIN users m ON m.id = bm.user_id WHERE bm.batch_id = b.id AND m.deleted_at IS NULL) AS managers,
           (SELECT json_build_object('name', concat_ws(' ', oa.first_name, oa.last_name), 'email', oa.email)
              FROM users oa WHERE oa.tenant_id = t.id AND oa.role = 'org_admin' AND oa.deleted_at IS NULL LIMIT 1) AS org_admin,
           pp.exam_preference, pp.goal_level, pp.score_target, pp.exam_date, pp.daily_minutes_preference, pp.exam_reason, pp.target_prep_days, pp.first_language
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN batches b ON b.id = u.batch_id
         LEFT JOIN participant_profiles pp ON pp.user_id = u.id
         WHERE u.id = $1`,
        [id],
      ),
      pool.query(`SELECT * FROM progress_stats WHERE user_id = $1`, [id]),
      pool.query(`SELECT cefr_level, overall_percent, taken_at FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [id]),
      pool.query(`SELECT code, cefr_level, batch_name, issued_at FROM certificates WHERE user_id = $1 AND revoked_at IS NULL ORDER BY issued_at DESC`, [id]),
    ]);
    const x = u.rows[0];
    const p = prog.rows[0];
    // Same numbers as the learner's Overview.
    const st = await getLearnerStats(id);
    const pl = place.rows[0];
    res.json({
      participantId: x.participant_id,
      memberSince: x.created_at,
      organization: x.tenant_type === "cohort" ? { name: x.org_name, category: x.category, orgAdmin: x.org_admin } : null,
      batch: x.batch_id
        ? {
            name: x.batch_name,
            description: x.batch_description,
            startDate: x.start_date,
            durationMonths: x.duration_months,
            startCefr: x.start_cefr,
            targetCefr: x.target_cefr,
            targetCutScore: x.target_cut_score,
            weeklyMinutesGoal: x.weekly_minutes_goal,
            examFocus: x.exam_focus,
            managers: x.managers,
          }
        : null,
      goals: {
        examPreference: x.exam_preference,
        goalLevel: x.goal_level,
        scoreTarget: x.score_target,
        examDate: x.exam_date,
        dailyMinutes: x.daily_minutes_preference,
        examReason: x.exam_reason,
        firstLanguage: x.first_language ?? null,
      },
      progress: {
        // The same overall level as Overview and My journey (the skill paths), else the placement's.
        level: overallFromSkills(await pathSummary(id)) ?? pl?.cefr_level ?? null,
        placementPercent: pl?.overall_percent ?? null,
        placedAt: pl?.taken_at ?? null,
        sessions: st.sessions,
        questions: st.questionsCompleted,
        minutes: st.practiceMinutes,
        streak: st.streakDays,
        xp: st.totalXp,
        accuracy: st.accuracyPercent ?? null,
        lastPractice: p?.last_practice_date ?? null,
      },
      certificates: certs.rows.map((c) => ({ code: c.code, cefrLevel: c.cefr_level, batchName: c.batch_name, issuedAt: c.issued_at })),
      access: await learnerAccess(id),
    });
  } catch (err) {
    next(err);
  }
});

meRouter.patch("/goals", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    const b = z
      .object({
        examPreference: z.enum(["versant", "ielts", "toefl", "pte", "cambridge", "other"]).optional(),
        goalLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "unsure"]).optional(),
        scoreTarget: z.string().trim().max(20).optional(),
        examDate: z.string().optional().or(z.literal("").transform(() => null)).nullable(),
        dailyMinutes: z.coerce.number().int().min(5).max(240).optional(),
        examReason: z.enum(["university", "job", "immigration", "promotion", "personal"]).optional(),
        // For the speaking fairness study (scores by first language).
        firstLanguage: z.string().trim().max(60).optional(),
      })
      .parse(req.body);
    await pool.query(
      `INSERT INTO participant_profiles (user_id, exam_preference, goal_level, score_target, exam_date, daily_minutes_preference, exam_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         exam_preference = coalesce($2, participant_profiles.exam_preference),
         goal_level = coalesce($3, participant_profiles.goal_level),
         score_target = coalesce($4, participant_profiles.score_target),
         exam_date = CASE WHEN $8 THEN $5::date ELSE participant_profiles.exam_date END,
         daily_minutes_preference = coalesce($6, participant_profiles.daily_minutes_preference),
         exam_reason = coalesce($7, participant_profiles.exam_reason),
         updated_at = now()`,
      [req.user!.id, b.examPreference ?? null, b.goalLevel ?? null, b.scoreTarget ?? null, b.examDate ?? null, b.dailyMinutes ?? null, b.examReason ?? null, b.examDate !== undefined],
    );
    if (b.firstLanguage !== undefined) {
      const lang = b.firstLanguage ? b.firstLanguage.charAt(0).toUpperCase() + b.firstLanguage.slice(1) : null;
      await pool.query(`UPDATE participant_profiles SET first_language = $2 WHERE user_id = $1`, [req.user!.id, lang]);
    }
    // A new goal, exam date or daily time gets a new study plan.
    if (b.goalLevel !== undefined || b.examDate !== undefined || b.dailyMinutes !== undefined) await rebuildRoadmap(req.user!.id);
    // A program's test plan stops at the learner's own exam date.
    if (b.examDate !== undefined) {
      const p = await activeProgramOf(req.user!.id);
      if (p) await planMember(p, req.user!.id).catch((err) => console.error("program replan failed:", err));
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// The learner's group this week (when their organization turned it on).
meRouter.get("/leaderboard", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    res.json(await learnerBoard(req.user!.id));
  } catch (err) {
    next(err);
  }
});

// Everything for a learner's Progress page in one call.
meRouter.get("/progress", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    const id = req.user!.id;
    const [totals, skills, days, recent, achievements, placements] = await Promise.all([
      pool.query(`SELECT * FROM progress_stats WHERE user_id = $1`, [id]),
      pool.query(`SELECT skill, minutes, accuracy_correct, accuracy_graded FROM skill_stats WHERE user_id = $1 ORDER BY skill`, [id]),
      pool.query(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(a.sessions, 0)::int AS sessions, coalesce(a.attempts, 0)::int AS attempts,
           coalesce(round(a.active_ms / 60000.0), 0)::int AS minutes
         FROM generate_series(current_date - 83, current_date, interval '1 day') d
         LEFT JOIN learner_activity_daily a ON a.user_id = $1 AND a.day = d::date
         ORDER BY d`,
        [id],
      ),
      pool.query(
        `SELECT s.id, s.session_type, s.mode, s.delivery_mode, s.composition->>'levelTest' AS level_test, s.started_at, s.completed_at,
           (SELECT count(*)::int FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)) AS answered,
           (SELECT coalesce(sum(a.active_ms), 0) FROM attempts a WHERE a.session_id = s.id) AS active_ms
         FROM sessions s WHERE s.user_id = $1 AND s.completed_at IS NOT NULL
           -- Sessions opened and left without an answer aren't listed.
           AND EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
         ORDER BY s.completed_at DESC LIMIT 12`,
        [id],
      ),
      pool.query(
        `SELECT a.id, a.title, a.description, a.icon, ua.unlocked_at
         FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
         ORDER BY ua.unlocked_at DESC NULLS LAST, a.title`,
        [id],
      ),
      pool.query(`SELECT cefr_level, overall_percent, status, taken_at FROM placements WHERE user_id = $1 ORDER BY taken_at`, [id]),
    ]);
    void totals;
    const st = await getLearnerStats(id);
    res.json({
      totals: {
        sessions: st.sessions,
        questions: st.questionsCompleted,
        minutes: st.practiceMinutes,
        streak: st.streakDays,
        xp: st.totalXp,
        accuracy: st.accuracyPercent ?? null,
      },
      skills: (Object.entries(st.skillAccuracy) as [string, { correct: number; graded: number }][]).map(([skill, v]) => ({
        skill,
        minutes: skills.rows.find((r) => r.skill === skill)?.minutes ?? 0,
        accuracy: v.graded ? Math.round((v.correct / v.graded) * 100) : null,
        answered: v.graded,
      })),
      days: days.rows,
      recent: recent.rows.map((r) => ({
        id: r.id,
        // A test says which kind it was: final assessment, level test, free sample, mock or practice test.
        type:
          r.session_type !== "mocktest"
            ? r.session_type
            : r.delivery_mode === "certified"
              ? r.level_test
                ? "level_test"
                : "final"
              : r.delivery_mode === "sample"
                ? "sample"
                : r.delivery_mode === "practice"
                  ? "practice_test"
                  : "mocktest",
        mode: r.mode,
        completedAt: r.completed_at,
        // Time actually spent answering, same as the totals — wall-clock time
        // counts a session left open overnight.
        minutes: Number(r.active_ms) > 0 ? Math.max(1, Math.round(Number(r.active_ms) / 60000)) : null,
        answered: r.answered,
      })),
      achievements: achievements.rows.map((a) => ({ id: a.id, title: a.title, description: a.description, icon: a.icon, unlockedAt: a.unlocked_at })),
      placements: placements.rows.map((p) => ({ level: p.cefr_level, percent: p.overall_percent, status: p.status, takenAt: p.taken_at })),
    });
  } catch (err) {
    next(err);
  }
});
