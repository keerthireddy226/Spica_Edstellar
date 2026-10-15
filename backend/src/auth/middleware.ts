import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";
import { hashToken, SESSION_COOKIE } from "./tokens.js";
import { ipAllowed } from "./policy.js";

export interface AuthedRequest extends Request {
  user?: { id: string; role: string; tenantId: string | null };
}

export interface SessionCheck {
  user?: {
    id: string;
    role: string;
    tenantId: string | null;
    mfaEnabled: boolean;
    mfaSetupRequired: boolean;
    // Set when Edstellar staff are viewing this account read-only.
    viewAs: { impersonatorName: string } | null;
  };
  error?: "not_authenticated" | "session_expired" | "ip_not_allowed";
}

const ORG_CONSOLE = ["org_admin", "manager", "recruiter"];

// One place that decides whether a session cookie is still good: not
// revoked or expired, not idle longer than the organization allows, and
// (for Org Admins and Managers) coming from an allowed network.
export async function checkSession(token: string | undefined, ip: string | undefined): Promise<SessionCheck> {
  if (!token) return { error: "not_authenticated" };
  const result = await pool.query(
    `SELECT u.id, u.role, u.tenant_id, u.mfa_enabled_at, s.id AS session_id, s.last_seen_at, s.read_only,
       t.session_idle_minutes, t.ip_allowlist, t.mfa_required,
       coalesce(nullif(concat_ws(' ', imp.first_name, imp.last_name), ''), imp.email) AS impersonator_name
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN users imp ON imp.id = s.impersonator_id
     WHERE s.session_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [hashToken(token)],
  );
  const r = result.rows[0];
  if (!r) return { error: "not_authenticated" };
  const lastSeen = new Date(r.last_seen_at).getTime();
  if (r.session_idle_minutes && Date.now() - lastSeen > r.session_idle_minutes * 60_000) {
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE id = $1`, [r.session_id]);
    return { error: "session_expired" };
  }
  const isConsole = ORG_CONSOLE.includes(r.role);
  const viewAs = r.read_only ? { impersonatorName: r.impersonator_name as string } : null;
  // Staff viewing an account aren't held to that organization's IP rules.
  if (isConsole && !viewAs && !ipAllowed(ip, r.ip_allowlist)) return { error: "ip_not_allowed" };
  // Cheap keep-alive: at most one write a minute per session.
  if (Date.now() - lastSeen > 60_000) {
    pool.query(`UPDATE auth_sessions SET last_seen_at = now() WHERE id = $1`, [r.session_id]).catch(() => {});
  }
  return {
    user: {
      id: r.id,
      role: r.role,
      tenantId: r.tenant_id,
      mfaEnabled: r.mfa_enabled_at !== null,
      mfaSetupRequired: !viewAs && isConsole && r.mfa_required && r.mfa_enabled_at === null,
      viewAs,
    },
  };
}

// Any route that needs a signed-in user. When the organization requires
// two-factor sign-in and this person hasn't set it up yet, only the auth
// routes (where they set it up) are open to them.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const check = await checkSession(req.cookies?.[SESSION_COOKIE], req.ip);
    if (!check.user) return res.status(check.error === "ip_not_allowed" ? 403 : 401).json({ error: check.error });
    if (check.user.mfaSetupRequired && !req.originalUrl.startsWith("/api/auth/")) {
      return res.status(403).json({ error: "mfa_setup_required" });
    }
    // A "view as" session can look but never change anything.
    if (check.user.viewAs && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !req.originalUrl.startsWith("/api/auth/view-as/exit")) {
      return res.status(403).json({ error: "read_only_session" });
    }
    req.user = { id: check.user.id, role: check.user.role, tenantId: check.user.tenantId };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: AuthedRequest, res: Response): boolean {
  if (!req.user || !["org_admin", "admin", "super_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}
