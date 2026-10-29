import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requireStaff } from "../admin/staff.js";
import { FEEDBACK_ISSUES, feedbackDue, feedbackSummary, saveFeedback } from "./service.js";

export const feedbackRouter = Router();

const feedbackSchema = z.object({
  skipped: z.boolean().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  smooth: z.boolean().nullable().optional(),
  issues: z.array(z.enum(FEEDBACK_ISSUES)).max(5).optional(),
  recommend: z.number().int().min(0).max(10).nullable().optional(),
  suggestion: z.string().max(2000).nullable().optional(),
});

feedbackRouter.get("/sessions/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ due: await feedbackDue(req.user!.id, String(req.params.sessionId)) });
  } catch (err) {
    next(err);
  }
});

feedbackRouter.post("/sessions/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = feedbackSchema.parse(req.body);
    const saved = await saveFeedback(req.user!.id, String(req.params.sessionId), body);
    res.status(saved ? 201 : 409).json({ ok: saved });
  } catch (err) {
    next(err);
  }
});

feedbackRouter.get("/summary", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    res.json(await feedbackSummary(Number(req.query.days) || 30));
  } catch (err) {
    next(err);
  }
});
