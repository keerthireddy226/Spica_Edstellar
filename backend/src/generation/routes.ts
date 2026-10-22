// Staff: question generation, the review queue and set assembly. Mounted
// under /api/admin; everything needs the "Content review" permission.
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { recordAudit } from "../audit/service.js";
import { CEFR_LEVELS } from "../placement/cefr.js";
import { DOMAINS } from "../programs/service.js";
import { GENERATABLE_TYPES, SPECS } from "./specs.js";
import { GENERATION_MODEL, CHECK_MODEL } from "./gemini.js";
import { checkItem, startGenerationJob } from "./pipeline.js";
import { AssemblyError, assembleSet, assemblyPlan } from "./assembly.js";
import { itemStats } from "./stats.js";
import { generateScriptAudio } from "../voice/scriptAudio.js";

export const contentRouter = Router();

const uuid = z.string().uuid();

// Test types with a set to copy, and the generatable question types in them.
async function generatableTestTypes() {
  const r = await pool.query(
    `SELECT tt.id, tt.name, tt.cefr_min, tt.cefr_max, array_agg(DISTINCT ep.item_type_id) AS item_types
     FROM test_types tt
     JOIN exams e ON e.test_type_id = tt.id AND e.is_active
     JOIN exam_parts ep ON ep.exam_id = e.id
     WHERE tt.status = 'live' AND EXISTS (SELECT 1 FROM exam_families f WHERE f.id = tt.family_id AND f.active)
     GROUP BY tt.id ORDER BY tt.sort_order`,
  );
  return r.rows
    .map((t) => ({ id: t.id as string, name: t.name as string, cefrMin: t.cefr_min, cefrMax: t.cefr_max, itemTypes: (t.item_types as string[]).filter((x) => GENERATABLE_TYPES.includes(x)) }))
    .filter((t) => t.itemTypes.length > 0);
}

contentRouter.get("/content/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const testTypes = await generatableTestTypes();
    const bank = await pool.query(
      `SELECT item_type_id, cefr_level,
         count(*) FILTER (WHERE status = 'approved' AND exam_part_id IS NULL)::int AS unplaced,
         count(*) FILTER (WHERE status = 'approved' AND exam_part_id IS NULL AND mock_approved)::int AS unplaced_mock,
         count(*) FILTER (WHERE status = 'approved')::int AS approved
       FROM items WHERE item_type_id = ANY($1::text[]) GROUP BY 1, 2`,
      [GENERATABLE_TYPES],
    );
    const queue = await pool.query(
      `SELECT count(*) FILTER (WHERE review_state = 'needs_review')::int AS needs_review,
         count(*) FILTER (WHERE status = 'approved' AND NOT mock_approved AND review_state IS NULL AND pipeline_version = 'gen-v1')::int AS for_mock
       FROM items`,
    );
    const plans = await Promise.all(
      testTypes.map(async (t) => ({
        testTypeId: t.id,
        practice: await assemblyPlan(t.id, false).catch(() => null),
        mock: await assemblyPlan(t.id, true).catch(() => null),
      })),
    );
    const names = await pool.query(`SELECT id, name FROM item_types WHERE id = ANY($1::text[])`, [GENERATABLE_TYPES]);
    res.json({
      testTypes,
      itemTypeNames: Object.fromEntries(names.rows.map((r) => [r.id, r.name])),
      bank: bank.rows.map((r) => ({ itemTypeId: r.item_type_id, level: r.cefr_level, unplaced: r.unplaced, unplacedMock: r.unplaced_mock, approved: r.approved })),
      queue: queue.rows[0],
      plans,
      models: { generation: GENERATION_MODEL, check: CHECK_MODEL },
      ttsEnabled: !!process.env.GOOGLE_TTS_API_KEY,
      domains: DOMAINS,
    });
  } catch (err) {
    next(err);
  }
});

