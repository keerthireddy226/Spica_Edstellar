import { pool } from "../db.js";

// Same completion rule used everywhere: a session counts only if every item got a real answer.
const GENUINELY_COMPLETED = `
  sessions.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
`;

// Everything about one learner for the console views. `batchIds` limits a
// Manager to their own batches. `includeSensitive` gates gender and age;
// both the Org Admin and the learner's Manager see them.
export async function buildLearnerProfile(learnerId: string, scope: { tenantId: string; batchIds?: string[]; includeSensitive: boolean }) {
  const learnerResult = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at, u.deleted_at, u.participant_id, u.batch_id,
       u.employee_id, u.department, u.job_title, u.phone,
       t.name AS tenant_name, t.type AS tenant_type, t.category AS tenant_category, b.name AS batch_name
     FROM users u
     LEFT JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN batches b ON b.id = u.batch_id
     WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'learner' AND u.erased_at IS NULL
       AND ($3::uuid[] IS NULL OR u.batch_id = ANY($3::uuid[]))`,
    [learnerId, scope.tenantId, scope.batchIds ?? null],
  );
  if (learnerResult.rowCount === 0) return null;
  const learner = learnerResult.rows[0];

  const [onboarding, placement, roadmap, progress, skillStats, sessionTotals, sessionsByType, batchMoves] = await Promise.all([
    pool.query(`SELECT * FROM participant_profiles WHERE user_id = $1`, [learnerId]),
    pool.query(`SELECT * FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [learnerId]),
    pool.query(`SELECT * FROM roadmaps WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1`, [learnerId]),
    pool.query(`SELECT * FROM progress_stats WHERE user_id = $1`, [learnerId]),
    pool.query(`SELECT skill, minutes, accuracy_correct, accuracy_graded FROM skill_stats WHERE user_id = $1 ORDER BY skill`, [learnerId]),
    pool.query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE ${GENUINELY_COMPLETED})::int AS genuinely_completed,
         max(completed_at) AS last_session_at
       FROM sessions WHERE user_id = $1`,
      [learnerId],
    ),
    pool.query(
      `SELECT session_type, count(*)::int AS n FROM sessions WHERE user_id = $1 GROUP BY session_type`,
      [learnerId],
    ),
    pool.query(
      `SELECT bm.from_batch_name, bm.to_batch_name, bm.reason, bm.moved_at, concat_ws(' ', mu.first_name, mu.last_name) AS moved_by_name
       FROM batch_moves bm LEFT JOIN users mu ON mu.id = bm.moved_by
       WHERE bm.user_id = $1 ORDER BY bm.moved_at DESC`,
      [learnerId],
    ),
  ]);

  const p = onboarding.rows[0];
  const pl = placement.rows[0];
  const r = roadmap.rows[0];
  const prog = progress.rows[0];

  return {
    learner: {
      id: learner.id,
      participantId: learner.participant_id,
      email: learner.email,
      firstName: learner.first_name,
      lastName: learner.last_name,
      tenantName: learner.tenant_name,
      tenantType: learner.tenant_type,
      tenantCategory: learner.tenant_category,
      batchId: learner.batch_id,
      batchName: learner.batch_name,
      active: !learner.deleted_at,
      createdAt: learner.created_at,
    },
    // What the organization records about them; gender and age are only
    // here when the viewer may see them.
    employment: {
      employeeId: learner.employee_id,
      department: learner.department,
      jobTitle: learner.job_title,
      phone: learner.phone,
      country: p?.country ?? null,
      city: p?.city ?? null,
      jobRole: p?.job_role ?? null,
      gender: scope.includeSensitive ? (p?.gender ?? null) : null,
      ageBand: scope.includeSensitive ? (p?.age_band ?? null) : null,
      demographicsSource: p?.demographics_source ?? null,
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
          gender: scope.includeSensitive ? p.gender : null,
          ageBand: scope.includeSensitive ? p.age_band : null,
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
  };
}
