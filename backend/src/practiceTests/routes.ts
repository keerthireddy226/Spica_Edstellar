import { REPORT_VERSION } from "../reports/feedbackReport.js";
import { z } from "zod";
import { learnerOrgPolicy } from "../orgAdmin/settings.js";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { submitAttemptSchema } from "../placement/schemas.js";
import { finishPendingSpeaking, gradeAndSaveAttempt } from "../attemptGrading.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { withAudioUrls } from "../voice/itemAudio.js";
import { toItemPayload } from "../itemPayload.js";
import { checkAndAwardBadges } from "../gamification/stats.js";
import { learnerPolicy } from "../proctoring/policy.js";
import { randomizedFormItemIds } from "../proctoring/forms.js";
import { finishProctoredSession, proctoringBlock } from "../proctoring/analyze.js";
import { activeAssessment, recordCandidateResult } from "../recruitment/service.js";
import { levelSummary } from "../placement/levels.js";
import { examPrefix, newTestCode } from "../lib/testCode.js";
import { auditTestCompleted, auditTestStarted } from "../audit/testEvents.js";
import { listCatalogue, liveTestType, testTypeOfExam } from "../catalogue/service.js";
import {
  answerTooLate,
  bandForLevel,
  familyScoreScale,
  itemViews,
  mockDeadline,
  mockFormItemIds,
  mockLimits,
  mockTemplateExam,
  practiceFeedback,
  recordView,
  secondsLeft,
  type DeliveryMode,
  type MockComposition,
} from "./modes.js";
import { QuotaError, assertQuota, listQuotas, quotaUsage } from "../programs/quotas.js";
import { activeProgramOf, learnerProgram, recordProgramSession } from "../programs/service.js";
import { enqueue } from "../queue/queue.js";
import { formSessionRows, pickMockForm, practiceForms } from "../builder/forms.js";
import { learnerQuota } from "../programs/quotas.js";

export const practiceTestsRouter = Router();

// Products are the catalogue's test types (catalogue/service.ts); a test
// type's sets are the active exams with its test_type_id.

interface PartBoundary {
  partId: string;
  label: string;
  startIndex: number;
  count: number;
}

