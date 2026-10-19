import { api } from "@/lib/api";
import type { CefrLevel, SkillTag } from "@/api/testSession";

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
