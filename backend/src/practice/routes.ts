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
                 -- Every item answered with a real response, not skipped blank.
                 AND NOT EXISTS (
                   SELECT 1 FROM attempts a WHERE a.session_id = se.id AND a.response_text IS NULL AND a.response_uri IS NULL
                 )
             )
         )::int AS completed_count
       FROM units u LEFT JOIN sets s ON s.unit_id = u.id
       WHERE u.item_type_id = $1
       GROUP BY u.id
       ORDER BY u.order_index`,
      [itemTypeId, req.user!.id, skill],
    );
    res.json({
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
         EXISTS (
           SELECT 1 FROM sessions se
           WHERE se.user_id = $2 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
             AND se.composition->>'setId' = s.id::text
             -- Every item answered with a real response, not skipped blank —
             -- completed_at alone only means "reached the end of the list".
             AND NOT EXISTS (
               SELECT 1 FROM attempts a WHERE a.session_id = se.id AND a.response_text IS NULL AND a.response_uri IS NULL
             )
         ) AS completed
       FROM sets s
       WHERE s.unit_id = $1
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = s.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $3))
       ORDER BY s.order_index`,
      [req.params.unitId, req.user!.id, skill],
    );
    res.json({ sets: result.rows.map((r) => ({ id: r.id, name: r.name, completed: r.completed })) });
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
  return withAudioUrls(userId, resumedItems);
}

// Resumes any already-in-progress session instead of minting a new item set.
practiceRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = startSessionSchema.parse(req.body);
    const count = body.count ?? (body.itemTypeId ? DEFAULT_TASK_ITEMS : DEFAULT_ITEMS);

    // A Set-based session matches on setId alone (already fully specific).
    const existing = await pool.query(
      body.setId
        ? `SELECT id, composition FROM sessions
           WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
             AND composition->>'setId' = $2
           ORDER BY started_at DESC LIMIT 1`
        : `SELECT id, composition FROM sessions
           WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
             AND composition->>'skill' = $2
             AND composition->>'itemTypeId' IS NOT DISTINCT FROM $3
           ORDER BY started_at DESC LIMIT 1`,
      body.setId ? [req.user!.id, body.setId] : [req.user!.id, body.skill, body.itemTypeId ?? null],
    );
    if (existing.rows[0]) {
      return res.json({
        sessionId: existing.rows[0].id,
        skill: body.skill,
        items: await loadResumedSession(req.user!.id, existing.rows[0]),
      });
    }

    const items = body.setId
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
          itemIds: items.map((i) => i.id),
        }),
      ],
    );

    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
      skill: body.skill,
      items: await withAudioUrls(req.user!.id, items.map(toItemPayload)),
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

    res.json({
      inProgress: true,
      sessionId: existing.rows[0].id,
      skill: existing.rows[0].composition?.skill ?? null,
      items: await loadResumedSession(req.user!.id, existing.rows[0]),
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

    res.json({
      sessionId: session.id,
      skill: session.composition?.skill ?? null,
      completed: !!session.completed_at,
      items: await withAudioUrls(req.user!.id, sessionItems),
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

// Unlike placement, completing a practice session never writes a placement
// or roadmap row — it's just a tally of how this set went.
practiceRouter.post("/session/:sessionId/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `UPDATE sessions SET completed_at = now()
       WHERE id = $1 AND user_id = $2 AND session_type = 'practice' AND completed_at IS NULL
       RETURNING id`,
      [req.params.sessionId, req.user!.id],
    );
    if (!sessionResult.rows[0]) return res.status(404).json({ error: "session_not_found_or_already_completed" });

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

    await checkAndAwardBadges(req.user!.id);
    res.json({ gradedCount: graded.length, correctCount, pendingCount, failedCount });
  } catch (err) {
    next(err);
  }
});
