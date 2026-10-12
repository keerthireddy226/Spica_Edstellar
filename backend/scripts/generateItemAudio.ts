// One-time/occasional batch job: generates real AI audio (male + female,
// standard American accent) for every approved item that needs spoken
// audio, via Google Cloud Text-to-Speech. Requires GOOGLE_TTS_API_KEY in
// backend/.env — without it, synthesizeSpeech() returns null for
// everything and this just logs skipped items and exits, same fail-closed
// behavior as the rest of the app's optional third-party integrations. Run
// manually after adding new content, or re-run with --force after a
// content edit that changes an item's spoken text.
//
// Usage: npm run generate-item-audio [-- --force] [-- --type=repeats] [-- --limit=5]
// --type restricts the run to one item type, --limit caps how many items —
// for trying a new voice/accent on a small sample before generating everything.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db.js";
import { synthesizeSpeech, type VoiceGender } from "../src/voice/googleTts.js";
import { getSpokenSegments, AUDIO_FIRST_TYPES } from "../src/voice/spokenText.js";

const VOICES: VoiceGender[] = ["male", "female"];
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");
const ACCENT = "en-US";

const force = process.argv.includes("--force");
const typeArg = process.argv.find((a) => a.startsWith("--type="));
const onlyType = typeArg?.slice("--type=".length);
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;

async function main() {
  if (!process.env.GOOGLE_TTS_API_KEY) {
    console.error("GOOGLE_TTS_API_KEY is not set — nothing to generate. Add it to backend/.env and re-run.");
    process.exit(1);
  }

  if (onlyType && !AUDIO_FIRST_TYPES.has(onlyType)) {
    console.error(`--type=${onlyType} isn't one of the audio-first types: ${[...AUDIO_FIRST_TYPES].join(", ")}`);
    process.exit(1);
  }
  const itemTypeIds = onlyType ? [onlyType] : Array.from(AUDIO_FIRST_TYPES);
  const itemsResult = await pool.query(
    `SELECT id, item_type_id, content FROM items WHERE status = 'approved' AND item_type_id = ANY($1::text[])
     ORDER BY created_at LIMIT $2`,
    [itemTypeIds, limit ?? null],
  );
  console.log(
    `Found ${itemsResult.rows.length} approved items needing spoken audio${onlyType ? ` (type=${onlyType})` : ""}${limit ? ` (limit=${limit})` : ""}.`,
  );

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of itemsResult.rows) {
    const text = getSpokenSegments(item.item_type_id, item.content as Record<string, unknown>).join(". ");
    if (!text) {
      console.warn(`Item ${item.id} (${item.item_type_id}): no spoken text found, skipping.`);
      skipped++;
      continue;
    }

    for (const voice of VOICES) {
      if (!force) {
        const existing = await pool.query(`SELECT 1 FROM item_audio WHERE item_id = $1 AND voice_id = $2`, [item.id, voice]);
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
      }

      const speech = await synthesizeSpeech(text, voice);
      if (!speech) {
        console.error(`Item ${item.id} (${voice}): synthesis failed, skipping.`);
        failed++;
        continue;
      }

      const voiceDir = path.join(UPLOADS_DIR, voice);
      await mkdir(voiceDir, { recursive: true });
      await writeFile(path.join(voiceDir, `${item.id}.mp3`), speech.audioBuffer);
      const uri = `/uploads/item-audio/${voice}/${item.id}.mp3`;

      await pool.query(
        `INSERT INTO item_audio (item_id, voice_id, accent, uri, duration_ms)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (item_id, voice_id) DO UPDATE SET uri = EXCLUDED.uri, duration_ms = EXCLUDED.duration_ms, accent = EXCLUDED.accent`,
        [item.id, voice, ACCENT, uri, speech.durationMs],
      );

      generated++;
      console.log(`Generated ${item.id} (${voice}), ${speech.durationMs}ms.`);
    }
  }

  console.log(`Done. Generated ${generated}, skipped ${skipped} (already existed), failed ${failed}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("generateItemAudio: fatal error:", err);
  process.exit(1);
});
