// Loads Versant Practice Modules questions written in Claude Code sessions
// (JSON files, one per track) into new "Set n" rows, bringing every level of
// the track up to TARGET_SETS sets of 5. Every question is validated first:
// shape, length for its level, track rules, and near-duplicates of existing
// questions or of each other. No AI calls, no audio.
//
// File shape: { "track": "reading_selective/reading",
//               "levels": { "A1": [ { ...fields as in the track schema } ], ... } }
//
// Usage:
//   npx tsx --env-file=.env scripts/loadVersantPractice.ts --existing <track>      list current questions to avoid
//   npx tsx --env-file=.env scripts/loadVersantPractice.ts <file.json> [...]       dry run: report problems
//   npx tsx --env-file=.env scripts/loadVersantPractice.ts --apply <file.json> [...]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";
import { DUPLICATE_OVERLAP, LEVELS, TRACKS, similarity, tokens, trackKey, words, type Item, type Level, type Track } from "./versantTracks.js";

const TARGET_SETS = 10;
const PER_SET = 5;
const PIPELINE_VERSION = "claude-code-versant-v1";

interface FileShape {
  track: string;
  levels: Partial<Record<Level, Record<string, unknown>[]>>;
}

const findTrack = (key: string) => TRACKS.find((t) => trackKey(t) === key);

// The text whose length the level range describes (not the question under it).
function lengthText(c: Record<string, unknown>): string {
  for (const k of ["text", "passage", "prompt", "situation", "sentence"]) if (typeof c[k] === "string") return c[k] as string;
  return "";
}

// Rules the schema can't express; returns the problem or null.
function extraRule(track: Track, level: Level, it: Item): string | null {
  const n = words(lengthText(it.content));
  const [lo, hi] = track.words[level].split("-").map(Number);
  if (n < lo - 2 || n > hi + 3) return `length ${n} words, want ${track.words[level]}`;
  const all = JSON.stringify(it.content);
  if ((track.type === "reading" || track.type === "typing") && /[^\x20-\x7E]/.test(all)) return "non-ASCII character (use plain quotes, no accents or dashes)";
  if (track.type === "reading" && /\d/.test(all)) return "digits in a read-aloud text";
  if (track.type === "reading_selective") {
    const answers = (it.answerSet?.acceptable_answers ?? []) as string[];
    if (answers.some((a) => words(a) > 4)) return "an answer is longer than 4 words";
  }
  if (track.type === "speaking_situations" && !/\?$/.test(String(it.content.situation))) return "situation must end with a question";
  if (track.type === "email_writing" && !/^Write an email to /.test(String(it.content.prompt))) return "prompt must start 'Write an email to'";
  if (track.type === "free_writing" && !/^Write a paragraph/.test(String(it.content.prompt))) return "prompt must start 'Write a paragraph'";
  return null;
}

async function existingTexts(track: Track): Promise<{ level: string | null; text: string }[]> {
  const r = await pool.query<{ content: Record<string, unknown>; cefr_level: string | null }>(
    `SELECT content, cefr_level FROM items WHERE item_type_id = $1 ${track.tag ? "AND (skill_tag = $2 OR skill_tag IS NULL)" : "AND $2::text IS NULL"} ORDER BY cefr_level, created_at`,
    [track.type, track.tag],
  );
  return r.rows.map((x) => ({ level: x.cefr_level, text: track.mainText(x.content) })).filter((x) => x.text);
}

async function unitAndSets(track: Track, level: Level) {
  const unit = (await pool.query<{ id: string }>(`SELECT id FROM units WHERE item_type_id = $1 AND name LIKE $2`, [track.type, `${level} -%`])).rows[0];
  if (!unit) return null;
  // This track's sets in the unit (a set holds one skill's items).
  const have = (
    await pool.query(
      `SELECT 1 FROM sets st WHERE st.unit_id = $1
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.cefr_level = $2 AND ${track.tag ? "i.skill_tag = $3" : "$3::text IS NULL"})`,
      [unit.id, level, track.tag],
    )
  ).rowCount ?? 0;
  return { unitId: unit.id, have };
}

