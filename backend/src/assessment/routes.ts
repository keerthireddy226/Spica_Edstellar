import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { z } from "zod";
import { AttemptError, chooseFinalTest, myTests, readiness, switchPrepTest, switchQuote } from "./service.js";
import { AppealError, fileAppeal } from "../quality/service.js";

// Assessment (once "My tests"): the learner's real assessment attempts. Starting one goes through
// POST /api/practice-tests/session with mode "certified" (or "sample").
export const assessmentRouter = Router();

assessmentRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ tests: await myTests(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// My journey's final step: predicted level from mock tests, the goal, the final assessment.
assessmentRouter.get("/readiness", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json(await readiness(req.user!.id));
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

// What switching preparation to another test costs: free for the same price
// or less, else the difference (paid through POST /payments/switch-orders).
assessmentRouter.get("/:id/switch-quote", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const q = z.object({ testTypeId: z.string().min(1).max(60) }).parse(req.query);
    res.json(await switchQuote(req.user!.id, String(req.params.id), q.testTypeId));
  } catch (err) {
    if (err instanceof AttemptError) return res.status(400).json({ error: err.code });
    next(err);
  }
});

// Switches preparation to another test (once, in the first 7 days) when it's
// free; a dearer test answers 402 with what it costs.
assessmentRouter.post("/:id/switch", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ testTypeId: z.string().min(1).max(60) }).parse(req.body);
    await switchPrepTest(req.user!.id, String(req.params.id), body.testTypeId);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AttemptError) return res.status(err.code === "payment_required" ? 402 : 400).json({ error: err.code, ...err.detail });
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
