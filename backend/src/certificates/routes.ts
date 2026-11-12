import { z } from "zod";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import path from "node:path";
import QRCode from "qrcode";
import { COMPLETION_CERTIFICATES, issueCertificate, listForLearner, listForTenant, revokeCertificate, setReportPublic, verifyCertificate } from "./service.js";
import { scoreReport } from "../reports/scoreReport.js";
import { reportAbout } from "../reports/feedbackReport.js";
import { CourseCertificateError, certificateStatus, decideRequest, listRequests, proofFor, requestCertificate, saveVersantResult } from "./course.js";
import { LOGO_DIR } from "../orgAdmin/settings.js";
import { APP_URL } from "../auth/mailer.js";

export const certificatesRouter = Router();

// Public, so it gets its own small budget against code guessing.
const verifyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

// Public samples for the website's Demo page, with made-up data: a certificate
// (checked at /certificate/SAMPLE) and a full score report.
const SAMPLE_SKILLS = { speaking: { level: "B2", score: 67 }, listening: { level: "B2", score: 66 }, reading: { level: "B1", score: 49 }, writing: { level: "B1", score: 48 } };

async function sampleCertificate() {
  const verifyUrl = `${APP_URL}/certificate/SAMPLE`;
  const year = new Date().getFullYear();
  return {
    sample: true,
    valid: true,
    revoked: false,
    code: "SAMPLE",
    learnerName: "Sample Candidate",
    participantId: "SPC-26-000123",
    organizationName: null,
    batchName: null,
    cefrLevel: "B2",
    issuedAt: `${year}-01-15T10:00:00Z`,
    courseName: null,
    periodFrom: null,
    periodTo: null,
    goalLevel: null,
    versantLevel: null,
    versantScore: null,
    versantTakenOn: null,
    kind: "result",
    testName: "English 4 Skills Essentials",
    spicaScore: 58,
    skillScores: SAMPLE_SKILLS,
    validUntil: `${year + 1}-01-15`,
    expired: false,
    identityVerified: true,
    orgLogoUrl: null,
    verifyUrl,
    qr: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240, color: { dark: "#1f3a5f", light: "#ffffff" } }),
  };
}

