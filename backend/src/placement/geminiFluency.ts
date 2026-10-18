// Real audio-based pronunciation/fluency scoring via Gemini — supplementary signal, fails closed.
import { GoogleGenAI } from "@google/genai";

// "gemini-2.5-flash-lite" (still in Google's published price sheet) 404s for
// new callers — this is the model Google's own error pointed to instead.
const GEMINI_MODEL = "gemini-3.5-flash-lite";

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// Bump when the rubric below changes, so scores made under different rubrics
// can be told apart later.
export const SPEAKING_RUBRIC_VERSION = "intelligibility-v1";

export interface GeminiFluencyResult {
  // How easy the speech is to understand (stored under its old name); an
  // accent on its own never lowers it.
  pronunciation: number;
  fluency: number;
  comment: string;
  // Server-side transcript fallback — lets content grading run even when
  // the browser's own speech-to-text (used first, see handleToggleRecord in
  // the frontend) came back empty, instead of leaving the attempt "pending"
  // forever with no way to ever grade it.
  transcript: string;
  model: string;
  rubric: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pronunciation: {
      type: "number",
      description:
        "0 to 1: intelligibility. How easily a listener used to international English understands each word. An accent (Indian, African, British, American or any other) is never an error; only sounds, stress or rhythm that make words hard to understand lower it.",
    },
    fluency: {
      type: "number",
      description: "0 to 1: how smoothly the speaker keeps going: steady pace, few long pauses, restarts or filler words. Accent plays no part.",
    },
    comment: { type: "string", description: "One short, specific sentence of feedback for the learner." },
    transcript: {
      type: "string",
      description: "The exact words spoken, transcribed in English. Empty string if no speech was detected.",
    },
  },
  required: ["pronunciation", "fluency", "comment", "transcript"],
};

// Measured 6-24 s per recording (Oct 2026), so 12 s cut off about a third of
// answers. A learner waiting for the next question gets 25 s; background
// grading after the answer is saved can wait longer.
export const SPEAKING_TIMEOUT_MS = 25_000;

export async function scoreAudioFluency(
  audioBase64: string,
  audioMimeType: string,
  cefrLevel: string | null,
  timeoutMs = SPEAKING_TIMEOUT_MS,
  // The question being answered (never the answer): helps tell apart short
  // words that sound alike ("cat" was heard as "ticket" with no context).
  question?: string,
): Promise<GeminiFluencyResult | null> {
  const ai = getClient();
  if (!ai) return null;

  const level = cefrLevel ?? "B1";
  // Deliberately doesn't tell the model the expected text — that made it anchor on "they probably said this"
  // and hallucinate on silence (4/6 trials); verifying real speech is present first fixed it (0/6).
  const prompt = `Listen carefully to the attached audio. First, determine: does this recording contain any actual audible human speech at all? If the recording is silent, contains only noise/static, or has no discernible spoken words, you must respond with pronunciation 0, fluency 0, and clearly state no speech was detected — do not guess or assume speech occurred. Only if you can actually hear real spoken words, judge what you genuinely hear (a ${level}-level English learner's recording) — how it sounds, not the words' content.

Score intelligibility (the "pronunciation" field) and fluency from 0 to 1. Judge them as a listener used to international English would, not against any one native accent. An Indian, African, British, American or any other accent is never an error and must not lower either score. Lower intelligibility only when sounds, word stress or rhythm make words hard to understand. 1 = every word is easy to understand; 0 = the speech can't be understood. Never use any other scale. Transcribe exactly what was said, in standard English spelling, without correcting the speaker's grammar.${
    question
      ? ` The speaker is answering this question: "${question}". Answers are often one or two words. Use the question only to tell apart words that sound alike; never write words you can't hear.`
      : ""
  }`;

  try {
    // Same reasoning as aiGrading.ts's timeout: an unguarded audio-grading
    // call (larger payload than text grading, so if anything is going to be
    // slow enough to stall the request, this is it) could hang the whole
    // attempt submission indefinitely. Capped so a slow call fails closed
    // within a predictable bound instead.
    const response = await Promise.race([
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, { inlineData: { mimeType: audioMimeType, data: audioBase64 } }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          // The same recording should get the same score.
          temperature: 0,
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("scoreAudioFluency: timed out")), timeoutMs)),
    ]);

    const parsed = JSON.parse(response.text ?? "");
    const pronunciation = Number(parsed.pronunciation);
    const fluency = Number(parsed.fluency);
    if (Number.isNaN(pronunciation) || Number.isNaN(fluency)) return null;

    return {
      pronunciation: Math.max(0, Math.min(1, pronunciation)),
      fluency: Math.max(0, Math.min(1, fluency)),
      comment: String(parsed.comment ?? ""),
      transcript: String(parsed.transcript ?? ""),
      model: GEMINI_MODEL,
      rubric: SPEAKING_RUBRIC_VERSION,
    };
  } catch (err) {
    console.error("scoreAudioFluency: request failed:", err);
    return null;
  }
}
