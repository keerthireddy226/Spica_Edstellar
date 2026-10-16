// Staff: the question library and the test builder. Mounted under /api/admin;
// Super Admins and Admins with the "Content review" permission only. Org
// Admins, Managers and Recruiters never build tests; they use published ones.
import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { recordAudit } from "../audit/service.js";
import { pool } from "../db.js";
import { CEFR_LEVELS } from "../placement/cefr.js";
import { SOURCES, itemUsage, listLibrary } from "./library.js";
import { planCounts, testTypeLayout, type Layout } from "./layout.js";
import { createTest, createTestSchema } from "./autoBuild.js";
import { FormError, autofill, createForm, fillSchema, formSchema, formSeconds, getForm, listForms, publishForm, retireForm, updateForm } from "./forms.js";

export const builderRouter = Router();

const uuid = z.string().uuid();
const level = z.enum(CEFR_LEVELS as [string, ...string[]]).optional();

const FORM_ERROR_STATUS: Record<FormError["code"], number> = {
  unknown_test_type: 404,
  form_not_found: 404,
  not_draft: 409,
  empty_section: 400,
  wrong_type: 400,
  not_approved: 400,
  not_mock_approved: 400,
  duplicate_item: 400,
};

function formError(err: unknown, res: Response): boolean {
  if (!(err instanceof FormError)) return false;
  res.status(FORM_ERROR_STATUS[err.code]).json({ error: err.code, ...err.detail });
  return true;
}

const sectionTimers = (l: Layout) => Object.fromEntries(l.sections.map((s) => [String(s.sortOrder), s.timerSeconds]));

const listOf = (v: unknown) => (typeof v === "string" && v ? v.split(",") : undefined);

const librarySchema = z.object({
  family: z.enum(["versant", "languagecert"]).optional(),
  testTypeId: z.string().max(60).optional(),
  itemTypeId: z.string().max(60).optional(),
  skill: z.enum(["listening", "speaking", "reading", "writing"]).optional(),
  levelMin: level,
  levelMax: level,
  domain: z.string().max(40).optional(),
  sources: z.array(z.enum(SOURCES)).optional(),
  status: z.enum(["approved", "draft", "retired"]).optional(),
  mockApproved: z.enum(["true", "false"]).optional(),
  q: z.string().max(200).optional(),
  exclude: z.array(z.string().uuid()).max(500).optional(),
  ids: z.array(z.string().uuid()).max(500).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  // Questions from this field first (the builder's picker).
  preferDomain: z.string().max(40).optional(),
  page: z.coerce.number().int().min(0).max(10_000).default(0),
});

// Every question in the bank, filtered.
builderRouter.get("/content/library", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const q = req.query as Record<string, string | undefined>;
    const f = librarySchema.parse({
      ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== "" && v !== undefined)),
      sources: listOf(q.sources),
      exclude: listOf(q.exclude),
      ids: listOf(q.ids),
    });
    res.json(
      await listLibrary(
        {
          family: f.family,
          testTypeId: f.testTypeId,
          itemTypeId: f.itemTypeId,
          skill: f.skill,
          levelMin: f.levelMin,
          levelMax: f.levelMax,
          domain: f.domain,
          sources: f.sources,
          status: f.status,
          mockApproved: f.mockApproved === undefined ? undefined : f.mockApproved === "true",
          q: f.q,
          excludeIds: f.exclude,
          ids: f.ids,
        },
        f.page,
        f.pageSize,
        f.preferDomain,
      ),
    );
  } catch (err) {
    next(err);
  }
});

builderRouter.get("/content/items/:id/usage", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "item_not_found" });
    const u = await itemUsage(String(req.params.id));
    if (!u) return res.status(404).json({ error: "item_not_found" });
    res.json(u);
  } catch (err) {
    next(err);
  }
});

// Test types grouped by exam family, with their layout, for the builder.
builderRouter.get("/content/builder/test-types", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const r = await pool.query(
      `SELECT tt.id, tt.name, tt.duration_minutes, tt.cefr_min, tt.cefr_max, f.id AS family_id, f.name AS family_name
       FROM test_types tt JOIN exam_families f ON f.id = tt.family_id
       WHERE tt.status = 'live' AND EXISTS (SELECT 1 FROM exams e WHERE e.test_type_id = tt.id AND e.is_active)
       ORDER BY f.sort_order, tt.sort_order`,
    );
    res.json({
      testTypes: r.rows.map((t) => ({ id: t.id, name: t.name, officialMinutes: t.duration_minutes, cefrMin: t.cefr_min, cefrMax: t.cefr_max, familyId: t.family_id, familyName: t.family_name })),
    });
  } catch (err) {
    next(err);
  }
});

