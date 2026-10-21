import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { notify } from "../notifications/service.js";
import { recordAudit } from "../audit/service.js";
import { creditBalance } from "../recruitment/service.js";
import { OrgTestError, givableProducts, giveTests, givenTests, withdrawTest } from "./service.js";

// Tests & credits (Org Admins): give learners a real test or preparation for
// one test, paid with the organization's credits.
export const orgTestsRouter = Router();

async function orgTenant(req: AuthedRequest, res: Response): Promise<string | null> {
  if (req.user!.role !== "org_admin" || !req.user!.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const t = (await pool.query(`SELECT type FROM tenants WHERE id = $1`, [req.user!.tenantId])).rows[0];
  if (t?.type !== "cohort") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return req.user!.tenantId;
}

function handle(err: unknown, res: Response, next: (e: unknown) => void) {
  if (err instanceof OrgTestError) return res.status(err.status).json({ error: err.code, ...err.detail });
  next(err);
}

orgTestsRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await orgTenant(req, res);
  if (!tenantId) return;
  try {
    const history = await pool.query(
      `SELECT delta, reason, note, created_at FROM recruitment_credit_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId],
    );
    res.json({
      balance: await creditBalance(tenantId),
      products: await givableProducts(),
      given: await givenTests(tenantId),
      history: history.rows.map((h) => ({ delta: h.delta, reason: h.reason, note: h.note, at: h.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

const giveSchema = z
  .object({
    productId: z.string().min(1).max(60),
    userIds: z.array(z.string().uuid()).max(1000).optional(),
    batchId: z.string().uuid().optional(),
    // Preparation: how many 30-day periods.
    periods: z.number().int().min(1).max(12).optional(),
  })
  .refine((b) => (b.userIds && b.userIds.length) || b.batchId, { message: "learners required" });

orgTestsRouter.post("/give", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await orgTenant(req, res);
  if (!tenantId) return;
  try {
    const body = giveSchema.parse(req.body);
    const userIds = body.batchId
      ? (await pool.query(`SELECT id FROM users WHERE batch_id = $1 AND tenant_id = $2 AND role = 'learner' AND deleted_at IS NULL`, [body.batchId, tenantId])).rows.map((r) => r.id)
      : body.userIds!;
    const r = await giveTests({ tenantId, actorId: req.user!.id, userIds, productId: body.productId, periods: body.periods });
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "tests.given", details: { productId: body.productId, learners: r.given, credits: r.creditsUsed }, ip: req.ip });
    res.status(201).json(r);
  } catch (err) {
    handle(err, res, next);
  }
});

orgTestsRouter.post("/:id/withdraw", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await orgTenant(req, res);
  if (!tenantId) return;
  try {
    await withdrawTest(tenantId, String(req.params.id), req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    handle(err, res, next);
  }
});

// Asks Spica for more credits (they're added by staff, or with a purchase order).
orgTestsRouter.post("/credits/request", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await orgTenant(req, res);
  if (!tenantId) return;
  try {
    const b = z.object({ quantity: z.coerce.number().int().min(1).max(100000), note: z.string().trim().max(500).optional() }).parse(req.body);
    const t = (await pool.query(`SELECT name, managed_by, account_manager_id FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    const staff = [t.account_manager_id, t.managed_by].filter(Boolean);
    if (!staff.length) staff.push(...(await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows.map((r) => r.id));
    for (const id of new Set(staff)) {
      await notify({
        userId: id,
        kind: "credit_request",
        title: `${t.name} asked for credits`,
        body: [`${b.quantity} credits for staff tests.`, b.note || null].filter(Boolean).join(" "),
        link: "/admin/organizations",
        email: true,
        sentBy: req.user!.id,
      });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
