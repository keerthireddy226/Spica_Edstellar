import { REPORT_VERSION, reportAbout } from "../reports/feedbackReport.js";
import { scoreReport } from "../reports/scoreReport.js";
import { canPrepare, narrowedAccess } from "../access/entitlements.js";
import { z } from "zod";
import { learnerOrgPolicy } from "../orgAdmin/settings.js";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { submitAttemptSchema } from "../placement/schemas.js";
import { gradeAndSaveAttempt } from "../attemptGrading.js";
import { withAudioUrls } from "../voice/itemAudio.js";
import { toItemPayload } from "../itemPayload.js";
import { isPhoneUserAgent } from "../lib/device.js";
import { learnerPolicy } from "../proctoring/policy.js";
import { randomizedFormItemIds } from "../proctoring/forms.js";
import { proctoringBlock } from "../proctoring/analyze.js";
import { activeAssessment } from "../recruitment/service.js";
import { examPrefix, newTestCode } from "../lib/testCode.js";
import { auditTestStarted } from "../audit/testEvents.js";
import { listCatalogue, liveTestType, testTypeOfExam } from "../catalogue/service.js";
import {
  answerTooLate,
  itemViews,
  mockDeadline,
  mockFormItemIds,
  mockLimits,
  mockTemplateExam,
  practiceFeedback,
  recordView,
  secondsLeft,
  isTimed,
  LEVEL_TEST_BLUEPRINT,
  levelTestItemIds,
  type DeliveryMode,
  type MockComposition,
} from "./modes.js";
import { QuotaError, assertQuota, listQuotas, quotaUsage } from "../programs/quotas.js";
import { activeProgramOf, learnerProgram } from "../programs/service.js";
import { enqueue } from "../queue/queue.js";
import { formSessionRows, pickMockForm, practiceForms } from "../builder/forms.js";
import { learnerQuota } from "../programs/quotas.js";
import { AttemptError, checkStart, samplePick, useAttempt } from "../assessment/service.js";
import { qualitySettings } from "../quality/settings.js";
import { completeSession } from "./complete.js";

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

