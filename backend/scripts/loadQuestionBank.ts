// Loads new full forms into the mock bank or the real-test bank (owner
// decision 2026-10-22: practice sets, mock tests and real tests never share
// questions). Each form becomes one exams row with its purpose, laid out like
// the test type's first practice set (same part labels and sort_order), so
// mock and real-test draws slot its questions into the template's sections.
//
// File shape: a JSON array of forms (or { "forms": [...] }):
//   { "testTypeId": "fourSkills", "purpose": "mock" | "assessment", "formNo": 1,
//     "parts": [{ "sortOrder": 1, "partLabel": "Repeats", "itemTypeId": "repeats",
//                 "items": [{ "cefr": "B1", "topic": "...", "content": {...}, "answer_set": {...} }] }] }
//
// Usage: npx tsx scripts/loadQuestionBank.ts <file.json>                                  (dry run)
//        npx tsx scripts/loadQuestionBank.ts <file.json> --apply [--ids-out listening.txt]  (writes)
// A form whose code already exists is skipped, so a rerun only adds what's new.
// --ids-out: the new listening questions' ids, one per line, for recording.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { pool } from "../src/db.js";

type Purpose = "mock" | "assessment";
interface FormFile {
  testTypeId: string;
  purpose: Purpose;
  formNo: number;
  parts: {
    sortOrder: number;
    partLabel: string;
    itemTypeId: string;
    items: { cefr: string; topic: string; content: unknown; answer_set: unknown }[];
  }[];
}

