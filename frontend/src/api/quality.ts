import { api } from "@/lib/api";

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
  tests: { test: string; part: string; approved: number; forMocks: number; overCap: number; meanExposure: number; maxExposure: number }[];
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
  status: "open" | "upheld" | "changed" | "new_attempt";
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export const getAppeals = (status: "open" | "all") => api<{ appeals: Appeal[] }>(`/quality/appeals?status=${status}`);
export const decideAppeal = (id: string, outcome: "upheld" | "changed" | "new_attempt", note: string) =>
  api<{ ok: true }>(`/quality/appeals/${id}/decide`, { method: "POST", body: JSON.stringify({ outcome, note }) });

// A learner appeals a real test's result.
export const fileAppeal = (sessionId: string, reason: string) => api<{ id: string }>("/assessment/appeals", { method: "POST", body: JSON.stringify({ sessionId, reason }) });
