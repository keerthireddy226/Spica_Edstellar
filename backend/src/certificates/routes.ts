import { z } from "zod";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { issueCertificate, listForLearner, listForTenant, revokeCertificate, verifyCertificate } from "./service.js";

export const certificatesRouter = Router();

// Public, so it gets its own small budget against code guessing.
const verifyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

certificatesRouter.get("/verify/:code", verifyLimiter, async (req, res, next) => {
  try {
    const c = await verifyCertificate(String(req.params.code));
    if (!c) return res.status(404).json({ valid: false });
    // Only what's printed on the certificate itself.
    res.json({
      valid: !c.revokedAt,
      revoked: !!c.revokedAt,
      code: c.code,
      learnerName: c.learnerName,
      participantId: c.participantId,
      organizationName: c.organizationName,
      batchName: c.batchName,
      cefrLevel: c.cefrLevel,
      issuedAt: c.issuedAt,
    });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.get("/mine", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ certificates: await listForLearner(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

function orgAdmin(req: AuthedRequest): string | null {
  return req.user?.role === "org_admin" && req.user.tenantId ? req.user.tenantId : null;
}

certificatesRouter.get("/org", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : null;
    res.json({ certificates: await listForTenant(tenantId, batchId) });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.post("/org/issue", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z.object({ learnerId: z.string().uuid(), batchId: z.string().uuid().nullable().optional() }).parse(req.body);
    const ok = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner'`, [body.learnerId, tenantId]);
    if (ok.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    if (body.batchId) {
      const b = await pool.query(`SELECT 1 FROM batches WHERE id = $1 AND tenant_id = $2`, [body.batchId, tenantId]);
      if (b.rowCount === 0) return res.status(400).json({ error: "invalid_batch" });
    }
    const cert = await issueCertificate({ userId: body.learnerId, batchId: body.batchId ?? null, issuedBy: req.user!.id });
    res.status(201).json(cert);
  } catch (err) {
    next(err);
  }
});

certificatesRouter.delete("/org/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const ok = await revokeCertificate(tenantId, String(req.params.id));
    if (!ok) return res.status(404).json({ error: "certificate_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
