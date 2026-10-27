import { api } from "@/lib/api";
import type { TestItem } from "@/api/testSession";
import type { PracticeFeedback } from "@/api/practiceTests";

export type CoachSkill = "listening" | "speaking" | "reading" | "writing";

// A coached question, the learner's answer to it, or its result (marked by
// Spica's scorer, explained by the coach in the turn's text).
export type CoachPayload =
  | { kind: "question"; skill: CoachSkill; retry: boolean; typeName: string; level: string; item: TestItem }
  | { kind: "answer"; itemId: string; responseText: string; spoken?: boolean }
  | { kind: "result"; itemId: string; skill: CoachSkill; feedback: PracticeFeedback | null };

export interface CoachTurn {
  speaker: "learner" | "agent";
  text: string;
  payload?: CoachPayload | null;
}

// Resumes the learner's one in-progress conversation, or starts a fresh one
// (seeded with a fixed opening line server-side) if there isn't one yet.
export function startCoachSession(): Promise<{ sessionId: string; turns: CoachTurn[] }> {
  return api("/coach/session", { method: "POST" });
}

export function sendCoachMessage(sessionId: string, text: string): Promise<{ reply: string }> {
  return api(`/coach/session/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ text }) });
}

export function endCoachSession(sessionId: string): Promise<void> {
  return api(`/coach/session/${sessionId}/end`, { method: "POST" });
}

// A question from the practice bank: the weakest skill, a chosen one, or a mistake to retry.
export function askCoachQuestion(sessionId: string, opts: { skill?: CoachSkill; retry?: boolean }): Promise<{ turn: CoachTurn }> {
  return api(`/coach/session/${sessionId}/practice`, { method: "POST", body: JSON.stringify(opts) });
}

export interface CoachAnswer {
  responseText?: string;
  // A spoken answer.
  audioBase64?: string;
  audioMimeType?: string;
  durationMs?: number;
  activeMs: number;
}

// The answer turn, and the result turn, or pending (a spoken answer is marked
// in the background: ask getCoachResult until it's ready).
export function answerCoachQuestion(sessionId: string, itemId: string, answer: CoachAnswer): Promise<{ answerTurn: CoachTurn; resultTurn?: CoachTurn; pending?: boolean }> {
  return api(`/coach/session/${sessionId}/answer`, { method: "POST", body: JSON.stringify({ itemId, ...answer }) });
}

export function getCoachResult(sessionId: string, itemId: string): Promise<{ resultTurn?: CoachTurn; pending?: boolean; done?: boolean }> {
  return api(`/coach/session/${sessionId}/result/${itemId}`);
}
