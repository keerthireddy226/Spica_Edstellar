import { api } from "@/lib/api";
import type { SkillTag, TestItem } from "@/api/testSession";
import type { ReportQuestion } from "@/api/practiceTests";

// Where a set sits: its skill, sub-module (question type), level and name.
export interface PracticeContext {
  skill: SkillTag | null;
  itemTypeId: string | null;
  typeName: string | null;
  unitName: string | null;
  setName: string | null;
  // The Versant tests this sub-module's questions are part of.
  tests?: { id: string; name: string }[];
}

export interface PracticeSummary {
  gradedCount: number;
  correctCount: number;
  // Genuinely unanswered, or nothing to grade yet.
  pendingCount: number;
  // An answer was given and grading was attempted, but the AI call itself
  // failed (rate limit, network error) — a temporary service issue, not the
  // learner's fault, shown separately from pendingCount.
  failedCount: number;
  // Every question: right, wrong or skipped, the learner's answer and the right one.
  questions: ReportQuestion[];
  context: PracticeContext;
  // The set to take next in this sub-module, if any.
  next: { setId: string; setName: string; unitId: string; unitName: string } | null;
}

// A sub-module's sets: how many, finished and started.
export interface TypeProgress {
  itemTypeId: string;
  setCount: number;
  // Sets finished at least once, and sets opened but not finished.
  done: number;
  started: number;
  tests: { id: string; name: string }[];
}

export interface SkillAvailability {
  skill: SkillTag;
  total: number;
  remaining: number;
}

export interface PracticeUnit {
  id: string;
  name: string;
  setCount: number;
  completedCount: number;
}

export interface PracticeSet {
  id: string;
  name: string;
  // Finished at least once (reached the end; skipped questions included).
  completed: boolean;
  // Opened and not finished yet.
  started: boolean;
  // The latest finished run: right answers, questions, skipped.
  lastResult: { right: number; total: number; skipped: number } | null;
}

export function getAvailability(): Promise<{ availability: SkillAvailability[] }> {
  return api("/practice/availability");
}

export function getTypeProgress(skill: string): Promise<{ types: TypeProgress[] }> {
  return api(`/practice/types?skill=${encodeURIComponent(skill)}`);
}

export function getUnits(itemTypeId: string, skill: string): Promise<{ units: PracticeUnit[] }> {
  return api(`/practice/units?itemTypeId=${encodeURIComponent(itemTypeId)}&skill=${encodeURIComponent(skill)}`);
}

export function getSets(unitId: string, skill: string): Promise<{ sets: PracticeSet[] }> {
  return api(`/practice/units/${unitId}/sets?skill=${encodeURIComponent(skill)}`);
}

// Finds whatever practice session was already running, if any — used after
// a page refresh wipes the frontend's own state (skill/unit/set, sessionId, etc).
export function getCurrentPracticeSession(): Promise<
  { inProgress: false } | { inProgress: true; sessionId: string; skill: SkillTag; items: TestItem[]; context?: PracticeContext }
> {
  return api("/practice/session/current");
}

// Loads one specific session by id — used to resume the exact session the
// learner was in (tracked via a `session=` URL param) rather than guessing
// from skill/type, which can't tell two in-progress sessions of the same
// skill apart.
export function getPracticeSession(
  sessionId: string,
): Promise<{ sessionId: string; skill: SkillTag; completed: boolean; items: TestItem[]; context?: PracticeContext }> {
  return api(`/practice/session/${sessionId}`);
}

export function startPracticeSession(
  skill: SkillTag,
  count?: number,
  itemTypeId?: string,
  setId?: string,
): Promise<{ sessionId: string; skill: SkillTag; items: TestItem[]; context?: PracticeContext }> {
  return api("/practice/session", { method: "POST", body: JSON.stringify({ skill, count, itemTypeId, setId }) });
}

export function submitPracticeAttempt(
  sessionId: string,
  payload: { itemId: string; responseText?: string; audioBase64?: string; audioMimeType?: string; durationMs?: number; activeMs?: number },
): Promise<{ attemptId: string; status: string; correct: boolean | null }> {
  return api(`/practice/session/${sessionId}/attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function completePracticeSession(sessionId: string): Promise<PracticeSummary> {
  return api(`/practice/session/${sessionId}/complete`, { method: "POST" });
}

// Short names of the Versant tests, for "Prepares you for" lines.
const SHORT_TEST_NAME: Record<string, string> = {
  fourSkills: "4 Skills Essentials",
  speakingListening: "Speaking & Listening",
  writing: "Writing",
  professional: "Professional English",
  placement: "Placement",
};

export function testsLine(tests: { id: string; name: string }[] | undefined): string {
  if (!tests?.length) return "";
  return tests.map((t) => SHORT_TEST_NAME[t.id] ?? t.name).join(" · ");
}
