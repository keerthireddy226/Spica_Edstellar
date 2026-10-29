// The short, optional form after every test: a rating, whether the test ran
// smoothly (and what went wrong), how likely the person is to recommend Spica,
// and any suggestion. Asked once per test; skipping is recorded too.
import { pool } from "../db.js";

export const FEEDBACK_ISSUES = ["audio", "camera_mic", "slow", "screen", "other"] as const;

export interface FeedbackInput {
  skipped?: boolean;
  rating?: number | null;
  smooth?: boolean | null;
  issues?: (typeof FEEDBACK_ISSUES)[number][];
  recommend?: number | null;
  suggestion?: string | null;
}

// Whether the form should be shown for this test (the person's own, finished,
// and not answered or skipped yet).
export async function feedbackDue(userId: string, sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT NOT EXISTS (SELECT 1 FROM test_feedback f WHERE f.session_id = s.id) AS due
     FROM sessions s WHERE s.id = $1 AND s.user_id = $2 AND s.completed_at IS NOT NULL`,
    [sessionId, userId],
  );
  return r.rows[0]?.due === true;
}

export async function saveFeedback(userId: string, sessionId: string, f: FeedbackInput): Promise<boolean> {
  const r = await pool.query(
    `INSERT INTO test_feedback (session_id, user_id, tenant_id, skipped, rating, smooth, issues, recommend, suggestion)
     SELECT s.id, s.user_id, u.tenant_id, $3, $4, $5, $6, $7, $8 FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.user_id = $2 AND s.completed_at IS NOT NULL
     ON CONFLICT (session_id) DO NOTHING RETURNING id`,
    [sessionId, userId, !!f.skipped, f.rating ?? null, f.smooth ?? null, f.smooth === false ? (f.issues ?? []) : [], f.recommend ?? null, f.suggestion?.trim() || null],
  );
  return !!r.rows[0];
}

// For Edstellar staff: the averages, the recommend score (NPS: % 9–10 minus
// % 0–6), what went wrong, and the latest comments.
export async function feedbackSummary(days: number) {
  const since = `${Math.max(1, Math.min(days, 365))} days`;
  const t = (
    await pool.query(
      `SELECT count(*) FILTER (WHERE NOT skipped)::int AS answered, count(*) FILTER (WHERE skipped)::int AS skipped,
         round(avg(rating)::numeric, 2)::float AS rating,
         count(*) FILTER (WHERE smooth = false)::int AS not_smooth, count(*) FILTER (WHERE smooth IS NOT NULL)::int AS smooth_answered,
         count(*) FILTER (WHERE recommend >= 9)::int AS promoters, count(*) FILTER (WHERE recommend <= 6)::int AS detractors,
         count(recommend)::int AS recommend_answered
       FROM test_feedback WHERE created_at > now() - $1::interval`,
      [since],
    )
  ).rows[0];
  const issues = (
    await pool.query(`SELECT i AS issue, count(*)::int AS n FROM test_feedback, unnest(issues) i WHERE created_at > now() - $1::interval GROUP BY i ORDER BY n DESC`, [since])
  ).rows;
  const byTest = (
    await pool.query(
      `SELECT CASE WHEN s.session_type = 'placement' THEN 'placement' ELSE coalesce(s.delivery_mode, 'practice') END AS test,
         count(*) FILTER (WHERE NOT f.skipped)::int AS answered, round(avg(f.rating)::numeric, 2)::float AS rating
       FROM test_feedback f JOIN sessions s ON s.id = f.session_id WHERE f.created_at > now() - $1::interval GROUP BY 1 ORDER BY 1`,
      [since],
    )
  ).rows;
  const comments = (
    await pool.query(
      `SELECT f.created_at, f.rating, f.recommend, f.smooth, f.issues, f.suggestion, t.name AS org,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS learner, s.test_code,
         CASE WHEN s.session_type = 'placement' THEN 'placement' ELSE coalesce(s.delivery_mode, 'practice') END AS test
       FROM test_feedback f JOIN users u ON u.id = f.user_id JOIN sessions s ON s.id = f.session_id LEFT JOIN tenants t ON t.id = f.tenant_id
       WHERE NOT f.skipped AND f.created_at > now() - $1::interval AND (f.suggestion IS NOT NULL OR f.smooth = false OR f.rating <= 2)
       ORDER BY f.created_at DESC LIMIT 100`,
      [since],
    )
  ).rows;
  return {
    answered: t.answered,
    skipped: t.skipped,
    rating: t.rating,
    notSmoothPercent: t.smooth_answered ? Math.round((t.not_smooth / t.smooth_answered) * 100) : null,
    nps: t.recommend_answered ? Math.round(((t.promoters - t.detractors) / t.recommend_answered) * 100) : null,
    issues,
    byTest,
    comments,
  };
}
