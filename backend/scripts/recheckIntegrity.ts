// Checks finished candidates' tests again with the current integrity rules
// (after a rule change, e.g. 2026-10-29: screenshots count as the screen
// record, face problems count from the third photo). A reviewer's decision
// always stands. Runs in one transaction: without --apply it's rolled back,
// so the list shows what would change and nothing is saved.
//
// Usage: npx tsx scripts/recheckIntegrity.ts --job <job id>           (list only)
//        npx tsx scripts/recheckIntegrity.ts --job <job id> --apply   (saves the new checks)
import "dotenv/config";
import { pool } from "../src/db.js";
import { analyzeSession } from "../src/proctoring/analyze.js";

const apply = process.argv.includes("--apply");
const jobId = process.argv[process.argv.indexOf("--job") + 1];
if (!process.argv.includes("--job") || !jobId) {
  console.error("Usage: npx tsx scripts/recheckIntegrity.ts --job <job id> [--apply]");
  process.exit(1);
}

const rows = (
  await pool.query(
    `SELECT a.email, a.session_id, si.status, si.risk_score FROM recruitment_assessments a JOIN session_integrity si ON si.session_id = a.session_id
     WHERE a.job_id = $1 AND a.status = 'completed' ORDER BY a.completed_at`,
    [jobId],
  )
).rows;

// The analysis reads and writes through the pool: inside the transaction.
const client = await pool.connect();
await client.query("BEGIN");
const poolQuery = pool.query.bind(pool);
(pool as unknown as { query: typeof client.query }).query = client.query.bind(client);

let changed = 0;
for (const r of rows) {
  const now = await analyzeSession(r.session_id);
  if (!now) continue;
  const same = now.status === r.status && now.riskScore === r.risk_score;
  if (!same) changed++;
  const reasons = (await client.query(`SELECT reasons FROM session_integrity WHERE session_id = $1`, [r.session_id])).rows[0].reasons as { code: string; points: number }[];
  console.log(`${same ? " " : "*"} ${r.email} | ${r.status} ${r.risk_score} -> ${now.status} ${now.riskScore} | ${reasons.filter((x) => x.points > 0).map((x) => `${x.code}:${x.points}`).join(" ")}`);
}

await client.query(apply ? "COMMIT" : "ROLLBACK");
client.release();
(pool as unknown as { query: typeof poolQuery }).query = poolQuery;
console.log(`${rows.length} tests, ${changed} with a different check${apply ? " (saved)" : " (nothing saved: add --apply)"}.`);
await pool.end();
