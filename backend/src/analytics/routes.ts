import { Router, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { assertFeature } from "../plans/service.js";
import { batchAnalytics, batchCsv, batchesInScope, learnersCsv, overview, type Scope } from "./service.js";

export const analyticsRouter = Router();

// Who sees what:
//  Super Admin — everyone, incl. individual learners
//  Admin       — only organizations they onboarded
//  Org Admin   — their organization
//  Manager     — only their batches
async function resolveScope(req: AuthedRequest, res: Response): Promise<(Scope & { tenantId: string | null; role: string }) | null> {
  const u = req.user!;
  if (u.role === "super_admin") return { tenantIds: null, includeIndividuals: true, label: "All learners", tenantId: null, role: u.role };
  if (u.role === "admin") {
    const r = await pool.query(`SELECT id FROM tenants WHERE managed_by = $1 AND type = 'cohort'`, [u.id]);
    return { tenantIds: r.rows.map((x) => x.id), includeIndividuals: false, label: "Organizations you onboarded", tenantId: null, role: u.role };
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
    res.json(
      await overview(scope, {
        withCompanies: scope.role === "super_admin" || scope.role === "admin",
        withRevenue: scope.role !== "manager",
      }),
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

async function batchFor(req: AuthedRequest, res: Response) {
  const scope = await resolveScope(req, res);
  if (!scope) return null;
  const batchId = String(req.params.id);
  if (!scope.tenantId || (scope.batchIds && !scope.batchIds.includes(batchId))) {
    res.status(404).json({ error: "batch_not_found" });
    return null;
  }
  await assertFeature(scope.tenantId, "batch_analytics");
  const data = await batchAnalytics(scope.tenantId, batchId);
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
