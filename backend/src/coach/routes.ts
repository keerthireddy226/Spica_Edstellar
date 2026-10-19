// Tutor (Coach Mode) — one open-ended Gemini conversation per learner, resumed each visit.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { getCoachReply, COACH_OPENING_LINE, type CoachTurn } from "./coachGemini.js";
import { learnerContext } from "./learnerContext.js";

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

function toTurnPayload(row: { speaker: "learner" | "agent"; transcript: string }) {
  return { speaker: row.speaker, text: row.transcript };
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
        `SELECT speaker, transcript FROM coach_turns WHERE session_id = $1 ORDER BY turn_index ASC`,
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
