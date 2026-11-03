// Works out finished candidates' results again from their stored answer
// scores, after a change to what counts as a correct answer (2026-11-03: a
// correct spoken answer is no longer marked wrong for a "slow" pace that only
// counted the silence around it). No answer is scored again and nothing is
// sent to the AI: only the right/wrong decisions and the totals are redone.
// Lists every change; --apply saves the new results on the invitations.
//
// Spoken answers said word for word count as right (2026-11-03). Answers
// scored before that don't carry the mark yet: --mark adds it to these
// candidates' answers (only the mark; no score changes), so the list and the
// reports show them as right.
//
// Everything runs in one transaction: without --apply it's rolled back, so
// the list shows what would change and nothing is saved.
//
// Usage: npx tsx scripts/recalcCandidateResults.ts --tenant <tenant id> --mark           (list only)
//        npx tsx scripts/recalcCandidateResults.ts --tenant <tenant id> --mark --apply   (marks and saves the new results)
import "dotenv/config";
import { pool } from "../src/db.js";
import { candidateResultFor } from "../src/recruitment/service.js";
import { saidWordForWord } from "../src/reports/wordDiff.js";

const apply = process.argv.includes("--apply");
const mark = process.argv.includes("--mark");
const tenantId = process.argv[process.argv.indexOf("--tenant") + 1];
if (!process.argv.includes("--tenant") || !tenantId) {
  console.error("Usage: npx tsx scripts/recalcCandidateResults.ts --tenant <tenant id> [--apply]");
  process.exit(1);
}

const rows = (
  await pool.query(
    `SELECT a.id, a.email, a.session_id, a.exam_id, j.min_cefr, j.title, a.result
     FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id
     WHERE a.tenant_id = $1 AND a.status = 'completed' AND a.session_id IS NOT NULL
     ORDER BY j.created_at, a.completed_at`,
    [tenantId],
  )
).rows;

// One connection for the whole run, inside a transaction (see above): the
// result calculation reads the pool, so the pool's queries go through it.
const client = await pool.connect();
await client.query("BEGIN");
const poolQuery = pool.query.bind(pool);
(pool as unknown as { query: typeof client.query }).query = client.query.bind(client);

if (mark) {
  const answers = (
    await pool.query(
      `SELECT sc.attempt_id, i.item_type_id, i.answer_set, i.content, coalesce(nullif(at.response_text, ''), sc.manner_scores->'gemini'->>'transcript') AS said
       FROM recruitment_assessments a JOIN attempts at ON at.session_id = a.session_id JOIN scores sc ON sc.attempt_id = at.id
       JOIN items i ON i.id = at.item_id JOIN item_types it ON it.id = i.item_type_id
       WHERE a.tenant_id = $1 AND a.status = 'completed' AND it.input_method = 'mic'
         AND i.item_type_id IN ('repeats', 'reading', 'sentence_builds') AND NOT coalesce((sc.manner_scores->>'wordsMatched')::boolean, false)`,
      [tenantId],
    )
  ).rows;
  let marked = 0;
  for (const x of answers) {
    if (!saidWordForWord(x.item_type_id, x.answer_set, x.content, x.said)) continue;
    await pool.query(`UPDATE scores SET manner_scores = coalesce(manner_scores, '{}'::jsonb) || '{"wordsMatched": true}'::jsonb WHERE attempt_id = $1`, [x.attempt_id]);
    marked++;
  }
  console.log(`${marked} of ${answers.length} spoken word-for-word answers marked as said word for word.`);
}

let changed = 0;
for (const r of rows) {
  const before = r.result ?? {};
  const after = await candidateResultFor(r.session_id, r.exam_id, r.min_cefr);
  // No scored answers found (a copy of the data without them): keep the result.
  if (after.overallPercent === null || after.overallPercent === undefined) {
    console.log(`  ${r.title} | ${r.email} | no scored answers found, kept ${before.cefrLevel ?? "-"} ${before.overallPercent ?? "-"}%`);
    continue;
  }
  const same = before.overallPercent === after.overallPercent && before.cefrLevel === after.cefrLevel;
  console.log(
    `${same ? " " : "*"} ${r.title} | ${r.email} | ${before.cefrLevel ?? "-"} ${before.overallPercent ?? "-"}% -> ${after.cefrLevel ?? "-"} ${after.overallPercent ?? "-"}%`,
  );
  if (same) continue;
  changed++;
  // The recruiter's decision and notes stay; only the result is replaced.
  if (apply) await pool.query(`UPDATE recruitment_assessments SET result = $2 WHERE id = $1`, [r.id, JSON.stringify(after)]);
}
await client.query(apply ? "COMMIT" : "ROLLBACK");
client.release();
(pool as unknown as { query: typeof poolQuery }).query = poolQuery;
console.log(`${rows.length} finished candidates, ${changed} with a different result${apply ? " (saved)" : " (nothing saved: add --apply)"}.`);
await pool.end();
