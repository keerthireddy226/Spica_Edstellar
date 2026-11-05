// Checks that a question's language suits its CEFR level, on top of the
// general checks (checks.ts): its words against a CEFR word list, its length
// against the bank's questions of the same type and level, and a blind AI
// rating of its level and grammar (the AI isn't told the target level).
// The word and grammar lists come from CEFR-J and Octanove (data/NOTICE.md).
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { CHECK_MODEL, generateJson, type Usage } from "./gemini.js";
import { SPECS, itemText, type Json } from "./specs.js";
import type { CheckResult, Checks } from "./checks.js";
import { CEFR_WORDS } from "./data/cefrWords.js";
import { CEFR_GRAMMAR } from "./data/cefrGrammar.js";

const WORD_LEVEL = CEFR_WORDS as Record<string, CefrLevel>;
const rank = (l: string | null | undefined) => CEFR_LEVELS.indexOf((l ?? "") as CefrLevel);

// A word's level: the word itself, else its base form (plurals, past tenses,
// -ing, comparatives, contractions). null for words the lists don't hold
// (names, numbers, rare words).
export function wordLevel(word: string): CefrLevel | null {
  const w = word.toLowerCase().replace(/’/g, "'");
  const base = w.replace(/'(s|re|ve|ll|d|m|t)$/, "").replace(/n't$/, "");
  const forms = [w, base];
  for (const [end, add] of [
    ["ies", "y"],
    ["ied", "y"],
    ["ier", "y"],
    ["iest", "y"],
    ["es", ""],
    ["s", ""],
    ["ed", ""],
    ["ed", "e"],
    ["d", ""],
    ["ing", ""],
    ["ing", "e"],
    ["er", ""],
    ["er", "e"],
    ["est", ""],
    ["est", "e"],
    ["ly", ""],
  ] as const) {
    if (base.length > end.length + 2 && base.endsWith(end)) forms.push(base.slice(0, -end.length) + add);
  }
  // Doubled consonants: "stopped", "running", "bigger".
  const doubled = base.match(/^(.*?)([bdfgklmnprt])\2(ed|ing|er|est)$/);
  if (doubled) forms.push(doubled[1] + doubled[2]);
  let best: CefrLevel | null = null;
  for (const f of forms) {
    const l = WORD_LEVEL[f];
    if (l && (best === null || rank(l) < rank(best))) best = l;
  }
  return best;
}

// Words above the question's level. At most one word one level above is
// normal (a test sentence needs some stretch); two or more, or any word two
// levels above, fail. A C2 question has no ceiling.
export function vocabularyCheck(text: string, level: string): CheckResult {
  const target = rank(level);
  if (target < 0 || level === "C2") return { ok: true, notes: [] };
  // Capitalised words mid-sentence are taken as names.
  const tokens = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const above: { word: string; level: CefrLevel }[] = [];
  tokens.forEach((t, i) => {
    if (i > 0 && /^[A-Z]/.test(t) && !/[.!?:]\s*$/.test(text.slice(0, text.indexOf(t)))) return;
    for (const part of t.split("-")) {
      const l = wordLevel(part);
      if (l && rank(l) > target && !above.some((a) => a.word === part.toLowerCase())) above.push({ word: part.toLowerCase(), level: l });
    }
  });
  const far = above.filter((a) => rank(a.level) >= target + 2);
  const ok = far.length === 0 && above.length <= 1;
  return { ok, above, notes: ok ? [] : [`words above ${level}: ${above.map((a) => `${a.word} (${a.level})`).join(", ")}`] };
}

const words = (t: string) => (t.match(/[A-Za-z0-9'’-]+/g) ?? []).length;

// The question's length against the bank's questions of the same type and
// level (5th to 95th percentile), when there are at least 20 of them.
export async function lengthCheck(itemTypeId: string, level: string, content: Json, itemId?: string): Promise<CheckResult> {
  const r = await pool.query(`SELECT content FROM items WHERE item_type_id = $1 AND cefr_level = $2 AND status = 'approved' AND ($3::uuid IS NULL OR id <> $3)`, [
    itemTypeId,
    level,
    itemId ?? null,
  ]);
  if (r.rows.length < 20) return { ok: true, notes: ["not enough questions of this type and level to compare length"] };
  const lengths = r.rows.map((x) => words(itemText(x.content))).sort((a, b) => a - b);
  const lo = lengths[Math.floor(lengths.length * 0.05)];
  const hi = lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95))];
  const n = words(itemText(content));
  const ok = n >= lo && n <= hi;
  return { ok, words: n, range: [lo, hi], notes: ok ? [] : [`${n} words; questions of this type at ${level} have ${lo}-${hi}`] };
}

