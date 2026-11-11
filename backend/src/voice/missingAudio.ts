// Test questions that need a recording: ones with none yet (new questions
// loaded into the bank from a file), and set questions still in the old
// voices or format (Neural2, or read without pauses, before 2026-11-11). Recorded on the server with its voice
// key, so the files land in the server's file storage like the rest. Both
// voices (googleTts: Chirp 3 HD Sulafat and Alnilam). The new files end in
// VOICE_FILE_SUFFIX, which marks them as done; old files stay on disk.
//
// Accent: a question in a set is in US or UK English by level (trialAccent);
// spare questions are in US English until a set takes them.
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { pool } from "../db.js";
import { synthesizeSpeech, VOICE_FILE_SUFFIX, type Accent } from "./googleTts.js";
import { AUDIO_FIRST_TYPES, getSpokenSegments } from "./spokenText.js";
import { spokenSsml } from "./spokenSsml.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");
const VOICES = ["male", "female"] as const;

// US English up to B1; at B2 every third question UK; at C1-C2 every second
// one. `position` counts from 0 among the set's recorded questions of that
// level (ordered by id), so a set splits exactly and both voices match.
export function trialAccent(position: number, level: string | null): Accent {
  if (level === "B2") return position % 3 === 2 ? "en-GB" : "en-US";
  if (level === "C1" || level === "C2") return position % 2 === 1 ? "en-GB" : "en-US";
  return "en-US";
}

export async function recordMissingItemAudio(limit = 100): Promise<number> {
  if (!process.env.GOOGLE_TTS_API_KEY) return 0;
  // Sets of the hidden LanguageCert-style tests keep their recordings.
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, i.cefr_level, (e.id IS NOT NULL AND e.is_active AND e.test_type_id NOT LIKE 'lc%') AS in_set,
       (SELECT count(*)::int FROM items o JOIN exam_parts op ON op.id = o.exam_part_id
        WHERE op.exam_id = e.id AND o.status = 'approved' AND o.pool = 'exam' AND o.item_type_id = ANY($1::text[])
          AND o.cefr_level = i.cefr_level AND o.id < i.id) AS position
     FROM items i
     LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id
     WHERE i.status = 'approved' AND i.pool = 'exam' AND i.item_type_id = ANY($1::text[])
       AND ((SELECT count(*) FROM item_audio a WHERE a.item_id = i.id) < 2
         OR (e.is_active AND e.test_type_id NOT LIKE 'lc%' AND EXISTS (SELECT 1 FROM item_audio a WHERE a.item_id = i.id AND a.uri NOT LIKE '%' || $3)))
     ORDER BY (e.id IS NULL), i.created_at DESC LIMIT $2`,
    [[...AUDIO_FIRST_TYPES], limit, VOICE_FILE_SUFFIX],
  );
  let recorded = 0;
  for (const item of r.rows) {
    // The approved reading format (pauses, "Speaker A/B"); plain text for
    // the LanguageCert-style types.
    const ssml = spokenSsml(item.item_type_id, item.content);
    const text = ssml ?? getSpokenSegments(item.item_type_id, item.content).join(". ");
    if (!text) continue;
    const accent: Accent = item.in_set ? trialAccent(item.position, item.cefr_level) : "en-US";
    for (const voice of VOICES) {
      const has = await pool.query(`SELECT uri FROM item_audio WHERE item_id = $1 AND voice_id = $2`, [item.id, voice]);
      if (has.rowCount && (!item.in_set || String(has.rows[0].uri).endsWith(VOICE_FILE_SUFFIX))) continue;
      const speech = await synthesizeSpeech(text, voice, accent, { ssml: !!ssml });
      if (!speech) continue;
      const file = `${item.id}${VOICE_FILE_SUFFIX}`;
      await mkdir(path.join(UPLOADS_DIR, voice), { recursive: true });
      await writeFile(path.join(UPLOADS_DIR, voice, file), speech.audioBuffer);
      await pool.query(
        `INSERT INTO item_audio (item_id, voice_id, accent, uri, duration_ms) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_id, voice_id) DO UPDATE SET uri = EXCLUDED.uri, duration_ms = EXCLUDED.duration_ms, accent = EXCLUDED.accent`,
        [item.id, voice, accent, `/uploads/item-audio/${voice}/${file}`, speech.durationMs],
      );
      recorded++;
    }
  }
  return recorded;
}
