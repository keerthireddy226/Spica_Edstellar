// Tutor (Coach Mode) — one open-ended Gemini conversation per learner, resumed each visit.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { getCoachReply, getCoachedFeedback, COACH_OPENING_LINE, type CoachTurn } from "./coachGemini.js";
import { clearLearnerContext, learnerContext } from "./learnerContext.js";
import { COACH_DAILY_QUESTIONS, COACH_SKILLS, coachPracticeSession, pickCoachQuestion, questionForExplanation, questionPayload, questionsToday } from "./practice.js";
import { gradeAndSaveAttempt } from "../attemptGrading.js";
import { practiceFeedback } from "../practiceTests/modes.js";
import { retryItems } from "../learner/insights.js";
import type { SkillTag } from "../gamification/stats.js";

export const coachRouter = Router();

const MAX_MESSAGE_LENGTH = 500;
const sendMessageSchema = z.object({ text: z.string().min(1).max(MAX_MESSAGE_LENGTH) });

// Skipped outside production so local dev/QA never gets locked out.
const coachMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
  handler: (_req, res) => {
    res.status(429).json({ error: "too_many_attempts" });
  },
});

// payload: a coached question, the learner's answer to it, or its result.
function toTurnPayload(row: { speaker: "learner" | "agent"; transcript: string; payload?: unknown }) {
  return { speaker: row.speaker, text: row.transcript, payload: row.payload ?? null };
}

// Resumes the learner's in-progress coach session, or starts a fresh one.
coachRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT id FROM sessions WHERE user_id = $1 AND session_type = 'coach' AND completed_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id],
    );

    if (existing.rows[0]) {
      const turnsResult = await pool.query(
        `SELECT speaker, transcript, payload FROM coach_turns WHERE session_id = $1 ORDER BY turn_index ASC`,
        [existing.rows[0].id],
      );
      return res.json({ sessionId: existing.rows[0].id, turns: turnsResult.rows.map(toTurnPayload) });
    }

    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode) VALUES ($1, 'coach', 'coach') RETURNING id`,
      [req.user!.id],
    );
    const sessionId = sessionResult.rows[0].id;
    await pool.query(`INSERT INTO coach_turns (session_id, turn_index, speaker, transcript) VALUES ($1, 0, 'agent', $2)`, [
      sessionId,
      COACH_OPENING_LINE,
    ]);
    res.status(201).json({ sessionId, turns: [{ speaker: "agent", text: COACH_OPENING_LINE }] });
  } catch (err) {
    next(err);
  }
});

// Ends the current conversation so the next POST /session starts a genuinely
// new one, instead of resuming this one forever.
coachRouter.post("/session/:sessionId/end", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    await pool.query(
      `UPDATE sessions SET completed_at = now() WHERE id = $1 AND user_id = $2 AND session_type = 'coach' AND completed_at IS NULL`,
      [req.params.sessionId, req.user!.id],
    );
    // Its coached practice ends with it.
    await pool.query(
      `UPDATE sessions SET completed_at = now() WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL
         AND composition->>'coach' = 'true' AND composition->>'coachSessionId' = $2`,
      [req.user!.id, req.params.sessionId],
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

coachRouter.post("/session/:sessionId/messages", requireAuth, coachMessageLimiter, async (req: AuthedRequest, res, next) => {
  // Started outside the transaction (cached per learner); a failure only
  // costs personalization, never the reply.
  const contextPromise = learnerContext(req.user!.id).catch((err) => {
    console.error("coach learnerContext failed:", err);
    return "";
  });
  const client = await pool.connect();
  try {
    const body = sendMessageSchema.parse(req.body);
    await client.query("BEGIN");

    // Locks the session row for the rest of this transaction, so a
    // double-click or a second tab sending at the same moment serializes
    // instead of both computing the same turn_index (see the coach_turns
    // unique index, added as a backstop for the same race).
    const sessionResult = await client.query(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'coach' AND completed_at IS NULL FOR UPDATE`,
      [req.params.sessionId, req.user!.id],
    );
    if (!sessionResult.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }

    const existingTurnsResult = await client.query(
      `SELECT turn_index, speaker, transcript FROM coach_turns WHERE session_id = $1 ORDER BY turn_index ASC`,
      [req.params.sessionId],
    );
    const nextIndex = existingTurnsResult.rows.length;
    const history: CoachTurn[] = existingTurnsResult.rows.map((r) => ({ speaker: r.speaker, transcript: r.transcript }));
    history.push({ speaker: "learner", transcript: body.text });

    await client.query(`INSERT INTO coach_turns (session_id, turn_index, speaker, transcript) VALUES ($1, $2, 'learner', $3)`, [
      req.params.sessionId,
      nextIndex,
      body.text,
    ]);

    // Fails closed — a real API hiccup still gets a reply shown (never a
    // silent dead end mid-conversation), just an honest one instead of a
    // fabricated coach line.
    const reply =
      (await getCoachReply(history, await contextPromise)) ?? "Sorry, I'm having trouble replying right now — please try again in a moment.";

    await client.query(`INSERT INTO coach_turns (session_id, turn_index, speaker, transcript) VALUES ($1, $2, 'agent', $3)`, [
      req.params.sessionId,
      nextIndex + 1,
      reply,
    ]);

    await client.query("COMMIT");
    res.status(201).json({ reply });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// ---- Coached practice: a question from the practice bank, marked by Spica ----

