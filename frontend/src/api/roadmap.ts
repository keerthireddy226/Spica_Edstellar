import { api } from "@/lib/api";
import type { CefrLevel, SkillTag } from "@/api/testSession";
import type { NextStep, PaceStatus } from "@/api/dashboard";

export interface RoadmapMilestone {
  level: CefrLevel;
  labelType: "reach" | "maintain";
  targetDayOffset: number;
  focusSkill: SkillTag;
}

export interface RoadmapData {
  firstName: string | null;
  placement: {
    overallPercent: number;
    cefrLevel: CefrLevel;
    // null per skill means that skill had zero graded questions in the
    // placement test — not a real score, so it shouldn't be displayed as one.
    skillPercents: Record<SkillTag, number | null>;
    skillLevels: Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null> | null;
    takenAt: string;
    // Non-blocking — the result and roadmap below are shown either way.
    reviewStatus: "certified" | "pending_review" | "fraud_confirmed";
  };
  goalLevel: CefrLevel;
  accessWindow: { startDate: string; durationDays: number } | null;
  examDate?: string | null;
  // Each skill's level now (Practice Modules path) and the overall from them.
  pathLevels?: Record<SkillTag, string>;
  currentLevel?: string | null;
  roadmap: {
    pace: "maintenance" | "light" | "steady" | "intensive";
    minutesPerDay: number;
    totalHoursEstimate: number;
    milestones: RoadmapMilestone[];
  };
  recommendedPractice: {
    focusSkill: SkillTag;
    items: { itemTypeId: string; name: string; questionInstruction: string; estimatedSeconds: number; completed: boolean }[];
  };
}

export function getRoadmap(): Promise<RoadmapData> {
  return api("/roadmap");
}

// "My journey": progress to the goal, the levels still to reach, this week's
// tasks and the checkpoints up to the exam.
export interface JourneyTask {
  id: string;
  kind: "sets" | "practice_test" | "retry" | "level_check" | "mock" | "final" | "final_choose";
  done: boolean;
  count?: number;
  target?: number;
  skill?: SkillTag;
  date?: string;
  href: string;
}

export interface Journey {
  current: string | null;
  goal: string | null;
  startLevel: string | null;
  goalReached: boolean;
  examDate: string | null;
  daysLeft: number | null;
  pace: PaceStatus;
  minutesPerDay: number | null;
  progressPercent: number;
  skills: { skill: SkillTag; level: string; startLevel: string | null; progressPercent: number; partWay: number }[];
  steps: { level: string; skills: { skill: SkillTag; state: "done" | "now" | "later"; partWay: number }[] }[];
  week: JourneyTask[];
  checkpoints: {
    date: string;
    kind: "practice_test" | "level_check" | "mock" | "exam" | "today" | "final" | "certificate";
    done: boolean;
    skill?: SkillTag;
    level?: string;
    onReset?: boolean;
    attempts?: number;
    // The final assessment: open now, or not in the learner's plan yet.
    open?: boolean;
    toGet?: boolean;
    // A certificate's code.
    code?: string;
  }[];
  nextStep: NextStep | null;
  planSource?: { kind: "program"; name: string } | { kind: "allowance"; practicePerMonth: number | null; mocksPerMonth: number | null };
}

export function getJourney(): Promise<Journey> {
  return api("/roadmap/journey");
}
