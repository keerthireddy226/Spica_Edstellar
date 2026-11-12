import { z } from "zod";
import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { createAndInviteUser } from "../auth/invite.js";
import { DetailsError } from "../learners/details.js";
import { learnerAccessMap, assignMonths, releaseQueuedMonths, LicenseError } from "../licenses/service.js";
import { recordAudit } from "../audit/service.js";
import { requireApiKey, requireScope, type ApiRequest } from "./keys.js";
import { OPENAPI } from "./openapi.js";
import { assertProduct, inviteCandidates, RecruitmentError } from "../recruitment/service.js";

// Public REST API for an organization's own systems. Everything is scoped to
// the organization that owns the key.
export const apiV1Router = Router();

const PG_UNIQUE_VIOLATION = "23505";

apiV1Router.get("/openapi.json", (_req, res) => {
  res.json(OPENAPI);
});

apiV1Router.use(requireApiKey);
apiV1Router.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as ApiRequest).apiKey?.id ?? "anon",
    handler: (_req, res) => {
      res.status(429).json({ error: "rate_limited" });
    },
  }),
);

function audit(req: ApiRequest, action: string, targetId: string | null, label: string | null, details: Record<string, unknown> = {}) {
  return recordAudit({
    tenantId: req.apiKey!.tenantId,
    actorId: null,
    actorRole: "api",
    actorLabel: `API key: ${req.apiKey!.name}`,
    action,
    targetType: "learner",
    targetId,
    targetLabel: label,
    details,
    ip: req.ip ?? null,
  });
}

async function learnersQuery(tenantId: string, where: string, params: unknown[], limit = 100) {
  const r = await pool.query(
    `SELECT u.id, u.participant_id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at,
       u.employee_id, u.department, u.job_title,
       b.id AS batch_id, b.batch_code, b.name AS batch_name,
       EXISTS (SELECT 1 FROM login_events le WHERE le.user_id = u.id) AS accepted,
       (SELECT cefr_level FROM placements pl WHERE pl.user_id = u.id ORDER BY taken_at DESC LIMIT 1) AS cefr,
       (SELECT coalesce(sum(d.sessions), 0)::int FROM learner_activity_daily d WHERE d.user_id = u.id) AS sessions,
       (SELECT max(d.day) FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0) AS last_active
     FROM users u LEFT JOIN batches b ON b.id = u.batch_id
     WHERE u.tenant_id = $1 AND u.role = 'learner' AND u.erased_at IS NULL ${where}
     ORDER BY u.created_at, u.id LIMIT ${limit + 1}`,
    [tenantId, ...params],
  );
  const rows = r.rows.slice(0, limit);
  const access = await learnerAccessMap(rows.map((x) => x.id));
  return {
    hasMore: r.rows.length > limit,
    learners: rows.map((x) => {
      const a = access.get(x.id);
      return {
        id: x.id,
        participantId: x.participant_id,
        email: x.email,
        firstName: x.first_name,
        lastName: x.last_name,
        employeeId: x.employee_id,
        department: x.department,
        jobTitle: x.job_title,
        status: x.deleted_at ? "deactivated" : "active",
        inviteAccepted: x.accepted,
        batch: x.batch_id ? { id: x.batch_id, code: x.batch_code, name: x.batch_name } : null,
        currentCefr: x.cefr,
        sessionsCompleted: x.sessions,
        lastActiveOn: x.last_active,
        license: a ? { status: a.status, accessEndsAt: a.accessEndsAt } : null,
        createdAt: x.created_at,
      };
    }),
  };
}

apiV1Router.get("/learners", requireScope("read"), async (req: ApiRequest, res, next) => {
  try {
    const q = z
      .object({
        batchCode: z.string().max(40).optional(),
        status: z.enum(["active", "deactivated"]).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        // Opaque cursor from the previous page.
        cursor: z.string().max(200).optional(),
      })
      .parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.batchCode) {
      params.push(q.batchCode);
      where.push(`AND b.batch_code = $${params.length + 1}`);
    }
    if (q.status) where.push(q.status === "active" ? "AND u.deleted_at IS NULL" : "AND u.deleted_at IS NOT NULL");
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, "base64url").toString().split("|");
      params.push(ts, id);
      where.push(`AND (u.created_at, u.id) > ($${params.length}::timestamptz, $${params.length + 1}::uuid)`);
    }
    const page = await learnersQuery(req.apiKey!.tenantId, where.join(" "), params, q.limit);
    const last = page.learners[page.learners.length - 1];
    res.json({
      data: page.learners,
      nextCursor: page.hasMore && last ? Buffer.from(`${new Date(last.createdAt).toISOString()}|${last.id}`).toString("base64url") : null,
    });
  } catch (err) {
    next(err);
  }
});