// The sections and question counts for a duration.
builderRouter.get("/content/builder/plan", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const q = z.object({ testTypeId: z.string().min(1).max(60), durationMinutes: z.coerce.number().int().min(5).max(300) }).parse(req.query);
    const layout = await testTypeLayout(q.testTypeId);
    if (!layout) return res.status(404).json({ error: "unknown_test_type" });
    const names = await pool.query(`SELECT id, name FROM item_types WHERE id = ANY($1::text[])`, [layout.sections.map((s) => s.itemTypeId)]);
    const plan = planCounts(layout, q.durationMinutes);
    res.json({
      officialMinutes: layout.officialMinutes,
      cefrMin: layout.cefrMin,
      cefrMax: layout.cefrMax,
      plannedSeconds: plan.plannedSeconds,
      sections: layout.sections.map((s) => {
        const p = plan.sections.find((x) => x.sortOrder === s.sortOrder)!;
        return {
          sortOrder: s.sortOrder,
          label: s.label,
          itemTypeId: s.itemTypeId,
          typeName: names.rows.find((n) => n.id === s.itemTypeId)?.name ?? s.itemTypeId,
          officialCount: s.officialCount,
          count: p.count,
          avgSeconds: s.avgSeconds,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

builderRouter.post("/content/builder/autofill", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const r = await autofill(fillSchema.parse(req.body));
    res.json({ sections: r.chosen, missing: r.missing, seconds: await formSeconds(r.chosen, sectionTimers(r.layout)) });
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});

// Seconds for a set of chosen questions (the builder's running total).
builderRouter.post("/content/builder/seconds", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const b = z.object({ testTypeId: z.string().min(1).max(60), sections: z.record(z.string(), z.array(z.string().uuid()).max(500)) }).parse(req.body);
    const layout = await testTypeLayout(b.testTypeId);
    res.json(await formSeconds(b.sections, layout ? sectionTimers(layout) : {}));
  } catch (err) {
    next(err);
  }
});

// One click: pick every question, ask the AI for gaps it can fill, save the
// test (and publish it when complete, if asked).
builderRouter.post("/content/builder/create", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const body = createTestSchema.parse(req.body);
    const r = await createTest(req.user!.id, body);
    await audit(req, "content.form_created", r.id, { purpose: body.purpose, durationMinutes: body.durationMinutes, oneClick: true, publish: body.publish });
    if (r.summary.published) await audit(req, "content.form_published", r.id);
    res.status(201).json(r);
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});

builderRouter.get("/content/forms", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    res.json({ forms: await listForms() });
  } catch (err) {
    next(err);
  }
});

builderRouter.get("/content/forms/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const f = uuid.safeParse(req.params.id).success ? await getForm(String(req.params.id)) : null;
    if (!f) return res.status(404).json({ error: "form_not_found" });
    const layout = await testTypeLayout(f.form.testTypeId);
    res.json({ ...f, seconds: await formSeconds(f.sections, layout ? sectionTimers(layout) : {}) });
  } catch (err) {
    next(err);
  }
});

async function audit(req: AuthedRequest, action: string, formId: string, details: Record<string, unknown> = {}) {
  const f = (await pool.query(`SELECT code, name FROM forms WHERE id = $1`, [formId])).rows[0];
  await recordAudit({
    tenantId: null,
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action,
    targetType: "form",
    targetId: formId,
    targetLabel: f ? `${f.code} ${f.name}` : null,
    details,
    ip: req.ip ?? null,
  });
}

builderRouter.post("/content/forms", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    const body = formSchema.parse(req.body);
    const id = await createForm(req.user!.id, body);
    await audit(req, "content.form_created", id, { purpose: body.purpose, durationMinutes: body.durationMinutes });
    res.status(201).json({ id });
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});

builderRouter.put("/content/forms/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "form_not_found" });
    await updateForm(String(req.params.id), formSchema.parse(req.body));
    res.json({ ok: true });
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});

builderRouter.post("/content/forms/:id/publish", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "form_not_found" });
    await publishForm(String(req.params.id), req.user!.id);
    await audit(req, "content.form_published", String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});

builderRouter.post("/content/forms/:id/retire", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "contentReview"))) return;
  try {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: "form_not_found" });
    await retireForm(String(req.params.id));
    await audit(req, "content.form_retired", String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    if (!formError(err, res)) next(err);
  }
});
