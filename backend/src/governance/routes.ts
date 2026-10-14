import { z } from "zod";
import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { SESSION_COOKIE } from "../auth/tokens.js";
import { assertFeature } from "../plans/service.js";
import { enqueue } from "../queue/queue.js";
import { DPA_VERSION, acceptDpa, eraseLearner, requestExport } from "./service.js";

// Mounted under /api/org-admin: data processing agreement, retention, exports
// and erasure for an organization.
export const governanceRouter = Router();

function orgAdmin(req: AuthedRequest): string | null {
  return req.user?.role === "org_admin" && req.user.tenantId ? req.user.tenantId : null;
}

governanceRouter.get("/data", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const t = (
      await pool.query(
        `SELECT t.dpa_accepted_at, t.dpa_version, t.retention_recordings_months, t.retention_inactive_learner_months,
           coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS dpa_by
         FROM tenants t LEFT JOIN users u ON u.id = t.dpa_accepted_by WHERE t.id = $1`,
        [tenantId],
      )
    ).rows[0];
    const exports = await pool.query(
      `SELECT id, status, size_bytes, created_at, completed_at, expires_at FROM data_exports WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [tenantId],
    );
    res.json({
      dpa: {
        acceptedAt: t.dpa_accepted_at,
        acceptedBy: t.dpa_by,
        acceptedVersion: t.dpa_version,
        currentVersion: DPA_VERSION,
        url: process.env.DPA_URL ?? null,
      },
      retention: { recordingsMonths: t.retention_recordings_months, inactiveLearnerMonths: t.retention_inactive_learner_months },
      exports: exports.rows.map((e) => ({
        id: e.id,
        status: e.status,
        sizeBytes: e.size_bytes,
        createdAt: e.created_at,
        completedAt: e.completed_at,
        expiresAt: e.expires_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

governanceRouter.post("/data/dpa/accept", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await acceptDpa(tenantId, req.user!.id);
    res.json({ acceptedVersion: DPA_VERSION });
  } catch (err) {
    next(err);
  }
});

governanceRouter.patch("/data/retention", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "data_governance");
    const body = z
      .object({
        recordingsMonths: z.number().int().min(1).max(120).nullable(),
        inactiveLearnerMonths: z.number().int().min(1).max(120).nullable(),
      })
      .parse(req.body);
    await pool.query(`UPDATE tenants SET retention_recordings_months = $2, retention_inactive_learner_months = $3 WHERE id = $1`, [
      tenantId,
      body.recordingsMonths,
      body.inactiveLearnerMonths,
    ]);
    res.json(body);
  } catch (err) {
    next(err);
  }
});

governanceRouter.post("/data-export", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "data_governance");
    const running = await pool.query(`SELECT 1 FROM data_exports WHERE tenant_id = $1 AND status = 'queued'`, [tenantId]);
    if (running.rowCount) return res.status(409).json({ error: "export_in_progress" });
    const id = await requestExport(tenantId, req.user!.id);
    await enqueue("data.export", { exportId: id }, { maxAttempts: 3 });
    res.status(202).json({ id });
  } catch (err) {
    next(err);
  }
});

governanceRouter.get("/data-exports/:id/download", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const e = (
      await pool.query(`SELECT file_path FROM data_exports WHERE id = $1 AND tenant_id = $2 AND status = 'ready' AND expires_at > now()`, [
        String(req.params.id),
        tenantId,
      ])
    ).rows[0];
    if (!e) return res.status(404).json({ error: "export_not_found" });
    res.download(e.file_path, `spica-export-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (err) {
    next(err);
  }
});

// Permanently removes a learner's personal data (a data subject request).
governanceRouter.post("/learners/:id/erase", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z.object({ confirm: z.literal(true), reason: z.string().trim().min(3).max(300) }).parse(req.body);
    const own = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner'`, [String(req.params.id), tenantId]);
    if (own.rowCount === 0) return res.status(404).json({ error: "learner_not_found" });
    const ok = await eraseLearner({ userId: String(req.params.id), actorId: req.user!.id, actorRole: "org_admin", reason: body.reason });
    if (!ok) return res.status(400).json({ error: "already_erased" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

// A learner erasing their own account.
export const selfEraseRouter = Router();
selfEraseRouter.post("/me/erase", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
    const body = z.object({ password: z.string().min(1) }).parse(req.body);
    const u = (await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id])).rows[0];
    if (!u || !(await bcrypt.compare(body.password, u.password_hash))) return res.status(401).json({ error: "invalid_credentials" });
    await eraseLearner({ userId: req.user!.id, actorId: req.user!.id, actorRole: "learner", reason: "Requested by the learner" });
    res.clearCookie(SESSION_COOKIE);
    res.json({ erased: true });
  } catch (err) {
    next(err);
  }
});
