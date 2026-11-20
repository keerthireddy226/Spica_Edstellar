// Model check set (owner request 20 Nov 2026): a fixed set of answers to
// practice questions, graded once by the AI model to make a baseline, then
// graded again every week. Google can change a model behind the same name; if
// the scores move (on average by more than 0.10, or more than 1 in 10 answers
// change between right and wrong), Super Admins are told before learners
// notice. Run it by hand before any model or prompt change:
//   npx tsx scripts/modelCheck.ts            (compare with the baseline)
//   npx tsx scripts/modelCheck.ts --baseline (make a new baseline)
// The set holds Spica's own practice questions and made-up answers only, no
// learner data.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { GEMINI_GRADING_MODEL, gradeWithAI } from "../placement/aiGrading.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { notify } from "../notifications/service.js";

export const BASELINE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../quality/model-check-baseline.json");
const TYPES = ["repeats", "sentence_builds", "conversations", "passage_reconstruction"] as const;
const PER_TYPE = 5;
export const DRIFT = { meanDiff: 0.1, flipShare: 0.1, failedShare: 0.2 };

export interface CheckCase {
  itemId: string;
  itemTypeId: string;
  cefrLevel: string | null;
  minWords: number | null;
  content: unknown;
  answerSet: unknown;
  variant: string;
  response: string;
  baseline?: number;
}
export interface Baseline {
  model: string;
  createdAt: string;
  cases: CheckCase[];
}

const dropEveryThird = (s: string) => s.split(/\s+/).filter((_, i) => i % 3 !== 2).join(" ");

// Three answers per question: the key (should score high), a damaged version
// (middle) and an off-topic one (low).
function variants(typeId: string, content: Record<string, any>, answers: Record<string, any> | null): { variant: string; response: string }[] {
  if (typeId === "repeats" && answers?.exact) return [{ variant: "key", response: answers.exact }, { variant: "partial", response: dropEveryThird(answers.exact) }, { variant: "off-topic", response: "I don't know the answer." }];
  if (typeId === "sentence_builds" && answers?.correct) {
    const scrambled = Array.isArray(content.groups) ? [...content.groups].reverse().join(" ") : dropEveryThird(answers.correct);
    return [{ variant: "key", response: answers.correct }, { variant: "partial", response: scrambled }, { variant: "off-topic", response: "Sorry, I didn't hear it." }];
  }
  if (typeId === "conversations" && Array.isArray(answers?.acceptable_answers) && answers.acceptable_answers[0]) return [{ variant: "key", response: answers.acceptable_answers[0] }, { variant: "off-topic", response: "My favourite colour is blue." }];
  if (typeId === "passage_reconstruction" && typeof content.passage === "string") {
    const first = content.passage.split(/(?<=[.!?])\s+/)[0];
    return [{ variant: "key", response: content.passage }, { variant: "partial", response: first }, { variant: "off-topic", response: "The weather is nice today." }];
  }
  return [];
}

export async function buildCases(): Promise<CheckCase[]> {
  const cases: CheckCase[] = [];
  for (const t of TYPES) {
    const r = await pool.query(
      `SELECT DISTINCT ON (i.cefr_level) i.id, i.item_type_id, i.cefr_level, i.content, i.answer_set, it.min_words
       FROM items i JOIN item_types it ON it.id = i.item_type_id
       WHERE i.item_type_id = $1 AND i.status = 'approved' AND i.pool = 'practice' AND i.cefr_level IS NOT NULL
       ORDER BY i.cefr_level, i.id`,
      [t],
    );
    for (const row of r.rows.slice(0, PER_TYPE)) {
      for (const v of variants(t, row.content ?? {}, row.answer_set)) {
        cases.push({ itemId: row.id, itemTypeId: t, cefrLevel: row.cefr_level, minWords: row.min_words, content: row.content, answerSet: row.answer_set, ...v });
      }
    }
  }
  return cases;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Paced (one call every 2 s) and retried, so a rate limit doesn't look like a
// model change.
async function grade(c: CheckCase): Promise<{ score: number } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 2_000 : 10_000 * attempt);
    const r = await gradeWithAI(c.itemTypeId, c.content, c.answerSet, c.cefrLevel, c.minWords, c.response, 60_000);
    if (r) return r;
  }
  return null;
}

export async function makeBaseline(): Promise<Baseline> {
  const cases = await buildCases();
  for (const c of cases) c.baseline = (await grade(c))?.score;
  const baseline = { model: GEMINI_GRADING_MODEL, createdAt: new Date().toISOString(), cases };
  await writeFile(BASELINE_FILE, JSON.stringify(baseline, null, 1) + "\n");
  return baseline;
}

export async function loadBaseline(): Promise<Baseline | null> {
  return JSON.parse(await readFile(BASELINE_FILE, "utf8").catch(() => "null"));
}

export interface CheckResult {
  model: string;
  baselineModel: string;
  cases: number;
  graded: number;
  failed: number;
  meanDiff: number;
  flips: { itemTypeId: string; variant: string; baseline: number; now: number }[];
  drift: boolean;
}

export function compare(baseline: Baseline, now: (number | null | undefined)[]): CheckResult {
  let sum = 0;
  let graded = 0;
  let failed = 0;
  const flips: CheckResult["flips"] = [];
  baseline.cases.forEach((c, i) => {
    const b = c.baseline;
    const n = now[i];
    if (typeof b !== "number") return;
    if (typeof n !== "number") {
      failed++;
      return;
    }
    graded++;
    sum += Math.abs(n - b);
    const bar = passThresholdForLevel(c.cefrLevel as never);
    if (b >= bar !== n >= bar) flips.push({ itemTypeId: c.itemTypeId, variant: c.variant, baseline: b, now: n });
  });
  const total = graded + failed;
  const meanDiff = graded ? Math.round((sum / graded) * 1000) / 1000 : 0;
  const drift = meanDiff > DRIFT.meanDiff || (graded > 0 && flips.length / graded > DRIFT.flipShare) || (total > 0 && failed / total > DRIFT.failedShare);
  return { model: GEMINI_GRADING_MODEL, baselineModel: baseline.model, cases: baseline.cases.length, graded, failed, meanDiff, flips, drift };
}

export async function runModelCheck(): Promise<CheckResult | null> {
  const baseline = await loadBaseline();
  if (!baseline?.cases?.length) return null;
  const now: (number | null)[] = [];
  for (const c of baseline.cases) now.push((await grade(c))?.score ?? null);
  return compare(baseline, now);
}

// The weekly run (Mondays): tells Super Admins when the scores have moved.
export async function weeklyModelCheck(now = new Date()): Promise<CheckResult | null> {
  if (now.getUTCDay() !== 1 || !process.env.GEMINI_API_KEY) return null;
  const result = await runModelCheck();
  if (!result) return null;
  console.log(`model check: ${result.graded} graded, ${result.failed} failed, mean change ${result.meanDiff}, ${result.flips.length} right/wrong changes${result.drift ? " — DRIFT" : ""}`);
  if (result.drift) {
    const supers = await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`);
    const week = now.toISOString().slice(0, 10);
    for (const { id } of supers.rows) {
      await notify({
        userId: id,
        kind: "escalation",
        title: "AI scoring has changed",
        body: `The weekly model check found scores moving: average change ${result.meanDiff} (limit ${DRIFT.meanDiff}), ${result.flips.length} of ${result.graded} answers changed between right and wrong, ${result.failed} not graded. Check before trusting new results, and record it in the AI Model Change Log.`,
        dedupeKey: `model-check:${week}:${id}`,
        email: true,
      });
    }
  }
  return result;
}
