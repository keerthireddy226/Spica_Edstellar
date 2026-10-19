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
  // An unfinished practice session of this set to resume.
  inProgress: boolean;
  // Taken to the end at least once (skips included).
  finished?: boolean;
  // Sets open in order: locked until the set before (lockedBy) is finished.
  locked?: boolean;
  lockedBy?: string | null;
  // The open session's progress: answered, passed (answered or skipped), of all.
  progress?: { answered: number; seen: number; total: number } | null;
  // "form": a test built by Edstellar staff from the question bank.
  source?: "set" | "form";
  durationMinutes?: number;
  // Not the exam's published length.
  shortForm?: boolean;
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
  // Each skill's level here against the learner's Practice Modules path.
  pathCompare?: PathCompare | null;
}

export type PathCompare = Partial<Record<"listening" | "speaking" | "reading" | "writing", { test: string; path: string; action: "raised" | "below" | "same" }>>;

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
  // A built test (assessment builder), instead of a set.
  formId?: string | null;
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

// A practice test built in the assessment builder.
export function startFormSession(formId: string): Promise<ExamSessionData> {
  return api("/practice-tests/session", { method: "POST", body: JSON.stringify({ formId, mode: "practice" }) });
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

// ---- Monthly limits and programs ----

export interface QuotaUsage {
  segment: "individual" | "company" | "university";
  tier: string;
  // null = unlimited.
  practicePerMonth: number | null;
  mocksPerMonth: number | null;
  reportLevel: "summary" | "full";
  practiceUsed: number;
  mocksUsed: number;
  // When the counts start again (YYYY-MM-DD).
  resetsOn: string;
}

export interface QuotaTier {
  segment: string;
  tier: string;
  practicePerMonth: number | null;
  mocksPerMonth: number | null;
  reportLevel: "summary" | "full";
}

// quota is null for people without limits (staff, candidates).
export function getQuota(): Promise<{ quota: QuotaUsage | null; tiers: QuotaTier[] | null }> {
  return api("/practice-tests/quota");
}

export interface Program {
  id: string;
  name: string;
  domain: string;
  testTypeId: string;
  targetLevel: string;
  targetSkills: Partial<Record<"listening" | "speaking" | "reading" | "writing", string>>;
  batchId: string;
  startsOn: string;
  targetDate: string;
  status: "active" | "completed" | "archived";
}

export interface ScheduleItem {
  id: string;
  dueOn: string;
  kind: DeliveryMode;
  status: "due" | "done" | "missed";
}

export interface MyProgram {
  program: Program;
  latestLevel: string | null;
  done: number;
  missed: number;
  upcoming: ScheduleItem[];
}

export function getMyProgram(): Promise<{ program: MyProgram | null }> {
  return api("/practice-tests/program");
}

// ---- Feedback report (ASSESSMENT_ENGINE.md section 7) ----

export interface WordOp {
  op: "same" | "sub" | "missing" | "extra";
  word?: string;
  said?: string;
}

export interface ReportExplanation {
  why?: string;
  evidence?: string;
  distractors?: string[];
}

export interface ReportQuestion {
  itemId: string;
  itemTypeId: string;
  typeName: string;
  part: string | null;
  skills: string[];
  level: string | null;
  prompt: string;
  answered: boolean;
  status: string;
  score: number | null;
  choices?: { stem: string | null; options: string[]; chosen: number | null; correct: number | null; explanation?: ReportExplanation }[];
  words?: { target: string; ops: WordOp[]; accuracy: number };
  writing?: {
    answer: string;
    errors: { text: string; correction: string; type: "spelling" | "grammar" | "vocabulary" | "punctuation" | "task"; reason: string }[];
    modelAnswer: string;
    comment: string;
  };
  speech?: { transcript: string | null; wordsPerMinute: number | null; fillers: number | null; clarity: number | null; comment: string | null; noisy: boolean };
  comment: string | null;
  outcome?: "right" | "wrong" | "skipped" | "pending";
  // The expected answer of a question that isn't multiple choice.
  expected?: { text?: string; points?: string[] };
  // What the learner typed or said, and their recording.
  given?: { text: string | null; audioUri: string | null; noSpeech: boolean };
}

export interface FeedbackReport {
  version: 1 | 2 | 3;
  level: "summary" | "full";
  counts?: { total: number; right: number; wrong: number; skipped: number; pending: number };
  explanationsMissing?: boolean;
  deliveryMode: DeliveryMode;
  testTypeId: string | null;
  overall: { cefrLevel: string | null; percent: number | null; skillLevels: Record<string, string> | null; scoreBand: ScoreBand | null; pathCompare?: PathCompare | null };
  target: { level: string; date: string; programName: string } | null;
  analysis: string;
  nextSteps: { title: string; why: string; skill: string; link: { testTypeId: string } | null }[];
  questions?: ReportQuestion[];
}

// What a report is about: practice test or mock exam, the test, set and date.
export interface ReportAbout {
  deliveryMode: "practice" | "mock";
  testTypeName: string | null;
  familyName: string | null;
  setName: string | null;
  testCode: string | null;
  completedAt: string | null;
}

export interface ReportResponse {
  status: "pending" | "ready" | "failed";
  report: FeedbackReport | null;
  about?: ReportAbout | null;
}

export function getReport(sessionId: string): Promise<ReportResponse> {
  return api(`/practice-tests/session/${sessionId}/report`);
}

export interface HistoryEntry {
  sessionId: string;
  testCode: string | null;
  deliveryMode: DeliveryMode;
  completedAt: string;
  testTypeId: string | null;
  examName: string | null;
  cefrLevel: string | null;
  percent: number | null;
  reportStatus: "pending" | "ready" | "failed" | null;
}

export function getHistory(): Promise<{ sessions: HistoryEntry[] }> {
  return api("/practice-tests/history");
}
