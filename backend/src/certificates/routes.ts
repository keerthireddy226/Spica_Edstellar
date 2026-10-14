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

// ---- Managers: certificates for the batches they manage ----

async function managerBatches(req: AuthedRequest): Promise<string[] | null> {
  if (req.user?.role !== "manager") return null;
  return (await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [req.user.id])).rows.map((r) => r.batch_id);
}

certificatesRouter.get("/manager", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const batches = await managerBatches(req);
    if (!batches) return res.status(403).json({ error: "forbidden" });
    const batchId = typeof req.query.batchId === "string" ? req.query.batchId : null;
    if (batchId && !batches.includes(batchId)) return res.status(404).json({ error: "batch_not_found" });
    const r = await pool.query(
      `SELECT id, code, user_id, learner_name, participant_id, organization_name, batch_name, cefr_level, issued_at, revoked_at
       FROM certificates WHERE batch_id = ANY($1::uuid[]) ORDER BY issued_at DESC LIMIT 500`,
      [batchId ? [batchId] : batches],
    );
    res.json({
      certificates: r.rows.map((c) => ({
        id: c.id,
        code: c.code,
        userId: c.user_id,
        learnerName: c.learner_name,
        participantId: c.participant_id,
        organizationName: c.organization_name,
        batchName: c.batch_name,
        cefrLevel: c.cefr_level,
        issuedAt: c.issued_at,
        revokedAt: c.revoked_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Issued against the learner's current batch, which must be one of theirs.
certificatesRouter.post("/manager/issue", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const batches = await managerBatches(req);
    if (!batches) return res.status(403).json({ error: "forbidden" });
    const body = z.object({ learnerId: z.string().uuid() }).parse(req.body);
    const l = (await pool.query(`SELECT batch_id FROM users WHERE id = $1 AND role = 'learner' AND batch_id = ANY($2::uuid[])`, [body.learnerId, batches])).rows[0];
    if (!l) return res.status(404).json({ error: "learner_not_found" });
    res.status(201).json(await issueCertificate({ userId: body.learnerId, batchId: l.batch_id, issuedBy: req.user!.id }));
  } catch (err) {
    next(err);
  }
});

certificatesRouter.delete("/manager/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const batches = await managerBatches(req);
    if (!batches) return res.status(403).json({ error: "forbidden" });
    const r = await pool.query(
      `UPDATE certificates SET revoked_at = now() WHERE id = $1 AND batch_id = ANY($2::uuid[]) AND revoked_at IS NULL RETURNING id`,
      [String(req.params.id), batches],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "certificate_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
