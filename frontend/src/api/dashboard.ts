import { api } from "@/lib/api";
import type { SkillTag } from "@/api/testSession";

export type ModuleStatus = "not_started" | "in_progress" | "completed";

export interface DashboardModule {
  skill: SkillTag;
  status: ModuleStatus;
  progressPercent: number;
}

export interface TodaysTask {
  skill: SkillTag;
  itemTarget: number;
  itemsCompletedToday: number;
  done: boolean;
}

export interface DashboardStats {
  sessions: number;
  questionsCompleted: number;
  practiceMinutes: number;
  // Already forgives up to 2 missed days before resetting — see
  // gamification/stats.ts computeStreakDays.
  streakDays: number;
  // null until at least one practice answer has been graded — see
  // dashboard/routes.ts for why 0% isn't used as the "no data yet" value.
  accuracyPercent: number | null;
  // 1 is the baseline — climbs only when a skill is genuinely mastered
  // (never from time spent or session count).
  level: number;
  // A fun running counter, not a gate on anything.
  totalXp: number;
}

export interface Badge {
  id: string;
  title: string;
  description: string;
  icon: "flag" | "target" | "flame" | "layers" | "award" | "list-checks" | "trophy" | "star";
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface InProgressPractice {
  skill: SkillTag;
  answered: number;
  total: number;
}

export interface DashboardData {
  firstName: string | null;
  startSkill: SkillTag;
  modules: DashboardModule[];
  todaysTasks: TodaysTask[];
  stats: DashboardStats;
  // English level from the level test (CEFR), when it was taken, and the goal.
  englishLevel?: { cefr: string | null; testedAt: string | null; goal: string | null };
  badges: Badge[];
  inProgressPractice: InProgressPractice | null;
  goal?: GoalStatus;
  // Each skill's level now (Practice Modules path) and the overall from them.
  pathLevels?: Record<SkillTag, string>;
  currentLevel?: string | null;
}

export type PaceStatus = "new" | "on_track" | "slightly_behind" | "behind";

// Days to the exam and whether the last 7 days of practice keep pace with the plan.
export interface GoalStatus {
  goalLevel: string | null;
  examDate: string | null;
  daysLeft: number | null;
  minutesPerDay: number | null;
  minutesLast7Days: number;
  pace: PaceStatus;
}

export type NextStep =
  | { kind: "mock"; daysLeft: number }
  | { kind: "practice_test"; daysSince: number | null }
  | { kind: "retry"; skill: SkillTag; count: number }
  | {
      kind: "set";
      skill: SkillTag;
      itemTypeId: string;
      typeName: string;
      unitId: string;
      unitName: string;
      setId: string;
      setName: string;
      level: string;
      retake: boolean;
    };

export function getNextStep(): Promise<{ nextStep: NextStep | null; retry: Record<SkillTag, number> }> {
  return api("/dashboard/next-step");
}

export function getDashboard(): Promise<DashboardData> {
  return api("/dashboard");
}

export interface DailyStat {
  date: string;
  questionsCompleted: number;
  // null on a day with no graded answers yet — same "no evidence yet"
  // convention as DashboardStats.accuracyPercent.
  accuracyPercent: number | null;
  practiceMinutes: number;
}

export interface DailyProgress {
  days: DailyStat[];
  totalQuestions: number;
  // Weighted across the whole week, not an average of each day's percent —
  // see dashboard/routes.ts.
  weekAccuracyPercent: number | null;
  bestDay: DailyStat;
  streakDays: number;
}

export function getDailyProgress(): Promise<DailyProgress> {
  return api("/dashboard/daily");
}
