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

export async function synthesizeSpeech(text: string, voice: VoiceGender, accent: Accent = "en-US"): Promise<SynthesizedSpeech | null> {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: accent, name: VOICE_NAME[accent][voice] },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
    if (!res.ok) {
      console.error("synthesizeSpeech: request failed:", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) return null;
    const audioBuffer = Buffer.from(json.audioContent, "base64");
    // Google doesn't return an exact duration — estimated from the MP3's
    // byte size at its default encoding bitrate (good enough; nothing reads
    // this for playback timing today, only item_audio.duration_ms).
    const MP3_BITRATE_KBPS = 32;
    const durationMs = Math.round((audioBuffer.byteLength * 8) / MP3_BITRATE_KBPS);
    return { audioBuffer, mimeType: "audio/mpeg", durationMs };
  } catch (err) {
    console.error("synthesizeSpeech: request failed:", err);
    return null;
  }
}