// A level test's questions, part by part (the blueprint's order), shaped like a set's rows.
async function levelTestRows(level: string, userId: string, exposureCap: number) {
  const ids = await levelTestItemIds(level, userId, exposureCap);
  const order = new Map(LEVEL_TEST_BLUEPRINT.map((p, i) => [p.itemTypeId, i + 1]));
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds, it.prep_seconds, it.min_words, it.max_words,
       'level-' || it.id AS exam_part_id, it.name AS part_label
     FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(r.rows.map((x) => [x.id, { ...x, sort_order: order.get(x.item_type_id) ?? 99 }]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as (Awaited<ReturnType<typeof selectExamItems>>[number])[];
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
  const mock = isTimed(sessionRow.delivery_mode) ? (sessionRow.composition as MockComposition) : null;
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

// The learner's open timed test (a mock, a real attempt or a sample), if any: one at a time.
// A mock whose time ran out while the learner was away, with nothing
// answered, is set aside (abandoned): it isn't finished with every question
// skipped, doesn't count towards the month's mocks or show in their reports,
// and the learner starts a fresh one. One with answers is finished as usual.
// A real (certified) attempt set aside before any question was shown (say the
// connection dropped during the proctoring checks) gives the attempt back.
async function setAsideExpiredMocks(userId: string): Promise<void> {
  const r = await pool.query(
    `UPDATE sessions s SET completed_at = now(), composition = s.composition || '{"abandoned": true}'::jsonb
     WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode IN ('mock', 'certified', 'sample') AND s.completed_at IS NULL
       AND (s.composition->>'deadlineAt')::timestamptz < now()
       AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
     RETURNING s.id, s.delivery_mode, s.entitlement_id`,
    [userId],
  );
  for (const s of r.rows) {
    if (s.delivery_mode !== "certified" || !s.entitlement_id) continue;
    const seen = await pool.query(`SELECT 1 FROM session_item_views WHERE session_id = $1 LIMIT 1`, [s.id]);
    if (!seen.rowCount) await pool.query(`UPDATE entitlements SET attempts_used = greatest(0, attempts_used - 1) WHERE id = $1`, [s.entitlement_id]);
  }
}

async function openMock(userId: string): Promise<{ id: string; composition: Record<string, unknown>; test_code: string; delivery_mode: DeliveryMode } | null> {
  await setAsideExpiredMocks(userId);
  const r = await pool.query(
    `SELECT id, composition, test_code, delivery_mode FROM sessions
     WHERE user_id = $1 AND session_type = 'mocktest' AND delivery_mode IN ('mock', 'certified', 'sample') AND completed_at IS NULL
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
    // A learner who bought one test prepares for that test only.
    const narrowed = req.user!.role === "candidate" ? null : await narrowedAccess(req.user!.id);
    res.json({
      openMock: mock ? { sessionId: mock.id, testTypeId: (mock.composition.testTypeId as string | undefined) ?? null } : null,
      families: families.map((f) => ({
        ...f,
        testTypes: f.testTypes.map((t) => ({
          ...t,
          allowed: !allowedTestProducts || allowedTestProducts.includes(t.id),
          inPlan: !narrowed || canPrepare(narrowed, t.id),
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Where a final assessment's (real attempt's) result stands: void (a proctoring
// violation), being scored (answers still waiting on the AI, or its scoring
// failed), under review (the proctoring record isn't clear yet), or ready.
async function finalResultState(sessionId: string): Promise<"void" | "scoring" | "review" | "ready"> {
  const r = (
    await pool.query(
      `SELECT (SELECT status FROM session_integrity WHERE session_id = $1) AS integrity,
         EXISTS (SELECT 1 FROM certificates WHERE session_id = $1 AND kind = 'result' AND revoked_at IS NULL) AS certified,
         EXISTS (SELECT 1 FROM attempts a LEFT JOIN scores sc ON sc.attempt_id = a.id
                 WHERE a.session_id = $1 AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)
                   AND coalesce(sc.status, 'pending') IN ('pending', 'failed')) AS unscored`,
      [sessionId],
    )
  ).rows[0];
  if (r.integrity === "violation") return "void";
  if (r.unscored) return "scoring";
  if (r.certified || r.integrity === "clear" || r.integrity === "cleared") return "ready";
  return "review";
}

// The feedback report of one finished test. Built on first request if it
// wasn't (tests finished before reports existed), and again if the learner's
// plan now includes the full report.
practiceTestsRouter.get("/session/:sessionId/report", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const s = (
      await pool.query(`SELECT id, completed_at, delivery_mode FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`, [req.params.sessionId, req.user!.id])
    ).rows[0];
    if (!s) return res.status(404).json({ error: "session_not_found" });
    if (!s.completed_at) return res.status(409).json({ error: "session_not_completed" });
    // A real assessment attempt shows its score report only: its questions
    // stay secret, so they can be used again.
    if (s.delivery_mode === "certified") {
      const about = await reportAbout(s.id);
      // The final assessment's score is shown once it's final: every answer
      // scored, and the proctoring record clear (or cleared by a reviewer), or
      // its certificate issued. Before that it's being scored or under review;
      // an attempt found to be a violation is void, with no score.
      if (!about?.levelTest) {
        const st = await finalResultState(s.id);
        if (st !== "ready") return res.json({ status: st === "void" ? "void" : "pending", waiting: st === "void" ? null : st, report: null, about, score: null });
      } else {
        // A level test: no score while it's undecided (some answers still being
        // scored), so a part score never reads as the result; void if it was a violation.
        const st = await finalResultState(s.id);
        if (st === "void") return res.json({ status: "void", waiting: null, report: null, about, score: null });
        if (about.levelPassed === null) return res.json({ status: "pending", waiting: "scoring", report: null, about, score: null });
      }
      const score = await scoreReport(s.id, null).catch(() => null);
      return res.json({ status: score?.overall ? "ready" : "pending", waiting: score?.overall ? null : "scoring", report: null, about, score });
    }
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
      if (!r || r.status === "failed" || outdated) return res.json({ status: "pending", report: null, about: await reportAbout(s.id) });
    }
    // The skill levels against the learner's path, saved when the test finished.
    const pathCompare = (await pool.query(`SELECT result->'pathCompare' AS pc FROM sessions WHERE id = $1`, [s.id])).rows[0]?.pc ?? null;
    const report = r.report?.overall ? { ...r.report, overall: { ...r.report.overall, pathCompare } } : r.report;
    // The score report (Spica score, skills, profile), worked out from the answers.
    const score = await scoreReport(s.id, r.report ?? null).catch((err) => {
      console.error("score report failed:", err);
      return null;
    });
    res.json({ status: r.status, report, about: await reportAbout(s.id), score });
  } catch (err) {
    next(err);
  }
});

// The learner's finished practice tests and mocks, newest first, with their results.
practiceTestsRouter.get("/history", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT s.id, s.test_code, s.delivery_mode, s.completed_at, s.result, coalesce(s.composition->>'testTypeId', e.test_type_id) AS test_type_id,
         coalesce(e.name, fo.name) AS exam_name, fr.status AS report_status,
         c.code AS certificate_code, c.spica_score, c.cefr_level AS certified_level, s.composition->>'levelTest' AS level_test, si.status AS integrity
       FROM sessions s LEFT JOIN certificates c ON c.session_id = s.id AND c.kind = 'result' AND c.revoked_at IS NULL
       LEFT JOIN session_integrity si ON si.session_id = s.id LEFT JOIN exams e ON e.id::text = s.composition->>'examId' LEFT JOIN forms fo ON fo.id::text = s.composition->>'formId'
       LEFT JOIN feedback_reports fr ON fr.session_id = s.id
       WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL
         AND coalesce(s.composition->>'abandoned', 'false') <> 'true'
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
        examName: isTimed(x.delivery_mode) ? null : x.exam_name,
        cefrLevel: x.result?.cefrLevel ?? null,
        percent: x.result?.overallPercent ?? null,
        reportStatus: x.report_status ?? null,
        // A final assessment's certificate and Spica score; a level test is marked as one.
        certificateCode: x.certificate_code ?? null,
        spicaScore: x.spica_score ?? null,
        certifiedLevel: x.certified_level ?? null,
        levelTest: x.level_test ?? null,
        // A final assessment's result shows once it's certified: until then
        // it's being scored or under review, or void (a proctoring violation).
        // A level test shows its level once decided; until then it's being scored.
        finalStatus:
          x.delivery_mode !== "certified"
            ? null
            : x.integrity === "violation"
              ? "void"
              : x.level_test
                ? x.result?.levelTest?.passed === null || x.result?.levelTest?.passed === undefined
                  ? "scoring"
                  : null
                : x.certificate_code
                  ? null
                  : x.integrity === "flagged"
                    ? "under_review"
                    : "scoring",
      })),
    });
  } catch (err) {
    next(err);
  }
});

// This month's practice tests and mock tests against the learner's limits.
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
// Whether a practice set is still locked: a set before it (by code) isn't
// completed yet, i.e. finished with every question answered.
async function practiceSetLocked(userId: string, examId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT e.id,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice'
               AND s.completed_at IS NOT NULL AND s.composition->>'examId' = e.id::text AND coalesce(s.composition->>'abandoned', 'false') <> 'true') AS finished,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice'
               AND s.completed_at IS NOT NULL AND s.composition->>'examId' = e.id::text
               AND (SELECT count(*) FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
                   >= jsonb_array_length(coalesce(s.composition->'itemIds', '[]'::jsonb))) AS completed
     FROM exams e WHERE e.is_active AND e.test_type_id = (SELECT test_type_id FROM exams WHERE id = $2) ORDER BY e.code`,
    [userId, examId],
  );
  const at = r.rows.findIndex((x) => x.id === examId);
  return r.rows.slice(0, Math.max(0, at)).some((prev) => !prev.completed);
}

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
             AND (SELECT count(*) FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
                 >= jsonb_array_length(coalesce(s.composition->'itemIds', '[]'::jsonb))
         ) AS completed,
         -- An open practice session to resume (doesn't count against the monthly limit again).
         EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NULL
             AND s.composition->>'examId' = e.id::text
         ) AS in_progress,
         -- How far the open session got: questions answered of all.
         (SELECT count(*)::int FROM sessions s JOIN attempts a ON a.session_id = s.id
          WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NULL
            AND s.composition->>'examId' = e.id::text AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)) AS progress_answered,
         -- Questions passed (answered or skipped), to know where it resumes.
         (SELECT count(*)::int FROM sessions s JOIN attempts a ON a.session_id = s.id
          WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NULL
            AND s.composition->>'examId' = e.id::text) AS progress_seen,
         -- The latest finished attempt: its level, score and when.
         (SELECT jsonb_build_object('sessionId', s.id, 'level', s.result->>'cefrLevel', 'percent', (s.result->>'overallPercent')::numeric, 'completedAt', s.completed_at)
          FROM sessions s WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
            AND s.composition->>'examId' = e.id::text AND coalesce(s.composition->>'abandoned', 'false') <> 'true'
          ORDER BY s.completed_at DESC LIMIT 1) AS last_result,
         (SELECT count(*)::int FROM sessions s WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
            AND s.composition->>'examId' = e.id::text AND coalesce(s.composition->>'abandoned', 'false') <> 'true') AS attempts,
         -- Taken to the end (skips included).
         EXISTS (
           SELECT 1 FROM sessions s
           WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
             AND s.composition->>'examId' = e.id::text AND coalesce(s.composition->>'abandoned', 'false') <> 'true'
         ) AS finished
       FROM exams e
       WHERE e.is_active AND e.test_type_id = $1
       ORDER BY e.code`,
      [testType.id, req.user!.id],
    );
    // Practice tests built in the assessment builder, after the sets.
    const forms = await practiceForms(testType.id, req.user!.id);
    res.json({
      exams: [
        // Sets open one at a time: each unlocks when the one before is completed.
        ...result.rows.map((r, i) => ({
          id: r.id,
          code: r.code,
          testId: r.test_id,
          name: r.name,
          itemCount: r.item_count,
          completed: r.completed,
          inProgress: r.in_progress,
          finished: r.finished,
          progress: r.in_progress ? { answered: r.progress_answered, seen: r.progress_seen, total: r.item_count } : null,
          last: r.last_result ? { ...r.last_result, attempts: r.attempts } : null,
          // Only Set 1 is open at first; each set unlocks once the one before
          // is completed (every question answered).
          locked: result.rows.slice(0, i).some((prev) => !prev.completed),
          lockedBy: i > 0 ? result.rows[i - 1].name : null,
          source: "set",
        })),
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
    mode: z.enum(["practice", "mock", "certified", "sample"]).default("practice"),
    // The purchase a real attempt (or its sample) belongs to.
    entitlementId: z.string().uuid().optional(),
  })
  .refine((b) => b.examId || b.formId || (b.mode === "mock" && b.testTypeId) || ((b.mode === "certified" || b.mode === "sample") && b.entitlementId), {
    message: "examId, formId, testTypeId or entitlementId required",
  });

// Resumes an open session for the same set (practice) or test type (mock)
// instead of starting a new one.
practiceTestsRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    // Practice tests and mocks run like the real exam: on a computer.
    if (isPhoneUserAgent(req.headers["user-agent"])) return res.status(403).json({ error: "computer_required" });
    const body = startSessionSchema.parse(req.body);
    const candidate = req.user!.role === "candidate";
    const mode: DeliveryMode = candidate ? "mock" : body.mode;
    const timed = isTimed(mode);
    // A real attempt or its sample: of the test the learner bought, open by the unlock rule.
    const owned = !candidate && (mode === "certified" || mode === "sample");
    let ownedTestType: string | null = null;
    // A level test (A1-C2): questions at that level.
    let ownedLevel: string | null = null;
    if (owned) {
      try {
        const started = await checkStart(req.user!.id, body.entitlementId!, mode);
        ownedTestType = started.testTypeId;
        ownedLevel = started.level;
      } catch (err) {
        if (err instanceof AttemptError) return res.status(403).json({ error: err.code, ...err.detail });
        throw err;
      }
    }
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
    const testTypeId: string = ownedTestType ?? (builtForm ? builtForm.test_type_id : body.examId ? await testTypeOfExam(body.examId) : body.testTypeId!);
    // Preparation for one test opens only that test's practice tests and mocks.
    if (!candidate && !owned) {
      const narrowed = await narrowedAccess(req.user!.id);
      if (narrowed && !canPrepare(narrowed, testTypeId)) return res.status(403).json({ error: "test_not_included", testTypeId });
    }
    // Practice sets open in order: the set before this one must be completed
    // (this applies to resuming too).
    if (mode === "practice" && body.examId && !builtForm && (await practiceSetLocked(req.user!.id, body.examId))) {
      return res.status(403).json({ error: "set_locked" });
    }
    if (!testTypeId || !(await liveTestType(testTypeId))) return res.status(404).json({ error: "unknown_product" });
    const { allowedTestProducts } = candidate || owned ? { allowedTestProducts: null } : await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts && !allowedTestProducts.includes(testTypeId)) return res.status(403).json({ error: "product_not_enabled" });

    let existing =
      timed
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
      // One open timed test at a time: finish the other one first.
      if (timed && (existingType !== testTypeId || existing.delivery_mode !== mode)) {
        return res.status(409).json({ error: "mock_in_progress", sessionId: existing.id, testTypeId: existingType, deliveryMode: existing.delivery_mode });
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
    // take their one assessment; real attempts and samples are bought).
    if (!candidate && !owned) {
      try {
        await assertQuota(req.user!.id, mode);
      } catch (err) {
        if (err instanceof QuotaError) return res.status(403).json({ error: "quota_reached", ...err.detail });
        throw err;
      }
    }
    // A test of the learner's program's test type counts towards it.
    const program = candidate || owned ? null : await activeProgramOf(req.user!.id);
    const programId = program?.test_type_id === testTypeId ? program.id : null;

    let examId: string | null = body.examId ?? null;
    let form: Awaited<ReturnType<typeof selectFormItems>> | null = null;
    // A built test (assessment builder): its questions, time limits and duration.
    let built: { id: string; code: string; durationMinutes: number; shortForm: boolean; timers: Record<string, number> } | null = null;
    // A real test keeps questions used in many real tests out while others remain.
    const exposureCap = mode === "certified" ? (await qualitySettings()).exposureCap : Infinity;
    const levelRows = ownedLevel ? await levelTestRows(ownedLevel, req.user!.id, exposureCap) : null;
    // Published mock forms are used before the per-learner draw.
    const mockForm = timed && !candidate && !levelRows ? await pickMockForm(testTypeId, req.user!.id) : null;
    const formToUse: { id: string; code: string; duration_minutes: number; short_form: boolean } | null =
      builtForm ?? (mockForm ? (await pool.query(`SELECT id, code, duration_minutes, short_form FROM forms WHERE id = $1`, [mockForm.id])).rows[0] : null);
    if (levelRows) {
      form = { rows: levelRows, partIdByOrder: new Map<number, string>() };
      examId = null;
    } else if (formToUse) {
      const fr = await formSessionRows(formToUse.id);
      form = { rows: fr.rows, partIdByOrder: fr.partIdByOrder };
      built = { id: formToUse.id, code: formToUse.code, durationMinutes: formToUse.duration_minutes, shortForm: formToUse.short_form, timers: fr.timers };
      examId = null;
    } else if (timed && !candidate) {
      // A learner's mock: questions they haven't seen, laid out like the first set.
      const template = await mockTemplateExam(testTypeId);
      if (!template) return res.status(404).json({ error: "no_exam_items_available" });
      examId = template.id;
      form = await selectFormItems(await mockFormItemIds(testTypeId, req.user!.id, template.id, exposureCap), template.id);
    } else if (candidate) {
      // Proctored organizations give each candidate their own mix of questions.
      const { policy } = await learnerPolicy(req.user!.id);
      if (policy.randomizedForms) form = await selectRandomizedItems(examId!);
    }
    const formRows = form?.rows ?? [];
    if (built && formRows.length === 0) return res.status(404).json({ error: "no_exam_items_available" });
    const allRows = formRows.length ? formRows : await selectExamItems(examId!);
    // The free sample: the first questions of each part.
    const rows = mode === "sample" ? samplePick(allRows, (r) => r.sort_order) : allRows;
    if (rows.length === 0) {
      return res.status(404).json({ error: "no_exam_items_available" });
    }
    const builtTest = built;
    const partBoundaries = derivePartBoundaries(rows, formRows.length ? form?.partIdByOrder : undefined);
    const itemIds = rows.map((r) => r.id);
    const timers = builtTest?.timers ?? {};
    const mock: MockComposition | null =
      timed
        ? await mockLimits(itemIds, timers).then((limits) => {
            // A built mock's whole-test deadline follows its duration (never shorter than its questions need).
            const byQuestions = mockDeadline(limits, partBoundaries.length).getTime();
            const byDuration = builtTest && mode !== "sample" ? Date.now() + (builtTest.durationMinutes + 10) * 60_000 : 0;
            return { limits, deadlineAt: new Date(Math.max(byQuestions, byDuration)).toISOString() };
          })
        : null;

    const examCode = examId ? ((await pool.query(`SELECT code FROM exams WHERE id = $1`, [examId])).rows[0]?.code ?? "") : "";
    const testCode = newTestCode(examPrefix(examCode));
    // A real attempt is used up as the session is created.
    const client = await pool.connect();
    let sessionResult;
    try {
      await client.query("BEGIN");
      if (mode === "certified" && !(await useAttempt(client, req.user!.id, body.entitlementId!))) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "attempt_used" });
      }
      sessionResult = await client.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition, test_code, delivery_mode, program_id, entitlement_id)
       VALUES ($1, 'mocktest', 'coach', $2, $3, $4, $5, $6) RETURNING id`,
      [
        req.user!.id,
        JSON.stringify({
          examId,
          testTypeId,
          itemIds,
          partBoundaries,
          randomized: !!formRows.length && !builtTest && !levelRows,
          ...(ownedLevel ? { levelTest: ownedLevel } : {}),
          ...(builtTest ? { formId: builtTest.id, formCode: builtTest.code, durationMinutes: builtTest.durationMinutes, shortForm: builtTest.shortForm, timers } : {}),
          ...mock,
        }),
        testCode,
        mode,
        programId,
        owned ? body.entitlementId : null,
      ],
    );
      // How often each question has been in a real test (the question pool's exposure).
      if (mode === "certified") await client.query(`UPDATE items SET certified_exposures = certified_exposures + 1 WHERE id = ANY($1::uuid[])`, [itemIds]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

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
    // Reloading a mock that ran out of time with nothing answered: it's set
    // aside (comes back as completed), not finished with every question skipped.
    await setAsideExpiredMocks(req.user!.id);
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
    if (!isTimed(session.delivery_mode)) return res.json({ secondsLeft: null });
    const shownAt = await recordView(session.id, itemId);
    res.json({ secondsLeft: secondsLeft(session.composition as MockComposition, itemId, shownAt), ...mockTiming(session.composition as MockComposition) });
  } catch (err) {
    next(err);
  }
});

