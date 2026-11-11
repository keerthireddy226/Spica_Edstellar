// Test questions that need a recording and have none yet (new questions
// loaded into the bank from a file): recorded on the server with its voice
// key, so the files land in the server's file storage like the rest. Both
// voices, US English, as the rest of the test bank.
//
// Trial voices: the questions of the sets in TRIAL_SETS are recorded (again)
// with Google's Chirp 3 HD voices, in US or UK English by level, so the
// owner can hear them in one whole set before choosing them for the bank.
// Their files end in ".c3.mp3", which marks them as done; the old files stay.
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { pool } from "../db.js";
import { synthesizeSpeech, type Accent, type VoiceGender } from "./googleTts.js";
import { AUDIO_FIRST_TYPES, getSpokenSegments } from "./spokenText.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");
const VOICES = ["male", "female"] as const;

// Practice Set 1 of English 4 Skills Essentials: a fixed set, never drawn
// into real tests or mocks.
export const TRIAL_SETS = ["fourskills-1"];
const TRIAL_VOICE: Record<VoiceGender, string> = { female: "Chirp3-HD-Sulafat", male: "Chirp3-HD-Alnilam" };
const TRIAL_SUFFIX = ".c3.mp3";

// US English up to B1; at B2 every third question UK; at C1-C2 every second
// one. `position` counts from 0 among the set's recorded questions of that
// level (ordered by id), so a set splits exactly and both voices match.
export function trialAccent(position: number, level: string | null): Accent {
  if (level === "B2") return position % 3 === 2 ? "en-GB" : "en-US";
  if (level === "C1" || level === "C2") return position % 2 === 1 ? "en-GB" : "en-US";
  return "en-US";
}

export async function recordMissingItemAudio(limit = 80): Promise<number> {
  if (!process.env.GOOGLE_TTS_API_KEY) return 0;
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, i.cefr_level, e.code = ANY($3::text[]) AS trial,
       (SELECT count(*)::int FROM items o JOIN exam_parts op ON op.id = o.exam_part_id
        WHERE op.exam_id = e.id AND o.status = 'approved' AND o.pool = 'exam' AND o.item_type_id = ANY($1::text[])
          AND o.cefr_level = i.cefr_level AND o.id < i.id) AS position
     FROM items i
     LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id
     WHERE i.status = 'approved' AND i.pool = 'exam' AND i.item_type_id = ANY($1::text[])
       AND ((SELECT count(*) FROM item_audio a WHERE a.item_id = i.id) < 2
         OR (e.code = ANY($3::text[]) AND EXISTS (SELECT 1 FROM item_audio a WHERE a.item_id = i.id AND a.uri NOT LIKE '%' || $4)))
     ORDER BY i.created_at DESC LIMIT $2`,
    [[...AUDIO_FIRST_TYPES], limit, TRIAL_SETS, TRIAL_SUFFIX],
  );
  let recorded = 0;
  for (const item of r.rows) {
    const text = getSpokenSegments(item.item_type_id, item.content).join(". ");
    if (!text) continue;
    const accent: Accent = item.trial ? trialAccent(item.position, item.cefr_level) : "en-US";
    for (const voice of VOICES) {
      const has = await pool.query(`SELECT uri FROM item_audio WHERE item_id = $1 AND voice_id = $2`, [item.id, voice]);
      if (has.rowCount && (!item.trial || String(has.rows[0].uri).endsWith(TRIAL_SUFFIX))) continue;
      const speech = await synthesizeSpeech(text, voice, accent, item.trial ? { voiceName: `${accent}-${TRIAL_VOICE[voice]}` } : {});
      if (!speech) continue;
      const file = `${item.id}${item.trial ? TRIAL_SUFFIX : ".mp3"}`;
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
