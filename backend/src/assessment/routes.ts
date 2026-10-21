import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { z } from "zod";
import { AttemptError, chooseFinalTest, myTests } from "./service.js";
import { AppealError, fileAppeal } from "../quality/service.js";

// My tests: the learner's real assessment attempts. Starting one goes through
// POST /api/practice-tests/session with mode "certified" (or "sample").
export const assessmentRouter = Router();

assessmentRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ tests: await myTests(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// Chooses the test of the final assessment included with Full access.
assessmentRouter.post("/:id/choose", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ testTypeId: z.string().min(1).max(60) }).parse(req.body);
    await chooseFinalTest(req.user!.id, String(req.params.id), body.testTypeId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AttemptError) return res.status(err.code === "attempt_not_found" ? 404 : 400).json({ error: err.code });
    next(err);
  }
});

// Appeals a real test's result (once, within the appeal window).
assessmentRouter.post("/appeals", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ sessionId: z.string().uuid(), reason: z.string().trim().min(10).max(2000) }).parse(req.body);
    res.status(201).json({ id: await fileAppeal(req.user!.id, body.sessionId, body.reason) });
  } catch (err) {
    if (err instanceof AppealError) return res.status(err.status).json({ error: err.code });
    next(err);
  }
});