// Full item list for one exam, in authored order: part sort_order, then
// exam_order within the part — mirrors selectSetItems in practice/routes.ts.
async function selectExamItems(examId: string) {
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds, it.prep_seconds, it.min_words, it.max_words,
       ep.id AS exam_part_id, ep.part_label, ep.sort_order
     FROM items i
     JOIN item_types it ON it.id = i.item_type_id
     JOIN exam_parts ep ON ep.id = i.exam_part_id
     WHERE ep.exam_id = $1 AND i.status = 'approved'
     ORDER BY ep.sort_order ASC, i.exam_order ASC`,
    [examId],
  );
  return result.rows;
}

// A randomized form draws a section's questions from several sets, so
// sections are grouped by position (sort_order), and each one takes the part
// id of the chosen exam's own section.
function derivePartBoundaries(rows: Awaited<ReturnType<typeof selectExamItems>>, partIdByOrder?: Map<number, string>): PartBoundary[] {
  const boundaries: (PartBoundary & { sortOrder: number })[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = boundaries[boundaries.length - 1];
    if (prev && prev.sortOrder === row.sort_order) {
      prev.count++;
    } else {
      boundaries.push({ partId: partIdByOrder?.get(row.sort_order) ?? row.exam_part_id, label: row.part_label, startIndex: i, count: 1, sortOrder: row.sort_order });
    }
  }
  return boundaries.map(({ sortOrder: _s, ...b }) => b);
}

// One randomized form for this exam, in section order.
async function selectRandomizedItems(examId: string) {
  return selectFormItems(await randomizedFormItemIds(examId), examId);
}

// A form's items in the given order; part ids are the template exam's.
async function selectFormItems(ids: string[], examId: string) {
  if (ids.length === 0) return { rows: [], partIdByOrder: new Map<number, string>() };
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds, it.prep_seconds, it.min_words, it.max_words,
       ep.id AS exam_part_id, ep.part_label, ep.sort_order
     FROM items i
     JOIN item_types it ON it.id = i.item_type_id
     JOIN exam_parts ep ON ep.id = i.exam_part_id
     WHERE i.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  const parts = await pool.query(`SELECT id, sort_order FROM exam_parts WHERE exam_id = $1`, [examId]);
  return {
    rows: ids.map((id) => byId.get(id)).filter(Boolean) as typeof result.rows,
    partIdByOrder: new Map<number, string>(parts.rows.map((p) => [p.sort_order, p.id])),
  };
}

// Used by both the resume-below and /session/current equivalents — loads an
// exam session's items + partBoundaries + per-item attempted/responseText.
async function loadExamSession(userId: string, sessionRow: { id: string; composition: Record<string, unknown>; delivery_mode?: DeliveryMode | null }) {
  const itemIds: string[] = (sessionRow.composition?.itemIds as string[]) ?? [];
  const partBoundaries: PartBoundary[] = (sessionRow.composition?.partBoundaries as PartBoundary[]) ?? [];
  const itemsResult = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds, it.prep_seconds, it.min_words, it.max_words
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[])`,
    [itemIds],
  );
  // A built test's own time limits.
  const timers = (sessionRow.composition?.timers as Record<string, number> | undefined) ?? {};
  const byId = new Map(itemsResult.rows.map((r) => [r.id, { ...r, timer_seconds: timers[r.id] ?? r.timer_seconds }]));
  const attemptsResult = await pool.query(`SELECT item_id, response_text FROM attempts WHERE session_id = $1`, [sessionRow.id]);
  const attemptByItem = new Map(attemptsResult.rows.map((r) => [r.item_id, r.response_text]));
  // A mock's questions carry their limit and, once shown, the seconds left.
  const mock = sessionRow.delivery_mode === "mock" ? (sessionRow.composition as MockComposition) : null;
  const views = mock ? await itemViews(sessionRow.id) : null;
  const items = itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      ...toItemPayload(row!),
      attempted: attemptByItem.has(row!.id),
      responseText: attemptByItem.get(row!.id) ?? null,
      ...(mock ? { limitSeconds: mock.limits?.[row!.id] ?? null, secondsLeft: secondsLeft(mock, row!.id, views!.get(row!.id)) } : {}),
    }));
  return { partBoundaries, items: await withAudioUrls(userId, items), timing: mock ? mockTiming(mock) : null };
}

function mockTiming(c: MockComposition) {
  return { deadlineAt: c.deadlineAt ?? null, serverNow: new Date().toISOString() };
}

