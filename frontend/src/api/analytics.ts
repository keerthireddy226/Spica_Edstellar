import { api } from "@/lib/api";
import type { LearnerEngagement } from "@/api/notifications";

export interface Bucket {
  key: string;
  count: number | null; // null = hidden (group smaller than minGroupSize)
}

export interface AnalyticsOverview {
  scope: string;
  minGroupSize: number;
  totals: {
    learners: number;
    activeLast7Days: number;
    activeLast28Days: number;
    sessionsLast30Days: number;
    newLast30Days: number;
    placementTaken: number;
    avgMinutesPerActiveLearnerPerWeek: number;
    dailyReminderAdoption: number;
  };
  breakdowns: {
    country: Bucket[];
    jobRole: Bucket[];
    ageBand: Bucket[];
    gender: Bucket[];
    language: Bucket[];
    cefr: Bucket[];
    orgType: Bucket[];
    companies: Bucket[];
  };
  trend: { week: string; activeLearners: number; signups: number; sessions: number }[];
  reminders: { sentLast30Days: number; returnedWithin7Days: number; returnRate: number | null };
  licenses: { currency: string; purchased: number; paid: number; assigned: number; revenueMinor: number; revenue30Minor: number }[] | null;
}

export interface BatchAnalytics {
  batch: {
    id: string;
    name: string;
    batchCode: string;
    startCefr: string | null;
    targetCefr: string | null;
    beginsOn: string;
    endsOn: string | null;
    daysLeft: number | null;
    managers: string[];
  };
  summary: {
    learners: number;
    statusCounts: Record<"not_started" | "inactive" | "slow" | "on_track" | "achieved", number>;
    onTrackPercent: number;
    orgOnTrackPercent: number;
    avgMinutesPerLearnerPerWeek: number;
    orgAvgMinutesPerLearnerPerWeek: number;
    licensedLearners: number;
    endingWithin7Days: number;
    fixedLicenses: number | null;
    fixedLicensesUsed: number;
    remindedLearners: number;
    needsAttention: number;
  };
  cefr: { start: string | null; target: string | null; current: Record<string, number> };
  weeklyActive: { week: string; activeLearners: number }[];
  skills: { skill: string; accuracy: number | null; avgMinutes: number }[];
  learners: (LearnerEngagement & { riskScore: number })[];
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return api("/analytics/overview");
}

export function getAnalyticsBatches(): Promise<{ batches: { id: string; name: string; batchCode: string; learners: number }[] }> {
  return api("/analytics/batches");
}

export function getBatchAnalytics(id: string): Promise<BatchAnalytics> {
  return api(`/analytics/batches/${id}`);
}

// Downloads a server-generated CSV with the session cookie.
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error("export_failed");
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
