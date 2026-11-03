import { warmFiles } from "../storage/mirror.js";
import { pool } from "../db.js";
import type { VoiceGender } from "./googleTts.js";

const DEFAULT_VOICE: VoiceGender = "female";

export async function getPreferredVoice(userId: string): Promise<VoiceGender> {
  const result = await pool.query(`SELECT preferred_voice FROM participant_profiles WHERE user_id = $1`, [userId]);
  return (result.rows[0]?.preferred_voice as VoiceGender | null) ?? DEFAULT_VOICE;
}

// Attaches audioUrl (null if not generated yet) — frontend falls back to browser TTS when null.
export async function withAudioUrls<T extends { id: string }>(userId: string, items: T[]): Promise<(T & { audioUrl: string | null })[]> {
  if (items.length === 0) return [];
  const voice = await getPreferredVoice(userId);
  const result = await pool.query(`SELECT item_id, uri FROM item_audio WHERE item_id = ANY($1::uuid[]) AND voice_id = $2`, [
    items.map((item) => item.id),
    voice,
  ]);
  const uriByItemId = new Map<string, string>(result.rows.map((row) => [row.item_id as string, row.uri as string]));
  // The test's recordings are fetched to this server now, while the learner
  // reads the instructions, so none waits for a download when it plays.
  warmFiles([...uriByItemId.values()]);
  return items.map((item) => ({ ...item, audioUrl: uriByItemId.get(item.id) ?? null }));
}
