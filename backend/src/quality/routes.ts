import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission, requireStaff } from "../admin/staff.js";
import { recordAudit } from "../audit/service.js";
import { AppealError, claimAppeal, decideAppeal, fairnessStudy, listAppeals, orgAppeals, poolReport, technicalReport } from "./service.js";
import { qualitySettings, saveQualitySettings } from "./settings.js";

// Assessment quality (Spica staff): settings, the question pool, the speaking
// fairness study, the technical report and appeals.
export const qualityRouter = Router();

function handle(err: unknown, res: Response, next: (e: unknown) => void) {
  if (err instanceof AppealError) return res.status(err.status).json({ error: err.code });
  next(err);
}

qualityRouter.get("/settings", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    res.json(await qualitySettings());
  } catch (err) {
    next(err);
  }
});

qualityRouter.put("/settings", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const body = z
      .object({
        levelPassOverall: z.number().int().min(30).max(100),
        levelSkillMin: z.number().int().min(0).max(100),
        levelRetakeDays: z.number().int().min(0).max(90),
        exposureCap: z.number().int().min(1).max(10000),
        appealDays: z.number().int().min(1).max(90),
      })
      .partial()
      .parse(req.body);
    const saved = await saveQualitySettings(body, req.user!.id);
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "quality.settings_changed", details: body, ip: req.ip });
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

qualityRouter.get("/pool", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    res.json(await poolReport());
  } catch (err) {
    next(err);
  }
});

qualityRouter.get("/fairness", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const q = z.object({ days: z.coerce.number().int().min(7).max(730).default(180) }).parse(req.query);
    res.json(await fairnessStudy(q.days));
  } catch (err) {
    next(err);
  }
});

qualityRouter.get("/technical", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const q = z.object({ testType: z.string().min(1).max(60) }).parse(req.query);
    res.json(await technicalReport(q.testType));
  } catch (err) {
    next(err);
  }
});

// The shared score-review queue: the Super Admin and Admins with the "score review" permission.
qualityRouter.get("/appeals", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    res.json({ appeals: await listAppeals(req.query.status === "all" ? "all" : "open") });
  } catch (err) {
    next(err);
  }
});

// Takes a request (the Super Admin can take one from someone else).
qualityRouter.post("/appeals/:id/claim", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    await claimAppeal(String(req.params.id), req.user!.id, req.user!.role === "super_admin" && req.body?.force === true);
    res.json({ ok: true });
  } catch (err) {
    handle(err, res, next);
  }
});

// An organization's own people's requests and outcomes (read-only; Edstellar decides).
qualityRouter.get("/org-appeals", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!req.user || !["org_admin", "manager", "recruiter"].includes(req.user.role) || !req.user.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    res.json({ appeals: await orgAppeals(req.user.tenantId) });
  } catch (err) {
    next(err);
  }
});

qualityRouter.post("/appeals/:id/decide", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    const body = z.object({ outcome: z.enum(["upheld", "changed", "new_attempt", "noted"]), note: z.string().trim().min(1).max(2000) }).parse(req.body);
    await decideAppeal(String(req.params.id), body.outcome, body.note, req.user!.id);
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "quality.appeal_decided", details: { id: req.params.id, outcome: body.outcome }, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    handle(err, res, next);
  }
});
