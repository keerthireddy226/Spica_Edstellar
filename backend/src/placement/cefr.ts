export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function cefrRank(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level);
}

/**
 * Approximate percent-correct -> CEFR band. A reasonable heuristic, not an
 * official Pearson/Versant score conversion — always surfaced to the user as
 * an estimate, never claimed as official.
 */
export function percentToCefr(percent: number): CefrLevel {
  if (percent < 20) return "A1";
  if (percent < 40) return "A2";
  if (percent < 60) return "B1";
  if (percent < 75) return "B2";
  if (percent < 90) return "C1";
  return "C2";
}

// Accuracy needed to be credited with a level — top levels demand near-flawless, bottom levels stay lenient.
const LEVEL_PASS_THRESHOLD: Record<CefrLevel, number> = {
  A1: 0.6,
  A2: 0.6,
  B1: 0.65,
  B2: 0.7,
  C1: 0.85,
  C2: 0.95,
};

export function passThresholdForLevel(level: string | null): number {
  if (level && level in LEVEL_PASS_THRESHOLD) return LEVEL_PASS_THRESHOLD[level as CefrLevel];
  return LEVEL_PASS_THRESHOLD.B1;
}

// Middle of the scale — the first question is equally uninformative either way.
export const START_LEVEL: CefrLevel = "B1";

// One step of the adaptive walk: right -> one level harder, wrong/skipped -> one level easier.
export function stepLevel(level: CefrLevel, correct: boolean): CefrLevel {
  const rank = cefrRank(level);
  const nextRank = correct ? Math.min(rank + 1, CEFR_LEVELS.length - 1) : Math.max(rank - 1, 0);
  return CEFR_LEVELS[nextRank];
}

/**
 * Assesses a level from which difficulty a learner got right, not a flat percent. Walks A1->C2,
 * stopping at the highest level clearing its own pass bar; a gap (untested level before higher
 * tested ones) also stops the walk there, since an unbroken chain from the evidence start is the
 * only real basis to certify a level. `cappedByGap` tells the caller whether that's why it stopped
 * (true) vs. a real failure/no more items (false) — a capped result needs explaining to the learner.
 */
export interface SkillLevelAssessment {
  level: CefrLevel | null;
  cappedByGap: boolean;
}

// A single question isn't enough evidence; below this, a level is treated as untested, not pass/fail.
const MIN_LEVEL_SAMPLE = 2;

export function assessSkillLevel(gradedItems: { cefrLevel: string | null; correct: boolean }[]): SkillLevelAssessment {
  const byLevel = new Map<CefrLevel, { correct: number; total: number }>();
  for (const item of gradedItems) {
    if (!item.cefrLevel || !CEFR_LEVELS.includes(item.cefrLevel as CefrLevel)) continue;
    const level = item.cefrLevel as CefrLevel;
    const entry = byLevel.get(level) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (item.correct) entry.correct += 1;
    byLevel.set(level, entry);
  }
  if (byLevel.size === 0) return { level: null, cappedByGap: false };

  const hasEnoughEvidence = (level: CefrLevel) => (byLevel.get(level)?.total ?? 0) >= MIN_LEVEL_SAMPLE;

  let highestPassed: CefrLevel | null = null;
  // The level just below, as tested: each level is judged together with it.
  let below: { correct: number; total: number } | null = null;
  let sawFirstTestedLevel = false;
  for (const level of CEFR_LEVELS) {
    if (!hasEnoughEvidence(level)) {
      if (sawFirstTestedLevel) {
        // Stopped on a gap (including "only one question at this level,
        // which isn't enough to count") — but only worth flagging if
        // there's real evidence at a *higher* level than where we stopped,
        // since that's exactly the "100% next to a low level" situation
        // that needs an explanation. A gap with nothing tested beyond it
        // isn't confusing.
        const higherLevelTested = CEFR_LEVELS.slice(cefrRank(level) + 1).some(hasEnoughEvidence);
        return { level: highestPassed, cappedByGap: higherLevelTested };
      }
      continue;
    }
    sawFirstTestedLevel = true;
    const entry = byLevel.get(level)!;
    if (entry.correct === 0) break;
    // A level counts when its questions and the level below's, together,
    // clear its pass bar, and the walk stops at the first level that
    // doesn't. Judged alone, a level rested on a handful of questions: one
    // answer either way moved it (3 of 5 at B1 failed, 4 of 5 passed), and a
    // failed level could be skipped (33% at B1, then 75% at B2, gave B2).
    const pooled = below ? (entry.correct + below.correct) / (entry.total + below.total) : entry.correct / entry.total;
    if (pooled < passThresholdForLevel(level)) break;
    highestPassed = level;
    below = entry;
  }
  return { level: highestPassed, cappedByGap: false };
}
