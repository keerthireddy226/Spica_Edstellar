import { mockLimits } from "../practiceTests/modes.js";
import { reviewQuestions } from "../reports/feedbackReport.js";
import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { submitAttemptSchema } from "../placement/schemas.js";
import { gradeAndSaveAttempt } from "../attemptGrading.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { pickDifficultySpread } from "../placement/routes.js";
import type { SkillTag } from "../placement/roadmapBuilder.js";
import { withAudioUrls } from "../voice/itemAudio.js";
import { toItemPayload } from "../itemPayload.js";
import { checkAndAwardBadges } from "../gamification/stats.js";
import { retryCounts, retryItems, RETRY_SET_SIZE } from "../learner/insights.js";
import { skillPath, updatePathAfterSet, pathLevels } from "../learner/path.js";

export const practiceRouter = Router();

const ALL_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const MIN_ITEMS = 1;
// Generous ceiling — actual results are capped by however many items exist.
const MAX_ITEMS = 40;
// Kept short (not the old 8) so "Start Practice" isn't a long same-feel grind.
const DEFAULT_ITEMS = 5;
// A single-type task from the Dashboard's "Today's Tasks" checklist — quick
// enough to feel like one bite-sized item, not a full session.
const DEFAULT_TASK_ITEMS = 3;

const startSessionSchema = z.object({
  skill: z.enum(["listening", "speaking", "reading", "writing"]),
  count: z.number().int().min(MIN_ITEMS).max(MAX_ITEMS).optional(),
  // Set for a single-type "Today's Tasks" row instead of spreading across all types.
  itemTypeId: z.string().optional(),
  // When set, the session is exactly this Set's items, in authored order —
  // a fixed lesson, not a spread/adaptive sample. Takes priority over count.
  setId: z.string().uuid().optional(),
  // A review set of this skill's questions answered wrong earlier.
  retry: z.boolean().optional(),
});

// Spreads `count` across the skill's item types and difficulty, preferring unseen items.
async function selectPracticeItems(userId: string, skill: SkillTag, count: number, itemTypeId?: string) {
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, i.difficulty, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds,
       EXISTS (
         SELECT 1 FROM attempts a JOIN sessions s ON s.id = a.session_id
         WHERE s.user_id = $1 AND a.item_id = i.id AND s.session_type = 'practice'
       ) AS previously_attempted
     FROM items i
     JOIN item_types it ON it.id = i.item_type_id
     WHERE i.status = 'approved' AND i.pool = 'practice' AND $2 = ANY(it.skills)
       -- A multi-skill type (e.g. conversations: speaking+listening) has its
       -- items partitioned by skill_tag so each skill draws its own
       -- non-overlapping subset; NULL means this item's type isn't
       -- partitioned (single-skill type), so it always matches.
       AND (i.skill_tag IS NULL OR i.skill_tag = $2)
       AND ($3::text IS NULL OR i.item_type_id = $3)
     ORDER BY i.item_type_id, i.difficulty ASC`,
    [userId, skill, itemTypeId ?? null],
  );

  const perType = new Map<string, (typeof result.rows)[number][]>();
  for (const row of result.rows) {
    const list = perType.get(row.item_type_id) ?? [];
    list.push(row);
    perType.set(row.item_type_id, list);
  }
  const types = [...perType.keys()];
  if (types.length === 0) return [];

  // Spread `count` as evenly as possible across the types that carry this
  // skill, capped per type by how many items that type actually has.
  const picksPerType = new Map<string, number>();
  let assigned = 0;
  const base = Math.floor(count / types.length);
  let remainder = count % types.length;
  for (const type of types) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    const want = Math.min(base + extra, perType.get(type)!.length);
    picksPerType.set(type, want);
    assigned += want;
  }
  // Some types were capped below their fair share — hand the shortfall to
  // any type that still has room, so a thin type doesn't shrink the session.
  let leftover = count - assigned;
  for (const type of types) {
    if (leftover <= 0) break;
    const cur = picksPerType.get(type)!;
    const room = perType.get(type)!.length - cur;
    const add = Math.min(leftover, room);
    if (add > 0) {
      picksPerType.set(type, cur + add);
      leftover -= add;
    }
  }

  const selected: (typeof result.rows)[number][] = [];
  for (const type of types) {
    const n = picksPerType.get(type) ?? 0;
    if (n === 0) continue;
    const rows = perType.get(type)!;
    const notAttempted = rows.filter((r) => !r.previously_attempted);
    const candidatePool = notAttempted.length >= n ? notAttempted : rows;
    selected.push(...pickDifficultySpread(candidatePool, n));
  }
  return selected;
}

// A Set's items in authored order (set_order, not created_at — a multi-row
// seed insert gives every row the same timestamp, so it can't break ties).
async function selectSetItems(setId: string) {
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.set_id = $1 AND i.status = 'approved'
     ORDER BY i.set_order ASC NULLS LAST, i.created_at ASC`,
    [setId],
  );
  return result.rows;
}

