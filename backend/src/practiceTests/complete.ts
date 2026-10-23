// Finishing a practice test, mock or real attempt: the learner's /complete,
// and the periodic sweep for timed tests left open past their deadline.
import { pool } from "../db.js";
import { finishPendingSpeaking, gradeAndSaveAttempt } from "../attemptGrading.js";
import { checkAndAwardBadges } from "../gamification/stats.js";
import { applyTestLevels } from "../learner/path.js";
import { rebuildRoadmap } from "../roadmap/save.js";
import { finishProctoredSession } from "../proctoring/analyze.js";
import { recordCandidateResult } from "../recruitment/service.js";
import { auditTestCompleted } from "../audit/testEvents.js";
import { testTypeOfExam } from "../catalogue/service.js";
import { recordProgramSession } from "../programs/service.js";
import { ongoingPauseSeconds, type MockComposition } from "./modes.js";
import { enqueue } from "../queue/queue.js";
import { bandForLevel, familyScoreScale, isTimed, type DeliveryMode } from "./modes.js";
import { levelTestOutcome, loadScoreRows, summarizeScores, unscoredCount } from "./sessionScore.js";

// Finishes one of the user's tests and works out its result. onResult gets
// the learner's result as soon as it's worked out (the /complete response);
// proctoring, the report, the program schedule and badges follow. Returns
// false when the session isn't this user's test.
//
// Idempotent: a session already marked complete (e.g. the first /complete
// call actually succeeded server-side but the client never saw the
// response — the exact "stuck on the last question forever" bug this
// fixes) just gets its real score recomputed and returned again, instead
// of a 404 that leaves the learner with no way to see their result.
async function recordUnfinishedHold(sessionId: string, c: MockComposition): Promise<void> {
  const si = (await pool.query(`SELECT user_id FROM session_integrity WHERE session_id = $1`, [sessionId])).rows[0];
  if (!si || !c.noisePause) return;
  const seconds = Math.round(ongoingPauseSeconds(c));
  const reason = c.noisePause.reason ?? "noise";
  await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity, detail) VALUES ($1, $2, 'test_hold', 'info', $3)`, [
    sessionId,
    si.user_id,
    JSON.stringify({ itemId: c.noisePause.itemId, event: "end", seconds, holdReason: reason, reason: `Test paused ${seconds} s for ${reason.replace("_", " ")}; the test ended while paused` }),
  ]);
  await pool.query(`UPDATE sessions SET composition = composition - 'noisePause' WHERE id = $1`, [sessionId]);
}

export async function completeSession(
  sessionId: string,
  userId: string,
  role: string,
  ip?: string,
  onResult?: (body: Record<string, unknown>) => void,
): Promise<boolean> {
  const respond = onResult ?? (() => {});
  // Only the first /complete finishes the test (and is audited).
  let justFinished = false;
  const sessionExists = await pool.query(
    `SELECT id, test_code, delivery_mode, composition FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'mocktest'`,
    [sessionId, userId],
  );
  if (sessionExists.rows[0]) {
    const u = await pool.query(`UPDATE sessions SET completed_at = now() WHERE id = $1 AND completed_at IS NULL`, [sessionId]);
    justFinished = (u.rowCount ?? 0) > 0;
    // Finished while paused for a problem in the room: the pause is recorded
    // for the reviewer now (it would otherwise only be recorded when it ended).
    const held = sessionExists.rows[0].composition as MockComposition | null;
    if (justFinished && held?.noisePause) await recordUnfinishedHold(sessionId, held).catch((err) => console.error("practiceTests /complete: hold record failed:", err));
  }
  if (!sessionExists.rows[0]) return false;
  const deliveryMode: DeliveryMode = sessionExists.rows[0].delivery_mode ?? "practice";
  const composition = sessionExists.rows[0].composition ?? {};

  // A mock's questions never reached (time ran out, or the learner ended
  // early) count as unanswered in the report.
  if (justFinished && isTimed(deliveryMode)) {
    try {
      const done = await pool.query(`SELECT item_id FROM attempts WHERE session_id = $1`, [sessionId]);
      const answered = new Set(done.rows.map((r) => r.item_id));
      for (const itemId of ((composition.itemIds as string[]) ?? []).filter((id) => !answered.has(id))) {
        await gradeAndSaveAttempt(sessionId, { itemId });
      }
    } catch (err) {
      console.error("practiceTests /complete: recording unanswered mock questions failed:", err);
    }
  }

  // Recorded answers graded in the background must count in the result.
  await finishPendingSpeaking(sessionId).catch((err) => console.error("practiceTests /complete: speaking grading failed:", err));

  // The session is now genuinely done — a crash computing the score
  // breakdown below must never leave the learner stuck mid-test with an
  // error and no way forward. Fall back to a minimal "you finished, score
  // pending" response instead of failing the whole request.
  try {
    const scored = summarizeScores(await loadScoreRows(sessionId));
    const { rows, graded, rowCorrect, correctCount, pendingCount, failedCount, skippedCount, level, overall } = scored;

    const partLabels = [...new Set(rows.map((r) => r.part_label))];
    const partResults = partLabels.map((label) => {
      const partRows = graded.filter((r) => r.part_label === label);
      return { label, gradedCount: partRows.length, correctCount: partRows.filter(rowCorrect).length };
    });

    // A mock's estimated score range on the exam family's scale, where it publishes one.
    // A short form isn't the exam's format, so its score range wouldn't mean anything.
    const scale = (deliveryMode === "mock" || deliveryMode === "certified") && !composition.shortForm ? await familyScoreScale((composition.testTypeId as string | undefined) ?? (await testTypeOfExam(composition.examId))) : null;
    const skillScoreBands = level?.skillLevels
      ? Object.fromEntries(Object.entries(level.skillLevels as Record<string, string | null>).map(([k, v]) => [k, bandForLevel(scale, v)]))
      : null;
    if (justFinished) {
      const unscored = unscoredCount(scored);
      // Kept for programs (the learner's latest level) and reports.
      await pool.query(`UPDATE sessions SET result = $2 WHERE id = $1`, [
        sessionId,
        JSON.stringify({
          cefrLevel: level?.cefrLevel ?? null,
          skillLevels: level?.skillLevels ?? null,
          // Each skill's share right, for its Spica score in batch reports.
          skillPercents: level?.skillPercents ?? null,
          overallPercent: overall,
          scoreBand: bandForLevel(scale, level?.cefrLevel),
          // Answers still being scored (or whose scoring failed): the result is
          // saved again once they are (settleResults), and this is cleared.
          ...(unscored > 0 ? { unscored } : {}),
          // A level test: passed at 70% overall and at least 50% in each skill,
          // decided once every answer is scored.
          ...(composition.levelTest
            ? {
                levelTest: await levelTestOutcome(composition.levelTest as string, scored),
              }
            : {}),
        }),
      ]);
      await auditTestCompleted(sessionId, { cefrLevel: level?.cefrLevel, overallPercent: overall, answered: rows.length - skippedCount, skipped: skippedCount }, ip).catch(() => {});
      // Each skill's level against the learner's Practice Modules path: a
      // higher one lifts the path (and the plan); a lower one is shown with a
      // nudge to take a level check, never lowering the path by itself.
      // A sample is too short to say anything about levels.
      if (role === "learner" && deliveryMode !== "sample") {
        const pathCompare = await applyTestLevels(userId, (level?.skillLevels as Record<string, unknown> | undefined) ?? null).catch((err) => {
          console.error("applyTestLevels failed:", err);
          return {};
        });
        await pool.query(`UPDATE sessions SET result = result || $2::jsonb WHERE id = $1`, [sessionId, JSON.stringify({ pathCompare })]);
        if (Object.values(pathCompare).some((x) => x?.action === "raised")) await rebuildRoadmap(userId).catch(() => false);
      }
    }
    const pathCompare = (await pool.query(`SELECT result->'pathCompare' AS pc FROM sessions WHERE id = $1`, [sessionId])).rows[0]?.pc ?? null;
    respond({
      // Each skill's level here against the learner's Practice Modules path.
      pathCompare,
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
    respond({ testCode: sessionExists.rows[0].test_code, deliveryMode, gradedCount: 0, correctCount: 0, pendingCount: 0, skippedCount: 0, failedCount: 0, overallPercent: 0, partResults: [] });
  }

  // Proctoring analysis is best-effort too: the learner already has their result.
  try {
    await finishProctoredSession(sessionId);
  } catch (err) {
    console.error("practiceTests /complete: proctoring analysis failed (non-fatal):", err);
  }

  // The feedback report is built in the background (a real attempt has its score report only).
  if (justFinished && deliveryMode !== "certified") {
    await enqueue("report.build", { sessionId }, { dedupeKey: `report.build:${sessionId}`, maxAttempts: 5 }).catch((err) =>
      console.error("practiceTests /complete: report not queued:", err),
    );
  }

  // A finished test ticks off the learner's program schedule.
  if (justFinished) {
    try {
      await recordProgramSession(userId, sessionId, deliveryMode);
    } catch (err) {
      console.error("practiceTests /complete: program schedule update failed (non-fatal):", err);
    }
  }

  // A candidate's result goes to the recruiter.
  try {
    await recordCandidateResult(userId, sessionId);
  } catch (err) {
    console.error("practiceTests /complete: candidate result failed (non-fatal):", err);
  }
  if (role === "candidate") return true;

  // Badge-checking is best-effort and must never affect the response above
  // (already sent) or retroactively fail a completion that already succeeded.
  try {
    await checkAndAwardBadges(userId);
  } catch (err) {
    console.error("practiceTests /complete: badge check failed (non-fatal):", err);
  }
  return true;
}

// Periodic: a timed test (a mock, a real attempt or a sample) with answers,
// left open more than a minute past its deadline (the tab was closed, the
// connection dropped), is finished as /complete would have finished it, so its
// result, proctoring review and certificate don't wait for the learner to come
// back. One with nothing answered is set aside when the learner returns
// (setAsideExpiredMocks in routes.ts). Returns how many were finished.
export async function finishOverdueTimedTests(): Promise<number> {
  const r = await pool.query(
    `SELECT s.id, s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.session_type = 'mocktest' AND s.delivery_mode IN ('mock', 'certified', 'sample') AND s.completed_at IS NULL
       AND (s.composition->>'deadlineAt')::timestamptz < now() - interval '60 seconds'
       AND EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
     ORDER BY s.composition->>'deadlineAt' LIMIT 50`,
  );
  let finished = 0;
  for (const s of r.rows) {
    try {
      if (await completeSession(s.id, s.user_id, s.role)) finished++;
    } catch (err) {
      console.error("overdue timed test not finished:", s.id, err);
    }
  }
  return finished;
}