async function load(file: string, write: boolean) {
  const data = JSON.parse(readFileSync(file, "utf8")) as FileShape;
  const track = findTrack(data.track);
  if (!track) throw new Error(`${file}: unknown track "${data.track}"`);
  // Everything already in the bank for this type, plus what this file adds, for the duplicate check.
  const seen = (await pool.query<{ content: Record<string, unknown> }>(`SELECT content FROM items WHERE item_type_id = $1`, [track.type])).rows.map((r) => tokens(track.mainText(r.content)));
  let problems = 0;
  for (const level of LEVELS) {
    const target = await unitAndSets(track, level);
    if (!target) {
      console.log(`${data.track} ${level}: no unit`);
      continue;
    }
    const need = Math.max(0, TARGET_SETS - target.have) * PER_SET;
    const good: Item[] = [];
    (data.levels[level] ?? []).forEach((raw, i) => {
      const it = track.toItem(raw);
      const why = typeof it === "string" ? it : extraRule(track, level, it);
      if (why || typeof it === "string") {
        problems++;
        return console.log(`  ${level} #${i}: ${why}  | ${JSON.stringify(raw).slice(0, 110)}`);
      }
      const t = tokens(track.mainText(it.content));
      if (seen.some((s) => similarity(t, s) >= DUPLICATE_OVERLAP)) {
        problems++;
        return console.log(`  ${level} #${i}: near-duplicate  | ${track.mainText(it.content).slice(0, 110)}`);
      }
      seen.push(t);
      good.push(it);
    });
    const use = good.slice(0, need);
    const sets = Math.floor(use.length / PER_SET);
    console.log(`${data.track} ${level}: has ${target.have} sets, needs ${need} questions, ${good.length} valid${good.length < need ? `  SHORT BY ${need - good.length}` : ""}`);
    if (!write || !sets) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const maxOrder = (await client.query<{ m: number }>(`SELECT coalesce(max(order_index), 0) AS m FROM sets WHERE unit_id = $1`, [target.unitId])).rows[0].m;
      for (let s = 0; s < sets; s++) {
        const setId = (
          await client.query<{ id: string }>(`INSERT INTO sets (unit_id, order_index, name) VALUES ($1, $2, $3) RETURNING id`, [target.unitId, maxOrder + s + 1, `Set ${target.have + s + 1}`])
        ).rows[0].id;
        for (let k = 0; k < PER_SET; k++) {
          const it = use[s * PER_SET + k];
          await client.query(
            `INSERT INTO items (item_type_id, content, answer_set, word_count, topic, status, pipeline_version, review_decision, pool, cefr_level, set_id, set_order, skill_tag, domain)
             VALUES ($1, $2, $3, $4, $5, 'approved', $6, 'grandfathered', 'practice', $7, $8, $9, $10, 'general')`,
            [track.type, it.content, it.answerSet, words(lengthText(it.content)), it.topic || null, PIPELINE_VERSION, level, setId, k + 1, track.tag],
          );
        }
      }
      await client.query("COMMIT");
      console.log(`  added ${sets} sets`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return problems;
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--existing") {
    const track = findTrack(args[1] ?? "");
    if (!track) throw new Error(`unknown track; one of: ${TRACKS.map(trackKey).join(", ")}`);
    for (const e of await existingTexts(track)) console.log(`${e.level ?? "-"}\t${e.text}`);
  } else {
    const write = args.includes("--apply");
    const files = args.filter((a) => a !== "--apply");
    if (!files.length) console.log("Pass JSON files (dry run), --apply <files>, or --existing <track>");
    let problems = 0;
    for (const f of files) problems += await load(f, write);
    console.log(`${problems} problem(s)`);
  }
} finally {
  await pool.end();
}
