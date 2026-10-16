// Runs a generation job: write questions in batches, check each one, and
// approve it for practice only if every check passes. Anything else waits in
// the review queue; mocks always need a person (ASSESSMENT_ENGINE.md section 6).
import { pool } from "../db.js";
import { buildBrief } from "./brief.js";
import { GENERATION_MODEL, embed, generateJson, type Usage } from "./gemini.js";
import { SPECS, batchSchema, itemText, type GeneratedItem } from "./specs.js";
import { allPassed, duplicateCheck, failedNames, keyCheck, reviewCheck, schemaCheck, type Checks } from "./checks.js";
import { generateScriptAudio } from "../voice/scriptAudio.js";

const BATCH_SIZE = 5;
export const PIPELINE_VERSION = "gen-v1";
const DIFFICULTY: Record<string, number> = { A1: 0.1, A2: 0.25, B1: 0.45, B2: 0.6, C1: 0.75, C2: 0.9 };
// A running job silent this long was interrupted and is started again.
const STALE_MINUTES = 15;

interface JobRow {
  id: string;
  test_type_id: string;
  item_type_id: string;
  cefr_level: string;
  domain: string;
  requested: number;
  produced: number;
  status: string;
}

const runningHere = new Set<string>();

async function heartbeat(jobId: string, usage: Usage, delta: { produced?: number; passed?: number; failed?: number } = {}) {
  await pool.query(
    `UPDATE generation_jobs SET heartbeat_at = now(), input_tokens = input_tokens + $2, output_tokens = output_tokens + $3,
       produced = produced + $4, passed = passed + $5, failed = failed + $6 WHERE id = $1`,
    [jobId, usage.inputTokens, usage.outputTokens, delta.produced ?? 0, delta.passed ?? 0, delta.failed ?? 0],
  );
  usage.inputTokens = 0;
  usage.outputTokens = 0;
}

// Runs every check on one stored question and sets its status.
export async function checkItem(itemId: string, opts: { others?: { id: string; v: number[] }[]; usage?: Usage } = {}): Promise<{ passed: boolean; checks: Checks }> {
  const usage = opts.usage ?? { inputTokens: 0, outputTokens: 0 };
  const it = (await pool.query(`SELECT id, item_type_id, cefr_level, content, answer_set FROM items WHERE id = $1`, [itemId])).rows[0];
  const checks: Checks = { schema: schemaCheck(it.item_type_id, it.content, it.answer_set) };
  const run = async (name: string, f: () => Promise<Checks | Checks[string]>) => {
    try {
      const r = await f();
      if ("ok" in r && typeof r.ok === "boolean") checks[name] = r as Checks[string];
      else Object.assign(checks, r);
    } catch (err) {
      checks[name] = { ok: false, notes: [`check could not run: ${(err as Error).message}`] };
    }
  };
  if (checks.schema.ok) {
    await Promise.all([
      run("key", () => keyCheck(it.item_type_id, it.content, it.answer_set, usage)),
      run("review", () => reviewCheck(it.item_type_id, it.cefr_level, it.content, usage)),
      run("duplicate", async () => {
        const [v] = await embed([itemText(it.content)]);
        await pool.query(`UPDATE items SET embedding = $2 WHERE id = $1`, [it.id, v]);
        opts.others?.push({ id: it.id, v });
        return duplicateCheck(it.id, it.item_type_id, v, opts.others ?? []);
      }),
    ]);
    // Listening: record it (two voices for a dialogue) once everything else passed.
    const spec = SPECS[it.item_type_id];
    if (spec.maxAudioSeconds && allPassed(checks)) {
      await run("audio", async () => {
        const seconds = await generateScriptAudio(it.id, String(it.content.audio), it.cefr_level);
        if (seconds === null) return { ok: true, notes: ["no text-to-speech key: recorded later"] };
        return { ok: seconds <= spec.maxAudioSeconds!, seconds, notes: seconds <= spec.maxAudioSeconds! ? [] : [`${seconds} s, longer than ${spec.maxAudioSeconds} s`] };
      });
    }
  }
  const passed = allPassed(checks);
  await pool.query(
    `UPDATE items SET filters_passed = $2, status = $3, review_state = $4, review_reason = $5, updated_at = now() WHERE id = $1`,
    [it.id, JSON.stringify(checks), passed ? "approved" : "draft", passed ? null : "needs_review", passed ? null : `Failed: ${failedNames(checks).join(", ")}`],
  );
  return { passed, checks };
}

