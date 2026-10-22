import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { levelSummary } from "../placement/levels.js";
import { snapshot } from "../reports/batchReport.js";
import { qualitySettings } from "../quality/settings.js";
import { levelTestPassed } from "./modes.js";

// Every answer of a session with its score, for the result at the end.
export async function loadScoreRows(sessionId: string) {
  const r = await pool.query(
    `SELECT sc.status, sc.content_score, sc.manner_scores, it.input_method, it.skills, i.cefr_level, coalesce(ep.part_label, it.name) AS part_label,
       a.response_text, a.response_uri
     FROM attempts a
     JOIN scores sc ON sc.attempt_id = a.id
     JOIN items i ON i.id = a.item_id
     JOIN item_types it ON it.id = i.item_type_id
     LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id
     WHERE a.session_id = $1`,
    [sessionId],
  );
  return r.rows;
}

// The result figures from a session's answers.
export function summarizeScores(raw: Awaited<ReturnType<typeof loadScoreRows>>) {
  // A question left blank (skipped, or never reached) counts as wrong in
  // every figure: the percentage, the skill levels and the sections. It used
  // to be left out, so 2 right answers out of 42 questions showed as 100%.
  const isBlank = (r: { response_text: string | null; response_uri: string | null }) => !r.response_text && !r.response_uri;
  const skippedCount = raw.filter((r) => r.status === "pending" && isBlank(r)).length;
  const rows = raw.map((r) => (r.status === "pending" && isBlank(r) ? { ...r, status: "scored", content_score: 0 } : r));
  const graded = rows.filter((r) => r.status === "scored");
  const rowCorrect = (r: (typeof rows)[number]) =>
    isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
  const correctCount = graded.filter(rowCorrect).length;
  // "Pending" splits into two very different things for the learner: a
  // real answer that's still waiting on AI grading, vs. a question left
  // blank (Skip, or never reached) — the latter will never grade itself,
  // so lumping it into "still being reviewed" is misleading.
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  // The same CEFR level logic as the placement test, from each question's level.
  const summary = levelSummary(rows);
  // The overall level is the Spica score's (the mean of the skills' scores),
  // as on the score report, so a high percentage never shows a low level.
  const level = summary
    ? {
        ...summary,
        cefrLevel: (snapshot(summary.skillLevels as never, summary.skillPercents as never, graded.length ? Math.round((correctCount / graded.length) * 100) : null, summary.cefrLevel).level ??
          summary.cefrLevel) as typeof summary.cefrLevel,
      }
    : null;
  const overall = graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : null;
  return { rows, graded, rowCorrect, correctCount, pendingCount, failedCount, skippedCount, level, overall };
}

// A level test's pass or fail, decided only once every answer is scored: an
// answer whose AI scoring failed or is still waiting leaves it undecided
// (passed: null, shown as "scoring") rather than passing without that skill.
export async function levelTestOutcome(level: string, s: ReturnType<typeof summarizeScores>) {
  const unscored = s.pendingCount + s.failedCount;
  const q = await qualitySettings();
  return {
    level,
    passed: unscored > 0 ? null : levelTestPassed(s.overall, (s.level?.skillPercents ?? {}) as Record<string, number>, { overall: q.levelPassOverall, skill: q.levelSkillMin }),
    ...(unscored > 0 ? { unscored } : {}),
    overallPercent: s.overall,
    skillPercents: s.level?.skillPercents ?? {},
  };
}

// Level tests left undecided: decided now if their answers have since been
// scored (the background scoring retries). Returns how many were decided.
export async function settleLevelTests(): Promise<number> {
  const r = await pool.query(
    `SELECT id, composition->>'levelTest' AS level FROM sessions
     WHERE completed_at IS NOT NULL AND delivery_mode = 'certified' AND composition->>'levelTest' IS NOT NULL
       AND result ? 'levelTest' AND jsonb_typeof(result->'levelTest'->'passed') = 'null'`,
  );
  let decided = 0;
  for (const { id, level } of r.rows) {
    const s = summarizeScores(await loadScoreRows(id));
    const outcome = await levelTestOutcome(level, s);
    if (outcome.passed === null) continue;
    await pool.query(`UPDATE sessions SET result = result || $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify({
        cefrLevel: s.level?.cefrLevel ?? null,
        skillLevels: s.level?.skillLevels ?? null,
        skillPercents: s.level?.skillPercents ?? null,
        overallPercent: s.overall,
        levelTest: outcome,
      }),
    ]);
    decided++;
  }
  return decided;
}
