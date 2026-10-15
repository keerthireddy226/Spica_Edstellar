// CEFR levels from scored answers, shared by the placement test, mock
// exams and recruitment results: per skill, then one headline level.
import { isTrulyCorrect, type StoredMannerScores } from "./fluencySignals.js";
import { assessSkillLevel, cefrRank, passThresholdForLevel, percentToCefr, type CefrLevel } from "./cefr.js";
import type { SkillTag } from "./roadmapBuilder.js";

const ALL_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];

export interface ScoredAttemptRow {
  status: string;
  content_score: number | string | null;
  manner_scores: StoredMannerScores | null;
  skills: string[];
  input_method: string;
  cefr_level: CefrLevel | null;
}

export function rowIsCorrect(r: ScoredAttemptRow): boolean {
  return isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
}

// Per-skill percent/level, plus the same percents shaped for buildRoadmap's "weakest first" ranking.
export function computeSkillBreakdown(graded: ScoredAttemptRow[], overallPercent: number) {
  const skillPercents = {} as Record<SkillTag, number | null>;
  const skillLevels = {} as Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null>;
  const roadmapSkillPercents = {} as Record<SkillTag, number>;
  for (const skill of ALL_SKILLS) {
    const relevant = graded.filter((r) => r.skills.includes(skill));
    if (relevant.length === 0) {
      skillPercents[skill] = null;
      skillLevels[skill] = null;
      roadmapSkillPercents[skill] = overallPercent;
      continue;
    }
    const percent = Math.round((relevant.filter(rowIsCorrect).length / relevant.length) * 100);
    // Highest CEFR level actually sustained, not just a flat percentage; falls back to percent only if no cefr_level tags exist yet.
    const assessed = assessSkillLevel(relevant.map((r) => ({ cefrLevel: r.cefr_level, correct: rowIsCorrect(r) })));
    skillPercents[skill] = percent;
    skillLevels[skill] = { level: assessed.level ?? percentToCefr(percent), cappedByGap: assessed.cappedByGap };
    roadmapSkillPercents[skill] = percent;
  }
  return { skillPercents, skillLevels, roadmapSkillPercents };
}

// Headline level: assessed across all skills from every question shown. A skip counts as wrong; grading failures are excluded. Can't outrank the weakest tested skill (avoids a strong skill masking a failed one).
export function computeHeadlineLevel(
  graded: ScoredAttemptRow[],
  allRows: ScoredAttemptRow[],
  correctCount: number,
  pendingCount: number,
  skillLevels: Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null>,
) {
  const gradedLevels = new Set(graded.map((r) => r.cefr_level));
  const skippedAsWrong = allRows
    .filter((r) => r.status === "pending" && gradedLevels.has(r.cefr_level))
    .map((r) => ({ cefrLevel: r.cefr_level, correct: false }));
  const answeredEvidence = graded.map((r) => ({ cefrLevel: r.cefr_level, correct: rowIsCorrect(r) }));
  const overallAssessment = assessSkillLevel([...answeredEvidence, ...skippedAsWrong]);
  // Fallback percentage (no level certified above) also counts skips as wrong, or a mostly-skipped test would look fine.
  const overallPercentForLevel = Math.round((correctCount / (graded.length + pendingCount)) * 100);
  const pooledCefrLevel: CefrLevel = overallAssessment.level ?? percentToCefr(overallPercentForLevel);

  const testedSkillLevels = ALL_SKILLS.map((skill) => skillLevels[skill]?.level).filter(
    (level): level is CefrLevel => level != null,
  );
  const weakestTestedSkillLevel =
    testedSkillLevels.length > 0
      ? testedSkillLevels.reduce((weakest, level) => (cefrRank(level) < cefrRank(weakest) ? level : weakest))
      : null;
  const cefrLevel: CefrLevel =
    weakestTestedSkillLevel && cefrRank(weakestTestedSkillLevel) < cefrRank(pooledCefrLevel) ? weakestTestedSkillLevel : pooledCefrLevel;
  // Once a weak skill has pulled the headline down below what the pooled walk found, that's the real, complete reason
  // why — the gap caveat only makes sense when the pooled result stands as-is.
  const cefrCappedByGap = cefrLevel === pooledCefrLevel && overallAssessment.cappedByGap;
  return { cefrLevel, cefrCappedByGap };
}

// One finished test's level, as the learner and the recruiter see it: a
// headline CEFR level and one per skill tested. null when nothing could be
// scored yet.
export function levelSummary(rows: ScoredAttemptRow[]): {
  cefrLevel: CefrLevel;
  skillLevels: Partial<Record<SkillTag, CefrLevel>>;
  skillPercents: Partial<Record<SkillTag, number>>;
} | null {
  const graded = rows.filter((r) => r.status === "scored");
  if (graded.length === 0) return null;
  const correctCount = graded.filter(rowIsCorrect).length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const overallPercent = Math.round((correctCount / graded.length) * 100);
  const { skillPercents, skillLevels } = computeSkillBreakdown(graded, overallPercent);
  const { cefrLevel } = computeHeadlineLevel(graded, rows, correctCount, pendingCount, skillLevels);
  const levels: Partial<Record<SkillTag, CefrLevel>> = {};
  const percents: Partial<Record<SkillTag, number>> = {};
  for (const skill of ALL_SKILLS) {
    const l = skillLevels[skill];
    const p = skillPercents[skill];
    if (l) levels[skill] = l.level;
    if (p !== null && p !== undefined) percents[skill] = p;
  }
  return { cefrLevel, skillLevels: levels, skillPercents: percents };
}
