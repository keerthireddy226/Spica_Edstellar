import { api } from "@/lib/api";

type InputMethod = "mic" | "text" | "textarea" | "radio" | "two-phase" | "mcq_group";

export interface TestItem {
  id: string;
  itemTypeId: string;
  content: Record<string, unknown>;
  skills: SkillTag[];
  inputMethod: InputMethod;
  instructionText: string;
  questionInstruction: string;
  timerSeconds: number | null;
  // Practice Modules: the whole time for the question (listening, reading, answering).
  questionSeconds?: number | null;
  twoPhaseReadSeconds?: number | null;
  twoPhaseWriteSeconds?: number | null;
  // Preparation time before a spoken answer can start (LanguageCert-style speaking).
  prepSeconds?: number | null;
  // Word range for writing tasks, shown as a counter.
  minWords?: number | null;
  maxWords?: number | null;
  attempted?: boolean;
  responseText?: string | null;
  // Mock exams: this question's time limit, and the seconds left once it has
  // been shown (the server's clock).
  limitSeconds?: number | null;
  secondsLeft?: number | null;
  // Pre-generated AI voice audio for this item in the learner's preferred
  // voice, or null if it hasn't been batch-generated yet (see backend/
  // scripts/generateItemAudio.ts) — playSpokenAudio() falls back to browser
  // TTS whenever this is null.
  audioUrl?: string | null;
}

interface AttemptResult {
  attemptId: string;
  status: "scored" | "pending" | "failed";
  correct: boolean | null;
  // The placement test is adaptive now — this is the next question to show,
  // chosen based on whether this answer was right. null means there's
  // nothing left to ask; the caller should call completeSession instead of
  // waiting for a fixed question count.
  nextItem: TestItem | null;
}

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type SkillTag = "listening" | "speaking" | "reading" | "writing";

export interface SessionSummary {
  // This attempt's Test ID, e.g. "AP-7K3M-9QX2".
  testCode?: string | null;
  gradedCount: number;
  correctCount: number;
  // Genuinely unanswered, or awaiting a grading path with nothing to check
  // yet — not the learner's fault, but not a service problem either.
  pendingCount: number;
  // An answer WAS given and grading was attempted, but the AI call itself
  // failed (rate limit, network error) — a temporary service issue, shown
  // separately so it isn't confused with "you didn't answer enough."
  failedCount: number;
  // Only present once at least one item could be scored — see the
  // graded.length === 0 guard on the backend.
  overallPercent?: number;
  cefrLevel?: CefrLevel;
  // Same meaning as skillLevels' cappedByGap below, but for the headline
  // level itself, which is now assessed from every graded answer combined
  // rather than the worst single per-skill level.
  cefrCappedByGap?: boolean;
  // null per skill means that skill had zero graded questions this run
  // (skipped, or still pending) — not a real score.
  skillPercents?: Record<SkillTag, number | null>;
  // cappedByGap: the percent above can look deceptively high next to this
  // level — it's correct, but there's an untested gap between what was
  // proven and a higher level that was also (partly) answered. Worth
  // explaining in the UI rather than just showing the two side by side.
  skillLevels?: Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null>;
  goalLevel?: CefrLevel;
}

export function startSession(): Promise<{ sessionId: string; testCode?: string | null; items: TestItem[] }> {
  return api("/placement/session", { method: "POST", body: JSON.stringify({}) });
}

// Side-effect-free — decides whether Placement's intro shows "Continue" vs. "Begin the test".
export function getCurrentSession(): Promise<{ inProgress: boolean; questionsShown?: number }> {
  return api("/placement/session/current");
}

export function submitAttempt(
  sessionId: string,
  payload: { itemId: string; responseText?: string; audioBase64?: string; audioMimeType?: string; durationMs?: number; activeMs?: number },
): Promise<AttemptResult> {
  return api(`/placement/session/${sessionId}/attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function completeSession(sessionId: string): Promise<SessionSummary> {
  return api(`/placement/session/${sessionId}/complete`, { method: "POST" });
}
