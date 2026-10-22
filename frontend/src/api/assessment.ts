import { api } from "@/lib/api";

// Assessment (once "My tests"): the real assessment attempts the learner owns.
export type Unlock =
  | { state: "open" }
  | { state: "mock_needed"; opensOn: string }
  | { state: "sample_needed" }
  | { state: "retake_wait"; opensOn: string }
  | { state: "used" }
  | { state: "expired" };

export type AttemptStatus = "in_progress" | "scoring" | "under_review" | "certified" | "passed" | "not_passed" | "void";

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
    certificateId: string | null;
    lifetime: boolean;
    issuedAt: string | null;
    spicaScore: number | null;
    level: string | null;
    validUntil: string | null;
    // passed null: an answer is still being scored, so it isn't decided yet.
    levelResult: { level: string; passed: boolean | null; overallPercent: number | null; skillPercents: Record<string, number | null> } | null;
    appeal: { status: "open" | "upheld" | "changed" | "new_attempt"; note: string | null } | null;
    canAppeal: boolean;
  }[];
}

export function getMyTests(): Promise<{ tests: OwnedTest[] }> {
  return api("/assessment/me");
}

// My journey's last step: predicted level from mock tests, the goal and the final assessment.
export interface Readiness {
  goal: string | null;
  goalScore: number | null;
  mocks: number;
  predicted: { score: number; level: string } | null;
  ready: boolean;
  final: { id: string; kind: OwnedTest["kind"]; testName: string | null; unlock: Unlock; chooseTest: boolean; endsAt: string } | null;
  certificate: { code: string; level: string; score: number | null; validUntil: string | null } | null;
}

export function getReadiness(): Promise<Readiness> {
  return api("/assessment/readiness");
}

// What switching preparation to that test costs: free for the same price or
// less, else the difference (with GST in India). The server answers
// "switch_needs_org" when an organization gave it and the test is dearer.
export type SwitchQuote = { free: true } | { free: false; amount: number; currency: string; taxLabel: string | null; taxAmount: number; total: number };

export function getSwitchQuote(id: string, testTypeId: string): Promise<SwitchQuote> {
  return api(`/assessment/${id}/switch-quote?testTypeId=${encodeURIComponent(testTypeId)}`);
}

// Preparation moves to another test (once, in its first 7 days) when it's free.
export function switchPrepTest(id: string, testTypeId: string): Promise<{ ok: true }> {
  return api(`/assessment/${id}/switch`, { method: "POST", body: JSON.stringify({ testTypeId }) });
}

export function chooseFinalTest(id: string, testTypeId: string): Promise<{ ok: true }> {
  return api(`/assessment/${id}/choose`, { method: "POST", body: JSON.stringify({ testTypeId }) });
}
