import { z } from "zod";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { assertFeature } from "../plans/service.js";
import { buildReport, getSubscription, setSubscription } from "./service.js";

export const reportsRouter = Router();

function orgStaff(req: AuthedRequest): string | null {
  return req.user && ["org_admin", "manager"].includes(req.user.role) && req.user.tenantId ? req.user.tenantId : null;
}

reportsRouter.get("/subscription", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgStaff(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    res.json(await getSubscription(req.user!.id));
  } catch (err) {
    next(err);
  }
});

reportsRouter.put("/subscription", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgStaff(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z.object({ frequency: z.enum(["weekly", "monthly", "off"]) }).parse(req.body);
    if (body.frequency !== "off") await assertFeature(tenantId, "scheduled_reports");
    await setSubscription(req.user!.id, tenantId, body.frequency);
    res.json(await getSubscription(req.user!.id));
  } catch (err) {
    next(err);
  }
});

// What the next email will say, right now.
reportsRouter.get("/preview", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgStaff(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const frequency = req.query.frequency === "monthly" ? "monthly" : "weekly";
    res.json(await buildReport(req.user!.id, frequency));
  } catch (err) {
    next(err);
  }
});
