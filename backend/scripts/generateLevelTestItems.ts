// Writes the questions used only by level tests (pool 'level_test'): enough
// for FORMS different tests at every level, in the same shape as the Practice
// Modules questions of each type. Each new question is checked: its fields,
// its length against the level's existing questions, no repeat of any
// existing question, and for multiple choice a second model must pick the same
// answer. Recordings are made afterwards with recordVersantAudio.ts --ids.
//
// Usage:
//   npx tsx --env-file=.env scripts/generateLevelTestItems.ts                    dry run: what's missing
//   npx tsx --env-file=.env scripts/generateLevelTestItems.ts --apply            write the missing questions
// Options: --level=B1  only this level     --type=dictation  only this type
//          --ids-out=<file>  also write the new listening questions' ids (for recording)
import "dotenv/config";
import { appendFile } from "node:fs/promises";
import { pool } from "../src/db.js";
import { CHECK_MODEL, GENERATION_MODEL, generateJson } from "../src/generation/gemini.js";
import { LEVEL_TEST_BLUEPRINT } from "../src/practiceTests/modes.js";

const FORMS = 4;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DIFFICULTY: Record<string, number> = { A1: 0.1, A2: 0.25, B1: 0.45, B2: 0.6, C1: 0.75, C2: 0.9 };
const LISTENING = new Set(["repeats", "short_answer", "response_selection", "dictation"]);

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const onlyLevel = arg("level");
const onlyType = arg("type");
const idsOut = arg("ids-out");

type Json = Record<string, unknown>;
interface Draft {
  content: Json;
  answer_set: Json | null;
  topic: string;
}

const str = { type: "string" };
const strArr = { type: "array", items: str };
// What the model writes for each type; turned into content and answer_set below.
const SHAPE: Record<string, { schema: Json; describe: string; build: (x: Json) => Draft | null }> = {
  reading: {
    describe: "one sentence the learner reads aloud",
    schema: { type: "object", properties: { text: str, topic: str }, required: ["text", "topic"] },
    build: (x) => ({ content: { text: s(x.text) }, answer_set: null, topic: s(x.topic) }),
  },
  repeats: {
    describe: "one sentence the learner hears and repeats word for word",
    schema: { type: "object", properties: { text: str, topic: str }, required: ["text", "topic"] },
    build: (x) => ({ content: { text: s(x.text) }, answer_set: { exact: s(x.text) }, topic: s(x.topic) }),
  },
  dictation: {
    describe: "one sentence the learner hears and types exactly",
    schema: { type: "object", properties: { text: str, topic: str }, required: ["text", "topic"] },
    build: (x) => ({ content: { text: s(x.text) }, answer_set: { exact: s(x.text) }, topic: s(x.topic) }),
  },
  short_answer: {
    describe: "a spoken general-knowledge question with a one- or two-word answer; list every acceptable answer (with and without articles)",
    schema: { type: "object", properties: { question: str, acceptable_answers: strArr, topic: str }, required: ["question", "acceptable_answers", "topic"] },
    build: (x) => {
      const answers = arr(x.acceptable_answers);
      return answers.length ? { content: { question: s(x.question) }, answer_set: { acceptable_answers: answers }, topic: s(x.topic) } : null;
    },
  },
  response_selection: {
    describe: "a spoken question or remark and three written replies; exactly one is a natural reply, the other two are clearly unrelated",
    schema: {
      type: "object",
      properties: { text: str, options: { type: "array", items: str, minItems: 3, maxItems: 3 }, correct_index: { type: "integer" }, topic: str },
      required: ["text", "options", "correct_index", "topic"],
    },
    build: (x) => mcq({ text: s(x.text), options: arr(x.options) }, x.correct_index, 3, s(x.topic)),
  },
  reading_comprehension: {
    describe: "a short passage (one to four sentences, longer at higher levels), a question about it and four options; exactly one is correct",
    schema: {
      type: "object",
      properties: { passage: str, question: str, options: { type: "array", items: str, minItems: 4, maxItems: 4 }, correct_index: { type: "integer" }, topic: str },
      required: ["passage", "question", "options", "correct_index", "topic"],
    },
    build: (x) => mcq({ passage: s(x.passage), question: s(x.question), options: arr(x.options) }, x.correct_index, 4, s(x.topic)),
  },
  sentence_completion: {
    describe: 'a sentence with exactly one missing word written as "___"; list every word that correctly fills the gap',
    schema: { type: "object", properties: { sentence: str, acceptable_answers: strArr, topic: str }, required: ["sentence", "acceptable_answers", "topic"] },
    build: (x) => {
      const sentence = s(x.sentence);
      const answers = arr(x.acceptable_answers).filter((a) => !/\s/.test(a));
      if ((sentence.match(/___/g) ?? []).length !== 1 || !answers.length) return null;
      return { content: { sentence }, answer_set: { acceptable_answers: answers }, topic: s(x.topic) };
    },
  },
  email_writing: {
    describe: "an email-writing task: who to write to and what to say, in one or two sentences",
    schema: { type: "object", properties: { prompt: str, topic: str }, required: ["prompt", "topic"] },
    build: (x) => ({ content: { prompt: s(x.prompt) }, answer_set: null, topic: s(x.topic) }),
  },
};

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(s).filter(Boolean) : [];
}
function mcq(content: Json, idx: unknown, n: number, topic: string): Draft | null {
  const options = content.options as string[];
  const i = Number(idx);
  if (options.length !== n || new Set(options.map(norm)).size !== n || !Number.isInteger(i) || i < 0 || i >= n) return null;
  return { content, answer_set: { correctIndex: i }, topic };
}
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const mainText = (c: Json) => s(c.text) || s(c.question) || s(c.sentence) || s(c.passage) || s(c.prompt);
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

