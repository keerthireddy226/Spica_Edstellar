// Questions in use whose statistics look wrong go back to review: almost
// everyone right or almost everyone wrong, or learners who do well overall
// doing worse on it than learners who don't (ASSESSMENT_ENGINE.md section 6).
import { pool } from "../db.js";

// Enough answers for the numbers to mean something.
export const MIN_ANSWERS = 30;
export const TOO_EASY = 0.95;
export const TOO_HARD = 0.1;

export function statsProblem(s: { n: number; mean: number | null; discrimination: number | null }): string | null {
  if (s.n < MIN_ANSWERS || s.mean === null) return null;
  if (s.mean >= TOO_EASY) return `almost everyone gets it right (${Math.round(s.mean * 100)}% average score, ${s.n} answers)`;
  if (s.mean <= TOO_HARD) return `almost everyone gets it wrong (${Math.round(s.mean * 100)}% average score, ${s.n} answers)`;
  if (s.discrimination !== null && s.discrimination < 0) return `stronger learners do worse on it than weaker ones (correlation ${s.discrimination.toFixed(2)}, ${s.n} answers)`;
  return null;
}

// Per question: answers, average score, and how its score goes with the
// learner's overall result in that test.
export async function itemStats(itemIds?: string[]) {
  const r = await pool.query(
    `SELECT a.item_id, count(*)::int AS n, avg(sc.content_score)::float AS mean,
       corr(sc.content_score, (s.result->>'overallPercent')::float)::float AS discrimination,
       (SELECT count(*)::int FROM session_item_views v WHERE v.item_id = a.item_id) AS views
     FROM attempts a JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored' JOIN sessions s ON s.id = a.session_id
     WHERE ($1::uuid[] IS NULL OR a.item_id = ANY($1::uuid[]))
     GROUP BY a.item_id`,
    [itemIds ?? null],
  );
  return new Map(r.rows.map((x) => [x.item_id as string, { n: x.n as number, mean: x.mean as number | null, discrimination: x.discrimination as number | null, views: x.views as number }]));
}

// Sends questions with suspicious statistics to review (not ones a person
// reviewed in the last 90 days).
export async function flagByStatistics(): Promise<number> {
  const stats = await itemStats();
  let flagged = 0;
  for (const [id, s] of stats) {
    const problem = statsProblem(s);
    if (!problem) continue;
    const r = await pool.query(
      `UPDATE items SET review_state = 'needs_review', review_reason = $2, updated_at = now()
       WHERE id = $1 AND status = 'approved' AND review_state IS NULL AND (reviewed_at IS NULL OR reviewed_at < now() - interval '90 days')`,
      [id, `Statistics: ${problem}`],
    );
    flagged += r.rowCount ?? 0;
  }
  return flagged;
}