const TEST_TYPES = ["fourSkills", "speakingListening", "writing", "professional", "placement"];
const DIFFICULTY: Record<string, number> = { A1: 0.1, A2: 0.25, B1: 0.45, B2: 0.6, C1: 0.75, C2: 0.9 };
// Question types with a recording to make.
const LISTENING_TYPES = new Set([
  "repeats",
  "sentence_builds",
  "conversations",
  "passage_comprehension",
  "story_retelling",
  "short_answer",
  "dictation",
  "response_selection",
]);
const PIPELINE = "bank-v1";
const PROMPT = "claude-opus-5-5";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const idsOutAt = args.indexOf("--ids-out");
const idsOut = idsOutAt >= 0 ? args[idsOutAt + 1] : null;
const file = args.find((a, i) => !a.startsWith("--") && (idsOutAt < 0 || i !== idsOutAt + 1));
if (!file) {
  console.error("Usage: npx tsx scripts/loadQuestionBank.ts <file.json> [--apply] [--ids-out <file>]");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf8"));
const forms: FormFile[] = Array.isArray(raw) ? raw : raw.forms;

// Near the CEFR level's difficulty, with a little spread so a level's
// questions aren't all identical (kept inside 0.05-0.95).
const difficulty = (cefr: string) => Math.min(0.95, Math.max(0.05, Math.round(((DIFFICULTY[cefr] ?? 0.5) + (Math.random() - 0.5) * 0.06) * 1000) / 1000));
const pad = (n: number) => String(n).padStart(2, "0");

// The test type's layout: its first practice set's parts and per-question times.
async function template(testTypeId: string) {
  const exam = (
    await pool.query(`SELECT id, code, name, test_id FROM exams WHERE is_active AND purpose = 'practice' AND test_type_id = $1 ORDER BY code LIMIT 1`, [testTypeId])
  ).rows[0];
  if (!exam) throw new Error(`${testTypeId}: no practice set to copy the layout from`);
  const parts = (await pool.query(`SELECT id, part_label, item_type_id, sort_order FROM exam_parts WHERE exam_id = $1 ORDER BY sort_order`, [exam.id])).rows;
  const timers = (
    await pool.query(
      `SELECT ep.sort_order, i.exam_order, i.timer_seconds FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved' WHERE ep.exam_id = $1`,
      [exam.id],
    )
  ).rows;
  return { exam, parts, timerAt: (sortOrder: number, order: number) => timers.find((t) => t.sort_order === sortOrder && t.exam_order === order)?.timer_seconds ?? null };
}

// Everything wrong with a form, before anything is written.
function problems(f: FormFile, t: Awaited<ReturnType<typeof template>>): string[] {
  const out: string[] = [];
  if (!TEST_TYPES.includes(f.testTypeId)) out.push(`unknown test type ${f.testTypeId}`);
  if (f.purpose !== "mock" && f.purpose !== "assessment") out.push(`purpose must be mock or assessment, not ${f.purpose}`);
  if (!Number.isInteger(f.formNo) || f.formNo < 1 || f.formNo > 99) out.push(`formNo must be 1-99`);
  const want = t.parts.map((p) => p.sort_order).join(",");
  const got = f.parts.map((p) => p.sortOrder).join(",");
  if (want !== got) out.push(`parts ${got} don't match the practice layout ${want}`);
  for (const p of f.parts) {
    const tp = t.parts.find((x) => x.sort_order === p.sortOrder);
    if (tp && tp.item_type_id !== p.itemTypeId) out.push(`part ${p.sortOrder} is ${tp.item_type_id} in the layout, not ${p.itemTypeId}`);
    if (!p.items?.length) out.push(`part ${p.sortOrder} has no items`);
    for (const [i, it] of (p.items ?? []).entries()) {
      if (!(it.cefr in DIFFICULTY)) out.push(`part ${p.sortOrder} item ${i + 1}: bad cefr ${it.cefr}`);
      if (!it.content || typeof it.content !== "object") out.push(`part ${p.sortOrder} item ${i + 1}: no content`);
    }
  }
  return out;
}

const listeningIds: string[] = [];
let added = 0;
let failed = 0;
console.log(apply ? "APPLY mode." : "DRY RUN — pass --apply to write.");
for (const f of forms) {
  const t = await template(f.testTypeId);
  const prefix = String(t.exam.code).replace(/-\d+$/, "");
  const letter = f.purpose === "mock" ? "m" : "a";
  const code = `${prefix}-${letter}${pad(f.formNo)}`;
  const testId = `${String(t.exam.test_id).split("-")[0]}-${letter.toUpperCase()}${pad(f.formNo)}`;
  const name = String(t.exam.name).replace(/Set \d+$/, `${f.purpose === "mock" ? "Mock form" : "Real test form"} ${f.formNo}`);
  const issues = problems(f, t);
  if (issues.length) {
    failed++;
    console.log(`${code}: NOT loaded — ${issues.join("; ")}`);
    continue;
  }
  const exists = await pool.query(`SELECT 1 FROM exams WHERE code = $1 OR test_id = $2`, [code, testId]);
  if (exists.rowCount) {
    console.log(`${code}: already loaded, skipped`);
    continue;
  }
  const itemCount = f.parts.reduce((n, p) => n + p.items.length, 0);
  const listening = f.parts.filter((p) => LISTENING_TYPES.has(p.itemTypeId)).reduce((n, p) => n + p.items.length, 0);
  console.log(`${code} (${testId}, "${name}"): ${f.parts.length} parts, ${itemCount} items, ${listening} to record${apply ? "" : " (dry run)"}`);
  if (!apply) {
    added++;
    continue;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exam = await client.query(`INSERT INTO exams (code, name, test_type_id, is_active, test_id, purpose) VALUES ($1, $2, $3, true, $4, $5) RETURNING id`, [
      code,
      name,
      f.testTypeId,
      testId,
      f.purpose,
    ]);
    for (const p of f.parts) {
      // Label and type from the practice layout, so sections match by sort_order.
      const tp = t.parts.find((x) => x.sort_order === p.sortOrder)!;
      const part = await client.query(`INSERT INTO exam_parts (exam_id, part_label, item_type_id, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`, [
        exam.rows[0].id,
        tp.part_label,
        tp.item_type_id,
        tp.sort_order,
      ]);
      for (const [i, it] of p.items.entries()) {
        const r = await client.query(
          `INSERT INTO items (item_type_id, content, answer_set, cefr_level, difficulty, topic, domain, status, mock_approved, pool,
             pipeline_version, prompt_version, exam_part_id, exam_order, timer_seconds)
           VALUES ($1, $2, $3, $4, $5, $6, 'general', 'approved', true, 'exam', $7, $8, $9, $10, $11) RETURNING id`,
          [
            tp.item_type_id,
            JSON.stringify(it.content),
            it.answer_set == null ? null : JSON.stringify(it.answer_set),
            it.cefr,
            difficulty(it.cefr),
            it.topic ?? null,
            PIPELINE,
            PROMPT,
            part.rows[0].id,
            i + 1,
            t.timerAt(tp.sort_order, i + 1),
          ],
        );
        if (LISTENING_TYPES.has(tp.item_type_id)) listeningIds.push(r.rows[0].id);
      }
    }
    await client.query("COMMIT");
    added++;
  } catch (err) {
    await client.query("ROLLBACK");
    failed++;
    console.log(`${code}: NOT loaded — ${(err as Error).message}`);
  } finally {
    client.release();
  }
}
if (idsOut && apply) {
  writeFileSync(idsOut, listeningIds.length ? `${listeningIds.join("\n")}\n` : "");
  console.log(`${listeningIds.length} listening item ids written to ${idsOut}`);
}
console.log(`${apply ? "Loaded" : "Would load"} ${added} form(s); ${failed} with problems.`);
await pool.end();
