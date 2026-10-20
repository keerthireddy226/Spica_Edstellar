// Records the Versant listening questions with the Google Neural2 voices, in
// both the female (en-US-Neural2-F) and male (en-US-Neural2-D) version.
//
// - Conversations: speaker A in the learner's voice, speaker B in the other
//   voice, a pause between turns, then the question after a longer pause.
//   Nothing like "Speaker A" is read out.
// - Passage Comprehension: the passage, a pause, then the question.
// - Sentence Builds: each word group with a pause between them.
// - Every other type (Repeats, Dictation, Short Answer, Response Selection,
//   Story Retelling): the text as written.
//
// Usage:
//   npx tsx --env-file=.env scripts/recordVersantAudio.ts                 dry run: what would be recorded, and its size
//   npx tsx --env-file=.env scripts/recordVersantAudio.ts --apply         record
// Options: --redo=conversations,passage_comprehension  re-record these types even when recorded
//          --type=conversations  only this type     --limit=5  at most this many questions
//          --ids=<uuid>,<uuid>   only these questions (always re-recorded)
//          --older-than=<ISO time>  with --redo: only questions recorded before this time
//          --concurrency=3       recordings at a time (Google limits requests per minute)
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db.js";
import { synthesizeSpeech, type VoiceGender } from "../src/voice/googleTts.js";

const TYPES = ["repeats", "sentence_builds", "conversations", "passage_comprehension", "story_retelling", "short_answer", "dictation", "response_selection"];
const VOICES: VoiceGender[] = ["female", "male"];
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "item-audio");

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const redo = new Set((arg("redo") ?? "").split(",").filter(Boolean));
const onlyType = arg("type");
const limit = arg("limit") ? Number(arg("limit")) : undefined;
const ids = (arg("ids") ?? "").split(",").filter(Boolean);
const olderThan = arg("older-than");
const CONCURRENCY = Number(arg("concurrency") ?? 3);

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ssml = (body: string) => `<speak>${body}</speak>`;
const pause = (ms: number) => `<break time="${ms}ms"/>`;

// "A: Hi. B: Hello. A: Bye." -> [{ speaker: "A", text: "Hi." }, ...]
export function dialogueTurns(dialogue: string): { speaker: string; text: string }[] {
  return dialogue
    .split(/\s*(?=\b[A-Z]:\s)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([A-Z]):\s*([\s\S]*)$/);
      return m ? { speaker: m[1], text: m[2].trim() } : { speaker: "A", text: part };
    })
    .filter((t) => t.text);
}

// One recording as a list of (voice, SSML) pieces, played one after another.
function pieces(type: string, content: Record<string, unknown>, voice: VoiceGender): { voice: VoiceGender; ssml: string }[] {
  const other: VoiceGender = voice === "female" ? "male" : "female";
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (type === "conversations") {
    const turns = dialogueTurns(s(content.dialogue));
    return [
      ...turns.map((t) => ({ voice: t.speaker === "B" ? other : voice, ssml: ssml(`${escapeXml(t.text)}${pause(500)}`) })),
      { voice, ssml: ssml(`${pause(700)}${escapeXml(s(content.question))}`) },
    ];
  }
  if (type === "passage_comprehension") {
    return [{ voice, ssml: ssml(`${escapeXml(s(content.story))}${pause(1200)}${escapeXml(s(content.question))}`) }];
  }
  if (type === "sentence_builds" && Array.isArray(content.groups)) {
    return [{ voice, ssml: ssml((content.groups as unknown[]).map((g) => escapeXml(s(g))).join(pause(700))) }];
  }
  const text = s(content.text) || s(content.question) || s(content.story);
  return text ? [{ voice, ssml: ssml(escapeXml(text)) }] : [];
}

const spokenChars = (p: { ssml: string }[]) => p.reduce((n, x) => n + x.ssml.replace(/<[^>]+>/g, "").length, 0);

async function record(item: { id: string; item_type_id: string; content: Record<string, unknown> }, voice: VoiceGender) {
  const parts: Buffer[] = [];
  let durationMs = 0;
  for (const p of pieces(item.item_type_id, item.content, voice)) {
    let speech = await synthesizeSpeech(p.ssml, p.voice, "en-US", { ssml: true });
    // Google limits requests per minute: wait and try again (2, 4, 8, 16, 32 s).
    for (let attempt = 1; !speech && attempt <= 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      speech = await synthesizeSpeech(p.ssml, p.voice, "en-US", { ssml: true });
    }
    if (!speech) throw new Error(`synthesis failed for ${item.id} (${voice})`);
    parts.push(speech.audioBuffer);
    durationMs += speech.durationMs ?? 0;
  }
  // Google returns the same MP3 format for every voice, so the pieces join as one file.
  const dir = path.join(UPLOADS_DIR, voice);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${item.id}.mp3`), Buffer.concat(parts));
  await pool.query(
    `INSERT INTO item_audio (item_id, voice_id, accent, uri, duration_ms) VALUES ($1, $2, 'en-US', $3, $4)
     ON CONFLICT (item_id, voice_id) DO UPDATE SET uri = EXCLUDED.uri, duration_ms = EXCLUDED.duration_ms, accent = EXCLUDED.accent, created_at = now()`,
    [item.id, voice, `/uploads/item-audio/${voice}/${item.id}.mp3`, durationMs],
  );
}

async function main() {
  if (apply && !process.env.GOOGLE_TTS_API_KEY) throw new Error("GOOGLE_TTS_API_KEY is not set");
  const types = onlyType ? [onlyType] : TYPES;
  const rows = (
    await pool.query(
      `SELECT i.id, i.item_type_id, i.content,
         (SELECT count(*)::int FROM item_audio a WHERE a.item_id = i.id AND a.voice_id IN ('female', 'male')) AS recorded,
         (SELECT min(a.created_at) FROM item_audio a WHERE a.item_id = i.id AND a.voice_id IN ('female', 'male')) AS recorded_at
       FROM items i WHERE i.status = 'approved' AND i.item_type_id = ANY($1::text[]) AND ($2::uuid[] IS NULL OR i.id = ANY($2::uuid[]))
       ORDER BY i.item_type_id, i.cefr_level, i.created_at`,
      [types, ids.length ? ids : null],
    )
  ).rows;
  const todo = rows
    .filter((r) => ids.length || r.recorded < 2 || (redo.has(r.item_type_id) && (!olderThan || new Date(r.recorded_at) < new Date(olderThan))))
    .slice(0, limit);
  const byType = new Map<string, { items: number; chars: number }>();
  let chars = 0;
  for (const r of todo) {
    const c = VOICES.reduce((n, v) => n + spokenChars(pieces(r.item_type_id, r.content, v)), 0);
    chars += c;
    const t = byType.get(r.item_type_id) ?? { items: 0, chars: 0 };
    byType.set(r.item_type_id, { items: t.items + 1, chars: t.chars + c });
  }
  for (const [t, v] of byType) console.log(`${t}: ${v.items} questions, ${v.chars} characters`);
  console.log(`Total: ${todo.length} questions x 2 voices, ${chars} characters.`);
  if (!apply) {
    console.log("Dry run. Add --apply to record.");
    return pool.end();
  }

  let done = 0;
  let failed = 0;
  const queue = todo.flatMap((item) => VOICES.map((voice) => ({ item, voice })));
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        try {
          await record(job.item, job.voice);
          done++;
        } catch (err) {
          failed++;
          console.error(String(err));
        }
        if ((done + failed) % 200 === 0) console.log(`${done + failed} recordings (${failed} failed)`);
      }
    }),
  );
  console.log(`Done: ${done} recorded, ${failed} failed.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
