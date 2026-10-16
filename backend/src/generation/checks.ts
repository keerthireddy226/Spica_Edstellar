// Automatic checks on a generated question (ASSESSMENT_ENGINE.md section 6).
// Each one is recorded in items.filters_passed; a question that fails any
// goes to the review queue instead of being used.
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { CHECK_MODEL, cosine, embed, generateJson, type Usage } from "./gemini.js";
import { SPECS, answerIndexes, itemText, mcqQuestions, type Json } from "./specs.js";

export interface CheckResult {
  ok: boolean;
  notes?: string[];
  [k: string]: unknown;
}
export type Checks = Record<string, CheckResult>;

// Questions this similar to one already in the bank are near-duplicates.
// Measured on the bank (Oct 2026, gemini-embedding-001, 768 dimensions):
// different questions of a type score 0.69-0.79 (median) and at most
// 0.86-0.92 (two short speaking prompts on weekends); a copied question 1.0.
export const DUPLICATE_THRESHOLD = 0.92;

export function schemaCheck(itemTypeId: string, content: Json, answerSet: Json): CheckResult {
  const notes = SPECS[itemTypeId].validate(content ?? {}, answerSet ?? {});
  return { ok: notes.length === 0, notes };
}

const KEY_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chosen: { type: "integer", description: "Index (0-2) of the option you think is right." },
          alsoDefensible: { type: "array", items: { type: "integer" }, description: "Indexes of any OTHER option a careful expert could also defend as right." },
          note: { type: "string" },
        },
        required: ["chosen", "alsoDefensible"],
      },
    },
  },
  required: ["answers"],
};

// A second model answers the questions without the key. It must agree on
// every question, and no other option may be defensible.
export async function keyCheck(itemTypeId: string, content: Json, answerSet: Json, usage: Usage): Promise<CheckResult> {
  const qs = mcqQuestions(itemTypeId, content);
  if (qs.length === 0) return { ok: true, notes: ["no answer key for this type"] };
  const key = answerIndexes(itemTypeId, answerSet);
  const source = String(content.audio ?? content.passage ?? content.text ?? content.sentence ?? "");
  const kind = content.audio ? "recording script (learners hear it; they don't read it)" : "text";
  const prompt = `You are checking an English test question. Answer each question using only the ${kind} below. Then say whether any OTHER option could also be defended as correct by a careful expert.

${kind.toUpperCase()}:
${source}

QUESTIONS:
${qs.map((q, i) => `${i + 1}. ${q.stem}\n${q.options.map((o, j) => `   ${j}: ${o}`).join("\n")}`).join("\n")}`;
  const r = await generateJson<{ answers: { chosen: number; alsoDefensible: number[]; note?: string }[] }>({ model: CHECK_MODEL, prompt, schema: KEY_SCHEMA, temperature: 0 });
  usage.inputTokens += r.usage.inputTokens;
  usage.outputTokens += r.usage.outputTokens;
  const notes: string[] = [];
  qs.forEach((_, i) => {
    const a = r.data.answers?.[i];
    if (!a) notes.push(`question ${i + 1}: no answer from the checker`);
    else if (a.chosen !== key[i]) notes.push(`question ${i + 1}: checker chose ${a.chosen}, key says ${key[i]}${a.note ? ` (${a.note})` : ""}`);
    else if ((a.alsoDefensible ?? []).filter((x) => x !== key[i]).length) notes.push(`question ${i + 1}: option ${a.alsoDefensible.join(", ")} also defensible${a.note ? ` (${a.note})` : ""}`);
  });
  return { ok: notes.length === 0, notes };
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    estimatedLevel: { type: "string", enum: CEFR_LEVELS },
    sensitivity: { type: "array", items: { type: "string" }, description: "Problems: stereotypes, real brands or people, medical/legal/financial/political advice, upsetting content. Empty if none." },
    clarity: { type: "array", items: { type: "string" }, description: "Problems that make the question confusing, ambiguous, unnatural English or wrong for its type. Empty if none." },
  },
  required: ["estimatedLevel", "sensitivity", "clarity"],
};

// The language's CEFR level (within one of the target), sensitivity and clarity.
export async function reviewCheck(itemTypeId: string, level: string, content: Json, usage: Usage): Promise<Checks> {
  const prompt = `You review questions for an English test. Type: ${SPECS[itemTypeId].brief}
Target CEFR level: ${level}.

QUESTION (JSON):
${JSON.stringify(content)}

Estimate the CEFR level of the language a learner must understand (vocabulary, grammar, length, speed for recordings). List any sensitivity problems and any clarity problems; leave a list empty when there are none. British, American and Indian spellings are all acceptable.`;
  const r = await generateJson<{ estimatedLevel: string; sensitivity: string[]; clarity: string[] }>({ model: CHECK_MODEL, prompt, schema: REVIEW_SCHEMA, temperature: 0 });
  usage.inputTokens += r.usage.inputTokens;
  usage.outputTokens += r.usage.outputTokens;
  const est = CEFR_LEVELS.indexOf(r.data.estimatedLevel as CefrLevel);
  const target = CEFR_LEVELS.indexOf(level as CefrLevel);
  return {
    level: { ok: est >= 0 && Math.abs(est - target) <= 1, estimate: r.data.estimatedLevel, notes: est >= 0 && Math.abs(est - target) <= 1 ? [] : [`estimated ${r.data.estimatedLevel}, target ${level}`] },
    sensitivity: { ok: (r.data.sensitivity ?? []).length === 0, notes: r.data.sensitivity ?? [] },
    clarity: { ok: (r.data.clarity ?? []).length === 0, notes: r.data.clarity ?? [] },
  };
}

// Bank embeddings for this type, computing any missing ones first.
async function bankEmbeddings(itemTypeId: string): Promise<{ id: string; v: number[] }[]> {
  const missing = await pool.query(`SELECT id, content FROM items WHERE item_type_id = $1 AND embedding IS NULL AND status <> 'retired' LIMIT 500`, [itemTypeId]);
  if (missing.rows.length) {
    const vs = await embed(missing.rows.map((r) => itemText(r.content)));
    for (const [i, r] of missing.rows.entries()) await pool.query(`UPDATE items SET embedding = $2 WHERE id = $1`, [r.id, vs[i]]);
  }
  const r = await pool.query(`SELECT id, embedding FROM items WHERE item_type_id = $1 AND embedding IS NOT NULL AND status <> 'retired'`, [itemTypeId]);
  return r.rows.map((x) => ({ id: x.id, v: x.embedding }));
}

// Near-duplicates against the bank (and the rest of the batch, `others`).
export async function duplicateCheck(itemId: string, itemTypeId: string, vector: number[], others: { id: string; v: number[] }[]): Promise<CheckResult> {
  let best = { id: null as string | null, similarity: 0 };
  for (const b of [...(await bankEmbeddings(itemTypeId)), ...others]) {
    if (b.id === itemId) continue;
    const s = cosine(vector, b.v);
    if (s > best.similarity) best = { id: b.id, similarity: s };
  }
  const similarity = Math.round(best.similarity * 1000) / 1000;
  return {
    ok: similarity < DUPLICATE_THRESHOLD,
    similarity,
    nearestId: best.id,
    notes: similarity < DUPLICATE_THRESHOLD ? [] : [`${Math.round(similarity * 100)}% similar to question ${best.id}`],
  };
}

export function allPassed(checks: Checks): boolean {
  return Object.values(checks).every((c) => c.ok);
}

export function failedNames(checks: Checks): string[] {
  return Object.entries(checks)
    .filter(([, c]) => !c.ok)
    .map(([k]) => k);
}
