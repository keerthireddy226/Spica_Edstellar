// Test questions that need a recording and have none yet (new questions
// loaded into the bank from a file): recorded on the server with its voice
// key, so the files land in the server's file storage like the rest. Both
// voices, US English, as the rest of the test bank.
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { pool } from "../db.js";
import { synthesizeSpeech } from "./googleTts.js";
import { AUDIO_FIRST_TYPES, getSpokenSegments } from "./spokenText.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");
const VOICES = ["male", "female"] as const;

export async function recordMissingItemAudio(limit = 20): Promise<number> {
  if (!process.env.GOOGLE_TTS_API_KEY) return 0;
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.content FROM items i
     WHERE i.status = 'approved' AND i.pool = 'exam' AND i.item_type_id = ANY($1::text[])
       AND (SELECT count(*) FROM item_audio a WHERE a.item_id = i.id) < 2
     ORDER BY i.created_at DESC LIMIT $2`,
    [[...AUDIO_FIRST_TYPES], limit],
  );
  let recorded = 0;
  for (const item of r.rows) {
    const text = getSpokenSegments(item.item_type_id, item.content).join(". ");
    if (!text) continue;
    for (const voice of VOICES) {
      if ((await pool.query(`SELECT 1 FROM item_audio WHERE item_id = $1 AND voice_id = $2`, [item.id, voice])).rowCount) continue;
      const speech = await synthesizeSpeech(text, voice, "en-US");
      if (!speech) continue;
      await mkdir(path.join(UPLOADS_DIR, voice), { recursive: true });
      await writeFile(path.join(UPLOADS_DIR, voice, `${item.id}.mp3`), speech.audioBuffer);
      await pool.query(
        `INSERT INTO item_audio (item_id, voice_id, accent, uri, duration_ms) VALUES ($1, $2, 'en-US', $3, $4)
         ON CONFLICT (item_id, voice_id) DO UPDATE SET uri = EXCLUDED.uri, duration_ms = EXCLUDED.duration_ms, accent = EXCLUDED.accent`,
        [item.id, voice, `/uploads/item-audio/${voice}/${item.id}.mp3`, speech.durationMs],
      );
      recorded++;
    }
  }
  return recorded;
}
