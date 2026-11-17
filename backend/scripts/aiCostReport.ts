// What the AI really cost, from the ai_calls log (every Gemini call since 17 Nov 2026).
//   npx tsx scripts/aiCostReport.ts                 this month so far
//   npx tsx scripts/aiCostReport.ts --month=2026-12 one calendar month
// Reads DATABASE_URL (run it with the live database's address to see live costs).
// Prints: totals by purpose and model, cost per finished test by kind of test,
// and cost per user by plan.
import { pool } from "../src/db.js";

const arg = process.argv.find((a) => a.startsWith("--month="))?.slice(8);
const start = arg ? new Date(`${arg}-01T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
const range = [start.toISOString(), end.toISOString()];
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(4)}`;

console.log(`AI cost, ${start.toISOString().slice(0, 7)} (UTC)\n`);

const byPurpose = await pool.query(
  `SELECT purpose, model, count(*) AS calls, count(*) FILTER (WHERE NOT ok) AS failed,
     sum(input_tokens) AS input, sum(audio_input_tokens) AS audio, sum(output_tokens + thinking_tokens) AS output, sum(cost_usd) AS cost
   FROM ai_calls WHERE created_at >= $1 AND created_at < $2 GROUP BY 1, 2 ORDER BY cost DESC NULLS LAST`,
  range,
);
console.log("1. By purpose and model");
console.table(byPurpose.rows.map((r) => ({ purpose: r.purpose, model: r.model, calls: Number(r.calls), failed: Number(r.failed), input: Number(r.input), audio: Number(r.audio), output: Number(r.output), cost: usd(r.cost) })));
const total = byPurpose.rows.reduce((n, r) => n + Number(r.cost ?? 0), 0);
console.log(`Total: ${usd(total)}\n`);

// Finished tests: every call tied to the session (grading, audio checks, its report).
const perTest = await pool.query(
  `WITH c AS (SELECT session_id, sum(cost_usd) AS cost, count(*) AS calls FROM ai_calls WHERE session_id IS NOT NULL GROUP BY 1)
   SELECT coalesce(s.delivery_mode, 'placement') AS kind, coalesce(s.composition->>'testTypeId', '-') AS test,
     count(*) AS tests, avg(c.calls) AS calls, avg(c.cost) AS avg_cost, max(c.cost) AS max_cost
   FROM c JOIN sessions s ON s.id = c.session_id
   WHERE s.completed_at >= $1 AND s.completed_at < $2
   GROUP BY 1, 2 ORDER BY 1, 2`,
  range,
);
console.log("2. Per finished test (grading + its report)");
console.table(perTest.rows.map((r) => ({ kind: r.kind, test: r.test, tests: Number(r.tests), "calls each": Math.round(Number(r.calls)), "average": usd(r.avg_cost), "highest": usd(r.max_cost) })));

// Per user: calls made for them directly (Coach, practice) or through their tests.
// Plan: an organisation learner's organisation plan; otherwise what they bought
// that was active in the month; otherwise Free.
const perPlan = await pool.query(
  `WITH c AS (
     SELECT coalesce(a.user_id, s.user_id) AS user_id, sum(a.cost_usd) AS cost
     FROM ai_calls a LEFT JOIN sessions s ON s.id = a.session_id
     WHERE a.created_at >= $1 AND a.created_at < $2 GROUP BY 1
   ), plans AS (
     SELECT u.id, CASE
       WHEN t.id IS NOT NULL THEN 'org: ' || coalesce(t.plan_tier, t.category, 'organisation')
       ELSE coalesce((SELECT string_agg(DISTINCT e.product_id, ' + ') FROM entitlements e
                      WHERE e.user_id = u.id AND e.revoked_at IS NULL AND e.product_id IS NOT NULL
                        AND e.starts_at < $2 AND (e.ends_at IS NULL OR e.ends_at >= $1)), 'free') END AS plan
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
   )
   SELECT coalesce(p.plan, 'unknown (no user)') AS plan, count(*) AS users, avg(c.cost) AS avg_cost,
     percentile_cont(0.5) WITHIN GROUP (ORDER BY c.cost) AS median, max(c.cost) AS max_cost, sum(c.cost) AS total
   FROM c LEFT JOIN plans p ON p.id = c.user_id
   GROUP BY 1 ORDER BY total DESC NULLS LAST`,
  range,
);
console.log("3. Per user, by plan (users who used AI this month)");
console.table(perPlan.rows.map((r) => ({ plan: r.plan, users: Number(r.users), average: usd(r.avg_cost), median: usd(r.median), highest: usd(r.max_cost), total: usd(r.total) })));

await pool.end();
