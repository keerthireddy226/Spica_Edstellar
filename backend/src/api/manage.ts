import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { hashToken } from "../auth/tokens.js";
import { assertFeature } from "../plans/service.js";
import { API_SCOPES, newApiKey } from "./keys.js";
import { WEBHOOK_EVENTS, emitEvent, newWebhookSecret, webhookUrlProblem } from "../webhooks/service.js";

// The Org Admin's Developers settings: API keys and webhooks (Enterprise).
export const developerRouter = Router();

function orgAdmin(req: AuthedRequest): string | null {
  return req.user?.role === "org_admin" && req.user.tenantId ? req.user.tenantId : null;
}

developerRouter.get("/api-keys", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const r = await pool.query(
      `SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS created_by
       FROM api_keys k LEFT JOIN users u ON u.id = k.created_by WHERE k.tenant_id = $1 ORDER BY k.created_at DESC`,
      [tenantId],
    );
    res.json({
      keys: r.rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        createdAt: k.created_at,
        createdBy: k.created_by,
        lastUsedAt: k.last_used_at,
        revokedAt: k.revoked_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

developerRouter.post("/api-keys", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "api_access");
    const body = z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(API_SCOPES)).min(1).default(["read"]) }).parse(req.body);
    const { key, prefix } = newApiKey();
    const r = await pool.query(
      `INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, body.name, prefix, hashToken(key), body.scopes, req.user!.id],
    );
    // The only time the full key is ever shown.
    res.status(201).json({ id: r.rows[0].id, name: body.name, key, scopes: body.scopes });
  } catch (err) {
    next(err);
  }
});

developerRouter.delete("/api-keys/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const r = await pool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING id, name`, [
      String(req.params.id),
      tenantId,
    ]);
    if (r.rowCount === 0) return res.status(404).json({ error: "api_key_not_found" });
    res.json({ id: r.rows[0].id, name: r.rows[0].name });
  } catch (err) {
    next(err);
  }
});

developerRouter.get("/webhooks", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const hooks = await pool.query(
      `SELECT w.id, w.url, w.secret, w.events, w.enabled, w.disabled_reason, w.consecutive_failures, w.created_at,
         (SELECT json_agg(d ORDER BY d.created_at DESC) FROM (
            SELECT id, event, status, attempts, response_code, last_error, created_at, delivered_at
            FROM webhook_deliveries WHERE webhook_id = w.id ORDER BY created_at DESC LIMIT 10) d) AS recent
       FROM webhooks w WHERE w.tenant_id = $1 ORDER BY w.created_at`,
      [tenantId],
    );
    res.json({
      events: WEBHOOK_EVENTS,
      webhooks: hooks.rows.map((w) => ({
        id: w.id,
        url: w.url,
        secret: w.secret,
        events: w.events,
        enabled: w.enabled,
        disabledReason: w.disabled_reason,
        consecutiveFailures: w.consecutive_failures,
        createdAt: w.created_at,
        recentDeliveries: w.recent ?? [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

developerRouter.post("/webhooks", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "api_access");
    const body = z.object({ url: z.string().trim().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(req.body);
    const problem = webhookUrlProblem(body.url);
    if (problem) return res.status(400).json({ error: "invalid_url", message: problem });
    const count = await pool.query(`SELECT count(*)::int n FROM webhooks WHERE tenant_id = $1`, [tenantId]);
    if (count.rows[0].n >= 10) return res.status(400).json({ error: "too_many_webhooks" });
    const r = await pool.query(
      `INSERT INTO webhooks (tenant_id, url, secret, events, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, body.url, newWebhookSecret(), body.events, req.user!.id],
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    next(err);
  }
});

developerRouter.patch("/webhooks/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const body = z.object({ enabled: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional() }).parse(req.body);
    const r = await pool.query(
      `UPDATE webhooks SET enabled = coalesce($3, enabled), events = coalesce($4, events),
         consecutive_failures = CASE WHEN $3 IS TRUE THEN 0 ELSE consecutive_failures END,
         disabled_reason = CASE WHEN $3 IS TRUE THEN NULL ELSE disabled_reason END
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [String(req.params.id), tenantId, body.enabled ?? null, body.events ?? null],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "webhook_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

developerRouter.delete("/webhooks/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const r = await pool.query(`DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2 RETURNING id`, [String(req.params.id), tenantId]);
    if (r.rowCount === 0) return res.status(404).json({ error: "webhook_not_found" });
    res.json({ id: req.params.id });
  } catch (err) {
    next(err);
  }
});

developerRouter.post("/webhooks/:id/test", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const w = await pool.query(`SELECT id FROM webhooks WHERE id = $1 AND tenant_id = $2 AND enabled`, [String(req.params.id), tenantId]);
    if (w.rowCount === 0) return res.status(404).json({ error: "webhook_not_found" });
    await emitEvent(tenantId, "ping", { message: "Test event from Spica" }, w.rows[0].id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
