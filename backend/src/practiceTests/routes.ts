import { z } from "zod";
import { learnerOrgPolicy } from "../orgAdmin/settings.js";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { submitAttemptSchema } from "../placement/schemas.js";
import { gradeAndSaveAttempt } from "../attemptGrading.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { withAudioUrls } from "../voice/itemAudio.js";
import { toItemPayload } from "../itemPayload.js";
import { checkAndAwardBadges } from "../gamification/stats.js";

export const practiceTestsRouter = Router();

// Frontend product id -> exams.code prefix (e.g. "fourskills-1"). Spellings
// differ because the frontend ids predate this backend and already have
// i18n keys (practiceTests.versantProduct.*) — translate here instead of
// renaming either side.
const PRODUCT_CODE_PREFIX: Record<string, string> = {
  fourSkills: "fourskills",
  placement: "placement",
  writing: "writing",
  professional: "professional",
  speakingListening: "speaklisten",
};
const PRODUCT_IDS = Object.keys(PRODUCT_CODE_PREFIX);

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
       it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds,
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

function derivePartBoundaries(rows: Awaited<ReturnType<typeof selectExamItems>>): PartBoundary[] {
  const boundaries: PartBoundary[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prev = boundaries[boundaries.length - 1];
    if (prev && prev.partId === row.exam_part_id) {
      prev.count++;
    } else {
      boundaries.push({ partId: row.exam_part_id, label: row.part_label, startIndex: i, count: 1 });
    }
  }
  return boundaries;
}

// Used by both the resume-below and /session/current equivalents — loads an
// exam session's items + partBoundaries + per-item attempted/responseText.
async function loadExamSession(userId: string, sessionRow: { id: string; composition: Record<string, unknown> }) {
  const itemIds: string[] = (sessionRow.composition?.itemIds as string[]) ?? [];
  const partBoundaries: PartBoundary[] = (sessionRow.composition?.partBoundaries as PartBoundary[]) ?? [];
  const itemsResult = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
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

// Set counts per product (feeds the ProductPicker's real "5 sets" copy).
practiceTestsRouter.get("/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    // Cheaper to fetch all active exam codes once and bucket in JS than run
    // 5 separate LIKE-prefix queries.
    const codesResult = await pool.query(`SELECT code FROM exams WHERE is_active`);
    const products = PRODUCT_IDS.map((id) => {
      const prefix = PRODUCT_CODE_PREFIX[id];
      const setCount = codesResult.rows.filter((r) => r.code.startsWith(`${prefix}-`)).length;
      // Products an organization switched off stay listed but closed.
      return { id, setCount, allowed: !allowedTestProducts || allowedTestProducts.includes(id) };
    });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// This product's 5 exam sets, each with its item count and this learner's completion.
practiceTestsRouter.get("/:product/exams", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const prefix = PRODUCT_CODE_PREFIX[req.params.product as string];
    if (!prefix) return res.status(404).json({ error: "unknown_product" });
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts && !allowedTestProducts.includes(req.params.product as string)) {
      return res.status(403).json({ error: "product_not_enabled" });
    }

    const result = await pool.query(
      `SELECT e.id, e.code, e.name,
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
       WHERE e.is_active AND e.code LIKE $1
       ORDER BY e.code`,
      [`${prefix}-%`, req.user!.id],
    );
    res.json({
      exams: result.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, itemCount: r.item_count, completed: r.completed })),
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
    const { allowedTestProducts } = await learnerOrgPolicy(req.user!.id);
    if (allowedTestProducts) {
      const code = (await pool.query(`SELECT code FROM exams WHERE id = $1`, [body.examId])).rows[0]?.code ?? "";
      const product = PRODUCT_IDS.find((id) => code.startsWith(`${PRODUCT_CODE_PREFIX[id]}-`));
      if (!product || !allowedTestProducts.includes(product)) return res.status(403).json({ error: "product_not_enabled" });
    }

    const existing = await pool.query(
      `SELECT id, composition FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NULL
         AND composition->>'examId' = $2
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id, body.examId],
    );
    if (existing.rows[0]) {
      const { partBoundaries, items } = await loadExamSession(req.user!.id, existing.rows[0]);
      return res.json({ sessionId: existing.rows[0].id, examId: body.examId, partBoundaries, items });
    }

    const rows = await selectExamItems(body.examId);
    if (rows.length === 0) {
      return res.status(404).json({ error: "no_exam_items_available" });
    }
    const partBoundaries = derivePartBoundaries(rows);

    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition)
       VALUES ($1, 'mocktest', 'coach', $2) RETURNING id`,
      [
        req.user!.id,
        JSON.stringify({ examId: body.examId, itemIds: rows.map((r) => r.id), partBoundaries }),
      ],
    );

    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
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
      `SELECT id, composition, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });

    const { partBoundaries, items } = await loadExamSession(req.user!.id, session);
    res.json({
      sessionId: session.id,
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

    const graded = await gradeAndSaveAttempt(session.id, body);
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
  try {
    sessionExists = await pool.query(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
      [req.params.sessionId, req.user!.id],
    );
    if (sessionExists.rows[0]) {
      await pool.query(`UPDATE sessions SET completed_at = now() WHERE id = $1 AND completed_at IS NULL`, [req.params.sessionId]);
    }
  } catch (err) {
    return next(err);
  }
  if (!sessionExists.rows[0]) return res.status(404).json({ error: "session_not_found" });

  // The session is now genuinely done — a crash computing the score
  // breakdown below must never leave the learner stuck mid-test with an
  // error and no way forward. Fall back to a minimal "you finished, score
  // pending" response instead of failing the whole request.
  try {
    const summaryResult = await pool.query(
      `SELECT sc.status, sc.content_score, sc.manner_scores, it.input_method, i.cefr_level, ep.part_label,
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

    res.json({
      gradedCount: graded.length,
      correctCount,
      pendingCount,
      skippedCount,
      failedCount,
      overallPercent: graded.length > 0 ? Math.round((correctCount / graded.length) * 100) : 0,
      partResults,
    });
  } catch (err) {
    console.error("practiceTests /complete: score summary failed, session still marked complete:", err);
    res.json({ gradedCount: 0, correctCount: 0, pendingCount: 0, skippedCount: 0, failedCount: 0, overallPercent: 0, partResults: [] });
  }

  // Badge-checking is best-effort and must never affect the response above
  // (already sent) or retroactively fail a completion that already succeeded.
  try {
    await checkAndAwardBadges(req.user!.id);
  } catch (err) {
    console.error("practiceTests /complete: badge check failed (non-fatal):", err);
  }
});
