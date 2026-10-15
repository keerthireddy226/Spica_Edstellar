// Rubric-based grading (Gemini), always from text — its own audio-quality judgment was tested and found to hallucinate. Fails closed: returns null, treated as "no verdict yet."
import { GoogleGenAI } from "@google/genai";
import { canonicalSpelling } from "./spelling.js";

export const GEMINI_GRADING_MODEL = "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export type AiGradeResult = { score: number; reason: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function acceptableAnswers(answerSet: Record<string, unknown>): string[] {
  const accepted = [
    answerSet.exact,
    answerSet.correct,
    ...((Array.isArray(answerSet.alternates) ? answerSet.alternates : []) as unknown[]),
    ...((Array.isArray(answerSet.acceptable_answers) ? answerSet.acceptable_answers : []) as unknown[]),
  ];
  return accepted.filter((a): a is string => typeof a === "string");
}

function levelStandard(cefrLevel: string | null): string {
  const level = cefrLevel ?? "B1";
  if (level === "C2" || level === "C1") {
    return `This item is tagged ${level} — hold it to that standard: content must be precise and complete, with natural, well-chosen wording and no grammar slips. Don't give a high score for merely adequate work at this level.`;
  }
  if (level === "B1" || level === "B2") {
    return `This item is tagged ${level} — clear, correct content is expected, but occasional minor errors are fine and not disqualifying.`;
  }
  return `This item is tagged ${level} — basic clarity is enough; simple errors are expected and should not be penalized heavily.`;
}

// Learners write British, Indian or American English; none of them is wrong.
const SPELLING_RULE =
  "Spelling: British, American, Indian and other standard English spellings are all correct (organisation/organization, colour/color, travelled/traveled, learnt/learned). Never count a standard spelling variant as a mistake, and don't require one variety to be used consistently.";

// Spoken answers reach the grader as an automatic transcript.
const SPOKEN_TYPES = new Set([
  "repeats",
  "short_answer",
  "sentence_builds",
  "conversations",
  "passage_comprehension",
  "reading",
  "story_retelling",
  "speaking_situations",
  "open_questions",
]);
const SPOKEN_RULE =
  "This is an automatic transcript of speech. Ignore spelling, punctuation and capital letters, and don't penalize the speaker's accent or a word the transcript obviously misheard. Judge the content, the grammar and the vocabulary.";

// One task description per AI-graded type — "answered well" means something different per type.
function buildTask(
  itemTypeId: string,
  content: Record<string, unknown>,
  answerSet: Record<string, unknown>,
  minWords: number | null,
): string | null {
  const wordNote = minWords ? ` The task requires at least ${minWords} words.` : "";
  const accepted = acceptableAnswers(answerSet);

  switch (itemTypeId) {
    case "email_writing":
      return `Task: write an email. Situation the email must address: "${str(content.prompt)}".${wordNote} Does it address the situation, is the grammar right for the standard below, does it meet the length requirement?`;
    case "summary_and_opinion":
      return `Passage: "${str(content.passage)}". Task: summarize the author's opinion in 25-50 words, then give their own opinion.${wordNote} Is the summary accurate, is there a clear own opinion, does it meet the length?`;
    case "passage_reconstruction":
      return `The learner read this passage for 30 seconds, then had to reconstruct it from memory in their own words: "${str(content.passage)}".${wordNote} Does the reconstruction capture the key facts/meaning of the original (paraphrasing is expected, not penalized)?`;
    case "repeats":
      return `The learner was asked to repeat this sentence exactly, word for word: "${str(answerSet.exact)}". This is a transcript of what they said.`;
    case "short_answer":
      return `The learner heard this question: "${str(content.question)}". Acceptable answers: ${JSON.stringify(accepted)}. This is a transcript of their spoken answer.`;
    case "sentence_builds":
      return `The learner heard these word groups in random order and had to say them back as one correct sentence: ${JSON.stringify(content.groups)}. A correct sentence: "${str(answerSet.correct)}". This is a transcript of what they said.`;
    case "conversations":
      return `The learner heard this exchange: "${str(content.dialogue)}", then this question: "${str(content.question)}". Acceptable answers: ${JSON.stringify(accepted)}. This is a transcript of their spoken answer.`;
    case "reading_selective":
      return `The learner read this text: "${str(content.text)}", then had to answer: "${str(content.question)}". Acceptable answers: ${JSON.stringify(accepted)}. This is a transcript of their spoken answer.`;
    case "passage_comprehension":
      return `The learner heard this story: "${str(content.story)}", then this question: "${str(content.question)}". Acceptable answers: ${JSON.stringify(accepted)}. This is a transcript of their spoken answer.`;
    case "reading":
      return `The learner was asked to read this passage aloud, as written: "${str(content.text)}". This is a transcript of what they actually said — judge how accurately it matches the target passage (allowing for reasonable speech-recognition noise).`;
    case "story_retelling":
      return `The learner heard this story and had to retell it in their own words (paraphrasing is expected and good): "${str(content.story)}". This is a transcript of their retelling.`;
    case "speaking_situations":
      return `The learner was given this situation and had to respond to it appropriately: "${str(content.situation)}". This is a transcript of their spoken response.`;
    case "open_questions":
      return `The learner was asked this open-ended question, and should give their own genuine answer: "${str(content.prompt)}". This is a transcript of their spoken answer.`;
    default:
      return null;
  }
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", description: "0 to 1, how well the answer meets the task." },
    reason: { type: "string", description: "One short sentence explaining the score." },
  },
  required: ["score", "reason"],
};

