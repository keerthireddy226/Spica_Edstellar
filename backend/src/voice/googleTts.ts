import { mp3DurationMs } from "./mp3.js";

// Real AI-generated item audio (male/female), batch-generated. Fails closed to null on any error.

export type VoiceGender = "male" | "female";

export type Accent = "en-US" | "en-GB" | "en-IN" | "en-AU";
export const ACCENTS: Accent[] = ["en-US", "en-GB", "en-IN", "en-AU"];

// Google's Neural2 voices per accent. item_audio.voice_id stores the gender
// label and item_audio.accent the accent, not these names.
const VOICE_NAME: Record<Accent, Record<VoiceGender, string>> = {
  "en-US": { male: "en-US-Neural2-D", female: "en-US-Neural2-F" },
  "en-GB": { male: "en-GB-Neural2-B", female: "en-GB-Neural2-A" },
  "en-IN": { male: "en-IN-Neural2-B", female: "en-IN-Neural2-A" },
  "en-AU": { male: "en-AU-Neural2-B", female: "en-AU-Neural2-A" },
};

export interface SynthesizedSpeech {
  audioBuffer: Buffer;
  mimeType: string;
  durationMs: number | null;
}

// opts.ssml: `text` is SSML (e.g. with <break> tags). opts.speakingRate: 1 =
// normal; slower for lower levels.
export async function synthesizeSpeech(
  text: string,
  voice: VoiceGender,
  accent: Accent = "en-US",
  opts: { ssml?: boolean; speakingRate?: number } = {},
): Promise<SynthesizedSpeech | null> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: opts.ssml ? { ssml: text } : { text },
        voice: { languageCode: accent, name: VOICE_NAME[accent][voice] },
        audioConfig: { audioEncoding: "MP3", ...(opts.speakingRate ? { speakingRate: opts.speakingRate } : {}) },
      }),
    });
    if (!res.ok) {
      console.error("synthesizeSpeech: request failed:", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) return null;
    const audioBuffer = Buffer.from(json.audioContent, "base64");
    // Google doesn't return a duration: measured from the MP3's frames (it
    // used to be estimated at 32 kbps, but the audio is 64 kbps, which
    // doubled every length).
    const durationMs = mp3DurationMs(audioBuffer);
    return { audioBuffer, mimeType: "audio/mpeg", durationMs };
  } catch (err) {
    console.error("synthesizeSpeech: request failed:", err);
    return null;
  }
}
