import { api } from "@/lib/api";
import type { ExamBank } from "@/lib/questionBank";

// Assessment quality (Spica staff).
export interface QualitySettings {
  levelPassOverall: number;
  levelSkillMin: number;
  levelRetakeDays: number;
  exposureCap: number;
  appealDays: number;
}

export const getQualitySettings = () => api<QualitySettings>("/quality/settings");
export const saveQualitySettings = (s: Partial<QualitySettings>) => api<QualitySettings>("/quality/settings", { method: "PUT", body: JSON.stringify(s) });

export interface PoolReport {
  exposureCap: number;
  tests: { test: string; bank: ExamBank; part: string; approved: number; forMocks: number; overCap: number; meanExposure: number; maxExposure: number }[];
  levelTests: { type: string; level: string; approved: number; overCap: number; maxExposure: number; perTest: number; testsLeft: number | null }[];
}
export const getPoolReport = () => api<PoolReport>("/quality/pool");

export interface FairnessStudy {
  days: number;
  minLearners: number;
  gap: number;
  answers: number;
  overall: number | null;
  groups: { group: string; learners: number; answers: number; mean: number | null; clarity: number | null; fluency: number | null; diff: number | null; flagged: boolean; tooFew: boolean }[];
}
export const getFairness = (days: number) => api<FairnessStudy>(`/quality/fairness?days=${days}`);

export interface TechnicalReport {
  testTypeId: string;
  generatedAt: string;
  sessions: { mock: number; certified: number };
  skills: Record<string, { n: number; mean: number | null; sd: number | null }>;
  alpha: number | null;
  alphaSessions: number;
  levels: Record<string, number>;
  integrity: Record<string, number>;
  appeals: Record<string, number>;
  items: { itemId: string; type: string; level: string | null; answers: number; difficulty: number | null; discrimination: number | null; flag: string | null }[];
  itemsAnalysed: number;
  flaggedItems: number;
  minAnswers: number;
}
export const getTechnical = (testType: string) => api<TechnicalReport>(`/quality/technical?testType=${encodeURIComponent(testType)}`);

export interface Appeal {
  id: string;
  sessionId: string;
  learner: string;
  email: string;
  org: string | null;
  testName: string | null;
  testCode: string | null;
  completedAt: string;
  level: string | null;
  spicaScore: number | null;
  integrity: string | null;
  certificate: string | null;
  reason: string;
  // review: placement or real test (the score can change); concern: practice or mock (noted).
  kind: "review" | "concern";
  testKind: string;
  assignedTo: string | null;
  reviewer: string | null;
  escalated: boolean;
  status: "open" | "upheld" | "changed" | "new_attempt" | "noted";
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export const getAppeals = (status: "open" | "all") => api<{ appeals: Appeal[] }>(`/quality/appeals?status=${status}`);
export type AppealOutcome = "upheld" | "changed" | "new_attempt" | "noted";
export const decideAppeal = (id: string, outcome: AppealOutcome, note: string) =>
  api<{ ok: true }>(`/quality/appeals/${id}/decide`, { method: "POST", body: JSON.stringify({ outcome, note }) });
export const claimAppeal = (id: string, force = false) => api<{ ok: true }>(`/quality/appeals/${id}/claim`, { method: "POST", body: JSON.stringify({ force }) });

// A learner's own score-review requests (status on their reports).
export interface MyAppeal {
  sessionId: string;
  kind: "review" | "concern";
  status: "pending" | "in_review" | "upheld" | "changed" | "new_attempt" | "noted";
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export const getMyAppeals = () => api<{ appeals: MyAppeal[] }>("/assessment/appeals/mine");

// An organization's people's requests (read-only).
export interface OrgAppeal {
  id: string;
  sessionId: string;
  learner: string;
  testCode: string | null;
  kind: "review" | "concern";
  status: MyAppeal["status"];
  reason: string;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export const getOrgAppeals = () => api<{ appeals: OrgAppeal[] }>("/quality/org-appeals");

// The short form after a test.
export interface TestFeedback {
  skipped?: boolean;
  rating?: number | null;
  smooth?: boolean | null;
  issues?: string[];
  recommend?: number | null;
  suggestion?: string | null;
}
export const getFeedbackDue = (sessionId: string) => api<{ due: boolean }>(`/feedback/sessions/${sessionId}`);
export const sendFeedback = (sessionId: string, f: TestFeedback) => api<{ ok: boolean }>(`/feedback/sessions/${sessionId}`, { method: "POST", body: JSON.stringify(f) });
export interface FeedbackSummary {
  answered: number;
  skipped: number;
  rating: number | null;
  notSmoothPercent: number | null;
  nps: number | null;
  issues: { issue: string; n: number }[];
  byTest: { test: string; answered: number; rating: number | null }[];
  comments: { created_at: string; rating: number | null; recommend: number | null; smooth: boolean | null; issues: string[]; suggestion: string | null; org: string | null; learner: string; test_code: string | null; test: string }[];
}
export const getFeedbackSummary = (days: number) => api<FeedbackSummary>(`/feedback/summary?days=${days}`);

// A learner asks for a review of a test's score.
export const fileAppeal = (sessionId: string, reason: string) => api<{ id: string }>("/assessment/appeals", { method: "POST", body: JSON.stringify({ sessionId, reason }) });
