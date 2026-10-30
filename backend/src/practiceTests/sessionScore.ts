import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { levelSummary, weightedSkillMean } from "../placement/levels.js";
import { snapshot } from "../reports/batchReport.js";
import { qualitySettings } from "../quality/settings.js";
import { bandForLevel, familyScoreScale, levelTestPassed } from "./modes.js";
import { testTypeOfExam } from "../catalogue/service.js";

// Results saved with unscored answers are settled this long after the test.
const SETTLE_DAYS = 45;

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

// The result figures from a session's answers. The overall percentage is the
// skills' percentages weighted by the test (each skill the same, except the
// English Writing test), so no skill counts more just for having more questions.
export function summarizeScores(raw: Awaited<ReturnType<typeof loadScoreRows>>, testTypeId?: string | null) {
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
  const pooled = graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : null;
  const weighted = summary ? weightedSkillMean(summary.skillPercents, testTypeId) : null;
  const overall = weighted !== null ? Math.round(weighted) : pooled;
  // The overall level is the Spica score's (the weighted mean of the skills'
  // scores), as on the score report, so a high percentage never shows a low level.
  const level = summary
    ? {
        ...summary,
        cefrLevel: (snapshot(summary.skillLevels as never, summary.skillPercents as never, overall, summary.cefrLevel, testTypeId).level ?? summary.cefrLevel) as typeof summary.cefrLevel,
      }
    : null;
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

// Answers not scored yet: still waiting on the AI, or its scoring failed.
export function unscoredCount(s: ReturnType<typeof summarizeScores>): number {
  return s.pendingCount + s.failedCount;
}

// The result figures to save again once every answer is scored (null while
// some aren't): the level, each skill's level and share, the overall share
// and, for a level test, its pass or fail.
export async function settledResult(levelTest: string | null, s: ReturnType<typeof summarizeScores>, scale: Awaited<ReturnType<typeof familyScoreScale>>) {
  if (unscoredCount(s) > 0) return null;
  return {
    cefrLevel: s.level?.cefrLevel ?? null,
    skillLevels: s.level?.skillLevels ?? null,
    skillPercents: s.level?.skillPercents ?? null,
    overallPercent: s.overall,
    scoreBand: bandForLevel(scale, s.level?.cefrLevel),
    ...(levelTest ? { levelTest: await levelTestOutcome(levelTest, s) } : {}),
  };
}

// A result saved at /complete while some answers were still unscored (marked
// with result.unscored) is saved again once the background scoring retries
// have scored them all, so the level, the skills and the percentage (and a
// level test's pass or fail) count every answer. Also level tests left
// undecided (passed: null), e.g. one an appeal re-marked. Returns how many
// results were settled.
export async function settleResults(): Promise<number> {
  const r = await pool.query(
    `SELECT s.id, s.delivery_mode, s.composition FROM sessions s
     WHERE s.completed_at IS NOT NULL
       AND ((s.result ? 'unscored' AND s.completed_at > now() - interval '${SETTLE_DAYS} days')
         OR (s.delivery_mode = 'certified' AND s.composition->>'levelTest' IS NOT NULL
             AND s.result ? 'levelTest' AND jsonb_typeof(s.result->'levelTest'->'passed') = 'null'))
       -- Only once nothing is left to score (as summarizeScores counts it).
       AND NOT EXISTS (SELECT 1 FROM attempts a JOIN scores sc ON sc.attempt_id = a.id
                       WHERE a.session_id = s.id
                         AND (sc.status = 'failed' OR (sc.status = 'pending' AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))))
     ORDER BY s.completed_at LIMIT 200`,
  );
  let settled = 0;
  for (const { id, delivery_mode, composition } of r.rows) {
    const c = (composition ?? {}) as Record<string, unknown>;
    const testTypeId = (c.testTypeId as string | undefined) ?? (c.examId ? await testTypeOfExam(c.examId as string) : null);
    const s = summarizeScores(await loadScoreRows(id), testTypeId);
    // The score range as /complete works it out: mocks and real tests in the exam's format.
    const scale = (delivery_mode === "mock" || delivery_mode === "certified") && !c.shortForm ? await familyScoreScale(testTypeId) : null;
    const result = await settledResult((c.levelTest as string | undefined) ?? null, s, scale);
    if (!result) continue;
    await pool.query(`UPDATE sessions SET result = (result || $2::jsonb) - 'unscored' WHERE id = $1`, [id, JSON.stringify(result)]);
    settled++;
  }
  return settled;
}

// The older name, still used where a level test is waiting on its answers.
export const settleLevelTests = settleResults;
