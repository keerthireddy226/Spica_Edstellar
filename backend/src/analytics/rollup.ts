import { pool } from "../db.js";

// Same rule analytics has always used for a "real" session: completed, and
// not simply skipped through with no answers.
const GENUINE = `s.completed_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)`;

// Recomputes learner_activity_daily for the last `days` UTC days (or all
// history the first time). Idempotent: rows are rebuilt, not incremented.
export async function refreshActivityRollup(days = 2): Promise<number> {
  const empty = (await pool.query(`SELECT NOT EXISTS (SELECT 1 FROM learner_activity_daily) AS e`)).rows[0].e;
  const since = empty ? "1970-01-01" : new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM learner_activity_daily WHERE day >= $1::date`, [since]);
    const r = await client.query(
      `INSERT INTO learner_activity_daily (user_id, day, tenant_id, sessions, attempts, active_ms)
       SELECT x.user_id, x.day, u.tenant_id, sum(x.sessions)::int, sum(x.attempts)::int, sum(x.active_ms)::bigint
       FROM (
         SELECT s.user_id, (s.completed_at AT TIME ZONE 'UTC')::date AS day, 1 AS sessions, 0 AS attempts, 0::bigint AS active_ms
         FROM sessions s WHERE s.completed_at >= $1::date AND ${GENUINE}
         UNION ALL
         SELECT s.user_id, (a.created_at AT TIME ZONE 'UTC')::date, 0, 1, coalesce(a.active_ms, 0)
         FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.created_at >= $1::date
       ) x JOIN users u ON u.id = x.user_id
       GROUP BY x.user_id, x.day, u.tenant_id`,
      [since],
    );
    await client.query("COMMIT");
    return r.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