// Given questions, in the given order.
async function selectItemsById(ids: string[]) {
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[]) AND i.status = 'approved'`,
    [ids],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is (typeof result.rows)[number] => !!r);
}

// The live tests (of shown exam families) each question type is part of, so a
// sub-module can say which Versant tests it prepares for.
async function testsByType(): Promise<Map<string, { id: string; name: string }[]>> {
  const r = await pool.query(
    `SELECT ep.item_type_id, tt.id, tt.name, min(tt.sort_order) AS sort
     FROM exam_parts ep JOIN exams e ON e.id = ep.exam_id AND e.is_active
     JOIN test_types tt ON tt.id = e.test_type_id JOIN exam_families f ON f.id = tt.family_id AND f.active
     WHERE tt.status = 'live' GROUP BY ep.item_type_id, tt.id, tt.name ORDER BY sort`,
  );
  const m = new Map<string, { id: string; name: string }[]>();
  for (const x of r.rows) {
    const list = m.get(x.item_type_id) ?? [];
    list.push({ id: x.id, name: x.name });
    m.set(x.item_type_id, list);
  }
  return m;
}

// Each sub-module (question type) of a skill: how many sets it has, how many
// this learner finished and how many they started (feeds TypePicker).
practiceRouter.get("/types", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const skill = req.query.skill;
    if (typeof skill !== "string") return res.status(400).json({ error: "skill_required" });
    const r = await pool.query(
      `WITH s AS (
         SELECT st.id, u.item_type_id FROM sets st JOIN units u ON u.id = st.unit_id
         WHERE EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $2))
       )
       SELECT s.item_type_id, count(*)::int AS set_count,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM sessions se WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
             AND se.composition->>'setId' = s.id::text
         ))::int AS done,
         -- Opened and not finished yet.
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM sessions se
           WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NULL AND se.composition->>'setId' = s.id::text
         ))::int AS started
       FROM s GROUP BY s.item_type_id`,
      [req.user!.id, skill],
    );
    const tests = await testsByType();
    res.json({
      types: r.rows.map((x) => ({ itemTypeId: x.item_type_id, setCount: x.set_count, done: x.done, started: x.started, tests: tests.get(x.item_type_id) ?? [] })),
    });
  } catch (err) {
    next(err);
  }
});

// Units for one item type, with each unit's set count and completed count (feeds UnitPicker).
practiceRouter.get("/units", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const itemTypeId = req.query.itemTypeId;
    const skill = req.query.skill;
    if (typeof itemTypeId !== "string") return res.status(400).json({ error: "itemTypeId_required" });
    if (typeof skill !== "string") return res.status(400).json({ error: "skill_required" });
    const result = await pool.query(
      `SELECT u.id, u.name, u.order_index,
         count(DISTINCT s.id) FILTER (
           WHERE EXISTS (SELECT 1 FROM items i WHERE i.set_id = s.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $3))
         )::int AS set_count,
         count(DISTINCT s.id) FILTER (
           WHERE EXISTS (SELECT 1 FROM items i WHERE i.set_id = s.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $3))
             AND EXISTS (
               SELECT 1 FROM sessions se
               WHERE se.user_id = $2 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
                 AND se.composition->>'setId' = s.id::text
             )
         )::int AS completed_count
       FROM units u LEFT JOIN sets s ON s.unit_id = u.id
       WHERE u.item_type_id = $1
       GROUP BY u.id
       ORDER BY u.order_index`,
      [itemTypeId, req.user!.id, skill],
    );
    const pathLevel = ["listening", "speaking", "reading", "writing"].includes(skill)
      ? (await pathLevels(req.user!.id, skill as SkillTag, [itemTypeId])).get(itemTypeId)
      : undefined;
    res.json({
      // This learner's "My path" level in this type, to mark "You are here".
      pathLevel: pathLevel ?? null,
      // A unit can end up with 0 matching sets for this skill (e.g. an
      // uneven split) — filtered out rather than shown as an empty card.
      units: result.rows
        .filter((r) => r.set_count > 0)
        .map((r) => ({ id: r.id, name: r.name, setCount: r.set_count, completedCount: r.completed_count })),
    });
  } catch (err) {
    next(err);
  }
});

// Sets within one unit, each flagged completed or not (feeds SetPicker).
// Filtered by skill_tag so a multi-skill type (e.g. conversations) shows a
// different slice of sets per skill instead of the same ones for both.
practiceRouter.get("/units/:unitId/sets", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const skill = req.query.skill;
    if (typeof skill !== "string") return res.status(400).json({ error: "skill_required" });
    const result = await pool.query(
      `SELECT s.id, s.name, s.order_index,
         -- The learner's latest finished run of this set (skips included).
         (SELECT se.id FROM sessions se
          WHERE se.user_id = $2 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND se.composition->>'setId' = s.id::text
          ORDER BY se.completed_at DESC LIMIT 1) AS last_session_id,
         (SELECT se.composition->'itemIds' FROM sessions se
          WHERE se.user_id = $2 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND se.composition->>'setId' = s.id::text
          ORDER BY se.completed_at DESC LIMIT 1) AS last_item_ids,
         -- Opened and not finished yet.
         EXISTS (
           SELECT 1 FROM sessions se
           WHERE se.user_id = $2 AND se.session_type = 'practice' AND se.completed_at IS NULL AND se.composition->>'setId' = s.id::text
         ) AS in_progress
       FROM sets s
       WHERE s.unit_id = $1
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = s.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $3))
       ORDER BY s.order_index`,
      [req.params.unitId, req.user!.id, skill],
    );
    const sets = await Promise.all(
      result.rows.map(async (r) => {
        let lastResult: { right: number; total: number; skipped: number } | null = null;
        if (r.last_session_id) {
          const qs = await reviewQuestions(r.last_session_id, (r.last_item_ids as string[]) ?? []);
          const total = ((r.last_item_ids as string[]) ?? []).length || qs.length;
          lastResult = {
            right: qs.filter((q) => q.outcome === "right").length,
            // Questions with no answer row at all count as skipped too.
            skipped: total - qs.filter((q) => q.answered).length,
            total,
          };
        }
        return { id: r.id, name: r.name, completed: !!r.last_session_id, started: !!r.in_progress, lastResult };
      }),
    );
    res.json({ sets });
  } catch (err) {
    next(err);
  }
});

// Per-skill total/remaining counts — used by the skill picker and Today's Plan.
practiceRouter.get("/availability", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT unnest(it.skills) AS skill, count(DISTINCT i.id) AS total,
         count(DISTINCT a.item_id) FILTER (WHERE a.item_id IS NOT NULL) AS attempted
       FROM items i
       JOIN item_types it ON it.id = i.item_type_id
       LEFT JOIN attempts a ON a.item_id = i.id
         AND a.session_id IN (SELECT id FROM sessions WHERE user_id = $1 AND session_type = 'practice')
       WHERE i.status = 'approved' AND i.pool = 'practice'
       GROUP BY skill`,
      [req.user!.id],
    );
    const bySkill = new Map(result.rows.map((r) => [r.skill, r]));
    const availability = ALL_SKILLS.map((skill) => {
      const row = bySkill.get(skill);
      const total = row ? Number(row.total) : 0;
      const attempted = row ? Number(row.attempted) : 0;
      return { skill, total, remaining: Math.max(0, total - attempted) };
    });
    res.json({ availability });
  } catch (err) {
    next(err);
  }
});

