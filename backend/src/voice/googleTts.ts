import { mp3DurationMs } from "./mp3.js";

// Real AI-generated item audio (male/female), batch-generated. Fails closed to null on any error.

export type VoiceGender = "male" | "female";

export type Accent = "en-US" | "en-GB" | "en-IN" | "en-AU";
export const ACCENTS: Accent[] = ["en-US", "en-GB", "en-IN", "en-AU"];

// Google's Chirp 3 HD voices, the same two in every accent: Sulafat (female)
// and Alnilam (male), chosen by the owner on 2026-11-11 (before that, Neural2
// F/D). item_audio.voice_id stores the gender label and item_audio.accent the
// accent, not these names.
const VOICE_NAME: Record<Accent, Record<VoiceGender, string>> = Object.fromEntries(
  ACCENTS.map((a) => [a, { female: `${a}-Chirp3-HD-Sulafat`, male: `${a}-Chirp3-HD-Alnilam` }]),
) as Record<Accent, Record<VoiceGender, string>>;

// Recording files made with these voices end in this, so the ones still in
// the old voices can be told apart (and re-recorded).
export const VOICE_FILE_SUFFIX = ".c3.mp3";

export interface SynthesizedSpeech {
  audioBuffer: Buffer;
  mimeType: string;
  durationMs: number | null;
}

// opts.ssml: `text` is SSML (e.g. with <break> tags). opts.speakingRate: 1 =
// normal; slower for lower levels. opts.voiceName: a Google voice to use
// instead of the accent's Neural2 voice.
export async function synthesizeSpeech(
  text: string,
  voice: VoiceGender,
  accent: Accent = "en-US",
  opts: { ssml?: boolean; speakingRate?: number; voiceName?: string } = {},
): Promise<SynthesizedSpeech | null> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: opts.ssml ? { ssml: text } : { text },
        voice: { languageCode: accent, name: opts.voiceName ?? VOICE_NAME[accent][voice] },
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
