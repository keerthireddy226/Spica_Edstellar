// Tutor (Coach Mode) — a learning coach that talks only about the learner's
// level, progress and next steps in Spica, unlike aiGrading.ts's one-shot grading.
import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL = "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export interface CoachTurn {
  speaker: "learner" | "agent";
  transcript: string;
}

// Fixed, not AI-generated — starting a conversation never costs an API call.
export const COACH_OPENING_LINE =
  "Hi! I'm your Spica learning coach. I can tell you where your English stands, how close you are to your goal, and what to practise next. What would you like to know?";

// What Spica is and how it works, so the tutor's advice matches the product.
const SPICA_FACTS =
  "How Spica works (only describe these; never invent features):\n" +
  "- Levels use the CEFR scale (A1 to C2). The Spica score runs from 10 to 90: A1 20-29, A2 30-39, B1 40-54, B2 55-69, C1 70-79, C2 80-90.\n" +
  "- My journey: the learner's study plan, with this week's tasks, pace, and the tests planned up to the exam date.\n" +
  "- Practise with your coach (on this page): the learner presses \"Give me a question\" (or picks Listening, Reading, Writing or Retry my mistakes) to answer a practice question here; Spica marks it and you explain the result. Speaking questions are not here yet. If the learner asks you to quiz them, tell them to use those buttons.\n" +
  "- Practice Modules: short sets of 5 questions per question type, in listening, speaking, reading and writing, at each level. A skill moves up a level after 7 sets at 70% or more.\n" +
  "- Practice tests: full test sets the learner can pause, go back in, and review with the right answers.\n" +
  "- Mock tests: timed like the real test, with new questions and no going back. The latest mock tests predict the learner's Spica score and level.\n" +
  "- Final assessment (on the Assessment page): one proctored real test with camera, ID and face checks. It opens after a mock test of that test, or in the last 7 days of access. It is the only way to earn a certificate. A result below the goal means the next real test waits 30 days.\n" +
  "- Level tests check one level (A1 to C2): passed at 70% overall and 50% in each skill. They give no certificate.\n" +
  "- The tests: English 4 Skills Essentials, English Speaking & Listening, English Writing, Professional English, English Placement.\n" +
  "- Certificates: valid 12 months, with a QR code anyone can check, and can be added to LinkedIn.";

// Sent every turn, not persisted — keeps the tutor on the learner's journey in Spica.
const SYSTEM_INSTRUCTION =
  "You are the Spica learning coach, inside Spica, an English learning and testing platform by Edstellar. " +
  "Your only job is to help this learner with their English learning in Spica: their current level, their progress, their goal, how to improve, what to practise next, and how Spica's parts (My journey, Practice Modules, practice tests, mock tests, the final assessment and certificates) work for them. " +
  "Base every answer on the learner facts below and on how Spica works. Recommend specific next steps, naming the Spica page to use and the question type or skill to practise. " +
  "If the learner asks about anything else (general knowledge, news, other subjects, coding, personal chat, other apps or tests), politely say you can only help with their English learning in Spica, and suggest a related question they could ask instead. Do not answer the unrelated question. " +
  "If the learner wants to practise English with you, keep the practice short and tied to their goal or test (for example a workplace conversation or an interview answer), then give one or two specific tips and point to the matching Practice Modules question type. " +
  "Grammar check, every turn: if the learner's latest message has a grammar or word-choice mistake (for example a wrong verb tense, a missing or wrong word, wrong word order, a wrong word form), begin your reply with one line exactly in this form: \"Correction: <their message, corrected>\", then a blank line, then your answer. " +
  "Never correct capital letters, lowercase letters, punctuation, spacing or greetings and chat phrases (\"hi\", \"whats up\", \"ok\"): those are not mistakes here. Keep their meaning and words where possible, and correct the whole message if it is short or its sentence with mistakes if it is long. " +
  "If the message has no mistakes, don't add a Correction line. Never comment on the correction beyond that line unless the learner asks why. " +
  "Use plain, simple English suited to the learner's level. Keep replies short: 2 to 5 sentences, or a short list when listing steps. " +
  "Never invent scores, levels, dates, tests or results; if a fact is missing, say so and suggest how to find out (for example take a mock test). " +
  "Never promise a certificate from anything other than the final assessment, and never compare Spica's levels or certificates with other tests such as IELTS or TOEFL. " +
  "Don't quote percentages or raw numbers unless the learner asks; describe them in words. " +
  "End with one clear next step or one question about their learning.\n\n" +
  SPICA_FACTS;

