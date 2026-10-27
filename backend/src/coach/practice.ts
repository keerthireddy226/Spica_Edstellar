// Coached practice in the AI Coach: the coach picks one practice-bank question
// for the learner, Spica's own scorer marks the answer, and the coach explains
// the result. Only Practice Modules questions are used (never mock or
// final-assessment questions).
import { pool } from "../db.js";
import type { SkillTag } from "../gamification/stats.js";
import { pathSummary, type Level } from "../learner/path.js";
import { adaptiveLevel } from "./adaptive.js";
import { recentTypeAccuracy, retryCounts, retryItems, weakestSkill } from "../learner/insights.js";
import { itemPayloads } from "../practice/routes.js";

// Listening, reading and writing: answered by typing or choosing, marked at
// once (choices, dictation) or by the AI grader within the request (writing).
// Speaking: recorded, marked in the background (the chat waits for the mark).
const TYPED_METHODS = ["radio", "text", "textarea", "mcq_group"];
export const methodsFor = (skill: SkillTag) => (skill === "speaking" ? ["mic"] : TYPED_METHODS);
export const COACH_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
// Coached questions a learner can get in a day (each answer costs AI calls).
export const COACH_DAILY_QUESTIONS = 30;

export async function questionsToday(userId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM coach_turns t JOIN sessions s ON s.id = t.session_id
     WHERE s.user_id = $1 AND t.payload->>'kind' = 'question' AND t.created_at > now() - interval '1 day'`,
    [userId],
  );
  return r.rows[0].n;
}

// This conversation's coached questions in one skill, oldest first, with each
// one's mark (null while unmarked or unanswered).
async function askedInSkill(coachSessionId: string, skill: SkillTag): Promise<{ level: string; typeId: string; correct: boolean | null }[]> {
  const rows = (await pool.query(`SELECT payload FROM coach_turns WHERE session_id = $1 AND payload IS NOT NULL ORDER BY turn_index`, [coachSessionId])).rows.map(
    (r) => r.payload as { kind: string; skill?: string; level?: string; item?: { id: string; itemTypeId: string }; itemId?: string; feedback?: { correct: boolean | null } | null },
  );
  const marks = new Map(rows.filter((p) => p.kind === "result" && p.itemId).map((p) => [p.itemId!, p.feedback?.correct ?? null]));
  return rows
    .filter((p) => p.kind === "question" && p.skill === skill && p.item)
    .map((p) => ({ level: p.level ?? "A1", typeId: p.item!.itemTypeId, correct: marks.get(p.item!.id) ?? null }));
}

// Practice Modules questions only: approved, in a practice set, not in any
// test, not approved for mock tests, and not from a hidden exam family.
const PRACTICE_ONLY = `i.status = 'approved' AND i.pool = 'practice' AND i.set_id IS NOT NULL AND i.exam_part_id IS NULL
  AND NOT coalesce(i.mock_approved, false) AND i.item_type_id NOT LIKE 'lc\\_%'`;

// The skill's question types that have coached questions, weakest first (by
// the learner's accuracy over 30 days; types not practised yet come after the
// weak ones, before the strong ones).
async function typesWeakestFirst(userId: string, skill: SkillTag): Promise<string[]> {
  const ids = (
    await pool.query(
      `SELECT DISTINCT i.item_type_id FROM items i JOIN item_types it ON it.id = i.item_type_id
       WHERE ${PRACTICE_ONLY} AND it.input_method = ANY($1::text[]) AND $2 = ANY(it.skills) AND (i.skill_tag IS NULL OR i.skill_tag = $2)`,
      [methodsFor(skill), skill],
    )
  ).rows.map((r) => r.item_type_id as string);
  const acc = new Map((await recentTypeAccuracy(userId)).filter((t) => t.skill === skill && t.graded >= 2).map((t) => [t.itemTypeId, t.correct / t.graded]));
  return ids.sort((a, b) => (acc.get(a) ?? 0.6) - (acc.get(b) ?? 0.6));
}

// One question for the learner, from this conversation's history:
// - Retry my mistakes: the oldest mistake waiting in the skill (the one with
//   the most waiting when none is chosen).
// - Otherwise: the chosen skill or the weakest one; the level adapts to the
//   last answers; the weakest question type first, then the next weakest not
//   asked in the last two questions; a question not answered in 30 days.
export async function pickCoachQuestion(
  userId: string,
  coachSessionId: string,
  opts: { skill?: SkillTag; retry?: boolean },
): Promise<{ itemId: string; skill: SkillTag; level: Level; retry: boolean } | null> {
  let retrySkill: SkillTag | undefined;
  if (opts.retry && !opts.skill) {
    const counts = await retryCounts(userId);
    const most = COACH_SKILLS.reduce((a, b) => (counts[b] > counts[a] ? b : a));
    if (counts[most] > 0) retrySkill = most;
  }
  const skill = opts.skill ?? retrySkill ?? (await weakestSkill(userId, await recentTypeAccuracy(userId), COACH_SKILLS));
  const pathLevel = (await pathSummary(userId))[skill] ?? "A1";
  const asked = await askedInSkill(coachSessionId, skill);

  if (opts.retry) {
    // retryItems is oldest first: the first one that can be answered here.
    const waiting = (await retryItems(userId, skill)).map((x) => x.itemId);
    if (waiting.length) {
      const r = await pool.query(
        `SELECT i.id, i.cefr_level FROM items i JOIN item_types it ON it.id = i.item_type_id
         WHERE i.id = ANY($1::uuid[]) AND it.input_method = ANY($2::text[])
         ORDER BY array_position($1::uuid[], i.id) LIMIT 1`,
        [waiting, methodsFor(skill)],
      );
      if (r.rows[0]) return { itemId: r.rows[0].id, skill, level: (r.rows[0].cefr_level as Level) ?? pathLevel, retry: true };
    }
  }

  const level = adaptiveLevel(pathLevel, asked);
  const recentTypes = asked.slice(-2).map((a) => a.typeId);
  const types = await typesWeakestFirst(userId, skill);
  const preferred = types.find((t) => !recentTypes.includes(t)) ?? types[0] ?? null;

  const pick = async (typeId: string | null, atLevel: string | null, unseen: boolean) =>
    (
      await pool.query(
        `SELECT i.id FROM items i JOIN item_types it ON it.id = i.item_type_id
         WHERE ${PRACTICE_ONLY}
           AND it.input_method = ANY($2::text[]) AND $3 = ANY(it.skills) AND (i.skill_tag IS NULL OR i.skill_tag = $3)
           AND ($4::text IS NULL OR i.cefr_level = $4) AND ($6::text IS NULL OR i.item_type_id = $6)
           AND (NOT $5 OR NOT EXISTS (
             SELECT 1 FROM attempts a JOIN sessions s ON s.id = a.session_id
             WHERE s.user_id = $1 AND a.item_id = i.id AND a.submitted_at > now() - interval '30 days'))
         ORDER BY random() LIMIT 1`,
        [userId, methodsFor(skill), skill, atLevel, unseen, typeId],
      )
    ).rows[0]?.id as string | undefined;
  const id =
    (await pick(preferred, level, true)) ??
    (await pick(null, level, true)) ??
    (await pick(preferred, level, false)) ??
    (await pick(null, level, false)) ??
    (await pick(null, null, true)) ??
    (await pick(null, null, false));
  return id ? { itemId: id, skill, level, retry: false } : null;
}

// The hidden practice session a coached answer is saved in, one per skill per
// coach conversation, so the answer counts like Practice Modules practice
// (accuracy, mistakes to retry, streak) without showing up as a module set.
export async function coachPracticeSession(userId: string, coachSessionId: string, skill: SkillTag, itemId: string): Promise<string> {
  const open = (
    await pool.query(
      `SELECT id FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
         AND composition->>'coach' = 'true' AND composition->>'coachSessionId' = $2 AND composition->>'skill' = $3 LIMIT 1`,
      [userId, coachSessionId, skill],
    )
  ).rows[0];
  if (open) {
    await pool.query(
      `UPDATE sessions SET composition = jsonb_set(composition, '{itemIds}', coalesce(composition->'itemIds', '[]'::jsonb) || to_jsonb($2::text)) WHERE id = $1`,
      [open.id, itemId],
    );
    return open.id;
  }
  const composition = { coach: true, coachSessionId, skill, itemIds: [itemId] };
  return (await pool.query(`INSERT INTO sessions (user_id, session_type, mode, composition) VALUES ($1, 'practice', 'coach', $2) RETURNING id`, [userId, composition]))
    .rows[0].id;
}

export async function questionPayload(userId: string, itemId: string) {
  const [item] = await itemPayloads(userId, [itemId]);
  if (!item) return null;
  const meta = (await pool.query(`SELECT it.name, i.cefr_level FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.id = $1`, [itemId])).rows[0];
  return { item, typeName: meta?.name as string, level: meta?.cefr_level as string | null };
}

// What the coach needs to explain a result: the question as text, the right
// answer as text, and the stored explanation when there is one.
export async function questionForExplanation(itemId: string) {
  const r = (
    await pool.query(
      `SELECT i.content, i.answer_set, i.explanation, it.name AS type_name, it.input_method FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.id = $1`,
      [itemId],
    )
  ).rows[0];
  if (!r) return null;
  const c = (r.content ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const options = Array.isArray(c.options) ? (c.options as unknown[]).map(str) : [];
  const question = [str(c.passage), str(c.text), str(c.sentence), str(c.question), str(c.prompt), str(c.situation), str(c.audio_transcript ?? c.audio)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
  const a = (r.answer_set ?? {}) as Record<string, unknown>;
  const right =
    typeof a.correctIndex === "number"
      ? (options[a.correctIndex] ?? String(a.correctIndex + 1))
      : typeof a.exact === "string"
        ? a.exact
        : Array.isArray(a.acceptable_answers)
          ? String(a.acceptable_answers[0] ?? "")
          : typeof a.correct === "string"
            ? a.correct
            : Array.isArray(a.key_points)
              ? (a.key_points as string[]).join("; ")
              : "";
  const why = r.explanation && typeof r.explanation === "object" && typeof (r.explanation as { why?: unknown }).why === "string" ? (r.explanation as { why: string }).why : "";
  return { typeName: r.type_name as string, inputMethod: r.input_method as string, question, options, right, why };
}
