import { CEFR_LEVELS, cefrRank, type CefrLevel } from "./cefr.js";

export type SkillTag = "listening" | "speaking" | "reading" | "writing";
export type AccessDuration = "1month" | "3months" | "6months" | "untilexam";

export function accessDurationToDays(duration: AccessDuration, examDate: string | null): number {
  switch (duration) {
    case "1month":
      return 30;
    case "3months":
      return 90;
    case "6months":
      return 180;
    case "untilexam":
      return examDate ? Math.max(daysUntil(examDate), 30) : 90;
  }
}

export function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const HOURS_PER_LEVEL_GAP = 20;

export type RoadmapPace = "maintenance" | "light" | "steady" | "intensive";

export interface RoadmapMilestone {
  level: CefrLevel;
  // "maintain" when the learner already met their goal (nothing left to
  // reach); the frontend templates the display label from this + level,
  // rather than storing an English sentence that would need its own i18n.
  labelType: "reach" | "maintain";
  targetDayOffset: number;
  focusSkill: SkillTag;
}

export interface RoadmapPlan {
  pace: RoadmapPace;
  minutesPerDay: number;
  totalHoursEstimate: number;
  milestones: RoadmapMilestone[];
}

function paceFor(minutesPerDay: number, levelGap: number): RoadmapPace {
  if (levelGap === 0) return "maintenance";
  if (minutesPerDay <= 20) return "light";
  if (minutesPerDay <= 45) return "steady";
  return "intensive";
}

interface BuildRoadmapInput {
  assessedLevel: CefrLevel;
  goalLevel: CefrLevel;
  examDate: string | null;
  accessDuration: AccessDuration;
  dailyMinutesPreference: number;
  skillPercents: Record<SkillTag, number>;
}

export function buildRoadmap(input: BuildRoadmapInput): RoadmapPlan {
  const levelGap = Math.max(0, cefrRank(input.goalLevel) - cefrRank(input.assessedLevel));
  const totalHoursEstimate = Math.max(levelGap * HOURS_PER_LEVEL_GAP, 5);

  const daysAvailable = input.examDate
    ? Math.max(daysUntil(input.examDate), 7)
    : accessDurationToDays(input.accessDuration, input.examDate);

  const neededMinutesPerDay = Math.ceil((totalHoursEstimate * 60) / Math.max(daysAvailable, 7));
  // The learner's own daily time counts when it's more than the plan needs.
  const minutesPerDay = Math.min(90, Math.max(15, neededMinutesPerDay, input.dailyMinutesPreference || 0));

  const weakestFirst = (Object.entries(input.skillPercents) as [SkillTag, number][])
    .sort((a, b) => a[1] - b[1])
    .map(([skill]) => skill);

  const stepLevels = CEFR_LEVELS.slice(cefrRank(input.assessedLevel) + 1, cefrRank(input.goalLevel) + 1);
  const milestoneLevels = stepLevels.length > 0 ? stepLevels : [input.assessedLevel];

  const milestones: RoadmapMilestone[] = milestoneLevels.map((level, i) => ({
    level,
    labelType: stepLevels.length > 0 ? "reach" : "maintain",
    targetDayOffset: Math.round(((i + 1) / milestoneLevels.length) * daysAvailable),
    focusSkill: weakestFirst[i % weakestFirst.length],
  }));

  return {
    pace: paceFor(minutesPerDay, levelGap),
    minutesPerDay,
    totalHoursEstimate,
    milestones,
  };
}