// Adds turns at the end of a conversation (locked, so two requests can't take
// the same turn numbers).
// resultFor: only if this question has no result turn yet (else "exists").
async function appendTurns(
  sessionId: string,
  userId: string,
  turns: { speaker: "learner" | "agent"; text: string; payload: unknown }[],
  resultFor?: string,
): Promise<boolean | "exists"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const s = await client.query(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = 'coach' AND completed_at IS NULL FOR UPDATE`,
      [sessionId, userId],
    );
    if (!s.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    if (resultFor) {
      const has = await client.query(`SELECT 1 FROM coach_turns WHERE session_id = $1 AND payload->>'kind' = 'result' AND payload->>'itemId' = $2`, [sessionId, resultFor]);
      if (has.rowCount) {
        await client.query("ROLLBACK");
        return "exists";
      }
    }
    let index = (await client.query(`SELECT count(*)::int AS n FROM coach_turns WHERE session_id = $1`, [sessionId])).rows[0].n as number;
    for (const t of turns) {
      await client.query(`INSERT INTO coach_turns (session_id, turn_index, speaker, transcript, payload) VALUES ($1, $2, $3, $4, $5)`, [
        sessionId,
        index++,
        t.speaker,
        t.text,
        JSON.stringify(t.payload),
      ]);
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SKILL_NAME: Record<SkillTag, string> = { listening: "listening", speaking: "speaking", reading: "reading", writing: "writing" };
const practiceSchema = z.object({ skill: z.enum(["listening", "speaking", "reading", "writing"]).optional(), retry: z.boolean().optional() });

// The coach gives the learner a question: their weakest skill (or the one they
// chose), at their level, or a mistake to retry.
coachRouter.post("/session/:sessionId/practice", requireAuth, coachMessageLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = practiceSchema.parse(req.body ?? {});
    const userId = req.user!.id;
    if ((await questionsToday(userId)) >= COACH_DAILY_QUESTIONS) return res.status(429).json({ error: "coach_daily_limit", limit: COACH_DAILY_QUESTIONS });
    const picked = await pickCoachQuestion(userId, req.params.sessionId as string, { skill: body.skill as SkillTag | undefined, retry: body.retry });
    if (!picked) return res.status(404).json({ error: "no_practice_items_available" });
    const q = await questionPayload(userId, picked.itemId);
    if (!q) return res.status(404).json({ error: "no_practice_items_available" });
    const text = picked.retry
      ? `Let's try one you got wrong before: ${q.typeName}, ${SKILL_NAME[picked.skill]}.`
      : `Here's a question for your ${SKILL_NAME[picked.skill]}: ${q.typeName}, level ${q.level ?? picked.level}. Take your time.`;
    const payload = { kind: "question", skill: picked.skill, retry: picked.retry, typeName: q.typeName, level: picked.retry ? (q.level ?? picked.level) : picked.level, item: q.item };
    if ((await appendTurns(req.params.sessionId as string, userId, [{ speaker: "agent", text, payload }])) === false) return res.status(404).json({ error: "session_not_found" });
    res.status(201).json({ turn: { speaker: "agent", text, payload } });
  } catch (err) {
    next(err);
  }
});

const answerSchema = z.object({
  itemId: z.string().uuid(),
  responseText: z.string().max(5000).optional(),
  // A spoken answer (speaking questions): the recording, as in Practice Modules.
  audioBase64: z.string().max(8_000_000).optional(),
  audioMimeType: z.string().max(100).optional(),
  durationMs: z.number().positive().optional(),
  activeMs: z.number().int().min(0).optional(),
});

type QuestionPayload = { kind: string; skill?: SkillTag; item?: { id: string } };

// This conversation's turns about one question.
async function questionTurns(sessionId: string, userId: string, itemId: string) {
  return (
    await pool.query(
      `SELECT t.payload FROM coach_turns t JOIN sessions s ON s.id = t.session_id
       WHERE t.session_id = $1 AND s.user_id = $2 AND s.completed_at IS NULL AND (t.payload->>'itemId' = $3 OR t.payload->'item'->>'id' = $3)
       ORDER BY t.turn_index`,
      [sessionId, userId, itemId],
    )
  ).rows.map((r) => r.payload as QuestionPayload);
}

