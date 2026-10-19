import { api } from "@/lib/api";
import type { LearnerAccess } from "@/api/licenses";

// The signed-in person's own profile extras.

export interface WorkDetails {
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  region: string | null;
  city: string | null;
  country: string | null;
}

export const getMyWork = () => api<WorkDetails>("/me/work");
export const saveMyWork = (w: Partial<Record<keyof WorkDetails, string>>) => api<{ ok: true }>("/me/work", { method: "PATCH", body: JSON.stringify(w) });
export const getMyActivity = () => api<{ entries: { action: string; targetLabel: string | null; orgName: string | null; createdAt: string }[] }>("/me/activity");
export const getMySummary = () => api<{ heading?: string; items: [string, number | string][] }>("/me/summary");

export interface MyLearning {
  participantId: string | null;
  memberSince: string;
  organization: { name: string; category: string | null; orgAdmin: { name: string; email: string } | null } | null;
  batch: {
    name: string;
    description: string | null;
    startDate: string | null;
    durationMonths: number | null;
    startCefr: string | null;
    targetCefr: string | null;
    targetCutScore: string | null;
    weeklyMinutesGoal: number | null;
    examFocus: string | null;
    managers: { name: string; email: string }[];
  } | null;
  goals: {
    examPreference: string | null;
    goalLevel: string | null;
    scoreTarget: string | null;
    examDate: string | null;
    dailyMinutes: number | null;
    examReason: string | null;
  };
  progress: {
    level: string | null;
    placementPercent: number | null;
    placedAt: string | null;
    sessions: number;
    questions: number;
    minutes: number;
    streak: number;
    xp: number;
    accuracy: number | null;
    lastPractice: string | null;
  };
  certificates: { code: string; cefrLevel: string | null; batchName: string | null; issuedAt: string }[];
  access: LearnerAccess;
}

export const getMyLearning = () => api<MyLearning>("/me/learning");
export const saveMyGoals = (g: {
  examPreference?: string;
  goalLevel?: string;
  scoreTarget?: string;
  examDate?: string | null;
  dailyMinutes?: number;
  examReason?: string;
}) => api<{ ok: true }>("/me/goals", { method: "PATCH", body: JSON.stringify(g) });

// The learner's group this week (when their organization turned it on).
export interface GroupBoard {
  enabled: boolean;
  group?: string;
  size?: number;
  active?: number;
  points?: { points: number; sets: number; correct: number; tests: number; activeDays: number };
  weekStart?: string;
  // Fewer than `needed` practised this week: no ranking shown yet.
  quiet?: boolean;
  needed?: number;
  rank?: number;
  // The learner's own level (peers' levels are never shown).
  myLevel?: string | null;
  topPercent?: number;
  topHalf?: boolean;
  climbed?: number | null;
  pointsToTopHalf?: number;
  // Peers by Learner ID (Spica's ID); the learner's own row is "me".
  top?: { learnerId: string | null; points: number; rank: number; me: boolean }[];
}

export function getGroupBoard(): Promise<GroupBoard> {
  return api("/me/leaderboard");
}

// A batch's board for its admin or managers.
export interface BatchBoard {
  enabled: boolean;
  group: string | null;
  weekStart: string;
  rows: { id: string; name: string; learnerId: string | null; rank: number; points: number; sets: number; correct: number; tests: number; activeDays: number; level: string | null; lastActive: string | null }[];
}

export function getBatchBoard(scope: "org-admin" | "manager", batchId: string): Promise<BatchBoard> {
  return api(`/${scope}/batches/${batchId}/leaderboard`);
}

export function setBatchBoardEnabled(batchId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  return api(`/org-admin/batches/${batchId}/leaderboard`, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