export async function gradeWithAI(
  itemTypeId: string,
  content: unknown,
  answerSet: unknown,
  cefrLevel: string | null,
  minWords: number | null,
  responseText: string,
): Promise<AiGradeResult | null> {
  const task = buildTask(itemTypeId, (content ?? {}) as Record<string, unknown>, (answerSet ?? {}) as Record<string, unknown>, minWords);
  if (!task) return null;

  const ai = getClient();
  if (!ai) return null;

  const spoken = SPOKEN_TYPES.has(itemTypeId) ? `\n\n${SPOKEN_RULE}` : "";
  const prompt = `${task}\n\n${levelStandard(cefrLevel)}\n\n${SPELLING_RULE}${spoken}\n\nLearner's response: "${responseText}"\n\nGive a score from 0 (fails the task) to 1 (fully meets it) and a one-sentence reason.`;

  let parsed: { score?: unknown; reason?: unknown };
  try {
    // No built-in timeout on this call — an occasional slow Gemini response
    // used to stall the whole attempt-submission request indefinitely, long
    // enough for the browser to give up and show a generic submit error
    // while the server kept working and wrote the attempt successfully a
    // few seconds later (confirmed: DB always showed success right after).
    // Capped here so a slow call fails closed (same as any other grading
    // failure) within a predictable bound instead of hanging the request.
    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_GRADING_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // The same answer should get the same score.
        config: { responseMimeType: "application/json", responseJsonSchema: GRADE_SCHEMA, temperature: 0 },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("gradeWithAI: timed out")), 10_000)),
    ]);
    parsed = JSON.parse(response.text ?? "");
  } catch (err) {
    console.error("gradeWithAI: request failed:", err);
    return null;
  }

  const score = Number(parsed.score);
  if (Number.isNaN(score)) return null;
  return { score: Math.max(0, Math.min(1, score)), reason: String(parsed.reason ?? "") };
}

// "Typing" has a definite target text — word-level diff is cheaper/more reliable than AI judging it.
export function scoreTypingAccuracy(target: string, response: string): number {
  // A habitual British or American spelling isn't a typing mistake.
  const norm = (s: string) => canonicalSpelling(s.trim().toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, " "));
  const a = norm(target).split(" ").filter(Boolean);
  const b = norm(response).split(" ").filter(Boolean);
  if (a.length === 0) return 0;

  // Word-level Levenshtein distance.
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const distance = dp[a.length][b.length];
  return Math.max(0, 1 - distance / a.length);
}

// Types that go through gradeWithAI above — text only, since audio judgment tested unreliable.
export const AI_GRADED_TYPES = new Set([
  "email_writing",
  "summary_and_opinion",
  "passage_reconstruction",
  "repeats",
  "short_answer",
  "sentence_builds",
  "conversations",
  "reading_selective",
  "passage_comprehension",
  "reading",
  "story_retelling",
  "speaking_situations",
  "open_questions",
]);
