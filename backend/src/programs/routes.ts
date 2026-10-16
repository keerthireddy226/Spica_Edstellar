import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { recordAudit } from "../audit/service.js";
import { listQuotas, updateQuota } from "./quotas.js";
import { pool } from "../db.js";
import { ProgramError, createProgram, getProgram, listPrograms, programEditSchema, programJson, programSchema, updateProgram } from "./service.js";
import { monitoringCsv, programMonitoring } from "./monitoring.js";
import { enqueue } from "../queue/queue.js";

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

// ---- Monitoring: shared by the Org Admin (/api/org-admin) and the batch's
// Managers (/api/manager, read only). ----

async function managerBatchIds(userId: string): Promise<string[]> {
  return (await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [userId])).rows.map((r) => r.batch_id as string);
}

// The program if this Org Admin's organization or this Manager's batch owns it.
async function viewableProgram(req: AuthedRequest, res: Response) {
  const role = req.user?.role;
  if (!req.user?.tenantId || (role !== "org_admin" && role !== "manager")) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const p = z.string().uuid().safeParse(req.params.id).success ? await getProgram(String(req.params.id), req.user.tenantId) : null;
  if (!p || (role === "manager" && !(await managerBatchIds(req.user.id)).includes(p.batch_id))) {
    res.status(404).json({ error: "program_not_found" });
    return null;
  }
  return p;
}

export const programViewRouter = Router();

programViewRouter.get("/programs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await viewableProgram(req, res);
    if (!p) return;
    const alerts = await pool.query(
      `SELECT a.user_id, a.kind, a.detail, a.created_at, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name
       FROM program_alerts a JOIN users u ON u.id = a.user_id WHERE a.program_id = $1 AND a.created_at > now() - interval '30 days' ORDER BY a.created_at DESC LIMIT 50`,
      [p.id],
    );
    res.json({
      program: programJson(p),
      members: await programMonitoring(p),
      alerts: alerts.rows.map((a) => ({ userId: a.user_id, name: a.name, kind: a.kind, detail: a.detail, createdAt: a.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

programViewRouter.get("/programs/:id/export.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await viewableProgram(req, res);
    if (!p) return;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="program-${p.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.csv"`);
    res.send(monitoringCsv(p, await programMonitoring(p)));
  } catch (err) {
    next(err);
  }
});

// A member's finished test report (the same report the learner sees), with
// the test's integrity status.
programViewRouter.get("/programs/:id/reports/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await viewableProgram(req, res);
    if (!p) return;
    if (!z.string().uuid().safeParse(req.params.sessionId).success) return res.status(404).json({ error: "session_not_found" });
    const s = (
      await pool.query(
        `SELECT s.id, si.status AS integrity_status, si.risk_level FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN session_integrity si ON si.session_id = s.id
         WHERE s.id = $1 AND u.batch_id = $2 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL`,
        [req.params.sessionId, p.batch_id],
      )
    ).rows[0];
    if (!s) return res.status(404).json({ error: "session_not_found" });
    const r = (await pool.query(`SELECT status, report FROM feedback_reports WHERE session_id = $1`, [s.id])).rows[0];
    if (!r || r.status === "failed") {
      await enqueue("report.build", { sessionId: s.id }, { dedupeKey: `report.build:${s.id}:${Date.now() >> 16}`, maxAttempts: 5 });
      return res.json({ status: "pending", report: null, integrity: { status: s.integrity_status, risk: s.risk_level } });
    }
    res.json({ status: r.status, report: r.report, integrity: { status: s.integrity_status, risk: s.risk_level } });
  } catch (err) {
    next(err);
  }
});

// A Manager's programs: those of the batches they manage.
programViewRouter.get("/programs", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user?.role !== "manager" || !req.user.tenantId) return next();
  try {
    const batches = await managerBatchIds(req.user.id);
    res.json({ programs: (await listPrograms(req.user.tenantId)).filter((p) => batches.includes(p.batchId)) });
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