practiceTestsRouter.post("/session/:sessionId/attempts", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (isPhoneUserAgent(req.headers["user-agent"])) return res.status(403).json({ error: "computer_required" });
    let body = submitAttemptSchema.parse(req.body);

    const session = await openSessionOf(req);
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });
    const blocked = await proctoringBlock(session.id, req.user!.id);
    if (blocked) return res.status(409).json({ error: blocked });

    // Mock: forward only, and an answer after the question's time counts as
    // unanswered (the server's clock, not the browser's).
    let late = false;
    if (isTimed(session.delivery_mode)) {
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

    // noisy: loud background noise in a recorded answer, so the learner can
    // move somewhere quieter before the next one (a mock too: it's about the
    // room, not the answer's score).
    const { attemptId, grade, wasCorrect, noisy } = graded;
    const correct = grade.status === "scored" ? wasCorrect : grade.correct;
    if (isTimed(session.delivery_mode)) return res.status(201).json({ attemptId, status: grade.status, late, noisy });
    // Practice: the correct answer and the grader's reason come back at once
    // (a recorded answer's once its background grading is done; see /feedback).
    const answered = !!(body.responseText || body.audioBase64);
    const feedback = answered ? await practiceFeedback(session.id, body.itemId) : null;
    res.status(201).json({ attemptId, status: grade.status, correct, feedback, noisy });
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
    if (isTimed(session.delivery_mode)) return res.status(403).json({ error: "no_feedback_in_mock" });
    const feedback = await practiceFeedback(session.id, String(req.params.itemId));
    if (!feedback) return res.status(404).json({ error: "not_answered" });
    res.json({ feedback });
  } catch (err) {
    next(err);
  }
});

// Unlike Placement, completing a mock-exam session never writes a placements
// or roadmap row — it's practice, not a certification (same rule as the
// existing practice router's /session/:id/complete). The work is in
// completeSession (complete.ts), which also finishes timed tests left open
// past their deadline.
practiceTestsRouter.post("/session/:sessionId/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const found = await completeSession(req.params.sessionId as string, req.user!.id, req.user!.role, req.ip, (body) => res.json(body));
    if (!found) res.status(404).json({ error: "session_not_found" });
  } catch (err) {
    if (!res.headersSent) return next(err);
    console.error("practiceTests /complete failed after the result was sent:", err);
  }
});
