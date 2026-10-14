import { createHash, randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { open, seal } from "../lib/secretBox.js";
import { discover, exchangeCode, verifyIdToken } from "./oidc.js";
import { applyLearnerDefaults } from "../orgAdmin/settings.js";
import { emitEvent } from "../webhooks/service.js";
import { recordAudit } from "../audit/service.js";

export const APP_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
// Goes through the app's own origin (the dev proxy / production reverse
// proxy), so the session cookie lands on the domain the app runs on.
export const SSO_REDIRECT_URI = `${APP_URL}/api/sso/callback`;
const STATE_TTL_MS = 10 * 60 * 1000;

export class SsoError extends Error {
  constructor(
    public code:
      | "sso_not_configured"
      | "domain_not_verified"
      | "invalid_state"
      | "email_not_verified"
      | "no_account"
      | "wrong_organization"
      | "account_inactive"
      | "already_logged_in"
      | "provider_error",
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export interface SsoConfig {
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  enabled: boolean;
  enforce: boolean;
  jitProvisioning: boolean;
  redirectUri: string;
  domains: { domain: string; verified: boolean; txtName: string; txtValue: string }[];
}

export async function getSsoConfig(tenantId: string): Promise<SsoConfig | null> {
  const c = (await pool.query(`SELECT * FROM tenant_sso WHERE tenant_id = $1`, [tenantId])).rows[0];
  const domains = await pool.query(`SELECT domain, verification_token, verified_at FROM sso_domains WHERE tenant_id = $1 ORDER BY domain`, [tenantId]);
  return {
    issuer: c?.issuer ?? "",
    clientId: c?.client_id ?? "",
    hasClientSecret: !!c?.client_secret_sealed,
    enabled: c?.enabled ?? false,
    enforce: c?.enforce ?? false,
    jitProvisioning: c?.jit_provisioning ?? false,
    redirectUri: SSO_REDIRECT_URI,
    domains: domains.rows.map((d) => ({
      domain: d.domain,
      verified: !!d.verified_at,
      txtName: `_spica-verification.${d.domain}`,
      txtValue: `spica-verification=${d.verification_token}`,
    })),
  };
}

export async function saveSsoConfig(
  tenantId: string,
  body: { issuer: string; clientId: string; clientSecret?: string; enabled: boolean; enforce: boolean; jitProvisioning: boolean },
) {
  // Checks the provider is reachable and speaks OpenID Connect before saving.
  await discover(body.issuer);
  const existing = (await pool.query(`SELECT client_secret_sealed FROM tenant_sso WHERE tenant_id = $1`, [tenantId])).rows[0];
  const sealed = body.clientSecret ? seal(body.clientSecret) : existing?.client_secret_sealed;
  if (!sealed) throw new SsoError("sso_not_configured", "client secret required");
  await pool.query(
    `INSERT INTO tenant_sso (tenant_id, issuer, client_id, client_secret_sealed, enabled, enforce, jit_provisioning)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id) DO UPDATE SET issuer = $2, client_id = $3, client_secret_sealed = $4, enabled = $5, enforce = $6,
       jit_provisioning = $7, updated_at = now()`,
    [tenantId, body.issuer.replace(/\/+$/, ""), body.clientId, sealed, body.enabled, body.enabled && body.enforce, body.jitProvisioning],
  );
}

export async function addDomain(tenantId: string, domain: string): Promise<"added" | "taken"> {
  const d = domain.trim().toLowerCase().replace(/^@/, "");
  const r = await pool.query(
    `INSERT INTO sso_domains (domain, tenant_id, verification_token) VALUES ($1, $2, $3) ON CONFLICT (domain) DO NOTHING RETURNING domain`,
    [d, tenantId, randomBytes(16).toString("hex")],
  );
  return r.rowCount ? "added" : "taken";
}

export async function removeDomain(tenantId: string, domain: string) {
  await pool.query(`DELETE FROM sso_domains WHERE domain = $1 AND tenant_id = $2`, [domain.toLowerCase(), tenantId]);
}

// The organization adds a TXT record at _spica-verification.<domain>.
export async function verifyDomain(tenantId: string, domain: string): Promise<boolean> {
  const row = (await pool.query(`SELECT verification_token FROM sso_domains WHERE domain = $1 AND tenant_id = $2`, [domain.toLowerCase(), tenantId])).rows[0];
  if (!row) return false;
  const expected = `spica-verification=${row.verification_token}`;
  let records: string[][] = [];
  try {
    records = await resolveTxt(`_spica-verification.${domain.toLowerCase()}`);
  } catch {
    return false;
  }
  if (!records.some((r) => r.join("") === expected)) return false;
  await pool.query(`UPDATE sso_domains SET verified_at = now() WHERE domain = $1`, [domain.toLowerCase()]);
  return true;
}

// For the login page: does this email's domain sign in through SSO, and must it?
export async function ssoForEmail(email: string): Promise<{ tenantId: string; enforce: boolean } | null> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  const r = await pool.query(
    `SELECT s.tenant_id, s.enforce FROM sso_domains d JOIN tenant_sso s ON s.tenant_id = d.tenant_id
     WHERE d.domain = $1 AND d.verified_at IS NOT NULL AND s.enabled`,
    [domain],
  );
  return r.rows[0] ? { tenantId: r.rows[0].tenant_id, enforce: r.rows[0].enforce } : null;
}

function b64url(buf: Buffer) {
  return buf.toString("base64url");
}

// Step 1: where to send the browser.
export async function startSignIn(email: string): Promise<string> {
  const route = await ssoForEmail(email);
  if (!route) throw new SsoError("domain_not_verified");
  const c = (await pool.query(`SELECT issuer, client_id FROM tenant_sso WHERE tenant_id = $1`, [route.tenantId])).rows[0];
  const d = await discover(c.issuer);
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(32));
  await pool.query(`INSERT INTO sso_states (state, tenant_id, nonce, code_verifier, expires_at) VALUES ($1, $2, $3, $4, $5)`, [
    state,
    route.tenantId,
    nonce,
    verifier,
    new Date(Date.now() + STATE_TTL_MS),
  ]);
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.client_id,
    redirect_uri: SSO_REDIRECT_URI,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    login_hint: email,
  }).toString();
  return url.toString();
}

