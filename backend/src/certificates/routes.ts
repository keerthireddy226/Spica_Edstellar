import { z } from "zod";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import path from "node:path";
import QRCode from "qrcode";
import { issueCertificate, listForLearner, listForTenant, revokeCertificate, verifyCertificate } from "./service.js";
import { CourseCertificateError, certificateStatus, decideRequest, listRequests, proofFor, requestCertificate, saveVersantResult } from "./course.js";
import { LOGO_DIR } from "../orgAdmin/settings.js";
import { APP_URL } from "../auth/mailer.js";

export const certificatesRouter = Router();

// Public, so it gets its own small budget against code guessing.
const verifyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

certificatesRouter.get("/verify/:code", verifyLimiter, async (req, res, next) => {
  try {
    const c = await verifyCertificate(String(req.params.code));
    if (!c) return res.status(404).json({ valid: false });
    // Only what's printed on the certificate itself, plus its QR code.
    const verifyUrl = `${APP_URL}/certificate/${c.code}`;
    // A result certificate is valid for a year.
    const expired = !!c.validUntil && c.validUntil < new Date().toISOString().slice(0, 10);
    res.json({
      valid: !c.revokedAt && !expired,
      revoked: !!c.revokedAt,
      code: c.code,
      learnerName: c.learnerName,
      participantId: c.participantId,
      organizationName: c.organizationName,
      batchName: c.batchName,
      cefrLevel: c.cefrLevel,
      issuedAt: c.issuedAt,
      courseName: c.courseName,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      goalLevel: c.goalLevel,
      versantLevel: c.versantLevel,
      versantScore: c.versantScore,
      versantTakenOn: c.versantTakenOn,
      kind: c.kind,
      testName: c.testName,
      spicaScore: c.spicaScore,
      skillScores: c.skillScores,
      validUntil: c.validUntil,
      expired,
      orgLogoUrl: c.hasOrgLogo && !c.revokedAt ? `/api/certificates/verify/${c.code}/logo` : null,
      verifyUrl,
      qr: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240, color: { dark: "#1f3a5f", light: "#ffffff" } }),
    });
  } catch (err) {
    next(err);
  }
});

// The organization's logo printed on its learners' certificates: public, but
// only through a valid certificate's code.
certificatesRouter.get("/verify/:code/logo", verifyLimiter, async (req, res, next) => {
  try {
    const c = await verifyCertificate(String(req.params.code));
    if (!c || c.revokedAt || !c.hasOrgLogo || !c.tenantId) return res.status(404).end();
    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(LOGO_DIR, `${c.tenantId}.png`), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (err) {
    next(err);
  }
});

function courseError(err: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (err instanceof CourseCertificateError) {
    const status = err.code === "request_not_found" ? 404 : err.code === "already_pending" || err.code === "not_pending" ? 409 : 400;
    return res.status(status).json({ error: err.code });
  }
  next(err);
}

// ---- Learner: course certificate and the real Versant result ----

certificatesRouter.get("/me/status", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    res.json(await certificateStatus(req.user!.id));
  } catch (err) {
    next(err);
  }
});

const LEVEL = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
const SKILL_RESULT = z.object({ level: LEVEL.optional(), score: z.number().int().min(10).max(90).optional() });

certificatesRouter.post("/me/versant", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    const body = z
      .object({
        takenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        overallLevel: LEVEL,
        overallScore: z.number().int().min(10).max(90).nullable().optional(),
        skills: z.object({ listening: SKILL_RESULT, speaking: SKILL_RESULT, reading: SKILL_RESULT, writing: SKILL_RESULT }).partial().optional(),
        proofBase64: z.string().max(4_500_000).nullable().optional(),
      })
      .parse(req.body);
    if (body.takenOn > new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "future_date" });
    res.status(201).json(await saveVersantResult(req.user!.id, body));
  } catch (err) {
    courseError(err, res, next);
  }
});

// The score report a learner uploaded: for them, their org admins and staff.
certificatesRouter.get("/versant/:id/proof", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await proofFor(String(req.params.id), { id: req.user!.id, role: req.user!.role, tenantId: req.user!.tenantId ?? null });
    if (!p) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=3600");
    res.type(p.type).sendFile(p.file, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.post("/me/request", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  try {
    res.status(201).json({ id: await requestCertificate(req.user!.id) });
  } catch (err) {
    courseError(err, res, next);
  }
});

// ---- Requests: an org's admins for their learners, Spica staff for individuals ----

function reviewScope(req: AuthedRequest): { reviewer: "org"; tenantId: string } | { reviewer: "staff" } | null {
  if (req.user?.role === "org_admin" && req.user.tenantId) return { reviewer: "org", tenantId: req.user.tenantId };
  if (req.user && ["admin", "super_admin"].includes(req.user.role)) return { reviewer: "staff" };
  return null;
}

certificatesRouter.get("/requests", requireAuth, async (req: AuthedRequest, res, next) => {
  const scope = reviewScope(req);
  if (!scope) return res.status(403).json({ error: "forbidden" });
  try {
    res.json({ requests: await listRequests(scope, req.query.status === "all" ? "all" : "pending") });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.post("/requests/:id/decide", requireAuth, async (req: AuthedRequest, res, next) => {
  const scope = reviewScope(req);
  if (!scope) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z
      .discriminatedUnion("issue", [
        z.object({ issue: z.literal(true), includeVersant: z.boolean().default(false) }),
        z.object({ issue: z.literal(false), note: z.string().trim().min(1).max(500) }),
      ])
      .parse(req.body);
    res.json(await decideRequest(String(req.params.id), scope, req.user!.id, body));
  } catch (err) {
    courseError(err, res, next);
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
