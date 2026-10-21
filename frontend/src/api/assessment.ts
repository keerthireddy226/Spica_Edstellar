import { api } from "@/lib/api";

// My tests: the real assessment attempts the learner owns.
export type Unlock =
  | { state: "open" }
  | { state: "mock_needed"; opensOn: string }
  | { state: "sample_needed" }
  | { state: "used" }
  | { state: "expired" };

export type AttemptStatus = "in_progress" | "scoring" | "under_review" | "certified" | "void";

export interface OwnedTest {
  id: string;
  productId: string;
  kind: "prep" | "assessment";
  name: string;
  testTypeId: string;
  testName: string | null;
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
  }[];
}

export function getMyTests(): Promise<{ tests: OwnedTest[] }> {
  return api("/assessment/me");
}