// The coach's explanation of a marked answer, added as the result turn
// (once: a second request for the same answer returns the first one).
async function explainResult(userId: string, sessionId: string, skill: SkillTag, itemId: string, practiceSessionId: string) {
  const feedback = await practiceFeedback(practiceSessionId, itemId);
  clearLearnerContext(userId);
  const q = await questionForExplanation(itemId);
  const said = (await pool.query(`SELECT response_text FROM attempts WHERE session_id = $1 AND item_id = $2`, [practiceSessionId, itemId])).rows[0]?.response_text ?? "";
  const shown = q?.inputMethod === "radio" && /^\d+$/.test(String(said).trim()) ? (q.options[Number(said)] ?? said) : said;
  const retryWaiting = (await retryItems(userId, skill).catch(() => [])).length;
  const ctx = await learnerContext(userId).catch(() => "");
  const explained = q
    ? await getCoachedFeedback(
        {
          typeName: q.typeName,
          question: q.question,
          options: q.options,
          learnerAnswer: q.inputMethod === "mic" ? `(spoken) ${shown || "nothing could be heard"}` : shown,
          correct: feedback?.correct ?? null,
          score: feedback?.score ?? null,
          rightAnswer: q.right,
          reason: feedback?.reason ?? q.why,
          skill,
          retryWaiting,
        },
        ctx,
      )
    : null;
  // Without the AI: the mark and the right answer, plainly.
  const reply =
    explained ??
    (feedback?.correct
      ? "That's right, well done! Want another one?"
      : feedback?.status === "scored"
        ? `Not quite.${q?.right ? ` The answer is: ${q.right}.` : ""} Want to try another one?`
        : "Your answer is saved. I couldn't mark it right now; try another one.");
  const resultTurn = { speaker: "agent" as const, text: reply, payload: { kind: "result", itemId, skill, feedback } };
  const added = await appendTurns(sessionId, userId, [resultTurn], itemId);
  return added === "exists" ? null : resultTurn;
}

// The learner's answer: marked by Spica's scorer (as in Practice Modules), then
// explained by the coach with a suggested next step. A spoken answer is marked
// in the background: the answer turn comes back with pending, and the result
// comes from GET …/result/:itemId once it's marked.
coachRouter.post("/session/:sessionId/answer", requireAuth, coachMessageLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = answerSchema.parse(req.body);
    const userId = req.user!.id;
    const sessionId = req.params.sessionId as string;
    const turns = await questionTurns(sessionId, userId, body.itemId);
    const question = turns.find((p) => p?.kind === "question");
    if (!question?.skill || !COACH_SKILLS.includes(question.skill)) return res.status(404).json({ error: "question_not_found" });
    if (turns.some((p) => p?.kind === "answer")) return res.status(409).json({ error: "already_answered" });
    const spoken = !!body.audioBase64;
    if (!spoken && !body.responseText?.trim()) return res.status(400).json({ error: "answer_required" });

    const practiceSessionId = await coachPracticeSession(userId, sessionId, question.skill, body.itemId);
    await gradeAndSaveAttempt(
      practiceSessionId,
      {
        itemId: body.itemId,
        responseText: body.responseText,
        audioBase64: body.audioBase64,
        audioMimeType: body.audioMimeType,
        durationMs: body.durationMs,
        activeMs: body.activeMs,
      },
      { deferSpeaking: true },
    );
    const q = await questionForExplanation(body.itemId);
    const text = spoken
      ? `(spoken answer${body.durationMs ? `, ${Math.round(body.durationMs / 1000)} s` : ""})`
      : q?.inputMethod === "radio" && /^\d+$/.test((body.responseText ?? "").trim())
        ? (q.options[Number(body.responseText)] ?? body.responseText!)
        : body.responseText!;
    const answerTurn = { speaker: "learner" as const, text, payload: { kind: "answer", itemId: body.itemId, responseText: spoken ? "" : body.responseText, spoken } };
    if ((await appendTurns(sessionId, userId, [answerTurn])) === false) return res.status(404).json({ error: "session_not_found" });

    const feedback = await practiceFeedback(practiceSessionId, body.itemId);
    if (feedback?.status === "pending") return res.status(201).json({ answerTurn, pending: true });
    const resultTurn = await explainResult(userId, sessionId, question.skill, body.itemId, practiceSessionId);
    res.status(201).json({ answerTurn, resultTurn });
  } catch (err) {
    next(err);
  }
});

// A spoken answer's result, once the background marking is done.
coachRouter.get("/session/:sessionId/result/:itemId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.params.sessionId as string;
    const itemId = req.params.itemId as string;
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return res.status(404).json({ error: "question_not_found" });
    const turns = await questionTurns(sessionId, userId, itemId);
    const question = turns.find((p) => p?.kind === "question");
    if (!question?.skill || !turns.some((p) => p?.kind === "answer")) return res.status(404).json({ error: "question_not_found" });
    if (turns.some((p) => p?.kind === "result")) return res.json({ done: true });
    const practiceSessionId = await coachPracticeSession(userId, sessionId, question.skill, itemId);
    const feedback = await practiceFeedback(practiceSessionId, itemId);
    if (!feedback || feedback.status === "pending") return res.json({ pending: true });
    const resultTurn = await explainResult(userId, sessionId, question.skill, itemId, practiceSessionId);
    res.json(resultTurn ? { resultTurn } : { done: true });
  } catch (err) {
    next(err);
  }
});
