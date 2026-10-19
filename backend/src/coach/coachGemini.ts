// Tutor (Coach Mode) — open-ended conversation, unlike aiGrading.ts's one-shot rubric grading.
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
  "Hi! I'm your practice conversation partner. Tell me a little about your day so far.";

// Sent every turn, not persisted — keeps the model in a consistent persona.
const SYSTEM_INSTRUCTION =
  "You are a friendly, encouraging English conversation partner helping a language learner practice everyday spoken English. " +
  "Keep every reply short — 1 to 3 sentences, natural and conversational, like a real chat message, not an essay. " +
  "If the learner makes a clear grammar or word-choice mistake, you may gently model the correct form in passing (e.g. \"Ah, you went to the market — nice!\"), but never lecture about grammar or call out the mistake directly. " +
  "Always end your reply with a simple follow-up question that keeps the conversation going. " +
  "Stay in character as a conversation partner at all times — never mention that you are an AI, a model, or a program.";

// Appended only when there is something to say — tells the model how to use
// the learner facts without turning the chat into a progress report.
export function buildSystemInstruction(learnerContext?: string): string {
  const facts = learnerContext?.trim();
  if (!facts) return SYSTEM_INSTRUCTION;
  return (
    SYSTEM_INSTRUCTION +
    "\n\nWhat you know about this learner (facts from their practice history):\n" +
    facts +
    "\n\nHow to use this: pitch your vocabulary and sentence length at their current level, stretching a little toward their goal. " +
    "When it fits naturally, steer the conversation toward their weak areas, their reason for learning and their exam date, " +
    "and when they ask what to practise, suggest specific Practice Modules question types by name (for example the weakest types above). " +
    "Use their first name occasionally if you have it. " +
    "Only refer to results that appear above — never invent scores, levels, tests or dates. " +
    "Don't quote percentages or other raw numbers unless the learner asks for them; describe them in words instead."
  );
}

// Only the most recent turns are sent — bounds prompt size without capping conversation length.
const MAX_HISTORY_TURNS = 20;

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
    return text || null;
  } catch (err) {
    console.error("getCoachReply: request failed:", err);
    return null;
  }
}
