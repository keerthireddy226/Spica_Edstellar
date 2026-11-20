// CEFR levels from scored answers, shared by the placement test, mock
// exams and recruitment results: per skill, then one headline level.
import { isTrulyCorrect, type StoredMannerScores } from "./fluencySignals.js";
import { assessSkillLevel, CEFR_LEVELS, passThresholdForLevel, percentToCefr, type CefrLevel } from "./cefr.js";
import type { SkillTag } from "./roadmapBuilder.js";
import { BELOW_A1, levelOfScore, spicaScore } from "./spicaScale.js";

// A skill's or test's reported level: a CEFR level, or Below A1 ("Pre-A1")
// when not even A1 is passed.
export type ReportedLevel = CefrLevel | typeof BELOW_A1;

const ALL_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];

export interface ScoredAttemptRow {
  status: string;
  content_score: number | string | null;
  manner_scores: StoredMannerScores | null;
  skills: string[];
  input_method: string;
  cefr_level: CefrLevel | null;
}

// How much each skill counts toward a test's overall result: the same for
// every skill the test reports, in every test (owner decision 2026-11-05; the
// English Writing test used to count writing as half).
export function skillWeights(testTypeId: string | null | undefined, skills: string[]): Record<string, number> {
  void testTypeId;
  if (!skills.length) return {};
  return Object.fromEntries(skills.map((s) => [s, 1 / skills.length]));
}

// The weighted mean of the skills' values (percents or scores); null when no
// skill has one.
export function weightedSkillMean(values: Partial<Record<string, number | null>>, testTypeId: string | null | undefined): number | null {
  const skills = Object.keys(values).filter((s) => typeof values[s] === "number");
  if (!skills.length) return null;
  const w = skillWeights(testTypeId, skills);
  return skills.reduce((sum, s) => sum + (values[s] as number) * w[s], 0);
}

// How results are worked out. Version 2 (owner decision 20 Nov 2026): a
// question that counts for several skills (Repeats: listening and speaking;
// Dictation: listening and writing) counts 1/n towards each, so one answer
// weighs the same in total as a single-skill question. Results saved before it
// keep version 1 (every question counts fully for each of its skills), so a
// saved result, its report and its certificate never disagree.
export const SCORING_VERSION = 2;
export interface ScoringOptions {
  splitWeights?: boolean;
}
export const scoringOptions = (version: unknown): ScoringOptions => ({ splitWeights: Number(version) >= 2 });

function skillWeight(r: ScoredAttemptRow, opts: ScoringOptions): number {
  if (!opts.splitWeights) return 1;
  const n = r.skills.filter((s) => (ALL_SKILLS as string[]).includes(s)).length;
  return n > 1 ? 1 / n : 1;
}

export function rowIsCorrect(r: ScoredAttemptRow): boolean {
  return isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
}

// Per-skill percent/level, plus the same percents shaped for buildRoadmap's "weakest first" ranking.
export function computeSkillBreakdown(graded: ScoredAttemptRow[], overallPercent: number, opts: ScoringOptions = {}) {
  const skillPercents = {} as Record<SkillTag, number | null>;
  const skillLevels = {} as Record<SkillTag, { level: ReportedLevel; cappedByGap: boolean } | null>;
  const roadmapSkillPercents = {} as Record<SkillTag, number>;
  for (const skill of ALL_SKILLS) {
    const relevant = graded.filter((r) => r.skills.includes(skill));
    if (relevant.length === 0) {
      skillPercents[skill] = null;
      skillLevels[skill] = null;
      roadmapSkillPercents[skill] = overallPercent;
      continue;
    }
    const totalWeight = relevant.reduce((sum, r) => sum + skillWeight(r, opts), 0);
    const rightWeight = relevant.filter(rowIsCorrect).reduce((sum, r) => sum + skillWeight(r, opts), 0);
    const percent = Math.round((rightWeight / totalWeight) * 100);
    // Highest CEFR level actually sustained, not just a flat percentage; falls back to percent only if no cefr_level tags exist yet.
    const assessed = assessSkillLevel(relevant.map((r) => ({ cefrLevel: r.cefr_level, correct: rowIsCorrect(r), weight: skillWeight(r, opts) })));
    skillPercents[skill] = percent;
    // No level passed: Below A1 (owner decision 19 Nov 2026; it used to fall
    // back to the percent table, so 0% right still showed A1 and the Below A1
    // band could never appear). Questions with no CEFR tag at all still use
    // the percent table.
    const tagged = relevant.some((r) => r.cefr_level && CEFR_LEVELS.includes(r.cefr_level));
    skillLevels[skill] = { level: assessed.level ?? (tagged ? BELOW_A1 : percentToCefr(percent)), cappedByGap: assessed.cappedByGap };
    roadmapSkillPercents[skill] = percent;
  }
  return { skillPercents, skillLevels, roadmapSkillPercents };
}

// The overall result from the skills (owner decision 19 Nov 2026: one rule
// everywhere): each skill's Spica score from its level and share right, the
// overall score their weighted mean, and the overall level that score's band.
// A strong skill can lift the overall above a weak one, as IELTS averages its
// bands; each skill's own level is always shown beside it.
export function overallFromSkills(
  skillLevels: Partial<Record<SkillTag, ReportedLevel | null>>,
  skillPercents: Partial<Record<SkillTag, number | null>>,
  fallbackPercent: number,
): { score: number | null; level: ReportedLevel } {
  const scores: Partial<Record<SkillTag, number>> = {};
  for (const skill of ALL_SKILLS) {
    const s = spicaScore(skillLevels[skill] ?? null, skillPercents[skill] ?? null);
    if (s !== null) scores[skill] = s;
  }
  const mean = weightedSkillMean(scores, null);
  if (mean === null) return { score: null, level: percentToCefr(fallbackPercent) };
  const score = Math.round(mean);
  return { score, level: levelOfScore(score) as ReportedLevel };
}

// One finished test's level, as the learner and the recruiter see it: a
// headline CEFR level and one per skill tested. null when nothing could be
// scored yet.
export function levelSummary(rows: ScoredAttemptRow[], opts: ScoringOptions = {}): {
  cefrLevel: ReportedLevel;
  skillLevels: Partial<Record<SkillTag, ReportedLevel>>;
  skillPercents: Partial<Record<SkillTag, number>>;
} | null {
  const graded = rows.filter((r) => r.status === "scored");
  if (graded.length === 0) return null;
  const correctCount = graded.filter(rowIsCorrect).length;
  const overallPercent = Math.round((correctCount / graded.length) * 100);
  const { skillPercents, skillLevels } = computeSkillBreakdown(graded, overallPercent, opts);
  const levels: Partial<Record<SkillTag, ReportedLevel>> = {};
  const percents: Partial<Record<SkillTag, number>> = {};
  for (const skill of ALL_SKILLS) {
    const l = skillLevels[skill];
    const p = skillPercents[skill];
    if (l) levels[skill] = l.level;
    if (p !== null && p !== undefined) percents[skill] = p;
  }
  const { level: cefrLevel } = overallFromSkills(levels, percents, overallPercent);
  return { cefrLevel, skillLevels: levels, skillPercents: percents };
}