// The learner's open mock exam, if any: one at a time.
async function openMock(userId: string): Promise<{ id: string; composition: Record<string, unknown>; test_code: string; delivery_mode: DeliveryMode } | null> {
  const r = await pool.query(
    `SELECT id, composition, test_code, delivery_mode FROM sessions
     WHERE user_id = $1 AND session_type = 'mocktest' AND delivery_mode = 'mock' AND completed_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

// The catalogue: exam families and their test types, with set counts and
// whether this learner's organization allows each one.
practiceTestsRouter.get("/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    const families = await listCatalogue();
    const mock = req.user!.role === "candidate" ? null : await openMock(req.user!.id);
    res.json({
      openMock: mock ? { sessionId: mock.id, testTypeId: (mock.composition.testTypeId as string | undefined) ?? null } : null,
      families: families.map((f) => ({
        ...f,
        testTypes: f.testTypes.map((t) => ({ ...t, allowed: !allowedTestProducts || allowedTestProducts.includes(t.id) })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// The feedback report of one finished test. Built on first request if it
// wasn't (tests finished before reports existed), and again if the learner's
// plan now includes the full report.
practiceTestsRouter.get("/session/:sessionId/report", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const s = (
      await pool.query(`SELECT id, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`, [req.params.sessionId, req.user!.id])
    ).rows[0];
    if (!s) return res.status(404).json({ error: "session_not_found" });
    if (!s.completed_at) return res.status(409).json({ error: "session_not_completed" });
    const r = (await pool.query(`SELECT status, report_level, report, updated_at FROM feedback_reports WHERE session_id = $1`, [s.id])).rows[0];
    // Explanations the AI couldn't write at the time: try again (at most hourly), showing this report meanwhile.
    if (r?.status === "ready" && r.report?.explanationsMissing && Date.now() - new Date(r.updated_at).getTime() > 3_600_000) {
      await enqueue("report.build", { sessionId: s.id }, { dedupeKey: `report.build:${s.id}:${Date.now() >> 22}`, maxAttempts: 2 });
    }
    const wanted = (await learnerQuota(req.user!.id))?.reportLevel ?? "full";
    // Reports made before skipped questions and answer explanations (version 2) are rebuilt.
    const outdated = r?.status === "ready" && (r.report?.version ?? 1) < REPORT_VERSION;
    const stale = !r || r.status === "failed" || outdated || (r.status === "ready" && r.report_level === "summary" && wanted === "full");
    if (stale) {
      await enqueue("report.build", { sessionId: s.id }, { dedupeKey: `report.build:${s.id}:${Date.now() >> 16}`, maxAttempts: 5 });
      if (!r || r.status === "failed" || outdated) return res.json({ status: "pending", report: null });
    }
    res.json({ status: r.status, report: r.report });
  } catch (err) {
    next(err);
  }
});

// The learner's finished practice tests and mocks, newest first, with their results.
practiceTestsRouter.get("/history", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT s.id, s.test_code, s.delivery_mode, s.completed_at, s.result, coalesce(s.composition->>'testTypeId', e.test_type_id) AS test_type_id,
         coalesce(e.name, fo.name) AS exam_name, fr.status AS report_status
       FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId' LEFT JOIN forms fo ON fo.id::text = s.composition->>'formId'
       LEFT JOIN feedback_reports fr ON fr.session_id = s.id
       WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL
         -- Results of hidden exam families (LanguageCert for now) aren't listed.
         AND NOT EXISTS (SELECT 1 FROM test_types tt JOIN exam_families f ON f.id = tt.family_id
                         WHERE tt.id = coalesce(s.composition->>'testTypeId', e.test_type_id) AND NOT f.active)
       ORDER BY s.completed_at DESC LIMIT 200`,
      [req.user!.id],
    );
    res.json({
      sessions: r.rows.map((x) => ({
        sessionId: x.id,
        testCode: x.test_code,
        deliveryMode: x.delivery_mode ?? "practice",
        completedAt: x.completed_at,
        testTypeId: x.test_type_id,
        examName: x.delivery_mode === "mock" ? null : x.exam_name,
        cefrLevel: x.result?.cefrLevel ?? null,
        percent: x.result?.overallPercent ?? null,
        reportStatus: x.report_status ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// This month's practice tests and mock exams against the learner's limits.
practiceTestsRouter.get("/quota", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const quota = await quotaUsage(req.user!.id);
    // Individuals also see both of their tiers' limits (for the Plans page).
    const tiers = quota?.segment === "individual" ? (await listQuotas()).filter((q) => q.segment === "individual") : null;
    res.json({ quota, tiers });
  } catch (err) {
    next(err);
  }
});

// The learner's program: target, latest level and the next scheduled tests.
practiceTestsRouter.get("/program", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ program: req.user!.role === "learner" ? await learnerProgram(req.user!.id) : null });
  } catch (err) {
    next(err);
  }
});

// This product's 5 exam sets, each with its item count and this learner's completion.
practiceTestsRouter.get("/:product/exams", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const testType = await liveTestType(req.params.product as string);
    if (!testType) return res.status(404).json({ error: "unknown_product" });
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts && !allowedTestProducts.includes(req.params.product as string)) {
      return res.status(403).json({ error: "product_not_enabled" });
    }

    const result = await pool.query(
      `SELECT e.id, e.code, e.name, e.test_id,
         (SELECT count(*)::int FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id WHERE ep.exam_id = e.id) AS item_count,
         EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
             AND s.composition->>'examId' = e.id::text
             -- Every item answered with a real response, not skipped blank —
             -- completed_at alone only means "reached the end of the list".
             AND NOT EXISTS (
               SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL
             )
         ) AS completed,
         -- An open practice session to resume (doesn't count against the monthly limit again).
         EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NULL
             AND s.composition->>'examId' = e.id::text
         ) AS in_progress
       FROM exams e
       WHERE e.is_active AND e.test_type_id = $1
       ORDER BY e.code`,
      [testType.id, req.user!.id],
    );
    // Practice tests built in the assessment builder, after the sets.
    const forms = await practiceForms(testType.id, req.user!.id);
    res.json({
      exams: [
        ...result.rows.map((r) => ({ id: r.id, code: r.code, testId: r.test_id, name: r.name, itemCount: r.item_count, completed: r.completed, inProgress: r.in_progress, source: "set" })),
        ...forms.map((f) => ({
          id: f.id,
          code: f.code,
          testId: f.code,
          name: f.name,
          itemCount: f.item_count,
          completed: f.completed,
          inProgress: f.in_progress,
          source: "form",
          durationMinutes: f.duration_minutes,
          shortForm: f.short_form,
        })),
      ],
    });
  } catch (err) {
    next(err);
  }
});

