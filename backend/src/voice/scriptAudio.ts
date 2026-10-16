// Recordings for generated listening questions: a dialogue's "A:" and "B:"
// turns are read by two different voices (a man and a woman), with a short
// pause between turns; one accent per recording, rotated across questions;
// a slower pace at lower levels.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db.js";
import { ACCENTS, synthesizeSpeech, type Accent, type VoiceGender } from "./googleTts.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");

const RATE: Record<string, number> = { A1: 0.85, A2: 0.9, B1: 0.95, B2: 1, C1: 1, C2: 1.05 };

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "A: Hi.\nB: Hello." -> [{speaker: "A", text: "Hi."}, ...]; a monologue is one turn.
export function splitTurns(script: string): { speaker: string | null; text: string }[] {
  const lines = script.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => /^[A-Z]:\s/.test(l))) return [{ speaker: null, text: script.trim() }];
  const turns: { speaker: string | null; text: string }[] = [];
  for (const l of lines) {
    const m = l.match(/^([A-Z]):\s*(.*)$/);
    if (m) turns.push({ speaker: m[1], text: m[2] });
    else if (turns.length) turns[turns.length - 1].text += ` ${l}`;
    else turns.push({ speaker: null, text: l });
  }
  return turns;
}

// Synthesizes one version of the recording: `first` reads speaker A (and a
// monologue), the other voice reads speaker B.
async function synthesizeScript(script: string, first: VoiceGender, accent: Accent, rate: number): Promise<{ buffer: Buffer; durationMs: number } | null> {
  const other: VoiceGender = first === "male" ? "female" : "male";
  const parts: Buffer[] = [];
  let durationMs = 0;
  for (const t of splitTurns(script)) {
    const voice = t.speaker && t.speaker !== "A" ? other : first;
    const speech = await synthesizeSpeech(`<speak>${escapeXml(t.text)}<break time="600ms"/></speak>`, voice, accent, { ssml: true, speakingRate: rate });
    if (!speech) return null;
    parts.push(speech.audioBuffer);
    durationMs += speech.durationMs ?? 0;
  }
  // MP3 frames from the same encoder can simply be joined.
  return { buffer: Buffer.concat(parts), durationMs };
}

// Both versions (the learner's preferred voice reads speaker A) for one item.
// Returns the longer duration in seconds, or null without a TTS key.
export async function generateScriptAudio(itemId: string, script: string, level: string, accent?: Accent): Promise<number | null> {
  if (!process.env.GOOGLE_TTS_API_KEY) return null;
  const a = accent ?? ACCENTS[Math.floor(Math.random() * ACCENTS.length)];
  let longest = 0;
  for (const voice of ["male", "female"] as VoiceGender[]) {
    const audio = await synthesizeScript(script, voice, a, RATE[level] ?? 1);
    if (!audio) throw new Error(`speech synthesis failed for item ${itemId}`);
    const dir = path.join(UPLOADS_DIR, voice);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${itemId}.mp3`), audio.buffer);
    await pool.query(
      `INSERT INTO item_audio (item_id, voice_id, accent, uri, duration_ms) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id, voice_id) DO UPDATE SET uri = EXCLUDED.uri, duration_ms = EXCLUDED.duration_ms, accent = EXCLUDED.accent`,
      [itemId, voice, a, `/uploads/item-audio/${voice}/${itemId}.mp3`, audio.durationMs],
    );
    longest = Math.max(longest, audio.durationMs);
  }
  return Math.round(longest / 1000);
}
