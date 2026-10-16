// Loads practice-test sets written as JSON (one file per set) into exams,
// exam_parts and items, then opens each test type that now has a set.
//
// File shape: { "exam": { "code", "test_type_id", "name" },
//               "parts": [{ "sort_order", "label", "item_type_id",
//                           "items": [{ "cefr_level", "topic", "content", "answer_set" }] }] }
//
// Usage: npx tsx scripts/loadExamSets.ts <file.json> [...]            (dry run)
//        npx tsx scripts/loadExamSets.ts --apply <file.json> [...]    (writes)
// A set whose code already exists is skipped.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

interface SetFile {
  exam: { code: string; test_type_id: string; name: string };
  parts: {
    sort_order: number;
    label: string;
    item_type_id: string;
    items: { cefr_level: string; topic: string; content: unknown; answer_set: unknown }[];
  }[];
}

const DIFFICULTY: Record<string, number> = { A1: 0.15, A2: 0.3, B1: 0.5, B2: 0.65, C1: 0.8, C2: 0.92 };
const PIPELINE = "lc-starter-v1";

const apply = process.argv.includes("--apply");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));

for (const file of files) {
  const set: SetFile = JSON.parse(readFileSync(file, "utf8"));
  const exists = await pool.query(`SELECT 1 FROM exams WHERE code = $1`, [set.exam.code]);
  const itemCount = set.parts.reduce((n, p) => n + p.items.length, 0);
  if (exists.rows[0]) {
    console.log(`${set.exam.code}: already loaded, skipped`);
    continue;
  }
  console.log(`${set.exam.code}: ${set.parts.length} parts, ${itemCount} items${apply ? "" : " (dry run)"}`);
  if (!apply) continue;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // test_id set here: the trigger meant to fill it isn't present in every database.
    const exam = await client.query(
      `INSERT INTO exams (code, name, test_type_id, is_active, test_id) VALUES ($1, $2, $3, true, exam_test_id($1)) RETURNING id, test_id`,
      [set.exam.code, set.exam.name, set.exam.test_type_id],
    );
    for (const part of set.parts) {
      const p = await client.query(`INSERT INTO exam_parts (exam_id, part_label, item_type_id, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`, [
        exam.rows[0].id,
        part.label,
        part.item_type_id,
        part.sort_order,
      ]);
      for (const [i, item] of part.items.entries()) {
        await client.query(
          `INSERT INTO items (item_type_id, content, answer_set, cefr_level, difficulty, topic, status, pool, pipeline_version, exam_part_id, exam_order)
           VALUES ($1, $2, $3, $4, $5, $6, 'approved', 'exam', $7, $8, $9)`,
          [part.item_type_id, JSON.stringify(item.content), JSON.stringify(item.answer_set), item.cefr_level, DIFFICULTY[item.cefr_level] ?? 0.5, item.topic, PIPELINE, p.rows[0].id, i + 1],
        );
      }
    }
    // A test type with at least one set can be taken.
    await client.query(`UPDATE test_types SET status = 'live' WHERE id = $1 AND status = 'coming_soon'`, [set.exam.test_type_id]);
    await client.query("COMMIT");
    console.log(`  loaded as ${exam.rows[0].test_id}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
await pool.end();
