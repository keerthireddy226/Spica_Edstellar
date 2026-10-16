// Past typed answers (dictation, sentence completion, typing) that were marked
// down only because of a British or American spelling, from before graders
// accepted both (commit 1bcd750). Lists them; --apply raises their scores.
//
// Only the question's score changes. A level, report or certificate already
// given for the test isn't recalculated.
//
// Usage: npx tsx scripts/regradeSpellingVariants.ts           (list only)
//        npx tsx scripts/regradeSpellingVariants.ts --apply   (writes the new scores)
import "dotenv/config";
import { pool } from "../src/db.js";
import { gradeAttempt } from "../src/placement/grading.js";

const apply = process.argv.includes("--apply");

const rows = (
  await pool.query(
    `SELECT sc.id AS score_id, sc.content_score, a.response_text, s.session_type, s.completed_at, u.email,
       i.item_type_id, i.answer_set, i.content, i.cefr_level, it.min_words
     FROM scores sc
     JOIN attempts a ON a.id = sc.attempt_id
     JOIN sessions s ON s.id = a.session_id
     JOIN users u ON u.id = s.user_id
     JOIN items i ON i.id = a.item_id
     JOIN item_types it ON it.id = i.item_type_id
     WHERE sc.status = 'scored' AND i.item_type_id IN ('dictation', 'sentence_completion', 'typing')
       AND a.response_text IS NOT NULL AND a.response_text <> ''
     ORDER BY a.submitted_at`,
  )
).rows;

let changed = 0;
for (const r of rows) {
  const grade = await gradeAttempt(r.item_type_id, r.answer_set, r.content, r.cefr_level, r.min_words, r.response_text);
  const before = Number(r.content_score);
  if (grade.status !== "scored" || grade.score === null || grade.score <= before) continue;
  changed++;
  console.log(
    `${r.email} · ${r.session_type}${r.completed_at ? "" : " (in progress)"} · ${r.item_type_id} · ${before.toFixed(2)} -> ${grade.score.toFixed(2)} · "${String(r.response_text).slice(0, 70)}"`,
  );
  if (apply) {
    await pool.query(`UPDATE scores SET content_score = $2, updated_at = now() WHERE id = $1`, [r.score_id, grade.score]);
  }
}

console.log(`\n${rows.length} typed answers checked, ${changed} ${apply ? "raised" : "would be raised"}.`);
if (!apply && changed > 0) console.log("Run again with --apply to write them.");
await pool.end();