certificatesRouter.get("/sample-report", verifyLimiter, async (_req, res, next) => {
  try {
    const url = `${APP_URL}/certificate/SAMPLE`;
    const T = (itemTypeId: string, typeName: string, right: number, total: number) => ({ itemTypeId, typeName, right, total });
    const rep = T("repeats", "Repeats", 10, 12), sb = T("sentence_builds", "Sentence Builds", 5, 6), conv = T("conversations", "Conversations", 10, 11), ra = T("reading", "Read Aloud", 5, 6);
    const sc = T("sentence_completion", "Sentence Completion", 16, 25), dic = T("dictation", "Dictation", 3, 6), pr = T("passage_reconstruction", "Passage Reconstruction", 2, 4);
    const share = (t: { right: number; total: number }) => t.right / t.total;
    const skill = (name: keyof typeof SAMPLE_SKILLS, percent: number, types: ReturnType<typeof T>[]) => ({
      skill: name,
      level: SAMPLE_SKILLS[name].level,
      score: SAMPLE_SKILLS[name].score,
      percent,
      status: null,
      types,
      strengths: types.filter((t) => share(t) >= 0.75).sort((x, y) => share(y) - share(x)).slice(0, 2),
      focus: types.filter((t) => share(t) < 0.6).sort((x, y) => share(x) - share(y)).slice(0, 2),
    });
    res.json({
      sample: true,
      analysis:
        "You reached B2 overall. Speaking (B2) is your strongest skill: you repeat and build sentences accurately and speak at a natural pace. Writing (B1) needs the most work: Dictation and Passage Reconstruction lost the most marks.",
      score: {
        learner: { name: "Sample Candidate", learnerId: "SPC-26-000123" },
        reportId: "SAMPLE",
        completedAt: `${new Date().getFullYear()}-01-15T10:00:00Z`,
        check: { url, qr: await QRCode.toDataURL(url, { margin: 0, width: 160, color: { dark: "#1f3a5f", light: "#ffffff" } }) },
        overall: { score: 58, level: "B2" },
        goal: null,
        skills: [
          skill("speaking", 86, [rep, sb, conv, ra]),
          skill("listening", 76, [rep, sb, conv, dic]),
          skill("reading", 62, [ra, sc, pr]),
          skill("writing", 56, [sc, dic, pr]),
        ],
        missingSkills: [],
        answers: { answered: 62, total: 70 },
        profile: [
          { key: "listening", value: 76 },
          { key: "reading", value: 62 },
          { key: "fluency", value: 82 },
          { key: "pronunciation", value: 85 },
          { key: "spokenGrammar", value: 88 },
          { key: "vocabulary", value: 64 },
          { key: "writtenGrammar", value: 58 },
          { key: "spelling", value: 61 },
        ],
        speaking: {
          answers: 35, silent: 0, wordsPerMinute: 128, fillers: 3, fluency: 82, clarity: 85, grammar: 88, vocabulary: 64,
          example: { typeName: "Conversations", transcript: "The meeting was moved to Thursday because the manager was travelling.", comment: "Clear and well paced; the answer was complete." },
        },
        writing: {
          answers: 35, grammar: 58, vocabulary: 66, spelling: 61, task: 55, errors: { grammar: 4, spelling: 3, punctuation: 1 }, marked: true,
          example: { text: "he go to office", correction: "he goes to the office", reason: "Use 'goes' after he, she or it." },
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.get("/verify/:code", verifyLimiter, async (req, res, next) => {
  try {
    if (String(req.params.code).toUpperCase() === "SAMPLE") return res.json(await sampleCertificate());
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
      identityVerified: c.kind === "result" && c.identityVerified,
      // A valid result certificate links to its full score report, unless the learner turned that off.
      reportAvailable: c.kind === "result" && !c.revokedAt && !expired && c.reportPublic && !!c.sessionId,
      orgLogoUrl: c.hasOrgLogo && !c.revokedAt ? `/api/certificates/verify/${c.code}/logo` : null,
      verifyUrl,
      qr: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 240, color: { dark: "#1f3a5f", light: "#ffffff" } }),
    });
  } catch (err) {
    next(err);
  }
});

// The full score report behind a valid result certificate, for anyone who has
// the code (an employer checking it). The learner can turn this off. The
// example answers (what they said and wrote) are left out.
certificatesRouter.get("/verify/:code/report", verifyLimiter, async (req, res, next) => {
  try {
    const c = await verifyCertificate(String(req.params.code));
    const expired = !!c?.validUntil && c.validUntil < new Date().toISOString().slice(0, 10);
    if (!c || c.kind !== "result" || c.revokedAt || expired || !c.reportPublic || !c.sessionId) return res.status(404).json({ error: "not_found" });
    const stored = (await pool.query(`SELECT report FROM feedback_reports WHERE session_id = $1 AND status = 'ready'`, [c.sessionId])).rows[0]?.report ?? null;
    const score = await scoreReport(c.sessionId, stored);
    if (!score?.overall) return res.status(404).json({ error: "not_found" });
    const about = await reportAbout(c.sessionId);
    res.json({
      code: c.code,
      score: {
        ...score,
        // The certificate's own name and the check page's link.
        learner: { ...score.learner, name: c.learnerName },
        speaking: score.speaking ? { ...score.speaking, example: null } : null,
        writing: score.writing ? { ...score.writing, example: null } : null,
      },
      about: about ? { ...about, setName: null } : null,
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
    const status = err.code === "request_not_found" ? 404 : err.code === "already_pending" || err.code === "not_pending" ? 409 : err.code === "stopped" ? 410 : 400;
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
  // An outside test result only went on course certificates, which have stopped.
  if (!COMPLETION_CERTIFICATES) return res.status(410).json({ error: "stopped" });
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

// ---- Printed certificates to post (Spica staff) ----

certificatesRouter.get("/prints", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!["admin", "super_admin"].includes(req.user!.role)) return res.status(403).json({ error: "forbidden" });
  try {
    const r = await pool.query(
      `SELECT p.id, p.status, p.shipping, p.created_at, p.posted_at, c.code, c.learner_name FROM certificate_prints p JOIN certificates c ON c.id = p.certificate_id
       ORDER BY (p.status = 'to_print') DESC, p.created_at DESC LIMIT 200`,
    );
    res.json({
      prints: r.rows.map((x) => ({ id: x.id, status: x.status, shipping: x.shipping, createdAt: x.created_at, postedAt: x.posted_at, code: x.code, learnerName: x.learner_name })),
    });
  } catch (err) {
    next(err);
  }
});

certificatesRouter.post("/prints/:id/posted", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!["admin", "super_admin"].includes(req.user!.role)) return res.status(403).json({ error: "forbidden" });
  try {
    await pool.query(`UPDATE certificate_prints SET status = 'posted', posted_at = now() WHERE id = $1`, [String(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
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

// The learner shows or hides the full report link on a result certificate's check page.
certificatesRouter.patch("/mine/:id/report-public", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ visible: z.boolean() }).parse(req.body);
    if (!(await setReportPublic(req.user!.id, String(req.params.id), body.visible))) return res.status(404).json({ error: "not_found" });
    res.json({ reportPublic: body.visible });
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
  // Certificates come only from the final assessment now.
  if (!COMPLETION_CERTIFICATES) return res.status(410).json({ error: "stopped" });
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
      `SELECT id, code, user_id, learner_name, participant_id, organization_name, batch_name, cefr_level, issued_at, revoked_at, kind, test_name, spica_score, valid_until
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
        kind: c.kind,
        testName: c.test_name,
        spicaScore: c.spica_score,
        validUntil: c.valid_until,
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
    if (!COMPLETION_CERTIFICATES) return res.status(410).json({ error: "stopped" });
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
      `UPDATE certificates SET revoked_at = now() WHERE id = $1 AND batch_id = ANY($2::uuid[]) AND revoked_at IS NULL AND kind <> 'result' RETURNING id`,
      [String(req.params.id), batches],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "certificate_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
