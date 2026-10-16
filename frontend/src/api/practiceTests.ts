import { api } from "@/lib/api";
import type { TestItem } from "@/api/testSession";
import type { DeliveryMode } from "@/api/proctoring";

// The exam catalogue: families (Versant, LanguageCert) and their test types.
export interface CatalogueTestType {
  id: string;
  familyId: string;
  name: string;
  skills: ("listening" | "speaking" | "reading" | "writing")[];
  cefrMin: string;
  cefrMax: string;
  durationMinutes: number;
  // Delivery formats and their times, e.g. paper 120 min, computer 60-90 min.
  formats: { kind: "paper" | "computer" | "online" | "face_to_face"; min: number; max: number }[];
  status: "live" | "coming_soon" | "retired";
  setCount: number;
  allowed: boolean;
}

export interface CatalogueFamily {
  id: string;
  name: string;
  publisher: string;
  testTypes: CatalogueTestType[];
}

export interface ExamSummary {
  id: string;
  code: string;
  // Fixed ID of this test set, e.g. "SL-001".
  testId: string;
  name: string;
  itemCount: number;
  completed: boolean;
}

export interface PartBoundary {
  partId: string;
  label: string;
  startIndex: number;
  count: number;
}

// An exam family's published score range for a level, e.g. LanguageCert B2 = 60-74.
export interface ScoreBand {
  level: string;
  from: number;
  to: number;
}

export interface ExamCompleteResult {
  // This attempt's Test ID, e.g. "FS-7K3M-9QX2".
  testCode?: string | null;
  deliveryMode?: DeliveryMode;
  // Mock exams: the estimated score range, where the exam family publishes one.
  scoreBand?: ScoreBand | null;
  skillScoreBands?: Partial<Record<"listening" | "speaking" | "reading" | "writing", ScoreBand | null>> | null;
  gradedCount: number;
  correctCount: number;
  pendingCount: number;
  skippedCount: number;
  failedCount: number;
  overallPercent: number;
  partResults: { label: string; gradedCount: number; correctCount: number }[];
  // CEFR level from the levels of the questions answered; null until something is scored.
  cefrLevel?: string | null;
  skillLevels?: Partial<Record<"listening" | "speaking" | "reading" | "writing", string>> | null;
  skillPercents?: Partial<Record<"listening" | "speaking" | "reading" | "writing", number>> | null;
}

// Every family and test type, for settings screens (no per-learner "allowed").
export function getCatalogue(): Promise<{ families: CatalogueFamily[] }> {
  return api("/catalogue");
}

// openMock: the learner's mock exam in progress (one at a time).
export function getProducts(): Promise<{ families: CatalogueFamily[]; openMock: { sessionId: string; testTypeId: string | null } | null }> {
  return api("/practice-tests/products");
}

export function getExamsForProduct(product: string): Promise<{ exams: ExamSummary[] }> {
  return api(`/practice-tests/${encodeURIComponent(product)}/exams`);
}

export interface ExamSessionData {
  sessionId: string;
  testCode: string | null;
  examId: string;
  testTypeId: string | null;
  deliveryMode: DeliveryMode;
  partBoundaries: PartBoundary[];
  items: TestItem[];
  // Mock exams: when the whole exam must be finished, and the server's time
  // (to correct for a wrong clock on the learner's computer).
  timing: { deadlineAt: string | null; serverNow: string } | null;
}

// Practice: one set. A candidate's assigned set always runs as a mock.
export function startExamSession(examId: string): Promise<ExamSessionData> {
  return api("/practice-tests/session", { method: "POST", body: JSON.stringify({ examId, mode: "practice" }) });
}

// A mock exam of a test type: exam conditions, questions the learner hasn't
// seen. Fails with 409 mock_in_progress while another mock is open.
export function startMockSession(testTypeId: string): Promise<ExamSessionData> {
  return api("/practice-tests/session", { method: "POST", body: JSON.stringify({ testTypeId, mode: "mock" }) });
}

export function getExamSession(sessionId: string): Promise<ExamSessionData & { completed: boolean }> {
  return api(`/practice-tests/session/${sessionId}`);
}

// Mock exams: starts a question's clock (the first time) and returns the seconds left.
export function markItemShown(sessionId: string, itemId: string): Promise<{ secondsLeft: number | null; deadlineAt?: string | null; serverNow?: string }> {
  return api(`/practice-tests/session/${sessionId}/view`, { method: "POST", body: JSON.stringify({ itemId }) });
}

// The answer key shown after a practice question: an option index, one per
// question of a group, a model text, or the points a good answer covers.
export interface AnswerKey {
  index?: number;
  indexes?: number[];
  text?: string;
  points?: string[];
}

export interface PracticeFeedback {
  status: "scored" | "pending" | "failed";
  correct: boolean | null;
  score: number | null;
  answer: AnswerKey | null;
  reason: string | null;
}

export interface ExamAttemptResult {
  attemptId: string;
  status: "scored" | "pending" | "failed";
  correct?: boolean | null;
  // Practice only; null for a skipped question.
  feedback?: PracticeFeedback | null;
  // Mock only: the answer came after the question's time and counts as unanswered.
  late?: boolean;
}

export function submitExamAttempt(
  sessionId: string,
  payload: { itemId: string; responseText?: string; audioBase64?: string; audioMimeType?: string; durationMs?: number; activeMs?: number },
): Promise<ExamAttemptResult> {
  return api(`/practice-tests/session/${sessionId}/attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Practice: feedback on a recorded answer that was still being scored.
export function getPracticeFeedback(sessionId: string, itemId: string): Promise<{ feedback: PracticeFeedback }> {
  return api(`/practice-tests/session/${sessionId}/feedback/${itemId}`);
}

export function completeExamSession(sessionId: string): Promise<ExamCompleteResult> {
  return api(`/practice-tests/session/${sessionId}/complete`, { method: "POST" });
}