async function findLearner(tenantId: string, idOrParticipant: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrParticipant);
  const page = await learnersQuery(tenantId, isUuid ? "AND u.id = $2" : "AND u.participant_id = $2", [idOrParticipant], 1);
  return page.learners[0] ?? null;
}

apiV1Router.get("/learners/:id", requireScope("read"), async (req: ApiRequest, res, next) => {
  try {
    const l = await findLearner(req.apiKey!.tenantId, String(req.params.id));
    if (!l) return res.status(404).json({ error: "learner_not_found" });
    res.json({ data: l });
  } catch (err) {
    next(err);
  }
});

// Add a learner (they get the usual invite email), optionally into a batch
// and with months of access.
apiV1Router.post("/learners", requireScope("write"), async (req: ApiRequest, res: Response, next) => {
  try {
    const body = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100),
        batchCode: z.string().max(40).optional(),
        licenseMonths: z.number().int().min(0).max(24).default(0),
        employeeId: z.string().trim().max(60).optional(),
        department: z.string().trim().max(120).optional(),
        jobTitle: z.string().trim().max(120).optional(),
      })
      .parse(req.body);
    const tenantId = req.apiKey!.tenantId;
    let batchId: string | null = null;
    if (body.batchCode) {
      const b = await pool.query(`SELECT id, status FROM batches WHERE tenant_id = $1 AND batch_code = $2`, [tenantId, body.batchCode]);
      if (!b.rows[0]) return res.status(400).json({ error: "batch_not_found" });
      if (b.rows[0].status !== "active") return res.status(400).json({ error: "batch_closed" });
      batchId = b.rows[0].id;
    }
    let id: string;
    try {
      const details = { employeeId: body.employeeId, department: body.department, jobTitle: body.jobTitle };
      id = (await createAndInviteUser({ role: "learner", tenantId, batchId, email: body.email, firstName: body.firstName, lastName: body.lastName, roleLabel: "a learner", details })).id;
    } catch (err) {
      if (err instanceof DetailsError) return res.status(409).json({ error: err.code });
      if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "email_already_registered" });
      throw err;
    }
    let licenseError: string | null = null;
    if (body.licenseMonths > 0) {
      try {
        await assignMonths({ tenantId, userId: id, months: body.licenseMonths, actorId: id, actorRole: "system" });
      } catch (err) {
        licenseError = err instanceof LicenseError ? err.code : "license_error";
      }
    }
    await audit(req, "learner.invited", id, body.email, { batchCode: body.batchCode ?? null, licenseMonths: body.licenseMonths });
    res.status(201).json({ data: await findLearner(tenantId, id), licenseError });
  } catch (err) {
    next(err);
  }
});

// Offboarding from an HR system: sign-in stops, unstarted months return.
apiV1Router.post("/learners/:id/deactivate", requireScope("write"), async (req: ApiRequest, res, next) => {
  try {
    const tenantId = req.apiKey!.tenantId;
    const l = await findLearner(tenantId, String(req.params.id));
    if (!l) return res.status(404).json({ error: "learner_not_found" });
    await pool.query(`UPDATE users SET deleted_at = coalesce(deleted_at, now()) WHERE id = $1`, [l.id]);
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [l.id]);
    const reclaimedMonths = await releaseQueuedMonths({ tenantId, userId: l.id, actorId: l.id, reason: `Deactivated via API (${req.apiKey!.name})` });
    await audit(req, "learner.deactivated", l.id, l.email);
    res.json({ data: await findLearner(tenantId, l.id), reclaimedMonths });
  } catch (err) {
    next(err);
  }
});