// Shared by the resume-below (filtered by skill/type/set) and /session/current (no filter).
// Each question's countdown: the whole time for it (recordings played, reading,
// preparation and answering), as in a mock exam.
async function withQuestionTimes<T extends { id: string }>(items: T[]): Promise<(T & { questionSeconds: number | null })[]> {
  const limits = await mockLimits(items.map((i) => i.id));
  return items.map((i) => ({ ...i, questionSeconds: limits[i.id] ?? null }));
}

async function loadResumedSession(userId: string, sessionRow: { id: string; composition: Record<string, unknown> }) {
  const itemIds: string[] = (sessionRow.composition?.itemIds as string[]) ?? [];
  const itemsResult = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[])`,
    [itemIds],
  );
  const byId = new Map(itemsResult.rows.map((r) => [r.id, r]));
  // Marks which items were already answered so resuming doesn't rewind the on-screen pointer.
  const attemptsResult = await pool.query(`SELECT item_id, response_text FROM attempts WHERE session_id = $1`, [sessionRow.id]);
  const attemptByItem = new Map(attemptsResult.rows.map((r) => [r.item_id, r.response_text]));
  const resumedItems = itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      ...toItemPayload(row!),
      attempted: attemptByItem.has(row!.id),
      responseText: attemptByItem.get(row!.id) ?? null,
    }));
  return withQuestionTimes(await withAudioUrls(userId, resumedItems));
}

// Resumes any already-in-progress session instead of minting a new item set.
practiceRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = startSessionSchema.parse(req.body);
    const count = body.count ?? (body.itemTypeId ? DEFAULT_TASK_ITEMS : DEFAULT_ITEMS);

    // A Set-based session matches on setId alone (already fully specific).
    const existing = await pool.query(
      body.retry
        ? `SELECT id, composition FROM sessions
           WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
             AND composition->>'retry' = 'true' AND composition->>'skill' = $2
           ORDER BY started_at DESC LIMIT 1`
        : body.setId
        ? `SELECT id, composition FROM sessions
           WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
             AND composition->>'setId' = $2
           ORDER BY started_at DESC LIMIT 1`
        : `SELECT id, composition FROM sessions
           WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
             AND composition->>'skill' = $2
             AND composition->>'itemTypeId' IS NOT DISTINCT FROM $3
           ORDER BY started_at DESC LIMIT 1`,
      body.retry ? [req.user!.id, body.skill] : body.setId ? [req.user!.id, body.setId] : [req.user!.id, body.skill, body.itemTypeId ?? null],
    );
    if (existing.rows[0]) {
      const c = existing.rows[0].composition ?? {};
      return res.json({
        sessionId: existing.rows[0].id,
        skill: body.skill,
        items: await loadResumedSession(req.user!.id, existing.rows[0]),
        context: await contextOf(req.user!.id, c),
      });
    }

    const items = body.retry
      ? await selectItemsById((await retryItems(req.user!.id, body.skill)).slice(0, RETRY_SET_SIZE).map((x) => x.itemId))
      : body.setId
        ? await selectSetItems(body.setId)
        : await selectPracticeItems(req.user!.id, body.skill, count, body.itemTypeId);
    if (items.length === 0) {
      return res.status(404).json({ error: "no_practice_items_available" });
    }

    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition)
       VALUES ($1, 'practice', 'coach', $2) RETURNING id`,
      [
        req.user!.id,
        JSON.stringify({
          skill: body.skill,
          itemTypeId: body.itemTypeId ?? null,
          setId: body.setId ?? null,
          ...(body.retry ? { retry: true } : {}),
          itemIds: items.map((i) => i.id),
        }),
      ],
    );

    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
      skill: body.skill,
      items: await withQuestionTimes(await withAudioUrls(req.user!.id, items.map(toItemPayload))),
      context: body.retry
        ? { ...(await setContext(req.user!.id, null, body.skill, null)).context, retry: true }
        : (await setContext(req.user!.id, body.setId ?? null, body.skill, body.itemTypeId ?? (items[0]?.item_type_id as string) ?? null)).context,
    });
  } catch (err) {
    next(err);
  }
});

