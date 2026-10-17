// Recruitment API: the candidate's invitation link, the recruiter console
// (job openings, invitations, results, decisions, team, credits), and the
// Edstellar staff controls for an organization's products and credits.
import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { enqueue } from "../queue/queue.js";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { hashToken } from "../auth/tokens.js";
import { createSession, setSessionCookie } from "../auth/routes.js";
import { createAndInviteUser } from "../auth/invite.js";
import { recordAudit } from "../audit/service.js";
import { notify } from "../notifications/service.js";
import { emitEvent } from "../webhooks/service.js";
import { requirePermission, staffOwnsTenant } from "../admin/staff.js";
import { learnerPolicy } from "../proctoring/policy.js";
import {
  ASSESSMENT_BANDS,
  PRODUCTS,
  RecruitmentError,
  TEST_KINDS,
  activeAssessment,
  addCredits,
  assertProduct,
  cancelInvite,
  creditBalance,
  inviteCandidates,
  latestAssessment,
  resendInvite,
  tenantProducts,
  unitPriceCents,
} from "./service.js";

export const recruitmentRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const CANDIDATE_SESSION_MS = 6 * 3600_000;
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function fail(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof RecruitmentError) return res.status(err.status).json({ error: err.code, ...err.detail });
  next(err);
}

