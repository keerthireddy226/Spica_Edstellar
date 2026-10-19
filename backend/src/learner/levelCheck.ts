// The Level check: a short adaptive test of one skill. It starts at the
// learner's current path level for the skill, asks questions of that level
// until two are right (pass: go up) or two are wrong (fail: go down), and
// stops when a level is passed and the one above it failed. The result sets
// the skill's path level for every question type. Answers are judged on the
// spot without AI (option picked, typed text, or the browser's transcript),
// so the next question never waits for a grader.
import { pool } from "../db.js";
import { wordDiff, diffSummary } from "../reports/wordDiff.js";
import type { SkillTag } from "../gamification/stats.js";
import { LEVELS, pathLevels, type Level } from "./path.js";

export const MAX_CHECK_QUESTIONS = 12;

// Question types each check uses, all judged without AI, with the skill tag
// their items carry (null: the type isn't split by skill).
export const CHECK_TYPES: Record<SkillTag, { type: string; tag: string | null }[]> = {
  listening: [
    { type: "response_selection", tag: null },
    { type: "conversations", tag: "listening" },
    { type: "dictation", tag: "listening" },
    { type: "short_answer", tag: "listening" },
  ],
  speaking: [
    { type: "repeats", tag: "speaking" },
    { type: "reading", tag: "speaking" },
    { type: "sentence_builds", tag: "speaking" },
  ],
  reading: [
    { type: "reading_comprehension", tag: null },
    { type: "reading_selective", tag: "reading" },
  ],
  writing: [
    { type: "sentence_completion", tag: null },
    { type: "dictation", tag: "writing" },
  ],
};

const rank = (l: string) => LEVELS.indexOf(l as Level);
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Right or wrong, judged at once from the answer text.
export function quickJudge(itemTypeId: string, content: Record<string, unknown>, answerSet: Record<string, unknown> | null, response: string | undefined): boolean {
  const said = normalize(response ?? "");
  if (!said) return false;
  const set = answerSet ?? {};
  if (typeof set.correctIndex === "number") return Number(response) === set.correctIndex;
  if (Array.isArray(set.acceptable_answers)) {
    // A spoken or typed short answer: the whole answer, or inside a sentence.
    return set.acceptable_answers.some((a) => {
      const n = normalize(String(a));
      return n && (said === n || ` ${said} `.includes(` ${n} `));
    });
  }
  const targets = [set.exact, set.correct, ...(Array.isArray(set.alternates) ? set.alternates : []), itemTypeId === "reading" ? content.text : undefined].filter(
    (x): x is string => typeof x === "string" && !!x.trim(),
  );
  if (!targets.length) return false;
  // Typed dictation must be near-exact; spoken answers allow for the transcript.
  const bar = itemTypeId === "dictation" ? 0.95 : 0.8;
  return targets.some((t) => diffSummary(wordDiff(t, response ?? "")).accuracy >= bar);
}

export interface CheckAnswer {
  itemId: string;
  level: Level;
  right: boolean;
}

export type CheckDecision = { done: false; level: Level } | { done: true; result: Level };

// Where the check goes next, from the answers so far. At each level, 2 right
// passes it and 2 wrong fail it (so 2 or 3 questions per level).
export function decide(start: Level, answers: CheckAnswer[]): CheckDecision {
  const passed = new Set<Level>();
  const failed = new Set<Level>();
  let cur = start;
  let right = 0;
  let wrong = 0;
  for (const a of answers) {
    if (a.level !== cur) continue;
    if (a.right) right++;
    else wrong++;
    if (right < 2 && wrong < 2) continue;
    const pass = right >= 2;
    right = 0;
    wrong = 0;
    if (pass) {
      passed.add(cur);
      if (cur === "C2" || failed.has(LEVELS[rank(cur) + 1])) return { done: true, result: cur };
      cur = LEVELS[rank(cur) + 1];
    } else {
      failed.add(cur);
      if (cur === "A1") return { done: true, result: "A1" };
      const below = LEVELS[rank(cur) - 1];
      if (passed.has(below)) return { done: true, result: below };
      cur = below;
    }
  }
  if (answers.length >= MAX_CHECK_QUESTIONS) return { done: true, result: settle(passed, cur) };
  return { done: false, level: cur };
}

// Stopping early (out of questions): the highest level passed, else one
// below the level being tried.
export function settleCheck(start: Level, answers: CheckAnswer[]): Level {
  const d = decide(start, [...answers, ...Array.from({ length: MAX_CHECK_QUESTIONS }, () => ({ itemId: "", level: "Z" as Level, right: false }))]);
  return d.done ? d.result : d.level;
}

function settle(passed: Set<Level>, cur: Level): Level {
  const best = [...passed].sort((a, b) => rank(b) - rank(a))[0];
  return best ?? LEVELS[Math.max(0, rank(cur) - 1)];
}

// A question for the check at this level: not yet in this check, preferring
// ones the learner hasn't met, rotating through the check's question types.
export async function pickCheckItem(userId: string, skill: SkillTag, level: Level, usedItemIds: string[], usedTypes: string[]) {
  const types = CHECK_TYPES[skill];
  const r = await pool.query(
    `SELECT i.id, i.item_type_id,
       EXISTS (SELECT 1 FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = $1 AND a.item_id = i.id) AS seen
     FROM items i
     WHERE i.status = 'approved' AND i.pool = 'practice' AND i.cefr_level = $2 AND i.set_id IS NOT NULL
       AND NOT (i.id = ANY($3::uuid[]))
       AND (i.item_type_id, coalesce(i.skill_tag, '')) IN (SELECT * FROM unnest($4::text[], $5::text[]))`,
    [userId, level, usedItemIds, types.map((t) => t.type), types.map((t) => t.tag ?? "")],
  );
  if (!r.rows.length) return null;
  const typeUse = (t: string) => usedTypes.filter((x) => x === t).length;
  const pool_ = r.rows.filter((x) => !x.seen).length ? r.rows.filter((x) => !x.seen) : r.rows;
  const leastUsed = Math.min(...pool_.map((x) => typeUse(x.item_type_id)));
  const choices = pool_.filter((x) => typeUse(x.item_type_id) === leastUsed);
  return choices[Math.floor(Math.random() * choices.length)].id as string;
}

// Where a skill's check starts: the level most of its types are at.
export async function checkStartLevel(userId: string, skill: SkillTag): Promise<Level> {
  const types = (await pool.query(`SELECT id FROM item_types WHERE $1 = ANY(skills)`, [skill])).rows.map((r) => r.id as string);
  const levels = [...(await pathLevels(userId, skill, types)).values()];
  const counts = new Map<Level, number>();
  for (const l of levels) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]?.[0] ?? "A1";
}

// The check's result becomes the path level of every question type in the skill.
export async function applyCheckResult(userId: string, skill: SkillTag, level: Level) {
  const types = (
    await pool.query(
      `SELECT DISTINCT u.item_type_id FROM units u JOIN item_types it ON it.id = u.item_type_id WHERE $1 = ANY(it.skills)`,
      [skill],
    )
  ).rows.map((r) => r.item_type_id as string);
  await pool.query(
    `INSERT INTO learner_type_levels (user_id, item_type_id, skill, level, source)
     SELECT $1, unnest($2::text[]), $3, $4, 'check'
     ON CONFLICT (user_id, item_type_id, skill) DO UPDATE SET level = EXCLUDED.level, source = 'check', updated_at = now()`,
    [userId, types, skill, level],
  );
}
