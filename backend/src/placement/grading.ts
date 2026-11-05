import { gradeWithAI, scoreTypingAccuracy, AI_GRADED_TYPES } from "./aiGrading.js";
import { passThresholdForLevel } from "./cefr.js";
import { canonicalSpelling } from "./spelling.js";
import { diffSummary, wordDiff } from "../reports/wordDiff.js";

// Exact-text grading for items with a definite answer, AI rubric grading otherwise. `correct` = score >= pass bar.
export type GradeResult = {
  status: "scored" | "pending" | "failed";
  correct: boolean | null;
  score: number | null;
  method: "exact-match" | "text-diff" | "ai-text" | null;
  // The AI grader's one-sentence reason (AI-graded answers only).
  reason?: string;
};

// British, Indian and American spellings of a word count as the same answer.
function normalize(s: string): string {
  return canonicalSpelling(
    s
      .trim()
      .toLowerCase()
      .replace(/[.,!?;:]+$/g, "")
      .replace(/\s+/g, " "),
  );
}

// Typed text compared word by word: punctuation and spacing don't count, and
// a hyphen is a space ("follow-up" = "follow up").
function plainWords(s: string): string {
  return normalize(s.replace(/[‘’]/g, "'").replace(/[^A-Za-z0-9'\s]+/g, " "));
}

// A dictation answer's score: each word missed, wrong or added costs 1.5
// words' worth, so one slip still meets the item level's pass bar (for
// sentences of the usual length) and two slips don't. All-or-nothing marking
// counted "follow up" for "follow-up", or one extra "the", as a wrong answer.
export function dictationScore(exact: string, typed: string): number {
  const d = diffSummary(wordDiff(plainWords(exact), plainWords(typed)));
  const words = Math.max(1, plainWords(exact).split(" ").filter(Boolean).length);
  return Math.max(0, Math.round((1 - (1.5 * (d.substituted + d.missing + d.extra)) / words) * 100) / 100);
}

const PENDING: GradeResult = { status: "pending", correct: null, score: null, method: null };

function exactResult(correct: boolean): GradeResult {
  return { status: "scored", correct, score: correct ? 1 : 0, method: "exact-match" };
}

async function aiResult(
  itemTypeId: string,
  content: unknown,
  answerSet: unknown,
  cefrLevel: string | null,
  minWords: number | null,
  responseText: string,
  timeoutMs?: number,
): Promise<GradeResult> {
  const ai = await gradeWithAI(itemTypeId, content, answerSet, cefrLevel, minWords, responseText, timeoutMs);
  // A null result here means the AI call broke, not that nothing was graded — recorded as "failed", not "pending".
  if (!ai) return { status: "failed", correct: null, score: null, method: "ai-text" };
  return {
    status: "scored",
    correct: ai.score >= passThresholdForLevel(cefrLevel),
    score: ai.score,
    method: "ai-text",
    reason: ai.reason || undefined,
  };
}

export async function gradeAttempt(
  itemTypeId: string,
  answerSet: unknown,
  content: unknown,
  cefrLevel: string | null,
  minWords: number | null,
  responseText: string | undefined,
  // Limit for an AI-graded answer; background grading can wait longer.
  timeoutMs?: number,
): Promise<GradeResult> {
  if (!responseText) return PENDING;

  if (AI_GRADED_TYPES.has(itemTypeId)) {
    return aiResult(itemTypeId, content, answerSet, cefrLevel, minWords, responseText, timeoutMs);
  }

  const set = (answerSet ?? {}) as Record<string, unknown>;
  const given = normalize(responseText);

  switch (itemTypeId) {
    // A typed-transcription task (hear it, type it).
    case "dictation": {
      const exact = set.exact;
      if (typeof exact !== "string") return PENDING;
      const score = dictationScore(exact, responseText);
      return { status: "scored", correct: score >= passThresholdForLevel(cefrLevel), score, method: "text-diff" };
    }
    case "sentence_completion": {
      const accepted = set.acceptable_answers;
      if (!Array.isArray(accepted) || accepted.length === 0) return PENDING;
      const typed = plainWords(responseText);
      return exactResult(accepted.some((a) => typeof a === "string" && (normalize(a) === given || plainWords(a) === typed)));
    }
    // Multiple-choice: client submits the option's index as a string (e.g. "1") — exact to grade.
    case "response_selection":
    case "reading_comprehension":
    case "lc_listen_mcq":
    case "lc_listen_reply":
    case "lc_listen_dialogue":
    case "lc_read_short":
    case "lc_read_gap": {
      const correctIndex = set.correctIndex;
      if (typeof correctIndex !== "number") return PENDING;
      const givenIndex = Number(responseText);
      if (!Number.isInteger(givenIndex)) return PENDING;
      return exactResult(givenIndex === correctIndex);
    }
    // One recording or text with several questions: the client submits the
    // chosen option per question as a JSON array ("[0,2,1]"); the score is the
    // share answered correctly, one mark per question.
    case "lc_listen_conversation":
    case "lc_listen_long":
    case "lc_read_cloze":
    case "lc_read_long": {
      const correct = set.correct;
      if (!Array.isArray(correct) || correct.length === 0) return PENDING;
      let given: unknown;
      try {
        given = JSON.parse(responseText);
      } catch {
        return PENDING;
      }
      if (!Array.isArray(given)) return PENDING;
      const right = correct.filter((c, i) => Number.isInteger(given[i]) && given[i] === c).length;
      const score = right / correct.length;
      return { status: "scored", correct: score >= passThresholdForLevel(cefrLevel), score, method: "exact-match" };
    }
    // A copy-the-passage-exactly typing drill — there's a definite target
    // text, so a word-level diff (not an AI judgment call) is the right tool.
    case "typing": {
      const contentObj = (content ?? {}) as Record<string, unknown>;
      const target = typeof contentObj.text === "string" ? contentObj.text : null;
      if (!target) return PENDING;
      const score = scoreTypingAccuracy(target, responseText);
      return { status: "scored", correct: score >= passThresholdForLevel(cefrLevel), score, method: "text-diff" };
    }
    default:
      return PENDING;
  }
}