// Org Admins and recruiters of an organization that has recruitment.
async function recruiterTenant(req: AuthedRequest, res: Response): Promise<string | null> {
  if (!req.user || !["org_admin", "recruiter"].includes(req.user.role) || !req.user.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  if (!(await tenantProducts(req.user.tenantId)).includes("recruitment")) {
    res.status(403).json({ error: "product_not_enabled", product: "recruitment" });
    return null;
  }
  return req.user.tenantId;
}

// ---------- Candidate: the invitation link ----------

async function assessmentByToken(token: string) {
  const r = await pool.query(
    `SELECT a.*, j.title AS job_title, j.test_kind, j.description, j.status AS job_status, t.name AS org_name, t.logo_path, t.id AS org_id
     FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id JOIN tenants t ON t.id = a.tenant_id
     WHERE a.token_hash = $1`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

// Public: what the link is for, before the candidate starts.
recruitmentRouter.get("/invite/:token", async (req, res, next) => {
  try {
    const a = await assessmentByToken(String(req.params.token));
    if (!a) return res.status(404).json({ error: "invite_not_found" });
    const usable = ["invited", "started"].includes(a.status) && new Date(a.expires_at) > new Date();
    const { policy } = await learnerPolicy(a.candidate_id);
    res.json({
      status: usable ? a.status : a.status === "completed" ? "completed" : "expired",
      organization: { name: a.org_name, logoUrl: null },
      // A university's admission test: the wording speaks of admissions, not recruiters.
      admissions: await isUniversity(a.tenant_id),
      job: { title: a.job_title, description: a.description },
      testKind: a.test_kind,
      firstName: a.first_name,
      expiresAt: a.expires_at,
      proctoring: {
        camera: policy.webcamMonitoring || policy.videoRecording || policy.faceMatch,
        microphone: policy.audioMonitoring || policy.voiceMatch,
        screen: policy.screenRecording,
        idDocument: policy.idVerification,
        secureBrowser: policy.secureBrowser,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Signs the candidate in for this one assessment.
recruitmentRouter.post("/invite/:token/start", async (req, res, next) => {
  try {
    const a = await assessmentByToken(String(req.params.token));
    if (!a) return res.status(404).json({ error: "invite_not_found" });
    if (a.status === "completed") return res.status(409).json({ error: "already_completed" });
    if (!["invited", "started"].includes(a.status) || new Date(a.expires_at) <= new Date()) return res.status(410).json({ error: "invite_expired" });
    if (a.job_status !== "open") return res.status(410).json({ error: "job_closed" });
    await pool.query(`UPDATE recruitment_assessments SET status = 'started', started_at = coalesce(started_at, now()) WHERE id = $1`, [a.id]);
    // One device at a time: earlier candidate sessions end.
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [a.candidate_id]);
    const { token } = await createSession(pool, a.candidate_id);
    await pool.query(`UPDATE auth_sessions SET expires_at = least(expires_at, now() + make_interval(secs => $2)) WHERE session_token_hash = $1`, [
      hashToken(token),
      CANDIDATE_SESSION_MS / 1000,
    ]);
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// The signed-in candidate's assessment.
recruitmentRouter.get("/candidate/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role !== "candidate") return res.status(403).json({ error: "forbidden" });
    const live = await activeAssessment(req.user!.id);
    const a = live ?? (await latestAssessment(req.user!.id));
    if (!a) return res.status(404).json({ error: "assessment_not_found" });
    const u = (await pool.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [req.user!.id])).rows[0];
    let sessionId: string | null = null;
    if (live && a.test_kind !== "placement") {
      const s = await pool.query(
        `SELECT id FROM sessions WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NULL AND composition->>'examId' = $2 ORDER BY started_at DESC LIMIT 1`,
        [req.user!.id, a.exam_id],
      );
      sessionId = s.rows[0]?.id ?? null;
    }
    res.json({
      id: a.id,
      status: live ? a.status : a.status === "completed" ? "completed" : "expired",
      organization: a.org_name,
      admissions: await isUniversity(a.tenant_id),
      jobTitle: a.job_title,
      testKind: a.test_kind,
      examId: a.exam_id,
      sessionId,
      firstName: u?.first_name ?? a.first_name,
      expiresAt: a.expires_at,
      // Only shown when the organization chose to share it.
      result: a.status === "completed" && a.show_result_to_candidate ? a.result : null,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Recruiter console ----------

recruitmentRouter.get("/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const [credits, counts, recent] = await Promise.all([
      creditBalance(tenantId),
      pool.query(
        `SELECT count(*) FILTER (WHERE status IN ('invited', 'started'))::int AS open,
           count(*) FILTER (WHERE status = 'completed' AND decision IS NULL)::int AS to_decide,
           count(*) FILTER (WHERE status = 'completed' AND completed_at > now() - interval '30 days')::int AS completed_30d,
           count(*) FILTER (WHERE decision IN ('hired', 'admitted'))::int AS hired,
           (SELECT count(*)::int FROM recruitment_jobs WHERE tenant_id = $1 AND status = 'open') AS open_jobs
         FROM recruitment_assessments WHERE tenant_id = $1`,
        [tenantId],
      ),
      pool.query(
        `SELECT a.id, a.first_name, a.last_name, a.email, a.status, a.completed_at, a.result, a.decision, j.title AS job_title
         FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id
         WHERE a.tenant_id = $1 AND a.status = 'completed' ORDER BY a.completed_at DESC LIMIT 8`,
        [tenantId],
      ),
    ]);
    const t = (await pool.query(`SELECT assessment_price_cents, candidate_retention_days FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    res.json({
      credits,
      unitPriceCents: unitPriceCents(t.assessment_price_cents, 1),
      retentionDays: t.candidate_retention_days,
      counts: counts.rows[0],
      recent: recent.rows,
    });
  } catch (err) {
    next(err);
  }
});

const jobSchema = z.object({
  title: z.string().trim().min(2).max(160),
  department: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  testKind: z.enum(TEST_KINDS),
  minCefr: z.enum(CEFR).nullable().optional(),
  inviteValidDays: z.coerce.number().int().min(1).max(60).default(7),
  showResultToCandidate: z.boolean().default(false),
});

const JOB_SELECT = `
  SELECT j.*, concat_ws(' ', u.first_name, u.last_name) AS created_by_name,
    count(a.id) FILTER (WHERE a.status <> 'cancelled')::int AS invited,
    count(a.id) FILTER (WHERE a.status = 'completed')::int AS completed,
    count(a.id) FILTER (WHERE a.status IN ('invited', 'started'))::int AS pending,
    -- Admissions: waitlisted and admitted count as shortlisted and hired.
    count(a.id) FILTER (WHERE a.decision IN ('shortlisted', 'waitlisted'))::int AS shortlisted,
    count(a.id) FILTER (WHERE a.decision IN ('hired', 'admitted'))::int AS hired
  FROM recruitment_jobs j
  LEFT JOIN recruitment_assessments a ON a.job_id = j.id
  LEFT JOIN users u ON u.id = j.created_by`;

recruitmentRouter.get("/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(`${JOB_SELECT} WHERE j.tenant_id = $1 GROUP BY j.id, u.id ORDER BY j.status, j.created_at DESC`, [tenantId]);
    res.json({ jobs: r.rows });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.post("/jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = jobSchema.parse(req.body);
    const r = await pool.query(
      `INSERT INTO recruitment_jobs (tenant_id, title, department, location, description, test_kind, min_cefr, invite_valid_days, show_result_to_candidate, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [tenantId, b.title, b.department ?? null, b.location ?? null, b.description ?? null, b.testKind, b.minCefr ?? null, b.inviteValidDays, b.showResultToCandidate, req.user!.id],
    );
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "recruitment.job_created", targetType: "job", targetId: r.rows[0].id, targetLabel: b.title, ip: req.ip });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.patch("/jobs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = jobSchema.partial().extend({ status: z.enum(["open", "closed"]).optional() }).parse(req.body);
    const map: [keyof typeof b, string][] = [
      ["title", "title"],
      ["department", "department"],
      ["location", "location"],
      ["description", "description"],
      ["testKind", "test_kind"],
      ["minCefr", "min_cefr"],
      ["inviteValidDays", "invite_valid_days"],
      ["showResultToCandidate", "show_result_to_candidate"],
      ["status", "status"],
    ];
    const sets: string[] = [];
    const vals: unknown[] = [req.params.id, tenantId];
    for (const [k, col] of map) {
      if (b[k] === undefined) continue;
      vals.push(b[k]);
      sets.push(`${col} = $${vals.length}`);
    }
    if (b.status) sets.push(b.status === "closed" ? `closed_at = now()` : `closed_at = NULL`);
    if (!sets.length) return res.json({ ok: true });
    // The test can't change once someone was invited to take it.
    if (b.testKind) {
      const used = await pool.query(`SELECT 1 FROM recruitment_assessments WHERE job_id = $1 LIMIT 1`, [req.params.id]);
      if (used.rowCount) return res.status(409).json({ error: "test_locked" });
    }
    const r = await pool.query(`UPDATE recruitment_jobs SET ${sets.join(", ")} WHERE id = $1 AND tenant_id = $2 RETURNING id`, vals);
    if (!r.rowCount) return res.status(404).json({ error: "job_not_found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// A job opening with every candidate and their result.
recruitmentRouter.get("/jobs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const job = (await pool.query(`${JOB_SELECT} WHERE j.id = $1 AND j.tenant_id = $2 GROUP BY j.id, u.id`, [req.params.id, tenantId])).rows[0];
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const candidates = await pool.query(
      `SELECT a.id, a.candidate_id, a.email, a.first_name, a.last_name, a.status, a.result, a.decision, a.decision_note, a.decided_at,
         a.confirmed_level, a.confirmed_at, a.invited_at, a.expires_at, a.started_at, a.completed_at, a.session_id, ts.test_code,
         si.status AS integrity_status, si.risk_level, si.risk_score,
         concat_ws(' ', inv.first_name, inv.last_name) AS invited_by_name
       FROM recruitment_assessments a
       LEFT JOIN sessions ts ON ts.id = a.session_id
       LEFT JOIN session_integrity si ON si.session_id = a.session_id
       LEFT JOIN users inv ON inv.id = a.invited_by
       WHERE a.job_id = $1 AND a.status <> 'cancelled'
       ORDER BY a.invited_at DESC`,
      [req.params.id],
    );
    res.json({ job, candidates: candidates.rows });
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({
  people: z
    .array(
      z.object({
        email: z.string().trim().email(),
        firstName: z.string().trim().max(80).optional().nullable(),
        lastName: z.string().trim().max(80).optional().nullable(),
      }),
    )
    .min(1)
    .max(200),
});

recruitmentRouter.post("/jobs/:id/invites", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = inviteSchema.parse(req.body);
    const r = await inviteCandidates({ tenantId, jobId: String(req.params.id), actorId: req.user!.id, people: b.people });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "recruitment.candidates_invited",
      targetType: "job",
      targetId: String(req.params.id),
      details: { count: r.invited.length, skipped: r.skipped },
      ip: req.ip,
    });
    res.status(201).json(r);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "already_invited" });
    fail(err, res, next);
  }
});

recruitmentRouter.post("/assessments/:id/resend", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    res.json({ ok: true, ...(await resendInvite(tenantId, String(req.params.id))) });
  } catch (err) {
    fail(err, res, next);
  }
});

recruitmentRouter.post("/assessments/:id/cancel", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    await cancelInvite(tenantId, String(req.params.id), req.user!.id);
    res.json({ ok: true });
  } catch (err) {
    fail(err, res, next);
  }
});

// One candidate's report: result, integrity, timeline.
recruitmentRouter.get("/assessments/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const a = (
      await pool.query(
        `SELECT a.*, j.title AS job_title, j.test_kind, j.min_cefr, j.department, j.location,
           si.status AS integrity_status, si.risk_level, si.risk_score, si.reasons AS integrity_reasons, si.reviewed_at AS integrity_reviewed_at,
           e.name AS exam_name, e.test_id AS exam_test_id, ts.test_code, concat_ws(' ', inv.first_name, inv.last_name) AS invited_by_name,
           concat_ws(' ', dec.first_name, dec.last_name) AS decided_by_name,
           concat_ws(' ', conf.first_name, conf.last_name) AS confirmed_by_name, t.category AS tenant_category,
           (SELECT status FROM identity_verifications iv WHERE iv.user_id = a.candidate_id ORDER BY created_at DESC LIMIT 1) AS identity_status
         FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id
         LEFT JOIN session_integrity si ON si.session_id = a.session_id
         LEFT JOIN sessions ts ON ts.id = a.session_id
         LEFT JOIN exams e ON e.id = a.exam_id
         LEFT JOIN users inv ON inv.id = a.invited_by
         LEFT JOIN users dec ON dec.id = a.decided_by
         LEFT JOIN users conf ON conf.id = a.confirmed_by
         JOIN tenants t ON t.id = a.tenant_id
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [req.params.id, tenantId],
      )
    ).rows[0];
    if (!a) return res.status(404).json({ error: "assessment_not_found" });
    const { token_hash: _t, ...rest } = a;
    res.json({ assessment: rest });
  } catch (err) {
    next(err);
  }
});

// The candidate's feedback report (built after the test; on first request for
// tests finished before reports existed).
recruitmentRouter.get("/assessments/:id/report", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const a = (await pool.query(`SELECT session_id, status FROM recruitment_assessments WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
    if (!a?.session_id || a.status !== "completed") return res.status(404).json({ error: "report_not_found" });
    const r = (await pool.query(`SELECT status, report FROM feedback_reports WHERE session_id = $1`, [a.session_id])).rows[0];
    // Missing, failed, or made before skipped questions and answer explanations (version 2).
    if (!r || r.status === "failed" || (r.status === "ready" && (r.report?.version ?? 1) < 2)) {
      await enqueue("report.build", { sessionId: a.session_id }, { dedupeKey: `report.build:${a.session_id}:${Date.now() >> 16}`, maxAttempts: 5 });
      return res.json({ status: "pending", report: null });
    }
    res.json({ status: r.status, report: r.report });
  } catch (err) {
    next(err);
  }
});

const RECRUITMENT_DECISIONS = ["shortlisted", "rejected", "hired"];
const ADMISSIONS_DECISIONS = ["admitted", "waitlisted", "declined"];
const decisionSchema = z.object({ decision: z.enum([...RECRUITMENT_DECISIONS, ...ADMISSIONS_DECISIONS] as [string, ...string[]]).nullable(), note: z.string().trim().max(1000).optional() });

async function isUniversity(tenantId: string): Promise<boolean> {
  return (await pool.query(`SELECT category FROM tenants WHERE id = $1`, [tenantId])).rows[0]?.category === "university";
}

// Admissions' human review step: an officer confirms (or corrects) the level
// from the AI-scored test before any decision.
const confirmSchema = z.object({ level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).nullable(), note: z.string().trim().max(1000).optional() });

recruitmentRouter.post("/assessments/:id/confirm", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = confirmSchema.parse(req.body);
    const r = await pool.query(
      `UPDATE recruitment_assessments SET confirmed_level = $3, confirm_note = $4, confirmed_by = CASE WHEN $3::text IS NULL THEN NULL ELSE $5::uuid END,
         confirmed_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
       WHERE id = $1 AND tenant_id = $2 AND status = 'completed' RETURNING id, email, first_name, last_name, result`,
      [req.params.id, tenantId, b.level, b.note ?? null, req.user!.id],
    );
    const a = r.rows[0];
    if (!a) return res.status(404).json({ error: "assessment_not_found" });
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "recruitment.result_confirmed",
      targetType: "candidate",
      targetId: String(req.params.id),
      targetLabel: [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email,
      details: { level: b.level, estimated: a.result?.cefrLevel ?? null },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.post("/assessments/:id/decision", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = decisionSchema.parse(req.body);
    // Universities decide on admissions, and only once a person confirmed the result.
    const university = await isUniversity(tenantId);
    if (b.decision && !(university ? ADMISSIONS_DECISIONS : RECRUITMENT_DECISIONS).includes(b.decision)) return res.status(400).json({ error: "invalid_decision" });
    if (b.decision && university) {
      const c = (await pool.query(`SELECT confirmed_level FROM recruitment_assessments WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
      if (c && !c.confirmed_level) return res.status(409).json({ error: "result_not_confirmed" });
    }
    const r = await pool.query(
      `UPDATE recruitment_assessments SET decision = $3, decision_note = $4, decided_by = $5, decided_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END
       WHERE id = $1 AND tenant_id = $2 AND status = 'completed' RETURNING id, job_id, email, first_name, last_name`,
      [req.params.id, tenantId, b.decision, b.note ?? null, req.user!.id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "assessment_not_found" });
    const a = r.rows[0];
    await recordAudit({
      tenantId,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "recruitment.decision",
      targetType: "candidate",
      targetId: String(req.params.id),
      targetLabel: [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email,
      details: { decision: b.decision },
      ip: req.ip,
    });
    if (b.decision) await emitEvent(tenantId, "assessment.decided", { assessmentId: a.id, jobId: a.job_id, email: a.email, decision: b.decision });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

recruitmentRouter.get("/jobs/:id/export.csv", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const job = (await pool.query(`SELECT title FROM recruitment_jobs WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])).rows[0];
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const rows = (
      await pool.query(
        `SELECT a.first_name, a.last_name, a.email, a.status, a.result, a.decision, a.confirmed_level, a.completed_at, si.status AS integrity, ts.test_code, e.test_id
         FROM recruitment_assessments a LEFT JOIN session_integrity si ON si.session_id = a.session_id
         LEFT JOIN sessions ts ON ts.id = a.session_id
         LEFT JOIN exams e ON e.id = a.exam_id
         WHERE a.job_id = $1 AND a.status <> 'cancelled' ORDER BY a.invited_at`,
        [req.params.id],
      )
    ).rows;
    const header = ["First name", "Last name", "Email", "Test ID", "Attempt ID", "Status", "Level", "Confirmed level", "Score %", "Integrity", "Decision", "Completed"];
    const lines = rows.map((r) =>
      [r.first_name, r.last_name, r.email, r.test_id ?? "", r.test_code ?? "", r.status, r.result?.cefrLevel ?? "", r.confirmed_level ?? "", r.result?.overallPercent ?? "", r.integrity ?? "", r.decision ?? "", r.completed_at?.toISOString?.() ?? ""]
        .map(csvCell)
        .join(","),
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="candidates-${String(req.params.id).slice(0, 8)}.csv"`);
    res.send([header.join(","), ...lines].join("\n"));
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.get("/credits", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const events = await pool.query(
      `SELECT e.delta, e.reason, e.note, e.created_at, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS actor
       FROM recruitment_credit_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.tenant_id = $1 AND e.reason <> 'invite' ORDER BY e.created_at DESC LIMIT 50`,
      [tenantId],
    );
    const used = (await pool.query(`SELECT count(*)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1 AND reason = 'invite'`, [tenantId])).rows[0].n;
    res.json({ balance: await creditBalance(tenantId), used, events: events.rows });
  } catch (err) {
    next(err);
  }
});

// Asks the organization's Edstellar contact for more credits.
recruitmentRouter.post("/credits/request", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const b = z.object({ quantity: z.coerce.number().int().min(1).max(100000), note: z.string().trim().max(500).optional() }).parse(req.body);
    const t = (await pool.query(`SELECT name, managed_by, account_manager_id, assessment_price_cents FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    const staff = [t.account_manager_id, t.managed_by].filter(Boolean);
    if (!staff.length) staff.push(...(await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows.map((r) => r.id));
    const price = unitPriceCents(t.assessment_price_cents, b.quantity);
    for (const id of new Set(staff)) {
      await notify({
        userId: id,
        kind: "credit_request",
        title: `${t.name} asked for assessment credits`,
        body: `${b.quantity} credits at ${(price / 100).toFixed(2)} USD each.${b.note ? ` ${b.note}` : ""}`,
        link: "/admin/organizations",
        email: true,
        sentBy: req.user!.id,
      });
    }
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "recruitment.credits_requested", details: { quantity: b.quantity }, ip: req.ip });
    res.status(201).json({ ok: true, unitPriceCents: price });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.put("/settings", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  if (req.user!.role !== "org_admin") return res.status(403).json({ error: "forbidden" });
  try {
    const b = z.object({ retentionDays: z.coerce.number().int().min(30).max(1095) }).parse(req.body);
    await pool.query(`UPDATE tenants SET candidate_retention_days = $2 WHERE id = $1`, [tenantId, b.retentionDays]);
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "recruitment.retention_changed", details: b, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Recruiters (managed by the Org Admin) ----------

recruitmentRouter.get("/team", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at,
         (SELECT max(le.created_at) FROM login_events le WHERE le.user_id = u.id) AS last_login_at,
         (SELECT count(*)::int FROM recruitment_assessments a WHERE a.invited_by = u.id) AS invited
       FROM users u WHERE u.tenant_id = $1 AND u.role = 'recruiter' AND u.deleted_at IS NULL ORDER BY u.created_at`,
      [tenantId],
    );
    res.json({ recruiters: r.rows });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.post("/team", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  if (req.user!.role !== "org_admin") return res.status(403).json({ error: "forbidden" });
  try {
    const b = z.object({ email: z.string().trim().email(), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80) }).parse(req.body);
    const u = await createAndInviteUser({ role: "recruiter", tenantId, email: b.email, firstName: b.firstName, lastName: b.lastName, roleLabel: "a Recruiter", invitedBy: req.user!.id });
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "recruitment.recruiter_added", targetType: "user", targetId: u.id, targetLabel: b.email, ip: req.ip });
    res.status(201).json(u);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "email_already_registered" });
    next(err);
  }
});

recruitmentRouter.delete("/team/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = await recruiterTenant(req, res);
  if (!tenantId) return;
  if (req.user!.role !== "org_admin") return res.status(403).json({ error: "forbidden" });
  try {
    const r = await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1 AND tenant_id = $2 AND role = 'recruiter' AND deleted_at IS NULL RETURNING email`, [
      req.params.id,
      tenantId,
    ]);
    if (!r.rowCount) return res.status(404).json({ error: "not_found" });
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [req.params.id]);
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "recruitment.recruiter_removed", targetType: "user", targetId: String(req.params.id), targetLabel: r.rows[0].email, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Edstellar staff: products, credits, price ----------

async function staffTenant(req: AuthedRequest, res: Response): Promise<string | null> {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return null;
  const tenantId = String(req.params.tenantId);
  if (!(await staffOwnsTenant(req, tenantId))) {
    res.status(404).json({ error: "organization_not_found" });
    return null;
  }
  return tenantId;
}

recruitmentRouter.get("/admin/orgs/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffTenant(req, res);
    if (!tenantId) return;
    const t = (await pool.query(`SELECT products, assessment_price_cents, candidate_retention_days FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    const [events, usage] = await Promise.all([
      pool.query(
        `SELECT e.delta, e.reason, e.note, e.created_at, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS actor
         FROM recruitment_credit_events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.tenant_id = $1 AND e.reason <> 'invite' ORDER BY e.created_at DESC LIMIT 50`,
        [tenantId],
      ),
      pool.query(
        `SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS invited, count(*) FILTER (WHERE status = 'completed')::int AS completed,
           (SELECT count(*)::int FROM recruitment_jobs WHERE tenant_id = $1) AS jobs
         FROM recruitment_assessments WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);
    res.json({
      products: t.products,
      credits: await creditBalance(tenantId),
      customPriceCents: t.assessment_price_cents,
      rateCard: ASSESSMENT_BANDS,
      retentionDays: t.candidate_retention_days,
      usage: usage.rows[0],
      events: events.rows,
    });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.put("/admin/orgs/:tenantId/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffTenant(req, res);
    if (!tenantId) return;
    const b = z.object({ products: z.array(z.enum(PRODUCTS)).min(1), note: z.string().trim().max(500).optional() }).parse(req.body);
    const products = [...new Set(b.products)];
    const before = (await pool.query(`SELECT products FROM tenants WHERE id = $1`, [tenantId])).rows[0].products as string[];
    await pool.query(`UPDATE tenants SET products = $2 WHERE id = $1`, [tenantId, products]);
    await pool.query(`INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'products_changed', $2, $3)`, [
      tenantId,
      `${before.join(", ")} → ${products.join(", ")}${b.note ? ` (${b.note})` : ""}`,
      req.user!.id,
    ]);
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "plan.products_changed", details: { before, after: products }, ip: req.ip });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

recruitmentRouter.post("/admin/orgs/:tenantId/credits", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffTenant(req, res);
    if (!tenantId) return;
    const b = z
      .object({ amount: z.coerce.number().int().min(-100000).max(100000).refine((n) => n !== 0), reason: z.enum(["grant", "purchase", "adjustment"]).default("grant"), note: z.string().trim().max(500).optional() })
      .parse(req.body);
    await assertProduct(tenantId, "recruitment");
    if (b.amount < 0 && (await creditBalance(tenantId)) + b.amount < 0) return res.status(400).json({ error: "balance_below_zero" });
    await addCredits({ tenantId, delta: b.amount, reason: b.reason, note: b.note ?? null, actorId: req.user!.id });
    await pool.query(`INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'credits_granted', $2, $3)`, [
      tenantId,
      `${b.amount > 0 ? "+" : ""}${b.amount} assessment credits${b.note ? ` (${b.note})` : ""}`,
      req.user!.id,
    ]);
    await recordAudit({ tenantId, actorId: req.user!.id, actorRole: req.user!.role, action: "plan.credits_granted", details: { amount: b.amount, reason: b.reason }, ip: req.ip });
    res.status(201).json({ balance: await creditBalance(tenantId) });
  } catch (err) {
    fail(err, res, next);
  }
});

recruitmentRouter.put("/admin/orgs/:tenantId/price", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = await staffTenant(req, res);
    if (!tenantId) return;
    const b = z.object({ customPriceCents: z.coerce.number().int().min(0).max(100000).nullable() }).parse(req.body);
    await pool.query(`UPDATE tenants SET assessment_price_cents = $2 WHERE id = $1`, [tenantId, b.customPriceCents]);
    await pool.query(`INSERT INTO tenant_plan_events (tenant_id, kind, custom_price_cents, actor_id) VALUES ($1, 'assessment_price_change', $2, $3)`, [
      tenantId,
      b.customPriceCents,
      req.user!.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
