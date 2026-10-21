import { api } from "@/lib/api";

// Tests & credits: an organization gives learners a real test, a level test or preparation for one test.
export interface GivableProduct {
  id: string;
  kind: "prep" | "assessment" | "level" | "pack";
  name: string;
  testTypeId: string;
  testName: string | null;
  credits: number;
  durationDays: number;
  attempts: number;
}

export type GivenStatus = "waiting" | "in_progress" | "taken" | "certified" | "not_passed" | "expired" | "expired_refunded" | "withdrawn";

export interface GivenTest {
  id: string;
  productId: string;
  kind: string;
  name: string;
  // A level test's level; the program whose final assessment this is.
  testLevel: string | null;
  programId: string | null;
  programName: string | null;
  learnerId: string;
  learner: string;
  participantId: string | null;
  givenAt: string;
  endsAt: string;
  credits: number;
  status: GivenStatus;
  certificate: string | null;
  score: number | null;
  level: string | null;
}

export interface OrgTests {
  balance: number;
  products: GivableProduct[];
  given: GivenTest[];
  history: { delta: number; reason: string; note: string | null; at: string }[];
}

export function getOrgTests(): Promise<OrgTests> {
  return api("/org-tests");
}

export function giveTests(body: { productId: string; userIds?: string[]; batchId?: string; periods?: number; level?: string }): Promise<{ given: number; creditsUsed: number; balance: number }> {
  return api("/org-tests/give", { method: "POST", body: JSON.stringify(body) });
}

export function withdrawTest(id: string): Promise<{ ok: true }> {
  return api(`/org-tests/${id}/withdraw`, { method: "POST" });
}

export function requestCredits(quantity: number, note?: string): Promise<{ ok: true }> {
  return api("/org-tests/credits/request", { method: "POST", body: JSON.stringify({ quantity, note }) });
}
