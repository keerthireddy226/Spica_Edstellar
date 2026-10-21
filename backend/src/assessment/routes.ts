import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { myTests } from "./service.js";

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
