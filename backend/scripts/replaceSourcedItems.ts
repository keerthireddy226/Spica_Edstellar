// Replaces the 71 practice questions taken from Pearson's Versant guides and a
// test-prep website (pipeline_version 'sourced-v2') with original ones. Each
// replacement takes the original's place (same pool, set, order, exam part and
// skill tag); the original is retired, so past attempts keep their history.
//
// Input: a JSON array of { replaces, item_type_id, cefr_level, topic, content, answer_set }.
// Usage: npx tsx scripts/replaceSourcedItems.ts <file.json>           (dry run)
//        npx tsx scripts/replaceSourcedItems.ts --apply <file.json>   (writes)
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

interface Replacement {
  replaces: string;
  item_type_id: string;
  cefr_level: string;
  topic: string;
  content: unknown;
  answer_set: unknown;
}

const apply = process.argv.includes("--apply");
const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) throw new Error("usage: replaceSourcedItems.ts [--apply] <file.json>");
const list: Replacement[] = JSON.parse(readFileSync(file, "utf8"));

const client = await pool.connect();
try {
  await client.query("BEGIN");
  let replaced = 0;
  for (const r of list) {
    const o = (
      await client.query(
        `SELECT id, item_type_id, cefr_level, difficulty, pool, set_id, set_order, exam_part_id, exam_order, skill_tag
         FROM items WHERE id = $1 AND pipeline_version = 'sourced-v2' AND status = 'approved'`,
        [r.replaces],
      )
    ).rows[0];
    if (!o) {
      console.log(`skip ${r.replaces}: not an approved sourced question`);
      continue;
    }
    if (o.item_type_id !== r.item_type_id || o.cefr_level !== r.cefr_level) throw new Error(`${r.replaces}: type or level differs`);
    await client.query(
      `INSERT INTO items (item_type_id, content, answer_set, cefr_level, difficulty, topic, status, pool, pipeline_version, set_id, set_order, exam_part_id, exam_order, skill_tag)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, 'original-v1', $8, $9, $10, $11, $12)`,
      [r.item_type_id, JSON.stringify(r.content), JSON.stringify(r.answer_set), r.cefr_level, o.difficulty, r.topic, o.pool, o.set_id, o.set_order, o.exam_part_id, o.exam_order, o.skill_tag],
    );
    await client.query(`UPDATE items SET status = 'retired', updated_at = now() WHERE id = $1`, [o.id]);
    replaced++;
  }
  console.log(`${replaced} of ${list.length} questions replaced${apply ? "" : " (dry run, rolled back)"}`);
  await client.query(apply ? "COMMIT" : "ROLLBACK");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
