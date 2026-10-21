import { api } from "@/lib/api";

// My tests: the real assessment attempts the learner owns.
export type Unlock =
  | { state: "open" }
  | { state: "mock_needed"; opensOn: string }
  | { state: "sample_needed" }
  | { state: "retake_wait"; opensOn: string }
  | { state: "used" }
  | { state: "expired" };

export type AttemptStatus = "in_progress" | "scoring" | "under_review" | "certified" | "not_passed" | "void";

export interface OwnedTest {
  id: string;
  productId: string;
  kind: "prep" | "assessment" | "level" | "final";
  // A level test's level.
  level: string | null;
  name: string;
  // Empty for a final assessment whose test isn't chosen yet.
  testTypeId: string | null;
  testName: string | null;
  // The final assessment included with Full access: the learner chooses its test from these.
  chooseTest: boolean;
  choices: { id: string; name: string }[];
  attemptsLeft: number;
  endsAt: string;
  unlock: Unlock;
  mocksDone: number;
  samplesDone: number;
  attempts: {
    sessionId: string;
    startedAt: string;
    completedAt: string | null;
    status: AttemptStatus;
    certificateCode: string | null;
    spicaScore: number | null;
    level: string | null;
    validUntil: string | null;
    levelResult: { level: string; passed: boolean; overallPercent: number | null; skillPercents: Record<string, number | null> } | null;
    appeal: { status: "open" | "upheld" | "changed" | "new_attempt"; note: string | null } | null;
    canAppeal: boolean;
  }[];
}

export function getMyTests(): Promise<{ tests: OwnedTest[] }> {
  return api("/assessment/me");
}

export function chooseFinalTest(id: string, testTypeId: string): Promise<{ ok: true }> {
  return api(`/assessment/${id}/choose`, { method: "POST", body: JSON.stringify({ testTypeId }) });
}