const BLIND_SCHEMA = {
  type: "object",
  properties: {
    estimatedLevel: { type: "string", enum: [...CEFR_LEVELS] },
    grammar: { type: "array", items: { type: "object", properties: { point: { type: "string" }, level: { type: "string", enum: [...CEFR_LEVELS] } }, required: ["point", "level"] } },
    reason: { type: "string" },
  },
  required: ["estimatedLevel", "grammar", "reason"],
};

// The grammar points each level adds (CEFR-J), as a guide for the rater.
const GRAMMAR_GUIDE = CEFR_LEVELS.map((l) => `${l}: ${(CEFR_GRAMMAR[l] ?? []).slice(0, 25).join("; ")}`).join("\n");

// The AI rates the question's level without being told the target, and lists
// the grammar points it needs with their levels. Fails when the estimate is
// more than one level from the target, or a grammar point is two or more
// levels above it.
export async function blindLevelCheck(itemTypeId: string, level: string, content: Json, usage: Usage): Promise<Checks> {
  const prompt = `You rate the CEFR level (A1-C2) of English test questions. Question type: ${SPECS[itemTypeId]?.brief ?? itemTypeId}

QUESTION (JSON):
${JSON.stringify(content)}

Rate the level a learner needs to understand and answer it: vocabulary, grammar, sentence length and, for recordings, how fast natural speech at that level is. List each grammar point the question uses with the CEFR level where learners usually master it. Grammar points by level (CEFR-J, for reference):
${GRAMMAR_GUIDE}`;
  const r = await generateJson<{ estimatedLevel: string; grammar: { point: string; level: string }[]; reason: string }>({ model: CHECK_MODEL, prompt, schema: BLIND_SCHEMA, temperature: 0 });
  usage.inputTokens += r.usage.inputTokens;
  usage.outputTokens += r.usage.outputTokens;
  const target = rank(level);
  const est = rank(r.data.estimatedLevel);
  const hard = (r.data.grammar ?? []).filter((g) => rank(g.level) >= target + 2 && level !== "C2");
  return {
    blindLevel: {
      ok: est >= 0 && Math.abs(est - target) <= 1,
      estimate: r.data.estimatedLevel,
      notes: est >= 0 && Math.abs(est - target) <= 1 ? [] : [`rated ${r.data.estimatedLevel} without knowing the target ${level}: ${r.data.reason}`],
    },
    grammar: { ok: hard.length === 0, points: r.data.grammar ?? [], notes: hard.map((g) => `${g.point} is ${g.level}, above ${level}`) },
  };
}

// Questions in use whose real difficulty doesn't fit their level: with
// enough answers, an average score nearer another level's average (of the
// same question type) by two or more levels.
export async function levelOrderProblems(minAnswers = 30): Promise<{ itemId: string; level: string; nearest: string; mean: number; n: number }[]> {
  const r = await pool.query(
    `SELECT a.item_id, i.item_type_id, i.cefr_level, count(*)::int AS n, avg(sc.content_score)::float AS mean
     FROM attempts a JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored' JOIN items i ON i.id = a.item_id
     WHERE i.status = 'approved' AND i.cefr_level IS NOT NULL
     GROUP BY a.item_id, i.item_type_id, i.cefr_level`,
  );
  const byType = new Map<string, Map<string, { sum: number; n: number }>>();
  for (const x of r.rows) {
    const t = byType.get(x.item_type_id) ?? new Map();
    const l = t.get(x.cefr_level) ?? { sum: 0, n: 0 };
    l.sum += x.mean * x.n;
    l.n += x.n;
    t.set(x.cefr_level, l);
    byType.set(x.item_type_id, t);
  }
  const out: { itemId: string; level: string; nearest: string; mean: number; n: number }[] = [];
  for (const x of r.rows) {
    if (x.n < minAnswers) continue;
    const levels = [...(byType.get(x.item_type_id) ?? new Map()).entries()].filter(([, v]) => v.n >= minAnswers).map(([l, v]) => [l, v.sum / v.n] as const);
    if (levels.length < 3) continue;
    const nearest = levels.sort((a, b) => Math.abs(a[1] - x.mean) - Math.abs(b[1] - x.mean))[0][0];
    if (Math.abs(rank(nearest) - rank(x.cefr_level)) >= 2) out.push({ itemId: x.item_id, level: x.cefr_level, nearest, mean: x.mean, n: x.n });
  }
  return out;
}
