import { hostname } from "node:os";
import { pool } from "../db.js";

// A small Postgres-backed job queue: enqueue work, and every API instance
// runs a worker that claims ready jobs with FOR UPDATE SKIP LOCKED, so a job
// runs once even with several instances. Failures retry with exponential
// backoff; jobs stuck "running" after a crash are picked up again.

export type JobHandler = (payload: Record<string, any>, job: { id: number; attempts: number }) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const WORKER_ID = `${hostname()}:${process.pid}`;
const POLL_MS = 2000;
const BATCH = 10;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const KEEP_FINISHED_DAYS = 7;

export function registerHandler(queue: string, handler: JobHandler) {
  handlers.set(queue, handler);
}

export async function enqueue(
  queue: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<number | null> {
  const r = await pool.query(
    `INSERT INTO job_queue (queue, payload, run_at, dedupe_key, max_attempts)
     VALUES ($1, $2, coalesce($3, now()), $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [queue, JSON.stringify(payload), opts.runAt ?? null, opts.dedupeKey ?? null, opts.maxAttempts ?? 5],
  );
  return r.rows[0]?.id ?? null;
}

function backoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** (attempts - 1));
}

async function claim(): Promise<{ id: number; queue: string; payload: Record<string, any>; attempts: number; max_attempts: number }[]> {
  const r = await pool.query(
    `UPDATE job_queue SET status = 'running', locked_at = now(), locked_by = $1, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM job_queue WHERE status = 'queued' AND run_at <= now()
       ORDER BY run_at LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, queue, payload, attempts, max_attempts`,
    [WORKER_ID, BATCH],
  );
  return r.rows;
}

async function runOne(job: { id: number; queue: string; payload: Record<string, any>; attempts: number; max_attempts: number }) {
  const handler = handlers.get(job.queue);
  try {
    if (!handler) throw new Error(`no handler for queue "${job.queue}"`);
    await handler(job.payload, { id: job.id, attempts: job.attempts });
    await pool.query(`UPDATE job_queue SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1`, [job.id]);
  } catch (err) {
    const message = err instanceof Error ? `${err.message}`.slice(0, 2000) : String(err);
    const giveUp = job.attempts >= job.max_attempts;
    await pool.query(
      `UPDATE job_queue SET status = $2, last_error = $3, locked_at = NULL,
         run_at = CASE WHEN $2 = 'queued' THEN now() + make_interval(secs => $4) ELSE run_at END,
         finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
       WHERE id = $1`,
      [job.id, giveUp ? "failed" : "queued", message, backoffMs(job.attempts) / 1000],
    );
    console.error(`job ${job.id} (${job.queue}) ${giveUp ? "failed for good" : "failed, will retry"}: ${message}`);
  }
}

// Requeue jobs whose worker died mid-run, and drop old finished jobs.
async function housekeeping() {
  await pool.query(
    `UPDATE job_queue SET status = 'queued', locked_at = NULL, run_at = now()
     WHERE status = 'running' AND locked_at < now() - make_interval(secs => $1)`,
    [STUCK_AFTER_MS / 1000],
  );
  await pool.query(`DELETE FROM job_queue WHERE status IN ('done', 'failed') AND finished_at < now() - make_interval(days => $1)`, [
    KEEP_FINISHED_DAYS,
  ]);
}

let running = false;

// Runs everything that's ready right now; used by the worker loop and tests.
export async function drainQueue(maxRounds = 50): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxRounds; i++) {
    const jobs = await claim();
    if (jobs.length === 0) break;
    await Promise.all(jobs.map(runOne));
    processed += jobs.length;
  }
  return processed;
}

export function startWorker() {
  if (running) return;
  running = true;
  let ticks = 0;
  const loop = async () => {
    try {
      await drainQueue(5);
      if (ticks++ % 150 === 0) await housekeeping(); // about every 5 minutes
    } catch (err) {
      console.error("job worker error:", err);
    } finally {
      setTimeout(loop, POLL_MS);
    }
  };
  setTimeout(loop, 1000);
}

export async function queueStats() {
  const counts = await pool.query(`SELECT queue, status, count(*)::int AS n FROM job_queue GROUP BY queue, status ORDER BY queue, status`);
  const failures = await pool.query(
    `SELECT id, queue, attempts, last_error, finished_at FROM job_queue WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 20`,
  );
  const backlog = await pool.query(`SELECT count(*)::int AS n, min(run_at) AS oldest FROM job_queue WHERE status = 'queued' AND run_at <= now()`);
  return { counts: counts.rows, recentFailures: failures.rows, readyBacklog: backlog.rows[0].n, oldestReady: backlog.rows[0].oldest };
}

export async function retryJob(id: number): Promise<boolean> {
  const r = await pool.query(
    `UPDATE job_queue SET status = 'queued', run_at = now(), attempts = 0, last_error = NULL, finished_at = NULL WHERE id = $1 AND status = 'failed'`,
    [id],
  );
  return (r.rowCount ?? 0) > 0;
}
