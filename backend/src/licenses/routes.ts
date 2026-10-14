import { z } from "zod";
import { Router, type NextFunction, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission, requireStaff, staffOwnsTenant } from "../admin/staff.js";
import {
  LicenseError,
  assignMonths,
  batchBudgets,
  creditPool,
  learnerAccess,
  learnerLicenseRows,
  listEvents,
  listPurchases,
  poolSummary,
  reclaimMonths,
  learnerKind,
  freeTierUsage,
  setBatchBudget,
  setManagerAllotment,
  managerPools,
  LICENSE_PRICE_CENTS,
  POOL_VALIDITY_MONTHS,
} from "./service.js";
import { assertFeature, getTenantPlan, orgUnitPriceCents } from "../plans/service.js";
import { RequestError, cancelRequest, createRequest, decideRequest, listRequests, pendingRequestCount } from "./requests.js";

export const licensesRouter = Router();

const monthsSchema = z.object({ months: z.coerce.number().int().min(1).max(24) });

function handleLicenseError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof LicenseError) {
    return res.status(err.code === "learner_not_found" ? 404 : 400).json({ error: err.code });
  }
  next(err);
}

function role(req: AuthedRequest, res: Response, roles: string[]): boolean {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// ---- Learner: own access ----

licensesRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const kind = await learnerKind(req.user!.id);
    const access = await learnerAccess(req.user!.id);
    res.json({
      required: kind === "org",
      individual: kind === "individual",
      freeTier: kind === "individual" ? await freeTierUsage(req.user!.id) : null,
      ...access,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Org Admin: their own organization's pool ----

function orgTenant(req: AuthedRequest, res: Response): string | null {
  if (!role(req, res, ["org_admin"])) return null;
  if (!req.user!.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return req.user!.tenantId;
}

licensesRouter.get("/org/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const [summary, purchases, learners, events, batches, managers, plan] = await Promise.all([
      poolSummary(tenantId),
      listPurchases(tenantId),
      learnerLicenseRows(tenantId),
      listEvents(tenantId),
      batchBudgets(tenantId),
      managerPools(tenantId),
      getTenantPlan(tenantId),
    ]);
    // The organization's own starting price (tier, negotiated or education
    // pricing), not the public rate card.
    const pricePerLicenseCents = plan ? orgUnitPriceCents(plan, 1) : LICENSE_PRICE_CENTS;
    res.json({ summary, purchases, learners, events, batches, managers, pricePerLicenseCents });
  } catch (err) {
    next(err);
  }
});

licensesRouter.get("/org/summary", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    res.json(await poolSummary(tenantId));
  } catch (err) {
    next(err);
  }
});

licensesRouter.post("/org/learners/:id/assign", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const body = monthsSchema.parse(req.body);
    res.json(await assignMonths({ tenantId, userId: String(req.params.id), months: body.months, actorId: req.user!.id, actorRole: "org_admin" }));
  } catch (err) {
    handleLicenseError(err, res, next);
  }
});

licensesRouter.post("/org/learners/:id/reclaim", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const body = monthsSchema.extend({ reason: z.string().trim().min(1).max(300) }).parse(req.body);
    const reclaimed = await reclaimMonths({
      tenantId,
      userId: String(req.params.id),
      months: body.months,
      actorId: req.user!.id,
      reason: body.reason,
    });
    res.json({ reclaimed });
  } catch (err) {
    handleLicenseError(err, res, next);
  }
});

licensesRouter.patch("/org/batches/:id/budget", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z.object({ budget: z.coerce.number().int().min(0).max(100000).nullable() }).parse(req.body);
    const ok = await setBatchBudget({ tenantId, batchId: String(req.params.id), budget: body.budget, actorId: req.user!.id });
    if (!ok) return res.status(404).json({ error: "batch_not_found" });
    res.json({ budget: body.budget });
  } catch (err) {
    handleLicenseError(err, res, next);
  }
});

licensesRouter.patch("/org/managers/:id/allotment", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const body = z.object({ allotment: z.coerce.number().int().min(0).max(100000).nullable() }).parse(req.body);
    const ok = await setManagerAllotment({ tenantId, managerId: String(req.params.id), allotment: body.allotment, actorId: req.user!.id });
    if (!ok) return res.status(404).json({ error: "manager_not_found" });
    res.json({ allotment: body.allotment });
  } catch (err) {
    handleLicenseError(err, res, next);
  }
});

// ---- Manager: their batches only, spending only their batch budget ----

async function managerScope(req: AuthedRequest, res: Response): Promise<{ tenantId: string; batchIds: string[] } | null> {
  if (!role(req, res, ["manager"])) return null;
  const result = await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [req.user!.id]);
  return { tenantId: req.user!.tenantId!, batchIds: result.rows.map((r) => r.batch_id) };
}