// Practice: a set (examId). Mock: a test type (testTypeId), or the set a
// candidate's invitation assigned; candidates always take a mock.
const startSessionSchema = z
  .object({
    examId: z.string().uuid().optional(),
    // A practice test built in the assessment builder (a published form).
    formId: z.string().uuid().optional(),
    testTypeId: z.string().min(1).max(60).optional(),
    mode: z.enum(["practice", "mock"]).default("practice"),
  })
  .refine((b) => b.examId || b.formId || (b.mode === "mock" && b.testTypeId), { message: "examId, formId or testTypeId required" });

// Resumes an open session for the same set (practice) or test type (mock)
// instead of starting a new one.
practiceTestsRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = startSessionSchema.parse(req.body);
    const candidate = req.user!.role === "candidate";
    const mode: DeliveryMode = candidate ? "mock" : body.mode;
    // A candidate takes exactly the exam set their invitation assigned.
    if (candidate) {
      const a = await activeAssessment(req.user!.id);
      if (!a || !body.examId || a.exam_id !== body.examId) return res.status(403).json({ error: "candidate_not_allowed" });
    }
    // A built practice test: published, for practice, and not for candidates.
    const builtForm = body.formId && !candidate
      ? (await pool.query(`SELECT id, test_type_id, code, duration_minutes, short_form FROM forms WHERE id = $1 AND status = 'published' AND purpose = 'practice'`, [body.formId])).rows[0]
      : null;
    if (body.formId && !builtForm) return res.status(404).json({ error: "unknown_form" });
    const testTypeId: string = builtForm ? builtForm.test_type_id : body.examId ? await testTypeOfExam(body.examId) : body.testTypeId!;
    if (!testTypeId || !(await liveTestType(testTypeId))) return res.status(404).json({ error: "unknown_product" });
    const { allowedTestProducts } = candidate ? { allowedTestProducts: null } : await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts && !allowedTestProducts.includes(testTypeId)) return res.status(403).json({ error: "product_not_enabled" });

    let existing =
      mode === "mock"
        ? await openMock(req.user!.id)
        : (
            await pool.query(
              `SELECT id, composition, test_code, delivery_mode FROM sessions
               WHERE user_id = $1 AND session_type = 'mocktest' AND delivery_mode = 'practice' AND completed_at IS NULL
                 AND coalesce(composition->>'formId', composition->>'examId') = $2
               ORDER BY started_at DESC LIMIT 1`,
              [req.user!.id, builtForm?.id ?? body.examId],
            )
          ).rows[0];
    // An untouched practice session holding questions retired since it
    // started (e.g. a format change) is replaced by a fresh one.
    if (existing && mode === "practice") {
      const stale = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM items WHERE id = ANY($2::uuid[]) AND status <> 'approved')
           AND NOT EXISTS (SELECT 1 FROM attempts WHERE session_id = $1) AS stale`,
        [existing.id, (existing.composition.itemIds as string[]) ?? []],
      );
      if (stale.rows[0].stale) existing = undefined;
    }
    if (existing) {
      const existingType = (existing.composition.testTypeId as string | undefined) ?? (await testTypeOfExam(existing.composition.examId as string));
      // One open mock at a time: finish the other one first.
      if (mode === "mock" && existingType !== testTypeId) {
        return res.status(409).json({ error: "mock_in_progress", sessionId: existing.id, testTypeId: existingType });
      }
      const { partBoundaries, items, timing } = await loadExamSession(req.user!.id, existing);
      return res.json({
        sessionId: existing.id,
        testCode: existing.test_code,
        examId: existing.composition.examId,
        formId: existing.composition.formId ?? null,
        testTypeId: existingType,
        deliveryMode: mode,
        partBoundaries,
        items,
        timing,
      });
    }

    // Monthly limits apply to each new practice test or mock (candidates
    // take their one assessment).
    if (!candidate) {
      try {
        await assertQuota(req.user!.id, mode);
      } catch (err) {
        if (err instanceof QuotaError) return res.status(403).json({ error: "quota_reached", ...err.detail });
        throw err;
      }
    }
    // A test of the learner's program's test type counts towards it.
    const program = candidate ? null : await activeProgramOf(req.user!.id);
    const programId = program?.test_type_id === testTypeId ? program.id : null;

    let examId: string | null = body.examId ?? null;
    let form: Awaited<ReturnType<typeof selectFormItems>> | null = null;
    // A built test (assessment builder): its questions, time limits and duration.
    let built: { id: string; code: string; durationMinutes: number; shortForm: boolean; timers: Record<string, number> } | null = null;
    // Published mock forms are used before the per-learner draw.
    const mockForm = mode === "mock" && !candidate ? await pickMockForm(testTypeId, req.user!.id) : null;
    const formToUse: { id: string; code: string; duration_minutes: number; short_form: boolean } | null =
      builtForm ?? (mockForm ? (await pool.query(`SELECT id, code, duration_minutes, short_form FROM forms WHERE id = $1`, [mockForm.id])).rows[0] : null);
    if (formToUse) {
      const fr = await formSessionRows(formToUse.id);
      form = { rows: fr.rows, partIdByOrder: fr.partIdByOrder };
      built = { id: formToUse.id, code: formToUse.code, durationMinutes: formToUse.duration_minutes, shortForm: formToUse.short_form, timers: fr.timers };
      examId = null;
    } else if (mode === "mock" && !candidate) {
      // A learner's mock: questions they haven't seen, laid out like the first set.
      const template = await mockTemplateExam(testTypeId);
      if (!template) return res.status(404).json({ error: "no_exam_items_available" });
      examId = template.id;
      form = await selectFormItems(await mockFormItemIds(testTypeId, req.user!.id, template.id), template.id);
    } else if (candidate) {
      // Proctored organizations give each candidate their own mix of questions.
      const { policy } = await learnerPolicy(req.user!.id);
      if (policy.randomizedForms) form = await selectRandomizedItems(examId!);
    }
    const formRows = form?.rows ?? [];
    if (built && formRows.length === 0) return res.status(404).json({ error: "no_exam_items_available" });
    const rows = formRows.length ? formRows : await selectExamItems(examId!);
    if (rows.length === 0) {
      return res.status(404).json({ error: "no_exam_items_available" });
    }
    const builtTest = built;
    const partBoundaries = derivePartBoundaries(rows, formRows.length ? form?.partIdByOrder : undefined);
    const itemIds = rows.map((r) => r.id);
    const timers = builtTest?.timers ?? {};
    const mock: MockComposition | null =
      mode === "mock"
        ? await mockLimits(itemIds, timers).then((limits) => {
            // A built mock's whole-test deadline follows its duration (never shorter than its questions need).
            const byQuestions = mockDeadline(limits, partBoundaries.length).getTime();
            const byDuration = builtTest ? Date.now() + (builtTest.durationMinutes + 10) * 60_000 : 0;
            return { limits, deadlineAt: new Date(Math.max(byQuestions, byDuration)).toISOString() };
          })
        : null;

    const examCode = examId ? ((await pool.query(`SELECT code FROM exams WHERE id = $1`, [examId])).rows[0]?.code ?? "") : "";
    const testCode = newTestCode(examPrefix(examCode));
    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition, test_code, delivery_mode, program_id)
       VALUES ($1, 'mocktest', 'coach', $2, $3, $4, $5) RETURNING id`,
      [
        req.user!.id,
        JSON.stringify({
          examId,
          testTypeId,
          itemIds,
          partBoundaries,
          randomized: !!formRows.length && !builtTest,
          ...(builtTest ? { formId: builtTest.id, formCode: builtTest.code, durationMinutes: builtTest.durationMinutes, shortForm: builtTest.shortForm, timers } : {}),
          ...mock,
        }),
        testCode,
        mode,
        programId,
      ],
    );

    await auditTestStarted(sessionResult.rows[0].id, req.ip).catch(() => {});
    const payload = await withAudioUrls(req.user!.id, rows.map(toItemPayload));
    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
      testCode,
      examId,
      formId: builtTest?.id ?? null,
      testTypeId,
      deliveryMode: mode,
      partBoundaries,
      items: mock ? payload.map((it) => ({ ...it, limitSeconds: mock.limits?.[it.id] ?? null, secondsLeft: null })) : payload,
      timing: mock ? mockTiming(mock) : null,
    });
  } catch (err) {
    next(err);
  }
});

