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
  done: number;
  started: number;
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
  completed: boolean;
  // Opened and at least one question answered or skipped.
  started: boolean;
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
): Promise<{ attemptId: string; status: string; correct: boolean | null; review: ReportQuestion | null }> {
  return api(`/practice/session/${sessionId}/attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function completePracticeSession(sessionId: string): Promise<PracticeSummary> {
  return api(`/practice/session/${sessionId}/complete`, { method: "POST" });
}