// A second model answers a multiple-choice question on its own; it must agree.
async function keyAgrees(type: string, d: Draft): Promise<boolean> {
  if (!("correctIndex" in (d.answer_set ?? {}))) return true;
  const c = d.content;
  const options = (c.options as string[]).map((o, i) => `${i}. ${o}`).join("\n");
  const prompt =
    type === "response_selection"
      ? `Someone says: "${c.text}"\nWhich reply fits best? Answer with the number only.\n${options}`
      : `Passage: ${c.passage}\nQuestion: ${c.question}\nWhich option is correct? Answer with the number only.\n${options}`;
  const r = await generateJson<{ index: number }>({ model: CHECK_MODEL, prompt, schema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] }, temperature: 0 });
  return r.data.index === (d.answer_set as { correctIndex: number }).correctIndex;
}

async function main() {
  const types = LEVEL_TEST_BLUEPRINT.filter((p) => !onlyType || p.itemTypeId === onlyType);
  const levels = LEVELS.filter((l) => !onlyLevel || l === onlyLevel);
  let made = 0;
  for (const level of levels) {
    for (const part of types) {
      const type = part.itemTypeId;
      const shape = SHAPE[type];
      if (!shape) throw new Error(`no shape for ${type}`);
      const target = part.count * FORMS;
      const have = Number((await pool.query(`SELECT count(*) FROM items WHERE pool = 'level_test' AND item_type_id = $1 AND cefr_level = $2 AND status = 'approved'`, [type, level])).rows[0].count);
      const missing = target - have;
      console.log(`${level} ${type}: ${have} of ${target}${missing > 0 ? `, ${missing} to write` : ""}`);
      if (missing <= 0 || !apply) continue;

      // The level's existing questions: style examples, length range, and no repeats.
      const existing = (await pool.query(`SELECT content, skill_tag FROM items WHERE item_type_id = $1 AND status = 'approved'`, [type])).rows;
      const atLevel = (await pool.query(`SELECT content FROM items WHERE item_type_id = $1 AND cefr_level = $2 AND status = 'approved' AND pool <> 'level_test' ORDER BY random() LIMIT 40`, [type, level])).rows.map((r) => r.content as Json);
      const seen = new Set(existing.map((r) => norm(mainText(r.content))));
      const lengths = atLevel.map((c) => words(mainText(c))).sort((a, b) => a - b);
      const lo = Math.max(1, Math.floor((lengths[Math.floor(lengths.length * 0.05)] ?? 3) * 0.7));
      const hi = Math.ceil((lengths[Math.floor(lengths.length * 0.95)] ?? 30) * 1.3);
      const tags = existing.map((r) => r.skill_tag).filter(Boolean);
      const skillTag = tags.sort((a, b) => tags.filter((t) => t === b).length - tags.filter((t) => t === a).length)[0] ?? null;

      let written = 0;
      for (let round = 0; round < 10 && written < missing; round++) {
        const ask = Math.min(12, missing - written + 2);
        const prompt = [
          `You write English test questions for adults at CEFR level ${level}.`,
          `Write ${ask} new questions of this type: ${shape.describe}.`,
          `Use vocabulary and grammar a ${level} learner can handle. Everyday, work and study topics; vary the topics; no two alike; no famous people or brands; neutral, respectful content.`,
          `Keep the main text between ${lo} and ${hi} words.`,
          `Here are examples at this level (do not copy them):`,
          ...atLevel.slice(0, 6).map((c) => JSON.stringify(c)),
        ].join("\n");
        // The model is sometimes busy (503): wait and try the round again.
        let r: { data: { items: Json[] } };
        try {
          r = await generateJson<{ items: Json[] }>({
            model: GENERATION_MODEL,
            prompt,
            schema: { type: "object", properties: { items: { type: "array", items: shape.schema } }, required: ["items"] },
            temperature: 1,
          });
        } catch (err) {
          console.log(`  model busy (${(err as { status?: number }).status ?? "error"}), waiting 60 s`);
          await new Promise((ok) => setTimeout(ok, 60_000));
          continue;
        }
        for (const x of r.data.items ?? []) {
          if (written >= missing) break;
          const d = shape.build(x);
          if (!d) continue;
          const text = mainText(d.content);
          const n = words(text);
          if (!text || n < lo || n > hi || seen.has(norm(text))) continue;
          if (!(await keyAgrees(type, d).catch(() => false))) continue;
          seen.add(norm(text));
          const ins = await pool.query(
            `INSERT INTO items (item_type_id, content, answer_set, cefr_level, difficulty, topic, domain, status, pool, skill_tag, pipeline_version, prompt_version)
             VALUES ($1, $2, $3, $4, $5, $6, 'general', 'approved', 'level_test', $7, 'level-v1', $8) RETURNING id`,
            [type, JSON.stringify(d.content), d.answer_set ? JSON.stringify(d.answer_set) : null, level, DIFFICULTY[level], d.topic.slice(0, 80) || null, skillTag, GENERATION_MODEL],
          );
          written++;
          made++;
          if (idsOut && LISTENING.has(type)) await appendFile(idsOut, `${ins.rows[0].id}\n`);
        }
      }
      console.log(`  wrote ${written}${written < missing ? ` (still ${missing - written} short: run again)` : ""}`);
    }
  }
  console.log(apply ? `done: ${made} questions written` : "dry run: add --apply to write them");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