practiceTestsRouter.get("/session/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `SELECT id, composition, completed_at, test_code, delivery_mode FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });

    const { partBoundaries, items, timing } = await loadExamSession(req.user!.id, session);
    res.json({
      sessionId: session.id,
      testCode: session.test_code,
      examId: session.composition?.examId ?? null,
      formId: session.composition?.formId ?? null,
      testTypeId: session.composition?.testTypeId ?? null,
      deliveryMode: session.delivery_mode ?? "practice",
      completed: !!session.completed_at,
      partBoundaries,
      items,
      timing,
    });
  } catch (err) {
    next(err);
  }
});

async function openSessionOf(req: AuthedRequest) {
  return (
    await pool.query(
      `SELECT id, completed_at, composition, delivery_mode FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    )
  ).rows[0] as { id: string; completed_at: string | null; composition: Record<string, unknown>; delivery_mode: DeliveryMode | null } | undefined;
}

// A mock question's clock starts the first time it's shown; the reply is the
// time left on it. Showing it again (a reload) keeps the first time.
practiceTestsRouter.post("/session/:sessionId/view", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { itemId } = z.object({ itemId: z.string().uuid() }).parse(req.body);
    const session = await openSessionOf(req);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });
    if (!((session.composition.itemIds as string[]) ?? []).includes(itemId)) return res.status(404).json({ error: "item_not_found" });
    if (session.delivery_mode !== "mock") return res.json({ secondsLeft: null });
    const shownAt = await recordView(session.id, itemId);
    res.json({ secondsLeft: secondsLeft(session.composition as MockComposition, itemId, shownAt), ...mockTiming(session.composition as MockComposition) });
  } catch (err) {
    next(err);
  }
});

practiceTestsRouter.post("/session/:sessionId/attempts", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    let body = submitAttemptSchema.parse(req.body);

    const session = await openSessionOf(req);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });
    const blocked = await proctoringBlock(session.id, req.user!.id);
    if (blocked) return res.status(409).json({ error: blocked });

    // Mock: forward only, and an answer after the question's time counts as
    // unanswered (the server's clock, not the browser's).
    let late = false;
    if (session.delivery_mode === "mock") {
      if (!((session.composition.itemIds as string[]) ?? []).includes(body.itemId)) return res.status(404).json({ error: "item_not_found" });
      const answered = await pool.query(`SELECT 1 FROM attempts WHERE session_id = $1 AND item_id = $2`, [session.id, body.itemId]);
      if (answered.rows[0]) return res.status(409).json({ error: "already_answered" });
      const shownAt = await recordView(session.id, body.itemId);
      late = answerTooLate(session.composition as MockComposition, body.itemId, shownAt);
      if (late) body = { itemId: body.itemId, activeMs: body.activeMs };
    }

    // These tests never pick the next question from this answer, so a
    // recorded answer is graded in the background instead of making the
    // learner wait for it.
    const graded = await gradeAndSaveAttempt(session.id, body, { deferSpeaking: true });
    if (!graded) return res.status(404).json({ error: "item_not_found" });

    const { attemptId, grade, wasCorrect } = graded;
    const correct = grade.status === "scored" ? wasCorrect : grade.correct;
    if (session.delivery_mode === "mock") return res.status(201).json({ attemptId, status: grade.status, late });
    // Practice: the correct answer and the grader's reason come back at once
    // (a recorded answer's once its background grading is done; see /feedback).
    const answered = !!(body.responseText || body.audioBase64);
    const feedback = answered ? await practiceFeedback(session.id, body.itemId) : null;
    res.status(201).json({ attemptId, status: grade.status, correct, feedback });
  } catch (err) {
    next(err);
  }
});

// Practice only: feedback on one answered question, for a recorded answer
// still being graded when it was submitted.
practiceTestsRouter.get("/session/:sessionId/feedback/:itemId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const session = await openSessionOf(req);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.delivery_mode === "mock") return res.status(403).json({ error: "no_feedback_in_mock" });
    const feedback = await practiceFeedback(session.id, String(req.params.itemId));
    if (!feedback) return res.status(404).json({ error: "not_answered" });
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

// Unlike Placement, completing a mock-exam session never writes a placements
// or roadmap row — it's practice, not a certification (same rule as the
// existing practice router's /session/:id/complete).
practiceTestsRouter.post("/session/:sessionId/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  // Idempotent: a session already marked complete (e.g. the first /complete
  // call actually succeeded server-side but the client never saw the
  // response — the exact "stuck on the last question forever" bug this
  // fixes) just gets its real score recomputed and returned again, instead
  // of a 404 that leaves the learner with no way to see their result.
  let sessionExists;
  // Only the first /complete finishes the test (and is audited).
  let justFinished = false;
  try {
    sessionExists = await pool.query(
      `SELECT id, test_code, delivery_mode, composition FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    if (sessionExists.rows[0]) {
      const u = await pool.query(`UPDATE sessions SET completed_at = now() WHERE id = $1 AND completed_at IS NULL`, [req.params.sessionId]);
      justFinished = (u.rowCount ?? 0) > 0;
    }
  } catch (err) {
    return next(err);
  }
  if (!sessionExists.rows[0]) return res.status(404).json({ error: "session_not_found" });
  const deliveryMode: DeliveryMode = sessionExists.rows[0].delivery_mode ?? "practice";
  const composition = sessionExists.rows[0].composition ?? {};

  // A mock's questions never reached (time ran out, or the learner ended
  // early) count as unanswered in the report.
  if (justFinished && deliveryMode === "mock") {
    try {
      const done = await pool.query(`SELECT item_id FROM attempts WHERE session_id = $1`, [req.params.sessionId]);
      const answered = new Set(done.rows.map((r) => r.item_id));
      for (const itemId of ((composition.itemIds as string[]) ?? []).filter((id) => !answered.has(id))) {
        await gradeAndSaveAttempt(req.params.sessionId as string, { itemId });
      }
    } catch (err) {
      console.error("practiceTests /complete: recording unanswered mock questions failed:", err);
    }
  }

  // Recorded answers graded in the background must count in the result.
  await finishPendingSpeaking(req.params.sessionId as string).catch((err) => console.error("practiceTests /complete: speaking grading failed:", err));

  // The session is now genuinely done — a crash computing the score
  // breakdown below must never leave the learner stuck mid-test with an
  // error and no way forward. Fall back to a minimal "you finished, score
  // pending" response instead of failing the whole request.
  try {
    const summaryResult = await pool.query(
      `SELECT sc.status, sc.content_score, sc.manner_scores, it.input_method, it.skills, i.cefr_level, ep.part_label,
         a.response_text, a.response_uri
       FROM attempts a
       JOIN scores sc ON sc.attempt_id = a.id
       JOIN items i ON i.id = a.item_id
       JOIN item_types it ON it.id = i.item_type_id
       JOIN exam_parts ep ON ep.id = i.exam_part_id
       WHERE a.session_id = $1`,
      [req.params.sessionId],
    );
    const rows = summaryResult.rows;
    const graded = rows.filter((r) => r.status === "scored");
    const rowCorrect = (r: (typeof rows)[number]) =>
      isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
    const correctCount = graded.filter(rowCorrect).length;
    // "Pending" splits into two very different things for the learner: a
    // real answer that's still waiting on AI grading, vs. a question left
    // blank (Skip, or never reached) — the latter will never grade itself,
    // so lumping it into "still being reviewed" is misleading.
    const pendingRows = rows.filter((r) => r.status === "pending");
    const skippedCount = pendingRows.filter((r) => !r.response_text && !r.response_uri).length;
    const pendingCount = pendingRows.length - skippedCount;
    const failedCount = rows.filter((r) => r.status === "failed").length;

    const partLabels = [...new Set(rows.map((r) => r.part_label))];
    const partResults = partLabels.map((label) => {
      const partRows = graded.filter((r) => r.part_label === label);
      return { label, gradedCount: partRows.length, correctCount: partRows.filter(rowCorrect).length };
    });

    // The same CEFR level logic as the placement test, from each question's level.
    const level = levelSummary(rows);
    // A mock's estimated score range on the exam family's scale, where it publishes one.
    // A short form isn't the exam's format, so its score range wouldn't mean anything.
    const scale = deliveryMode === "mock" && !composition.shortForm ? await familyScoreScale((composition.testTypeId as string | undefined) ?? (await testTypeOfExam(composition.examId))) : null;
    const skillScoreBands = level?.skillLevels
      ? Object.fromEntries(Object.entries(level.skillLevels as Record<string, string | null>).map(([k, v]) => [k, bandForLevel(scale, v)]))
      : null;
    if (justFinished) {
      const overall = graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : null;
      // Kept for programs (the learner's latest level) and reports.
      await pool.query(`UPDATE sessions SET result = $2 WHERE id = $1`, [
        req.params.sessionId,
        JSON.stringify({ cefrLevel: level?.cefrLevel ?? null, skillLevels: level?.skillLevels ?? null, overallPercent: overall, scoreBand: bandForLevel(scale, level?.cefrLevel) }),
      ]);
      await auditTestCompleted(req.params.sessionId as string, { cefrLevel: level?.cefrLevel, overallPercent: overall, answered: rows.length - skippedCount, skipped: skippedCount }, req.ip).catch(() => {});
    }
    res.json({
      testCode: sessionExists.rows[0].test_code,
      gradedCount: graded.length,
      correctCount,
      pendingCount,
      skippedCount,
      failedCount,
      overallPercent: graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : 0,
      partResults,
      cefrLevel: level?.cefrLevel ?? null,
      skillLevels: level?.skillLevels ?? null,
      skillPercents: level?.skillPercents ?? null,
      deliveryMode,
      scoreBand: bandForLevel(scale, level?.cefrLevel),
      skillScoreBands,
    });
  } catch (err) {
    console.error("practiceTests /complete: score summary failed, session still marked complete:", err);
    res.json({ testCode: sessionExists.rows[0].test_code, deliveryMode, gradedCount: 0, correctCount: 0, pendingCount: 0, skippedCount: 0, failedCount: 0, overallPercent: 0, partResults: [] });
  }

  // Proctoring analysis is best-effort too: the learner already has their result.
  try {
    await finishProctoredSession(req.params.sessionId as string);
  } catch (err) {
    console.error("practiceTests /complete: proctoring analysis failed (non-fatal):", err);
  }

  // The feedback report is built in the background.
  if (justFinished) {
    await enqueue("report.build", { sessionId: req.params.sessionId }, { dedupeKey: `report.build:${req.params.sessionId}`, maxAttempts: 5 }).catch((err) =>
      console.error("practiceTests /complete: report not queued:", err),
    );
  }

  // A finished test ticks off the learner's program schedule.
  if (justFinished) {
    try {
      await recordProgramSession(req.user!.id, req.params.sessionId as string, deliveryMode);
    } catch (err) {
      console.error("practiceTests /complete: program schedule update failed (non-fatal):", err);
    }
  }

  // A candidate's result goes to the recruiter.
  try {
    await recordCandidateResult(req.user!.id, req.params.sessionId as string);
  } catch (err) {
    console.error("practiceTests /complete: candidate result failed (non-fatal):", err);
  }
  if (req.user!.role === "candidate") return;

  // Badge-checking is best-effort and must never affect the response above
  // (already sent) or retroactively fail a completion that already succeeded.
  try {
    await checkAndAwardBadges(req.user!.id);
  } catch (err) {
    console.error("practiceTests /complete: badge check failed (non-fatal):", err);
  }
});
