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

export interface GeminiFluencyResult {
  pronunciation: number;
  fluency: number;
  comment: string;
  // Server-side transcript fallback — lets content grading run even when
  // the browser's own speech-to-text (used first, see handleToggleRecord in
  // the frontend) came back empty, instead of leaving the attempt "pending"
  // forever with no way to ever grade it.
  transcript: string;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    pronunciation: {
      type: "number",
      description: "0 to 1: how clearly and accurately the individual sounds/words were pronounced.",
    },
    fluency: {
      type: "number",
      description: "0 to 1: how smooth and natural the delivery was — pace, hesitation, filler words.",
    },
    comment: { type: "string", description: "One short, specific sentence of feedback for the learner." },
    transcript: {
      type: "string",
      description: "The exact words spoken, transcribed in English. Empty string if no speech was detected.",
    },
  },
  required: ["pronunciation", "fluency", "comment", "transcript"],
};

export async function scoreAudioFluency(
  audioBase64: string,
  audioMimeType: string,
  cefrLevel: string | null,
): Promise<GeminiFluencyResult | null> {
  const ai = getClient();
  if (!ai) return null;

  const level = cefrLevel ?? "B1";
  // Deliberately doesn't tell the model the expected text — that made it anchor on "they probably said this"
  // and hallucinate on silence (4/6 trials); verifying real speech is present first fixed it (0/6).
  const prompt = `Listen carefully to the attached audio. First, determine: does this recording contain any actual audible human speech at all? If the recording is silent, contains only noise/static, or has no discernible spoken words, you must respond with pronunciation 0, fluency 0, and clearly state no speech was detected — do not guess or assume speech occurred. Only if you can actually hear real spoken words, judge the pronunciation and fluency of what you genuinely hear (a ${level}-level English learner's recording) — how it sounds, not the words' content. Score both pronunciation and fluency on a scale from 0 (worst) to 1 (excellent, native-like) — never use any other scale.`;

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
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("scoreAudioFluency: timed out")), 12_000)),
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
    };
  } catch (err) {
    console.error("scoreAudioFluency: request failed:", err);
    return null;
  }
}