// Registered before /session/:sessionId — otherwise "current" would match as a sessionId value.
practiceRouter.get("/session/current", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT id, composition FROM sessions
       WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id],
    );
    if (!existing.rows[0]) return res.json({ inProgress: false });

    const c = existing.rows[0].composition ?? {};
    res.json({
      inProgress: true,
      sessionId: existing.rows[0].id,
      skill: c.skill ?? null,
      items: await loadResumedSession(req.user!.id, existing.rows[0]),
      context: await contextOf(req.user!.id, c),
    });
  } catch (err) {
    next(err);
  }
});

practiceRouter.get("/session/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `SELECT id, composition, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'practice'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });

    const itemIds: string[] = session.composition?.itemIds ?? [];
    const itemsResult = await pool.query(
      `SELECT i.id, i.item_type_id, i.content, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
       FROM items i JOIN item_types it ON it.id = i.item_type_id
       WHERE i.id = ANY($1::uuid[])`,
      [itemIds],
    );
    const byId = new Map(itemsResult.rows.map((r) => [r.id, r]));

    const attemptsResult = await pool.query(`SELECT item_id, response_text FROM attempts WHERE session_id = $1`, [
      session.id,
    ]);
    const attemptByItem = new Map(attemptsResult.rows.map((r) => [r.item_id, r.response_text]));

    const sessionItems = itemIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((row) => ({
        ...toItemPayload(row!),
        attempted: attemptByItem.has(row!.id),
        responseText: attemptByItem.get(row!.id) ?? null,
      }));

    const c = session.composition ?? {};
    res.json({
      sessionId: session.id,
      skill: c.skill ?? null,
      completed: !!session.completed_at,
      items: await withQuestionTimes(await withAudioUrls(req.user!.id, sessionItems)),
      context: await contextOf(req.user!.id, c),
    });
  } catch (err) {
    next(err);
  }
});