apiV1Router.get("/batches", requireScope("read"), async (req: ApiRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.batch_code, b.name, b.status, b.start_date, b.duration_months, b.start_cefr, b.target_cefr,
         (SELECT count(*)::int FROM users u WHERE u.batch_id = b.id AND u.role = 'learner' AND u.deleted_at IS NULL) AS learners
       FROM batches b WHERE b.tenant_id = $1 ORDER BY b.created_at`,
      [req.apiKey!.tenantId],
    );
    res.json({
      data: r.rows.map((b) => ({
        id: b.id,
        code: b.batch_code,
        name: b.name,
        status: b.status,
        startDate: b.start_date,
        durationMonths: b.duration_months,
        goal: { from: b.start_cefr, to: b.target_cefr },
        activeLearners: b.learners,
      })),
    });
  } catch (err) {
    next(err);
  }
});

apiV1Router.get("/certificates", requireScope("read"), async (req: ApiRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT c.id, c.code, c.user_id, c.learner_name, c.participant_id, c.batch_name, c.cefr_level, c.issued_at, c.revoked_at
       FROM certificates c WHERE c.tenant_id = $1 ORDER BY c.issued_at DESC LIMIT 1000`,
      [req.apiKey!.tenantId],
    );
    res.json({
      data: r.rows.map((c) => ({
        id: c.id,
        code: c.code,
        learnerId: c.user_id,
        learnerName: c.learner_name,
        participantId: c.participant_id,
        batchName: c.batch_name,
        cefrLevel: c.cefr_level,
        issuedAt: c.issued_at,
        revoked: !!c.revoked_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

apiV1Router.get("/analytics/summary", requireScope("read"), async (req: ApiRequest, res, next) => {
  try {
    const t = req.apiKey!.tenantId;
    const r = (
      await pool.query(
        `SELECT
           (SELECT count(*)::int FROM users WHERE tenant_id = $1 AND role = 'learner' AND deleted_at IS NULL) AS learners,
           (SELECT count(DISTINCT user_id)::int FROM learner_activity_daily WHERE tenant_id = $1 AND sessions > 0 AND day > current_date - 7) AS active7,
           (SELECT count(DISTINCT user_id)::int FROM learner_activity_daily WHERE tenant_id = $1 AND sessions > 0 AND day > current_date - 30) AS active30,
           (SELECT coalesce(sum(sessions), 0)::int FROM learner_activity_daily WHERE tenant_id = $1 AND day > current_date - 30) AS sessions30,
           (SELECT coalesce(sum(active_ms), 0)::bigint FROM learner_activity_daily WHERE tenant_id = $1 AND day > current_date - 30) AS ms30`,
        [t],
      )
    ).rows[0];
    res.json({
      data: {
        learners: r.learners,
        activeLast7Days: r.active7,
        activeLast30Days: r.active30,
        sessionsLast30Days: r.sessions30,
        practiceMinutesLast30Days: Math.round(Number(r.ms30) / 60000),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- Recruitment ----------
// Hiring systems invite candidates to a job opening's English assessment and
// read the results. Only for organizations with the recruitment product.

const PER_PAGE = 100;

async function recruitmentTenant(req: ApiRequest, res: Response): Promise<string | null> {
  try {
    await assertProduct(req.apiKey!.tenantId, "recruitment");
    return req.apiKey!.tenantId;
  } catch (err) {
    if (!(err instanceof RecruitmentError)) throw err;
    res.status(403).json({ error: "recruitment_not_enabled" });
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assessmentOut(a: Record<string, any>) {
  return {
    id: a.id,
    jobId: a.job_id,
    jobTitle: a.job_title,
    email: a.email,
    firstName: a.first_name,
    lastName: a.last_name,
    status: a.status,
    extraTimePercent: a.extra_time_percent ?? 0,
    invitedAt: a.invited_at,
    expiresAt: a.expires_at,
    startedAt: a.started_at,
    completedAt: a.completed_at,
    // The test's result once it's scored: CEFR level, Spica score, skills.
    result: a.status === "completed" ? (a.result ?? null) : null,
    decision: a.decision,
    decidedAt: a.decided_at,
  };
}

const ASSESSMENT_SELECT = `SELECT a.id, a.job_id, j.title AS job_title, a.email, a.first_name, a.last_name, a.status, a.extra_time_percent,
  a.invited_at, a.expires_at, a.started_at, a.completed_at, a.result, a.decision, a.decided_at
  FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

apiV1Router.get("/jobs", requireScope("read"), async (req: ApiRequest, res, next) => {
  const tenantId = await recruitmentTenant(req, res);
  if (!tenantId) return;
  try {
    const r = await pool.query(
      `SELECT id, title, department, location, test_kind, min_cefr, status, created_at FROM recruitment_jobs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [tenantId],
    );
    res.json({
      data: r.rows.map((j) => ({ id: j.id, title: j.title, department: j.department, location: j.location, testKind: j.test_kind, minCefr: j.min_cefr, status: j.status, createdAt: j.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

apiV1Router.get("/assessments", requireScope("read"), async (req: ApiRequest, res, next) => {
  const tenantId = await recruitmentTenant(req, res);
  if (!tenantId) return;
  try {
    const q = z
      .object({
        jobId: z.string().regex(UUID_RE).optional(),
        status: z.enum(["invited", "started", "completed", "expired", "cancelled"]).optional(),
        email: z.string().email().max(254).optional(),
        cursor: z.string().max(200).optional(),
      })
      .parse(req.query);
    const params: unknown[] = [tenantId];
    const where = ["a.tenant_id = $1"];
    if (q.jobId) where.push(`a.job_id = $${params.push(q.jobId)}`);
    if (q.status) where.push(`a.status = $${params.push(q.status)}`);
    if (q.email) where.push(`lower(a.email) = lower($${params.push(q.email)})`);
    if (q.cursor) {
      const [ts, id] = Buffer.from(q.cursor, "base64url").toString().split("|");
      if (!ts || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(ts))) return res.status(400).json({ error: "invalid_cursor" });
      where.push(`(a.invited_at, a.id) > ($${params.push(ts)}::timestamptz, $${params.push(id)}::uuid)`);
    }
    const r = await pool.query(`${ASSESSMENT_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.invited_at, a.id LIMIT ${PER_PAGE + 1}`, params);
    const rows = r.rows.slice(0, PER_PAGE);
    const last = rows[rows.length - 1];
    res.json({
      data: rows.map(assessmentOut),
      nextCursor: r.rows.length > PER_PAGE && last ? Buffer.from(`${new Date(last.invited_at).toISOString()}|${last.id}`).toString("base64url") : null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid_query" });
    next(err);
  }
});

apiV1Router.get("/assessments/:id", requireScope("read"), async (req: ApiRequest, res, next) => {
  const tenantId = await recruitmentTenant(req, res);
  if (!tenantId) return;
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "not_found" });
    const a = (await pool.query(`${ASSESSMENT_SELECT} WHERE a.id = $1 AND a.tenant_id = $2`, [req.params.id, tenantId])).rows[0];
    if (!a) return res.status(404).json({ error: "not_found" });
    res.json(assessmentOut(a));
  } catch (err) {
    next(err);
  }
});

const apiInviteSchema = z.object({
  people: z
    .array(
      z.object({
        email: z.string().email().max(254),
        firstName: z.string().max(100).optional(),
        lastName: z.string().max(100).optional(),
        extraTimePercent: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(100)]).optional(),
      }),
    )
    .min(1)
    .max(100),
});

// Invites people to a job opening's assessment. Each invitation uses the
// test's credits; people already invited to this job are skipped.
apiV1Router.post("/jobs/:id/assessments", requireScope("write"), async (req: ApiRequest, res: Response, next) => {
  const tenantId = await recruitmentTenant(req, res);
  if (!tenantId) return;
  try {
    if (!UUID_RE.test(String(req.params.id))) return res.status(404).json({ error: "job_not_found" });
    const b = apiInviteSchema.parse(req.body);
    const r = await inviteCandidates({ tenantId, jobId: String(req.params.id), actorId: null, people: b.people });
    await recordAudit({
      tenantId,
      actorId: null,
      actorRole: "api",
      actorLabel: `API key: ${req.apiKey!.name}`,
      action: "recruitment.candidates_invited",
      targetType: "job",
      targetId: String(req.params.id),
      targetLabel: null,
      details: { count: r.invited.length, skipped: r.skipped },
      ip: req.ip ?? null,
    });
    res.status(201).json({ data: r.invited.map((x) => ({ id: x.id, email: x.email })), skipped: r.skipped });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "invalid_body", fields: err.issues.map((i) => i.path.join(".")) });
    if (err instanceof RecruitmentError) return res.status(err.status).json({ error: err.code, ...err.detail });
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "already_invited" });
    next(err);
  }
});