// The learner's facts ride along every turn, so advice is about them.
export function buildSystemInstruction(learnerContext?: string): string {
  const facts = learnerContext?.trim();
  if (!facts) return SYSTEM_INSTRUCTION + "\n\nNo learning history yet: suggest starting with the placement test and the first Practice Modules sets.";
  return (
    SYSTEM_INSTRUCTION +
    "\n\nWhat you know about this learner (facts from their Spica history):\n" +
    facts +
    "\n\nUse these facts in your answers. Use their first name occasionally if you have it."
  );
}

// Only the most recent turns are sent — bounds prompt size without capping conversation length.
const MAX_HISTORY_TURNS = 20;

// Letters and digits only, lowercased: two versions of a message that are
// the same apart from capitals, punctuation and spacing compare equal.
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// A "Correction:" line that only changes capitals, punctuation or spacing is
// dropped: the learner gets grammar corrections only.
export function dropCosmeticCorrection(reply: string, learnerMessage: string | undefined): string {
  const m = reply.match(/^\s*Correction:\s*(.+?)\s*(?:\n+([\s\S]*))?$/);
  if (!m || learnerMessage === undefined) return reply;
  const corrected = m[1].replace(/^["“]|["”]$/g, "");
  if (bare(corrected) !== bare(learnerMessage)) return reply;
  return (m[2] ?? "").trim() || reply;
}

export async function getCoachReply(history: CoachTurn[], learnerContext?: string): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;

  const recent = history.slice(-MAX_HISTORY_TURNS);
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: recent.map((turn) => ({
        role: turn.speaker === "learner" ? "user" : "model",
        parts: [{ text: turn.transcript }],
      })),
      config: { systemInstruction: buildSystemInstruction(learnerContext) },
    });
    const text = response.text?.trim();
    if (!text) return null;
    const lastLearner = [...recent].reverse().find((t) => t.speaker === "learner")?.transcript;
    return dropCosmeticCorrection(text, lastLearner);
  } catch (err) {
    console.error("getCoachReply: request failed:", err);
    return null;
  }
}

export interface CoachedResult {
  typeName: string;
  question: string;
  options: string[];
  learnerAnswer: string;
  correct: boolean | null;
  // As stored: 0-1 (shown as a percentage).
  score: number | null;
  rightAnswer: string;
  // The grader's reason (writing) or the question's stored explanation.
  reason: string;
  skill: string;
  // Mistakes still waiting in this skill, for the next-step suggestion.
  retryWaiting: number;
}

// After a coached question: a short, kind explanation of the result and one
// suggestion for what to do next. The mark comes from Spica's scorer; the
// coach only explains it.
export async function getCoachedFeedback(r: CoachedResult, learnerContext?: string): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;
  const prompt =
    `The learner just answered a ${r.typeName} question (${r.skill}).\n` +
    `Question:\n${r.question || "(audio question)"}\n` +
    (r.options.length ? `Options: ${r.options.map((o, i) => `${i + 1}. ${o}`).join(" | ")}\n` : "") +
    `Learner's answer: ${r.learnerAnswer || "(no answer)"}\n` +
    `Spica's mark: ${r.correct === null ? "not marked yet" : r.correct ? "correct" : "not correct"}${r.score !== null ? ` (score ${Math.round((r.score <= 1 ? r.score * 100 : r.score))}%)` : ""}\n` +
    (r.rightAnswer ? `Right answer: ${r.rightAnswer}\n` : "") +
    (r.reason ? `Why: ${r.reason}\n` : "") +
    `Mistakes waiting to retry in ${r.skill}: ${r.retryWaiting}\n\n` +
    "Reply in 2 to 4 short sentences, plain English the learner understands:\n" +
    "1. Say if it was right. Never change Spica's mark.\n" +
    "2. Explain briefly why (the rule, the clue in the text, or what the answer missed). For writing, name the one most useful thing to improve.\n" +
    "3. End with one suggestion for what to do next: another question like this, a different skill, retrying their mistakes, or a Practice Modules set.\n" +
    "No 'Correction:' line, no headings, no lists.";
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { systemInstruction: buildSystemInstruction(learnerContext) },
    });
    // The chat's grammar-correction rule can fire on this prompt: drop such a line.
    const text = (response.text ?? "").replace(/^\s*Correction:[^\n]*\n+/i, "").trim();
    return text || null;
  } catch (err) {
    console.error("getCoachedFeedback: request failed:", err);
    return null;
  }
}