licensesRouter.get("/manager/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await managerScope(req, res);
    if (!scope) return;
    const [myPool] = await managerPools(scope.tenantId, [req.user!.id]);
    if (scope.batchIds.length === 0) return res.json({ batches: [], learners: [], myPool });
    const [batches, learners] = await Promise.all([
      batchBudgets(scope.tenantId, scope.batchIds),
      learnerLicenseRows(scope.tenantId, scope.batchIds),
    ]);
    res.json({ batches, learners, myPool });
  } catch (err) {
    next(err);
  }
});

licensesRouter.post("/manager/learners/:id/assign", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await managerScope(req, res);
    if (!scope) return;
    const body = monthsSchema.parse(req.body);
    const learner = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'learner' AND batch_id = ANY($2::uuid[])`, [
      String(req.params.id),
      scope.batchIds,
    ]);
    if (learner.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    res.json(
      await assignMonths({
        tenantId: scope.tenantId,
        userId: String(req.params.id),
        months: body.months,
        actorId: req.user!.id,
        actorRole: "manager",
      }),
    );
  } catch (err) {
    handleLicenseError(err, res, next);
  }
});

// ---- Admin / Super Admin: any org they can see; sales-led credits ----

// An organization staff may see; `write` also needs "Manage organizations".
async function adminOrg(req: AuthedRequest, res: Response, write = false): Promise<string | null> {
  if (!(write ? await requirePermission(req, res, "manageOrganizations") : requireStaff(req, res))) return null;
  const tenantId = String(req.params.tenantId);
  if (!(await staffOwnsTenant(req, tenantId))) {
    res.status(404).json({ error: "organization_not_found" });
    return null;
  }
  return tenantId;
}

licensesRouter.get("/admin/orgs/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res);
    if (!tenantId) return;
    const [summary, purchases, events, plan] = await Promise.all([
      poolSummary(tenantId),
      listPurchases(tenantId),
      listEvents(tenantId, 25),
      getTenantPlan(tenantId),
    ]);
    res.json({ summary, purchases, events, pricePerLicenseCents: plan ? orgUnitPriceCents(plan, 1) : LICENSE_PRICE_CENTS });
  } catch (err) {
    next(err);
  }
});

licensesRouter.post("/admin/orgs/:tenantId/credit", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res, true);
    if (!tenantId) return;
    const body = z
      .object({
        quantity: z.coerce.number().int().min(1).max(100000),
        source: z.enum(["purchase", "credit", "comp"]),
        unitPriceCents: z.coerce.number().int().min(0).optional(),
        reference: z.string().trim().max(100).optional(),
        note: z.string().trim().max(500).optional(),
        // Longer than the standard 12 months — Enterprise only.
        validityMonths: z.coerce.number().int().min(1).max(36).optional(),
      })
      .parse(req.body);
    if (body.validityMonths !== undefined && body.validityMonths !== POOL_VALIDITY_MONTHS) {
      await assertFeature(tenantId, "custom_pool_expiry");
    }
    const id = await creditPool({ tenantId, ...body, actorId: req.user!.id });
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

// ---- Allotment change requests: Manager asks, Org Admin decides ----

function handleRequestError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof RequestError) {
    return res.status(err.code === "request_not_found" ? 404 : 400).json({ error: err.code });
  }
  next(err);
}

licensesRouter.post("/manager/requests", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await managerScope(req, res);
    if (!scope) return;
    const body = z
      .object({
        kind: z.enum(["increase_allotment", "decrease_allotment", "unassign_learner"]),
        quantity: z.coerce.number().int().min(1).max(10000),
        batchId: z.string().uuid().nullable().optional(),
        learnerId: z.string().uuid().nullable().optional(),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(req.body);
    await assertFeature(scope.tenantId, "license_requests");
    const id = await createRequest({ tenantId: scope.tenantId, managerId: req.user!.id, managerBatchIds: scope.batchIds, ...body });
    res.status(201).json({ id });
  } catch (err) {
    handleRequestError(err, res, next);
  }
});

licensesRouter.get("/manager/requests", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await managerScope(req, res);
    if (!scope) return;
    res.json({ requests: await listRequests({ tenantId: scope.tenantId, requestedBy: req.user!.id }) });
  } catch (err) {
    next(err);
  }
});

licensesRouter.post("/manager/requests/:id/cancel", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const scope = await managerScope(req, res);
    if (!scope) return;
    if (!(await cancelRequest(String(req.params.id), req.user!.id))) return res.status(404).json({ error: "request_not_found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

licensesRouter.get("/org/requests", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const [requests, pending] = await Promise.all([listRequests({ tenantId }), pendingRequestCount(tenantId)]);
    res.json({ requests, pending });
  } catch (err) {
    next(err);
  }
});

licensesRouter.post("/org/requests/:id/:decision", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgTenant(req, res);
  if (!tenantId) return;
  try {
    const decision = String(req.params.decision);
    if (decision !== "approve" && decision !== "reject") return res.status(404).json({ error: "not_found" });
    const body = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    res.json(
      await decideRequest({ tenantId, requestId: String(req.params.id), approve: decision === "approve", note: body.note || null, actorId: req.user!.id }),
    );
  } catch (err) {
    handleRequestError(err, res, next);
  }
});