practiceRouter.post("/session/:sessionId/attempts", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = submitAttemptSchema.parse(req.body);

    const sessionResult = await pool.query(
      `SELECT id, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'practice'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });

    const graded = await gradeAndSaveAttempt(session.id, body);
    if (!graded) return res.status(404).json({ error: "item_not_found" });

    const { attemptId, grade, wasCorrect } = graded;
    const correct = grade.status === "scored" ? wasCorrect : grade.correct;
    res.status(201).json({ attemptId, status: grade.status, correct });
  } catch (err) {
    next(err);
  }
});

// Where a finished set sits: its sub-module, level and name, and the set to
// take next (the next one in the same sub-module and skill this learner hasn't
// finished, else simply the next one).
async function setContext(userId: string, setId: string | null, skill: string | null, itemTypeId: string | null) {
  const typeName = itemTypeId ? ((await pool.query(`SELECT name FROM item_types WHERE id = $1`, [itemTypeId])).rows[0]?.name ?? null) : null;
  const byType = await testsByType();
  if (!setId || !skill) return { context: { skill, itemTypeId, typeName, unitName: null, setName: null, tests: itemTypeId ? (byType.get(itemTypeId) ?? []) : [] }, next: null };
  const all = (
    await pool.query(
      `SELECT st.id, st.name, u.id AS unit_id, u.name AS unit_name, u.item_type_id, it.name AS type_name,
         EXISTS (
           SELECT 1 FROM sessions se WHERE se.user_id = $3 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
             AND se.composition->>'setId' = st.id::text
         ) AS done
       FROM sets st JOIN units u ON u.id = st.unit_id JOIN item_types it ON it.id = u.item_type_id
       WHERE u.item_type_id = (SELECT u2.item_type_id FROM sets s2 JOIN units u2 ON u2.id = s2.unit_id WHERE s2.id = $1)
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $2))
       ORDER BY u.order_index, st.order_index`,
      [setId, skill, userId],
    )
  ).rows;
  const at = all.findIndex((r) => r.id === setId);
  const cur = all[at];
  const after = at >= 0 ? all.slice(at + 1) : [];
  const nxt = after.find((r) => !r.done) ?? after[0] ?? null;
  return {
    context: {
      skill,
      itemTypeId: cur?.item_type_id ?? itemTypeId,
      typeName: cur?.type_name ?? typeName,
      unitName: cur?.unit_name ?? null,
      setName: cur?.name ?? null,
      tests: byType.get(cur?.item_type_id ?? itemTypeId ?? "") ?? [],
    },
    next: nxt ? { setId: nxt.id, setName: nxt.name, unitId: nxt.unit_id, unitName: nxt.unit_name } : null,
  };
}

// A session's context, flagged when it is a "mistakes to retry" review set.
async function contextOf(userId: string, c: Record<string, unknown>) {
  const { context } = await setContext(userId, (c.setId as string) ?? null, (c.skill as string) ?? null, (c.itemTypeId as string) ?? null);
  return { ...context, retry: c.retry === true };
}

// Sets of this level (unit) finished, for this skill.
async function unitProgress(userId: string, setId: string, skill: string) {
  const r = await pool.query(
    `SELECT u.name, count(st.id)::int AS total,
       count(st.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM sessions se WHERE se.user_id = $3 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND se.composition->>'setId' = st.id::text
       ))::int AS done
     FROM units u JOIN sets st ON st.unit_id = u.id
     WHERE u.id = (SELECT unit_id FROM sets WHERE id = $1)
       AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $2))
     GROUP BY u.name`,
    [setId, skill, userId],
  );
  const x = r.rows[0];
  return x ? { unitName: x.name as string, done: x.done as number, total: x.total as number, levelComplete: x.done >= x.total } : null;
}

// Outcome counts of one finished session (no answer row counts as skipped).
async function sessionCounts(sessionId: string, itemIds: string[]) {
  const qs = await reviewQuestions(sessionId, itemIds);
  const total = itemIds.length || qs.length;
  return {
    questions: qs,
    right: qs.filter((q) => q.outcome === "right").length,
    wrong: qs.filter((q) => q.outcome === "wrong").length,
    pending: qs.filter((q) => q.outcome === "pending").length,
    skipped: total - qs.filter((q) => q.answered).length,
    total,
  };
}

// Every finished Practice Modules session, newest first, for My reports.
practiceRouter.get("/history", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT se.id, se.completed_at, se.composition, it.name AS type_name, u.item_type_id, u.name AS unit_name, st.name AS set_name
       FROM sessions se
       LEFT JOIN sets st ON st.id::text = se.composition->>'setId'
       LEFT JOIN units u ON u.id = st.unit_id
       LEFT JOIN item_types it ON it.id = coalesce(u.item_type_id, se.composition->>'itemTypeId')
       WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
         AND jsonb_array_length(coalesce(se.composition->'itemIds', '[]'::jsonb)) > 0
       ORDER BY se.completed_at DESC LIMIT 300`,
      [req.user!.id],
    );
    const sessions = [];
    // A few at a time: each one reads its answers.
    for (let i = 0; i < r.rows.length; i += 10) {
      sessions.push(
        ...(await Promise.all(
          r.rows.slice(i, i + 10).map(async (x) => {
            const c = x.composition ?? {};
            const { questions: _q, ...counts } = await sessionCounts(x.id, c.itemIds ?? []);
            return {
              sessionId: x.id,
              completedAt: x.completed_at,
              skill: c.skill ?? null,
              itemTypeId: x.item_type_id ?? c.itemTypeId ?? null,
              typeName: x.type_name ?? null,
              unitName: x.unit_name ?? null,
              setName: x.set_name ?? null,
              retry: c.retry === true,
              ...counts,
            };
          }),
        )),
      );
    }
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

