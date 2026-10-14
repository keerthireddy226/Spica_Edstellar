import { z } from "zod";
import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createSession, setSessionCookie } from "../auth/routes.js";
import { assertFeature } from "../plans/service.js";
import { APP_URL, SsoError, addDomain, finishSignIn, getSsoConfig, removeDomain, saveSsoConfig, ssoForEmail, startSignIn, verifyDomain } from "./service.js";

const LANDING: Record<string, string> = { learner: "/onboarding", manager: "/manager/dashboard", org_admin: "/orgadmin/dashboard" };

// Public: the sign-in flow.
export const ssoRouter = Router();
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });

function fail(res: Response, code: string) {
  res.redirect(302, `${APP_URL}/login?sso_error=${encodeURIComponent(code)}`);
}

ssoRouter.get("/discover", limiter, async (req, res, next) => {
  try {
    const email = z.string().email().parse(req.query.email);
    const sso = await ssoForEmail(email);
    res.json({ sso: !!sso, enforce: sso?.enforce ?? false });
  } catch (err) {
    next(err);
  }
});

ssoRouter.get("/start", limiter, async (req, res) => {
  try {
    const email = z.string().email().parse(req.query.email);
    res.redirect(302, await startSignIn(email));
  } catch (err) {
    fail(res, err instanceof SsoError ? err.code : "provider_error");
  }
});

ssoRouter.get("/callback", limiter, async (req, res) => {
  try {
    if (typeof req.query.error === "string") return fail(res, "provider_error");
    const q = z.object({ state: z.string().min(10), code: z.string().min(1) }).parse(req.query);
    const { userId, role } = await finishSignIn(q.state, q.code, req.ip);
    const active = await pool.query(
      `SELECT 1 FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND impersonator_id IS NULL LIMIT 1`,
      [userId],
    );
    if (active.rowCount) return fail(res, "already_logged_in");
    const { token } = await createSession(pool, userId);
    setSessionCookie(res, token);
    pool
      .query(`INSERT INTO login_events (user_id, ip_address, user_agent) VALUES ($1, $2, $3)`, [userId, req.ip, req.headers["user-agent"] ?? null])
      .catch(() => {});
    res.redirect(302, `${APP_URL}${LANDING[role] ?? "/"}`);
  } catch (err) {
    if (err instanceof SsoError && err.code === "provider_error") console.error("SSO provider error:", err.message);
    fail(res, err instanceof SsoError ? err.code : "provider_error");
  }
});

// Org Admin: configuration (Enterprise).
export const ssoAdminRouter = Router();

function orgAdmin(req: AuthedRequest): string | null {
  return req.user?.role === "org_admin" && req.user.tenantId ? req.user.tenantId : null;
}

ssoAdminRouter.get("/sso", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const t = (await pool.query(`SELECT scim_token_prefix, scim_enabled_at FROM tenants WHERE id = $1`, [tenantId])).rows[0];
    res.json({
      ...(await getSsoConfig(tenantId)),
      scim: { enabled: !!t.scim_enabled_at, tokenPrefix: t.scim_token_prefix, baseUrl: `${APP_URL}/api/scim/v2` },
    });
  } catch (err) {
    next(err);
  }
});

ssoAdminRouter.patch("/sso", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "sso");
    const body = z
      .object({
        issuer: z.string().trim().url().max(300),
        clientId: z.string().trim().min(1).max(300),
        clientSecret: z.string().trim().min(1).max(1000).optional(),
        enabled: z.boolean(),
        enforce: z.boolean(),
        jitProvisioning: z.boolean(),
      })
      .parse(req.body);
    if (body.enabled) {
      const verified = await pool.query(`SELECT 1 FROM sso_domains WHERE tenant_id = $1 AND verified_at IS NOT NULL`, [tenantId]);
      if (verified.rowCount === 0) return res.status(400).json({ error: "verify_a_domain_first" });
    }
    try {
      await saveSsoConfig(tenantId, body);
    } catch (err) {
      if (err instanceof SsoError) return res.status(400).json({ error: err.code, message: err.message });
      return res.status(400).json({ error: "provider_unreachable", message: err instanceof Error ? err.message : String(err) });
    }
    res.json(await getSsoConfig(tenantId));
  } catch (err) {
    next(err);
  }
});

ssoAdminRouter.post("/sso/domains", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "sso");
    const body = z.object({ domain: z.string().trim().toLowerCase().regex(/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/) }).parse(req.body);
    if ((await addDomain(tenantId, body.domain)) === "taken") return res.status(409).json({ error: "domain_taken" });
    res.status(201).json(await getSsoConfig(tenantId));
  } catch (err) {
    next(err);
  }
});

ssoAdminRouter.post("/sso/domains/:domain/verify", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    const ok = await verifyDomain(tenantId, String(req.params.domain));
    if (!ok) return res.status(400).json({ error: "txt_record_not_found" });
    res.json(await getSsoConfig(tenantId));
  } catch (err) {
    next(err);
  }
});

ssoAdminRouter.delete("/sso/domains/:domain", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await removeDomain(tenantId, String(req.params.domain));
    res.json(await getSsoConfig(tenantId));
  } catch (err) {
    next(err);
  }
});

// SCIM bearer token, shown once.
ssoAdminRouter.post("/scim-token", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await assertFeature(tenantId, "sso");
    const token = `scim_${randomBytes(32).toString("base64url")}`;
    await pool.query(`UPDATE tenants SET scim_token_hash = $2, scim_token_prefix = $3, scim_enabled_at = now() WHERE id = $1`, [
      tenantId,
      createHash("sha256").update(token).digest("hex"),
      token.slice(0, 10),
    ]);
    res.status(201).json({ token, baseUrl: `${APP_URL}/api/scim/v2` });
  } catch (err) {
    next(err);
  }
});

ssoAdminRouter.delete("/scim-token", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = orgAdmin(req);
  if (!tenantId) return res.status(403).json({ error: "forbidden" });
  try {
    await pool.query(`UPDATE tenants SET scim_token_hash = NULL, scim_token_prefix = NULL, scim_enabled_at = NULL WHERE id = $1`, [tenantId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
