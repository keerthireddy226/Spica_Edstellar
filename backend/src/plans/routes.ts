import { z } from "zod";
import { Router, type Response } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission, requireStaff, staffOwnsTenant } from "../admin/staff.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { PILOT_DEFAULT_DAYS, PILOT_DEFAULT_LICENSES, PLAN_TIERS, TIER_LABELS } from "./config.js";
import {
  endPilot,
  enterpriseInquiry,
  listPlanEvents,
  planCatalog,
  planSummary,
  setCustomPrice,
  setTier,
  startPilot,
} from "./service.js";

export const plansRouter = Router();

// ---- Org Admin and Manager: their own organization's plan ----

plansRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!req.user || !["org_admin", "manager"].includes(req.user.role) || !req.user.tenantId) {
    return res.status(403).json({ error: "forbidden" });
  }
  try {
    const summary = await planSummary(req.user.tenantId);
    if (!summary) return res.status(404).json({ error: "organization_not_found" });
    const category = (await pool.query(`SELECT category FROM tenants WHERE id = $1`, [req.user.tenantId])).rows[0]?.category ?? null;
    res.json({ ...summary, catalog: planCatalog(category) });
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/enterprise-inquiry", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user?.role !== "org_admin" || !req.user.tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
    await enterpriseInquiry({ tenantId: req.user.tenantId, actorId: req.user.id, message: body.message });
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Admin / Super Admin: set tier, negotiated price, pilots ----

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

plansRouter.get("/admin/orgs/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res);
    if (!tenantId) return;
    const [summary, events] = await Promise.all([planSummary(tenantId), listPlanEvents(tenantId)]);
    res.json({ ...summary, events });
  } catch (err) {
    next(err);
  }
});

plansRouter.patch("/admin/orgs/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res, true);
    if (!tenantId) return;
    const body = z
      .object({
        tier: z.enum(PLAN_TIERS).optional(),
        // USD cents per license-month; null returns to the rate card.
        customPriceCents: z.coerce.number().int().min(0).max(100000).nullable().optional(),
        note: z.string().trim().max(500).optional(),
      })
      .parse(req.body);

    const before = (await pool.query(`SELECT plan_tier, custom_price_cents FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    if (body.tier && body.tier !== before.plan_tier) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await setTier({ tenantId, tier: body.tier, actorId: req.user!.id, note: body.note ?? null, executor: client });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      for (const id of await orgAdminIds(tenantId)) {
        await notify({
          userId: id,
          kind: "plan_changed",
          title: `Your organization is now on ${TIER_LABELS[body.tier]}`,
          body: body.note || "Open your Plan page to see what's included.",
          link: "/orgadmin/plan",
          email: true,
          sentBy: req.user!.id,
        });
      }
    }
    if (body.customPriceCents !== undefined && body.customPriceCents !== before.custom_price_cents) {
      await setCustomPrice({ tenantId, customPriceCents: body.customPriceCents, actorId: req.user!.id, note: body.note ?? null });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/admin/orgs/:tenantId/pilot", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res, true);
    if (!tenantId) return;
    const body = z
      .object({
        licenses: z.coerce.number().int().min(1).max(500).default(PILOT_DEFAULT_LICENSES),
        days: z.coerce.number().int().min(1).max(180).default(PILOT_DEFAULT_DAYS),
      })
      .parse(req.body);
    const endsAt = await startPilot({ tenantId, ...body, actorId: req.user!.id });
    if (!endsAt) return res.status(404).json({ error: "organization_not_found" });
    res.status(201).json({ pilotEndsAt: endsAt });
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/admin/orgs/:tenantId/pilot/end", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await adminOrg(req, res, true);
    if (!tenantId) return;
    const ok = await endPilot({ tenantId, actorId: req.user!.id, note: "Ended by Admin" });
    if (!ok) return res.status(400).json({ error: "no_active_pilot" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