// One finished session's report: where it sits and every question with the
// learner's answer and the right one.
practiceRouter.get("/session/:sessionId/report", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const row = (
      await pool.query(`SELECT id, composition, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'practice'`, [
        req.params.sessionId,
        req.user!.id,
      ])
    ).rows[0];
    if (!row) return res.status(404).json({ error: "session_not_found" });
    if (!row.completed_at) return res.status(409).json({ error: "session_not_finished" });
    const c = row.composition ?? {};
    res.json({
      sessionId: row.id,
      completedAt: row.completed_at,
      context: await contextOf(req.user!.id, c),
      ...(await sessionCounts(row.id, c.itemIds ?? [])),
    });
  } catch (err) {
    next(err);
  }
});

// "My path" for one skill: each question type's level and progress there,
// and the set to do next.
practiceRouter.get("/path", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const skill = z.enum(["listening", "speaking", "reading", "writing"]).parse(req.query.skill);
    res.json(await skillPath(req.user!.id, skill));
  } catch (err) {
    next(err);
  }
});

// How many wrong answers wait for a retry, per skill.
practiceRouter.get("/retry", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ retry: await retryCounts(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// Unlike placement, completing a practice session never writes a placement
// or roadmap row — it's just a tally of how this set went.
practiceRouter.post("/session/:sessionId/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `UPDATE sessions SET completed_at = now()
       WHERE id = $1 AND user_id = $2 AND session_type = 'practice' AND completed_at IS NULL
       RETURNING id, composition`,
      [req.params.sessionId, req.user!.id],
    );
    if (!sessionResult.rows[0]) return res.status(404).json({ error: "session_not_found_or_already_completed" });
    const composition = sessionResult.rows[0].composition ?? {};

    const summaryResult = await pool.query(
      `SELECT sc.status, sc.content_score, sc.manner_scores, it.input_method, i.cefr_level
       FROM attempts a
       JOIN scores sc ON sc.attempt_id = a.id
       JOIN items i ON i.id = a.item_id
       JOIN item_types it ON it.id = i.item_type_id
       WHERE a.session_id = $1`,
      [req.params.sessionId],
    );
    const graded = summaryResult.rows.filter((r) => r.status === "scored");
    const correctCount = graded.filter((r) =>
      isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel),
    ).length;
    const pendingCount = summaryResult.rows.filter((r) => r.status === "pending").length;
    // Distinct from pending: an answer was given and grading was attempted,
    // but the AI call itself failed (rate limit, network error) — a
    // temporary service problem, not "you didn't answer enough."
    const failedCount = summaryResult.rows.filter((r) => r.status === "failed").length;

    const { newBadges, stats } = await checkAndAwardBadges(req.user!.id);
    const ctx = await setContext(req.user!.id, composition.setId ?? null, composition.skill ?? null, composition.itemTypeId ?? null);
    res.json({
      // For the "set done" moment: streak, new badges, how far through this
      // level, and a nudge up or down a level after two strong or weak sets.
      streakDays: stats.streakDays,
      newBadges,
      unitProgress: composition.setId ? await unitProgress(req.user!.id, composition.setId, composition.skill) : null,
      // "My path" moved up (level passed) or down (two weak sets) by this set.
      pathChange: composition.setId && !composition.retry ? await updatePathAfterSet(req.user!.id, composition.setId, composition.skill) : null,
      gradedCount: graded.length,
      correctCount,
      pendingCount,
      failedCount,
      questions: await reviewQuestions(req.params.sessionId as string, composition.itemIds ?? []),
      context: { ...ctx.context, retry: composition.retry === true },
      next: ctx.next,
    });
  } catch (err) {
    next(err);
  }
});
