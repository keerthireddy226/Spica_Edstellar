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
  const ids = await randomizedFormItemIds(examId);
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
async function loadExamSession(userId: string, sessionRow: { id: string; composition: Record<string, unknown> }) {
  const itemIds: string[] = (sessionRow.composition?.itemIds as string[]) ?? [];
  const partBoundaries: PartBoundary[] = (sessionRow.composition?.partBoundaries as PartBoundary[]) ?? [];
  const itemsResult = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds, it.prep_seconds, it.min_words, it.max_words
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[])`,
    [itemIds],
  );
  const byId = new Map(itemsResult.rows.map((r) => [r.id, r]));
  const attemptsResult = await pool.query(`SELECT item_id, response_text FROM attempts WHERE session_id = $1`, [sessionRow.id]);
  const attemptByItem = new Map(attemptsResult.rows.map((r) => [r.item_id, r.response_text]));
  const items = itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      ...toItemPayload(row!),
      attempted: attemptByItem.has(row!.id),
      responseText: attemptByItem.get(row!.id) ?? null,
    }));
  return { partBoundaries, items: await withAudioUrls(userId, items) };
}

// The catalogue: exam families and their test types, with set counts and
// whether this learner's organization allows each one.
practiceTestsRouter.get("/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    const families = await listCatalogue();
    res.json({
      families: families.map((f) => ({
        ...f,
        testTypes: f.testTypes.map((t) => ({ ...t, allowed: !allowedTestProducts || allowedTestProducts.includes(t.id) })),
      })),
    });
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
           WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL
             AND s.composition->>'examId' = e.id::text
             -- Every item answered with a real response, not skipped blank —
             -- completed_at alone only means "reached the end of the list".
             AND NOT EXISTS (
               SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL
             )
         ) AS completed
       FROM exams e
       WHERE e.is_active AND e.test_type_id = $1
       ORDER BY e.code`,
      [testType.id, req.user!.id],
    );
    res.json({
      exams: result.rows.map((r) => ({ id: r.id, code: r.code, testId: r.test_id, name: r.name, itemCount: r.item_count, completed: r.completed })),
    });
  } catch (err) {
    next(err);
  }
});

const startSessionSchema = z.object({ examId: z.string().uuid() });

// Resumes any already-in-progress mocktest session for this exam instead of minting a new one.
practiceTestsRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = startSessionSchema.parse(req.body);
    // A candidate takes exactly the exam set their invitation assigned.
    if (req.user!.role === "candidate") {
      const a = await activeAssessment(req.user!.id);
      if (!a || a.exam_id !== body.examId) return res.status(403).json({ error: "candidate_not_allowed" });
    }
    const { allowedTestProducts } = req.user!.role === "candidate" ? { allowedTestProducts: null } : await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts) {
      const product = await testTypeOfExam(body.examId);
      if (!product || !allowedTestProducts.includes(product)) return res.status(403).json({ error: "product_not_enabled" });
    }

    const existing = await pool.query(
      `SELECT id, composition, test_code FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NULL
         AND composition->>'examId' = $2
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id, body.examId],
    );
    if (existing.rows[0]) {
      const { partBoundaries, items } = await loadExamSession(req.user!.id, existing.rows[0]);
      return res.json({ sessionId: existing.rows[0].id, testCode: existing.rows[0].test_code, examId: body.examId, partBoundaries, items });
    }

    // Proctored organizations give each candidate their own mix of questions.
    const { policy } = await learnerPolicy(req.user!.id);
    const randomized = policy.randomizedForms ? await selectRandomizedItems(body.examId) : null;
    const rows = randomized?.rows.length ? randomized.rows : await selectExamItems(body.examId);
    if (rows.length === 0) {
      return res.status(404).json({ error: "no_exam_items_available" });
    }
    const partBoundaries = derivePartBoundaries(rows, randomized?.rows.length ? randomized.partIdByOrder : undefined);

    const examCode = (await pool.query(`SELECT code FROM exams WHERE id = $1`, [body.examId])).rows[0]?.code ?? "";
    const testCode = newTestCode(examPrefix(examCode));
    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition, test_code)
       VALUES ($1, 'mocktest', 'coach', $2, $3) RETURNING id`,
      [
        req.user!.id,
        JSON.stringify({ examId: body.examId, itemIds: rows.map((r) => r.id), partBoundaries, randomized: !!randomized?.rows.length }),
        testCode,
      ],
    );

    await auditTestStarted(sessionResult.rows[0].id, req.ip).catch(() => {});
    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
      testCode,
      examId: body.examId,
      partBoundaries,
      items: await withAudioUrls(req.user!.id, rows.map(toItemPayload)),
    });
  } catch (err) {
    next(err);
  }
});

practiceTestsRouter.get("/session/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `SELECT id, composition, completed_at, test_code FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });

    const { partBoundaries, items } = await loadExamSession(req.user!.id, session);
    res.json({
      sessionId: session.id,
      testCode: session.test_code,
      examId: session.composition?.examId ?? null,
      completed: !!session.completed_at,
      partBoundaries,
      items,
    });
  } catch (err) {
    next(err);
  }
});

practiceTestsRouter.post("/session/:sessionId/attempts", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = submitAttemptSchema.parse(req.body);

    const sessionResult = await pool.query(
      `SELECT id, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });
    const blocked = await proctoringBlock(session.id, req.user!.id);
    if (blocked) return res.status(409).json({ error: blocked });

    // A mock exam never picks the next question from this answer, so a
    // recorded answer is graded in the background instead of making the
    // learner wait for it.
    const graded = await gradeAndSaveAttempt(session.id, body, { deferSpeaking: true });
    if (!graded) return res.status(404).json({ error: "item_not_found" });

    const { attemptId, grade, wasCorrect } = graded;
    const correct = grade.status === "scored" ? wasCorrect : grade.correct;
    res.status(201).json({ attemptId, status: grade.status, correct });
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
      `SELECT id, test_code FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
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
    if (justFinished) {
      const overall = graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : null;
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
    });
  } catch (err) {
    console.error("practiceTests /complete: score summary failed, session still marked complete:", err);
    res.json({ testCode: sessionExists.rows[0].test_code, gradedCount: 0, correctCount: 0, pendingCount: 0, skippedCount: 0, failedCount: 0, overallPercent: 0, partResults: [] });
  }

  // Proctoring analysis is best-effort too: the learner already has their result.
  try {
    await finishProctoredSession(req.params.sessionId as string);
  } catch (err) {
    console.error("practiceTests /complete: proctoring analysis failed (non-fatal):", err);
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
