import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { recordAudit } from "../audit/service.js";
import { listQuotas, updateQuota } from "./quotas.js";
import { ProgramError, createProgram, getProgram, listPrograms, programEditSchema, programJson, programMembers, programSchema, updateProgram } from "./service.js";

// Org Admin: programs for the organization's batches. Mounted under /api/org-admin.
export const programsAdminRouter = Router();

function orgAdminTenant(req: AuthedRequest, res: Response): string | null {
  if (req.user?.role !== "org_admin" || !req.user.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return req.user.tenantId;
}

const PROGRAM_ERROR_STATUS: Record<ProgramError["code"], number> = {
  batch_not_found: 404,
  program_not_found: 404,
  batch_not_active: 409,
  batch_has_program: 409,
  unknown_test_type: 400,
  test_type_not_enabled: 400,
  bad_dates: 400,
};

function programError(err: unknown, res: Response): boolean {
  if (!(err instanceof ProgramError)) return false;
  res.status(PROGRAM_ERROR_STATUS[err.code]).json({ error: err.code });
  return true;
}

programsAdminRouter.get("/programs", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdminTenant(req, res);
  if (!tenantId) return;
  try {
    res.json({ programs: await listPrograms(tenantId) });
  } catch (err) {
    next(err);
  }
});

programsAdminRouter.post("/programs", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdminTenant(req, res);
  if (!tenantId) return;
  try {
    const p = await createProgram(tenantId, req.user!.id, programSchema.parse(req.body));
    res.status(201).json(programJson(p));
  } catch (err) {
    if (!programError(err, res)) next(err);
  }
});

programsAdminRouter.get("/programs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdminTenant(req, res);
  if (!tenantId) return;
  try {
    const p = z.string().uuid().safeParse(req.params.id).success ? await getProgram(String(req.params.id), tenantId) : null;
    if (!p) return res.status(404).json({ error: "program_not_found" });
    res.json({ program: programJson(p), members: await programMembers(p) });
  } catch (err) {
    next(err);
  }
});

programsAdminRouter.patch("/programs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdminTenant(req, res);
  if (!tenantId) return;
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) return res.status(404).json({ error: "program_not_found" });
    const p = await updateProgram(tenantId, String(req.params.id), programEditSchema.parse(req.body));
    res.json(programJson(p));
  } catch (err) {
    if (!programError(err, res)) next(err);
  }
});

// Super Admin: the monthly practice and mock limits per segment and tier.
// Mounted under /api/admin.
export const quotasAdminRouter = Router();

quotasAdminRouter.get("/plan-quotas", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!["admin", "super_admin"].includes(req.user?.role ?? "")) return res.status(403).json({ error: "forbidden" });
  try {
    res.json({ quotas: await listQuotas() });
  } catch (err) {
    next(err);
  }
});

const limit = z.number().int().min(0).max(1000).nullable();
const quotaSchema = z.object({ practicePerMonth: limit, mocksPerMonth: limit, reportLevel: z.enum(["summary", "full"]) });

quotasAdminRouter.put("/plan-quotas/:segment/:tier", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user?.role !== "super_admin") return res.status(403).json({ error: "forbidden" });
  try {
    const body = quotaSchema.parse(req.body);
    const segment = String(req.params.segment);
    const tier = String(req.params.tier);
    if (!(await updateQuota(segment, tier, body))) return res.status(404).json({ error: "quota_not_found" });
    await recordAudit({
      tenantId: null,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: "plan.quota_changed",
      targetType: "plan",
      targetLabel: `${segment} ${tier}`,
      details: body,
      ip: req.ip ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
