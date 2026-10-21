import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { assertFeature } from "../plans/service.js";
import { TtlCache } from "../lib/ttlCache.js";
import { batchAnalytics, batchCsv, batchesInScope, learnersCsv, overview, type Scope } from "./service.js";
import { batchReport } from "../reports/batchReport.js";
import { scoreReport } from "../reports/scoreReport.js";
import { reportAbout } from "../reports/feedbackReport.js";

export const analyticsRouter = Router();

const overviewCache = new TtlCache<Awaited<ReturnType<typeof overview>>>(60_000, 2000);

// Who sees what:
//  Super Admin — everyone, incl. individual learners
//  Admin       — only organizations they onboarded
//  Org Admin   — their organization
//  Manager     — only their batches
async function resolveScope(req: AuthedRequest, res: Response): Promise<(Scope & { tenantId: string | null; role: string }) | null> {
  const u = req.user!;
  if (u.role === "super_admin") return { tenantIds: null, includeIndividuals: true, label: "All learners", tenantId: null, role: u.role };
  if (u.role === "admin") {
    // Reports need the "View reports" permission.
    if (!(await requirePermission(req, res, "viewReports"))) return null;
    const r = await pool.query(`SELECT id FROM tenants WHERE (managed_by = $1 OR account_manager_id = $1) AND type = 'cohort'`, [u.id]);
    return { tenantIds: r.rows.map((x) => x.id), includeIndividuals: false, label: "Your organizations", tenantId: null, role: u.role };
  }
  if (u.role === "org_admin" && u.tenantId) {
    return { tenantIds: [u.tenantId], includeIndividuals: false, label: "Your organization", tenantId: u.tenantId, role: u.role };
  }
  if (u.role === "manager" && u.tenantId) {
    const r = await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [u.id]);
    return {
      tenantIds: [u.tenantId],
      includeIndividuals: false,
      batchIds: r.rows.map((x) => x.batch_id),
      label: "Your batches",
      tenantId: u.tenantId,
      role: u.role,
    };
  }
  res.status(403).json({ error: "forbidden" });
  return null;
}

analyticsRouter.get("/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    // Heavy aggregate; a minute-old answer is fine for a dashboard.
    res.json(
      await overviewCache.getOrLoad(`${req.user!.role}:${req.user!.id}`, () =>
        overview(scope, {
          withCompanies: scope.role === "super_admin" || scope.role === "admin",
          withRevenue: scope.role !== "manager",
        }),
      ),
    );
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/batches", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    if (!scope.tenantId) return res.status(400).json({ error: "org_scope_required" });
    await assertFeature(scope.tenantId, "batch_analytics");
    res.json({ batches: await batchesInScope(scope.tenantId, scope.batchIds) });
  } catch (err) {
    next(err);
  }
});

// A batch the viewer may see (an Org Admin's organization, a Manager's own batches).
async function batchScope(req: AuthedRequest, res: Response) {
  const scope = await resolveScope(req, res);
  if (!scope) return null;
  const batchId = String(req.params.id);
  if (!scope.tenantId || (scope.batchIds && !scope.batchIds.includes(batchId))) {
    res.status(404).json({ error: "batch_not_found" });
    return null;
  }
  await assertFeature(scope.tenantId, "batch_analytics");
  return { ...scope, tenantId: scope.tenantId, batchId };
}

// Org Admins open learners' full score reports; Managers when the organization allows it.
async function canOpenReports(scope: { role: string; tenantId: string }): Promise<boolean> {
  if (scope.role !== "manager") return true;
  const r = await pool.query(`SELECT managers_see_reports FROM tenants WHERE id = $1`, [scope.tenantId]);
  return !!r.rows[0]?.managers_see_reports;
}

async function batchFor(req: AuthedRequest, res: Response) {
  const scope = await batchScope(req, res);
  if (!scope) return null;
  const data = await batchAnalytics(scope.tenantId, scope.batchId);
  if (!data) {
    res.status(404).json({ error: "batch_not_found" });
    return null;
  }
  return data;
}

analyticsRouter.get("/batches/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await batchFor(req, res);
    if (data) res.json(data);
  } catch (err) {
    next(err);
  }
});

const periodQuery = z.object({
  period: z.enum(["since_start", "last_30", "quarter", "custom"]).default("since_start"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

analyticsRouter.get("/batches/:id/report", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await batchScope(req, res);
    if (!scope) return;
    const q = periodQuery.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "invalid_period" });
    const data = await batchReport(scope.tenantId, scope.batchId, { ...q.data, canOpenReports: await canOpenReports(scope) });
    if (!data) return res.status(404).json({ error: "batch_not_found" });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// A learner's score report (their latest mock test), opened from the Batch report.
analyticsRouter.get("/batches/:id/reports/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await batchScope(req, res);
    if (!scope) return;
    if (!(await canOpenReports(scope))) return res.status(403).json({ error: "reports_not_shared" });
    if (!z.string().uuid().safeParse(req.params.sessionId).success) return res.status(404).json({ error: "session_not_found" });
    const s = (
      await pool.query(
        `SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = $1 AND u.batch_id = $2 AND u.tenant_id = $3 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL`,
        [req.params.sessionId, scope.batchId, scope.tenantId],
      )
    ).rows[0];
    if (!s) return res.status(404).json({ error: "session_not_found" });
    const r = (await pool.query(`SELECT report FROM feedback_reports WHERE session_id = $1 AND status = 'ready'`, [s.id])).rows[0];
    const score = await scoreReport(s.id, r?.report ?? null);
    if (!score?.overall) return res.status(404).json({ error: "report_not_ready" });
    res.json({ score, about: await reportAbout(s.id), analysis: r?.report?.analysis ?? "" });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/batches/:id/export.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const data = await batchFor(req, res);
    if (!data) return;
    res
      .type("text/csv")
      .attachment(`${data.batch.batchCode ?? "batch"}-learners-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(batchCsv(data));
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/learners/export.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) return;
    res.type("text/csv").attachment(`spica-learners-${new Date().toISOString().slice(0, 10)}.csv`).send(await learnersCsv(scope));
  } catch (err) {
    next(err);
  }
});
