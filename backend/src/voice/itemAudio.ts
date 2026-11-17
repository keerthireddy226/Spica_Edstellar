import { warmFiles } from "../storage/mirror.js";
import { pool } from "../db.js";
import type { VoiceGender } from "./googleTts.js";

const DEFAULT_VOICE: VoiceGender = "female";

export async function getPreferredVoice(userId: string): Promise<VoiceGender> {
  const result = await pool.query(`SELECT preferred_voice FROM participant_profiles WHERE user_id = $1`, [userId]);
  return (result.rows[0]?.preferred_voice as VoiceGender | null) ?? DEFAULT_VOICE;
}

// The voice a real test uses for a question: fixed by the question (the same
// for everyone), so a real test mixes female and male voices.
export function voiceForQuestion(itemId: string): VoiceGender {
  let h = 0;
  for (const ch of itemId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "female" : "male";
}

// Attaches audioUrl (null if not recorded yet). Every question has its own fixed
// voice, female or male (from 17 Nov 2026, everywhere in the app), falling back
// to the other voice if that recording is missing. opts.mixVoices: false uses the
// person's saved voice instead (kept for scripts and older callers).
export async function withAudioUrls<T extends { id: string }>(userId: string, items: T[], opts: { mixVoices?: boolean } = {}): Promise<(T & { audioUrl: string | null })[]> {
  const mix = opts.mixVoices ?? true;
  if (items.length === 0) return [];
  const chosen = await getPreferredVoice(userId);
  const result = await pool.query(`SELECT item_id, voice_id, uri FROM item_audio WHERE item_id = ANY($1::uuid[])`, [items.map((item) => item.id)]);
  const byItem = new Map<string, Map<string, string>>();
  for (const row of result.rows) {
    const m = byItem.get(row.item_id) ?? new Map<string, string>();
    m.set(row.voice_id, row.uri);
    byItem.set(row.item_id, m);
  }
  const uriByItemId = new Map<string, string>();
  for (const item of items) {
    const m = byItem.get(item.id);
    if (!m) continue;
    const want = mix ? voiceForQuestion(item.id) : chosen;
    const other: VoiceGender = want === "female" ? "male" : "female";
    const uri = m.get(want) ?? (mix ? m.get(other) : undefined);
    if (uri) uriByItemId.set(item.id, uri);
  }
  // The test's recordings are fetched to this server now, while the learner
  // reads the instructions, so none waits for a download when it plays.
  warmFiles([...uriByItemId.values()]);
  return items.map((item) => ({ ...item, audioUrl: uriByItemId.get(item.id) ?? null }));
}