// Step 2: the provider sends the browser back with a code. Returns the user
// to sign in (the caller creates the session).
export async function finishSignIn(state: string, code: string, ip: string | undefined): Promise<{ userId: string; role: string }> {
  const s = (await pool.query(`DELETE FROM sso_states WHERE state = $1 AND expires_at > now() RETURNING tenant_id, nonce, code_verifier`, [state])).rows[0];
  if (!s) throw new SsoError("invalid_state");
  const c = (await pool.query(`SELECT * FROM tenant_sso WHERE tenant_id = $1 AND enabled`, [s.tenant_id])).rows[0];
  if (!c) throw new SsoError("sso_not_configured");
  let claims: Record<string, unknown>;
  try {
    const d = await discover(c.issuer);
    const idToken = await exchangeCode({ d, code, redirectUri: SSO_REDIRECT_URI, clientId: c.client_id, clientSecret: open(c.client_secret_sealed), codeVerifier: s.code_verifier });
    claims = await verifyIdToken(idToken, d, c.client_id, s.nonce);
  } catch (err) {
    throw new SsoError("provider_error", err instanceof Error ? err.message : String(err));
  }
  const email = String(claims.email ?? "").toLowerCase();
  if (!email || claims.email_verified === false) throw new SsoError("email_not_verified");
  const domain = email.split("@")[1];
  // The email must be on one of this organization's verified domains.
  const owns = await pool.query(`SELECT 1 FROM sso_domains WHERE domain = $1 AND tenant_id = $2 AND verified_at IS NOT NULL`, [domain, s.tenant_id]);
  if (owns.rowCount === 0) throw new SsoError("wrong_organization");

  let u = (await pool.query(`SELECT id, role, tenant_id, deleted_at FROM users WHERE lower(email) = $1`, [email])).rows[0];
  if (u && u.tenant_id !== s.tenant_id) throw new SsoError("wrong_organization");
  if (u && u.deleted_at) throw new SsoError("account_inactive");
  if (!u) {
    if (!c.jit_provisioning) throw new SsoError("no_account");
    const ins = await pool.query(
      `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, email_verified)
       VALUES ('learner', $1, $2, $3, $4, $5, true) RETURNING id, role, tenant_id`,
      [s.tenant_id, email, await bcrypt.hash(randomBytes(16).toString("hex"), 4), claims.given_name ?? null, claims.family_name ?? null],
    );
    u = ins.rows[0];
    await applyLearnerDefaults(s.tenant_id, u.id);
    await emitEvent(s.tenant_id, "learner.created", { learnerId: u.id, email, source: "sso" });
    await recordAudit({ tenantId: s.tenant_id, actorId: null, actorRole: "sso", actorLabel: "Single sign-on", action: "learner.invited", targetType: "learner", targetId: u.id, targetLabel: email, details: { jit: true }, ip: ip ?? null });
  }
  if (!["learner", "manager", "org_admin"].includes(u.role)) throw new SsoError("wrong_organization");
  return { userId: u.id, role: u.role };
}
