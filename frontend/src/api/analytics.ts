import { api } from "@/lib/api";
import type { LearnerEngagement } from "@/api/notifications";
import type { ReportAbout, ScoreReport as ScoreReportData } from "@/api/practiceTests";

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
    department?: Bucket[];
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

// ---- Batch report ----

export type ReportSkill = "speaking" | "listening" | "reading" | "writing";
export type BatchReportPeriod = "since_start" | "last_30" | "quarter" | "custom";
export type GoalStatus = "reached" | "on_track" | "at_risk" | "too_early";

export interface LevelSnapshot {
  level: string | null;
  score: number | null;
  skills: Partial<Record<ReportSkill, { level: string; score: number }>>;
}

export interface BatchReportLearner {
  id: string;
  name: string;
  participantId: string | null;
  start: LevelSnapshot | null;
  current: LevelSnapshot | null;
  levelSource: "mock" | "level_test" | null;
  practiceTests: number;
  mockTests: number;
  minutes: number;
  goal: GoalStatus | null;
  projected: string | null;
  lastActivity: string | null;
  inactiveDays: number | null;
  accessEndsAt: string | null;
  missedMocks: number;
  lastMissedMock: string | null;
  reportSessionId: string | null;
  // Each mock test's Spica score, oldest first.
  mocks: { date: string; score: number | null; level: string | null }[];
  // With detail: each skill against the goal, strengths and areas to improve.
  insights: LearnerInsights | null;
}

export interface LearnerInsights {
  skills: { skill: ReportSkill; level: string; score: number; startLevel: string | null; startScore: number | null; change: number | null; vsGoal: "above" | "meets" | "below" | null }[];
  strongSkills: ReportSkill[];
  weakSkills: { skill: ReportSkill; gap: number | null; target: string | null }[];
  strongTypes: { skill: ReportSkill; type: string; right: number; total: number }[];
  focusTypes: { skill: ReportSkill; type: string; right: number; total: number }[];
}

export interface BatchLearnerData {
  batch: BatchReport["batch"];
  goal: BatchReport["goal"];
  generatedAt: string;
  canOpenReports: boolean;
  learner: BatchReportLearner;
}

export function getBatchLearner(batchId: string, userId: string): Promise<BatchLearnerData> {
  return api(`/analytics/batches/${batchId}/learners/${userId}`);
}

export interface BatchReport {
  batch: { id: string; name: string; batchCode: string | null; organization: string; testName: string | null; managers: string[]; beginsOn: string };
  goal: { level: string; date: string | null; daysLeft: number | null; minScore: number | null; fromProgram: boolean } | null;
  period: { key: BatchReportPeriod; from: string; to: string };
  generatedAt: string;
  summary: {
    learners: number;
    active: number;
    activeDays: number;
    practiceMinutes: number;
    practiceTests: number;
    mockTests: number;
    certificates: number;
    scoreNow: number | null;
    scoreStart: number | null;
  };
  goalCounts: { reached: number; onTrack: number; atRisk: number; tooEarly: number } | null;
  levels: { start: Record<ReportSkill, Record<string, number>>; now: Record<ReportSkill, Record<string, number>> };
  scores: number[];
  profile: Record<ReportSkill, { now: number | null; start: number | null }>;
  learners: BatchReportLearner[];
  attention: {
    inactive: { id: string; name: string; days: number | null }[];
    offPace: { id: string; name: string; score: number | null; needs: number | null; projected: string | null }[];
    accessEnding: { id: string; name: string; endsAt: string }[];
    missedMock: { id: string; name: string; count: number; last: string | null }[];
    accessEndingDays: number;
  };
  canOpenReports: boolean;
}

export function getBatchReport(id: string, q: { period: BatchReportPeriod; from?: string; to?: string; detail?: boolean }): Promise<BatchReport> {
  const p = new URLSearchParams({ period: q.period });
  if (q.detail) p.set("detail", "1");
  if (q.period === "custom" && q.from && q.to) {
    p.set("from", q.from);
    p.set("to", q.to);
  }
  return api(`/analytics/batches/${id}/report?${p}`);
}

export function getBatchLearnerReport(batchId: string, sessionId: string): Promise<{ score: ScoreReportData; about: ReportAbout | null; analysis: string }> {
  return api(`/analytics/batches/${batchId}/reports/${sessionId}`);
}