contentRouter.get("/content/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const r = await pool.query(
      `SELECT j.*, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS created_by_name
       FROM generation_jobs j LEFT JOIN users u ON u.id = j.created_by ORDER BY j.created_at DESC LIMIT 50`,
    );
    res.json({
      jobs: r.rows.map((j) => ({
        id: j.id,
        testTypeId: j.test_type_id,
        itemTypeId: j.item_type_id,
        level: j.cefr_level,
        domain: j.domain,
        requested: j.requested,
        produced: j.produced,
        passed: j.passed,
        failed: j.failed,
        model: j.model,
        inputTokens: Number(j.input_tokens),
        outputTokens: Number(j.output_tokens),
        status: j.status,
        error: j.error,
        createdBy: j.created_by_name,
        createdAt: j.created_at,
        finishedAt: j.finished_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const jobSchema = z.object({
  testTypeId: z.string().min(1).max(60),
  itemTypeId: z.string().min(1).max(60),
  level: z.enum(CEFR_LEVELS as [string, ...string[]]),
  domain: z.enum(DOMAINS).default("general"),
  count: z.number().int().min(1).max(50),
});

contentRouter.post("/content/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const body = jobSchema.parse(req.body);
    const tt = (await generatableTestTypes()).find((t) => t.id === body.testTypeId);
    if (!tt || !tt.itemTypes.includes(body.itemTypeId)) return res.status(400).json({ error: "not_generatable" });
    if (body.level < tt.cefrMin || body.level > tt.cefrMax) return res.status(400).json({ error: "level_out_of_range" });
    const j = await pool.query(
      `INSERT INTO generation_jobs (test_type_id, item_type_id, cefr_level, domain, requested, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [body.testTypeId, body.itemTypeId, body.level, body.domain, body.count, req.user!.id],
    );
    await recordAudit({
      tenantId: null,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "content.generation_started",
      targetType: "generation_job",
      targetId: j.rows[0].id,
      targetLabel: `${body.count} × ${body.itemTypeId} ${body.level}`,
      details: body,
      ip: req.ip ?? null,
    });
    startGenerationJob(j.rows[0].id);
    res.status(201).json({ id: j.rows[0].id });
  } catch (err) {
    next(err);
  }
});

const QUEUE_FILTERS: Record<string, string> = {
  needs_review: `i.review_state = 'needs_review'`,
  for_mock: `i.status = 'approved' AND NOT i.mock_approved AND i.review_state IS NULL AND i.pipeline_version = 'gen-v1'`,
  approved_before_review: `i.review_decision = 'grandfathered' AND i.status = 'approved'`,
  rejected: `i.review_state = 'rejected'`,
};

function itemJson(i: Record<string, unknown>) {
  return {
    id: i.id,
    itemTypeId: i.item_type_id,
    level: i.cefr_level,
    topic: i.topic,
    domain: i.domain,
    content: i.content,
    answerSet: i.answer_set,
    explanation: i.explanation,
    status: i.status,
    mockApproved: i.mock_approved,
    reviewState: i.review_state,
    reviewReason: i.review_reason,
    reviewDecision: i.review_decision,
    reviewNote: i.review_rationale,
    checks: i.filters_passed,
    pipeline: i.pipeline_version,
    placedIn: i.exam_code ?? null,
    // Which bank that set is in: practice set, mock bank or real-test bank.
    placedBank: i.exam_purpose ?? null,
    createdAt: i.created_at,
  };
}

contentRouter.get("/content/queue", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const state = z.enum(Object.keys(QUEUE_FILTERS) as [string, ...string[]]).parse(req.query.state ?? "needs_review");
    const itemTypeId = typeof req.query.itemTypeId === "string" && req.query.itemTypeId ? req.query.itemTypeId : null;
    const r = await pool.query(
      `SELECT i.*, e.code AS exam_code, e.purpose AS exam_purpose FROM items i
       LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id
       WHERE ${QUEUE_FILTERS[state]} AND ($1::text IS NULL OR i.item_type_id = $1)
       ORDER BY i.created_at DESC LIMIT 100`,
      [itemTypeId],
    );
    const stats = await itemStats(r.rows.map((x) => x.id));
    res.json({ items: r.rows.map((i) => ({ ...itemJson(i), stats: stats.get(i.id) ?? null })) });
  } catch (err) {
    next(err);
  }
});

contentRouter.get("/content/items/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "item_not_found" });
    const i = (
      await pool.query(
        `SELECT i.*, e.code AS exam_code, e.purpose AS exam_purpose FROM items i LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id WHERE i.id = $1`,
        [req.params.id],
      )
    ).rows[0];
    if (!i) return res.status(404).json({ error: "item_not_found" });
    const audio = await pool.query(`SELECT voice_id, accent, uri, duration_ms FROM item_audio WHERE item_id = $1 ORDER BY voice_id`, [i.id]);
    const stats = await itemStats([i.id]);
    res.json({ item: { ...itemJson(i), stats: stats.get(i.id) ?? null, audio: audio.rows.map((a) => ({ voice: a.voice_id, accent: a.accent, uri: a.uri, seconds: Math.round(a.duration_ms / 1000) })) } });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({
  decision: z.enum(["approve", "approve_mock", "remove_mock", "reject"]),
  note: z.string().trim().max(1000).optional(),
  // Edits made by the reviewer before deciding.
  content: z.record(z.string(), z.unknown()).optional(),
  answerSet: z.record(z.string(), z.unknown()).optional(),
  explanation: z.record(z.string(), z.unknown()).nullable().optional(),
});

contentRouter.post("/content/items/:id/decision", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "item_not_found" });
    const body = decisionSchema.parse(req.body);
    const i = (await pool.query(`SELECT * FROM items WHERE id = $1`, [req.params.id])).rows[0];
    if (!i) return res.status(404).json({ error: "item_not_found" });
    const content = body.content ?? i.content;
    const answerSet = body.answerSet ?? i.answer_set;
    const edited = !!(body.content || body.answerSet || body.explanation !== undefined);
    // An edited question must still have the right shape.
    if (edited && SPECS[i.item_type_id] && body.decision !== "reject") {
      const problems = SPECS[i.item_type_id].validate(content, answerSet);
      if (problems.length) return res.status(400).json({ error: "invalid_item", problems });
    }
    const approve = body.decision === "approve" || body.decision === "approve_mock";
    await pool.query(
      `UPDATE items SET content = $2, answer_set = $3, explanation = $4,
         status = CASE WHEN $5 = 'reject' THEN 'retired' WHEN $6 THEN 'approved' ELSE status END,
         mock_approved = CASE WHEN $5 = 'approve_mock' THEN true WHEN $5 IN ('remove_mock', 'reject') THEN false ELSE mock_approved END,
         review_state = CASE WHEN $5 = 'reject' THEN 'rejected' WHEN $6 THEN NULL ELSE review_state END,
         review_decision = $5, review_rationale = $7, reviewer_id = $8, reviewed_at = now(),
         embedding = CASE WHEN $9 THEN NULL ELSE embedding END, updated_at = now()
       WHERE id = $1`,
      [
        i.id,
        JSON.stringify(content),
        JSON.stringify(answerSet),
        body.explanation === undefined ? (i.explanation ? JSON.stringify(i.explanation) : null) : body.explanation ? JSON.stringify(body.explanation) : null,
        body.decision,
        approve,
        body.note ?? null,
        req.user!.id,
        !!body.content,
      ],
    );
    // A listening question approved without a recording (its checks stopped
    // early, or its script was edited) gets one now.
    if (approve && SPECS[i.item_type_id]?.maxAudioSeconds) {
      const has = await pool.query(`SELECT 1 FROM item_audio WHERE item_id = $1`, [i.id]);
      if (!has.rows[0] || (body.content && body.content.audio !== i.content.audio)) {
        await generateScriptAudio(i.id, String(content.audio), i.cefr_level).catch((err) => console.error("audio for approved item failed:", err));
      }
    }
    await recordAudit({
      tenantId: null,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: `content.item_${body.decision}`,
      targetType: "item",
      targetId: i.id,
      targetLabel: `${i.item_type_id} ${i.cefr_level ?? ""}`.trim(),
      details: { edited, note: body.note ?? null },
      ip: req.ip ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Runs the automatic checks again (after an edit, or a check that couldn't run).
contentRouter.post("/content/items/:id/recheck", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "item_not_found" });
    const i = (await pool.query(`SELECT item_type_id, status FROM items WHERE id = $1`, [req.params.id])).rows[0];
    if (!i || !SPECS[i.item_type_id]) return res.status(404).json({ error: "item_not_found" });
    if (i.status === "retired") return res.status(409).json({ error: "item_retired" });
    const r = await checkItem(String(req.params.id), { others: [] });
    res.json(r);
  } catch (err) {
    next(err);
  }
});

contentRouter.post("/content/assemble", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const body = z.object({ testTypeId: z.string().min(1).max(60), mockOnly: z.boolean().default(false) }).parse(req.body);
    const set = await assembleSet(body.testTypeId, { mockOnly: body.mockOnly });
    await recordAudit({
      tenantId: null,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "content.set_assembled",
      targetType: "exam",
      targetId: set.examId,
      targetLabel: set.testId,
      details: body,
      ip: req.ip ?? null,
    });
    res.status(201).json(set);
  } catch (err) {
    if (err instanceof AssemblyError) return res.status(409).json({ error: err.code, ...err.detail });
    next(err);
  }
});