export async function runGenerationJob(jobId: string): Promise<void> {
  if (runningHere.has(jobId)) return;
  runningHere.add(jobId);
  try {
    const job: JobRow | undefined = (
      await pool.query(
        `UPDATE generation_jobs SET status = 'running', heartbeat_at = now(), model = $2 WHERE id = $1 AND status IN ('queued', 'running') RETURNING *`,
        [jobId, GENERATION_MODEL],
      )
    ).rows[0];
    if (!job) return;
    const tt = (await pool.query(`SELECT f.name FROM test_types t JOIN exam_families f ON f.id = t.family_id WHERE t.id = $1`, [job.test_type_id])).rows[0];
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    const batchVectors: { id: string; v: number[] }[] = [];
    let produced = job.produced;
    let rounds = 0;
    // A few extra rounds in case a batch comes back short.
    while (produced < job.requested && rounds < Math.ceil(job.requested / BATCH_SIZE) + 2) {
      rounds++;
      const count = Math.min(BATCH_SIZE, job.requested - produced);
      const prompt = await buildBrief({ itemTypeId: job.item_type_id, level: job.cefr_level, domain: job.domain, count, testTypeName: tt?.name ?? "English" });
      const r = await generateJson<{ items: GeneratedItem[] }>({ model: GENERATION_MODEL, prompt, schema: batchSchema(job.item_type_id), temperature: 1 });
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      const items = (r.data.items ?? []).slice(0, count);
      const ids: string[] = [];
      for (const g of items) {
        const ins = await pool.query(
          `INSERT INTO items (item_type_id, content, answer_set, explanation, cefr_level, difficulty, topic, domain, status, pool, pipeline_version, prompt_version, generation_job_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'exam', $9, $10, $11) RETURNING id`,
          [
            job.item_type_id,
            JSON.stringify(g.content ?? {}),
            JSON.stringify(g.answer_set ?? {}),
            g.explanation ? JSON.stringify(g.explanation) : null,
            job.cefr_level,
            DIFFICULTY[job.cefr_level],
            String(g.topic ?? "").slice(0, 80) || null,
            job.domain,
            PIPELINE_VERSION,
            GENERATION_MODEL,
            job.id,
          ],
        );
        ids.push(ins.rows[0].id);
      }
      await heartbeat(job.id, usage, { produced: ids.length });
      produced += ids.length;
      for (const id of ids) {
        const res = await checkItem(id, { others: batchVectors, usage });
        await heartbeat(job.id, usage, res.passed ? { passed: 1 } : { failed: 1 });
      }
    }
    await pool.query(`UPDATE generation_jobs SET status = 'done', finished_at = now() WHERE id = $1`, [job.id]);
  } catch (err) {
    console.error(`generation job ${jobId} failed:`, err);
    await pool.query(`UPDATE generation_jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1`, [jobId, String((err as Error).message ?? err).slice(0, 500)]);
  } finally {
    runningHere.delete(jobId);
  }
}

// Started outside the job queue's worker (a job takes minutes, and the
// worker waits for each round), so it never holds up grading.
export function startGenerationJob(jobId: string): void {
  void runGenerationJob(jobId);
}

// Jobs left queued or interrupted (a server restart) are started again; they
// continue from the questions already made.
export async function resumeStaleJobs(): Promise<number> {
  const r = await pool.query(
    `SELECT id FROM generation_jobs
     WHERE status = 'queued' OR (status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(mins => $1)))`,
    [STALE_MINUTES],
  );
  for (const { id } of r.rows) if (!runningHere.has(id)) startGenerationJob(id);
  return r.rows.length;
}
