import { gradeWithAI, scoreTypingAccuracy, AI_GRADED_TYPES } from "./aiGrading.js";
import { passThresholdForLevel } from "./cefr.js";
import { canonicalSpelling } from "./spelling.js";

// Exact-text grading for items with a definite answer, AI rubric grading otherwise. `correct` = score >= pass bar.
export type GradeResult = {
  status: "scored" | "pending" | "failed";
  correct: boolean | null;
  score: number | null;
  method: "exact-match" | "text-diff" | "ai-text" | null;
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
      return exactResult(given === normalize(exact));
    }
    case "sentence_completion": {
      const accepted = set.acceptable_answers;
      if (!Array.isArray(accepted) || accepted.length === 0) return PENDING;
      return exactResult(accepted.some((a) => typeof a === "string" && normalize(a) === given));
    }
    // Multiple-choice: client submits the option's index as a string (e.g. "1") — exact to grade.
    case "response_selection":
    case "reading_comprehension": {
      const correctIndex = set.correctIndex;
      if (typeof correctIndex !== "number") return PENDING;
      const givenIndex = Number(responseText);
      if (!Number.isInteger(givenIndex)) return PENDING;
      return exactResult(givenIndex === correctIndex);
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
