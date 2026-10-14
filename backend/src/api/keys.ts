import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db.js";
import { hashToken } from "../auth/tokens.js";
import { getTenantPlan } from "../plans/service.js";
import { tierIncludes } from "../plans/config.js";

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function newApiKey(): { key: string; prefix: string } {
  const bytes = randomBytes(40);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % ALPHABET.length];
  const key = `spk_${body}`;
  return { key, prefix: key.slice(0, 12) };
}

export interface ApiRequest extends Request {
  apiKey?: { id: string; tenantId: string; name: string; scopes: ApiScope[] };
}

// Authorization: Bearer spk_… — resolves the organization and its scopes.
// Keys stop working if revoked or if the organization leaves the plan that
// includes API access.
export async function requireApiKey(req: ApiRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!key.startsWith("spk_")) return res.status(401).json({ error: "missing_api_key" });
    const r = await pool.query(
      `SELECT k.id, k.tenant_id, k.name, k.scopes, k.last_used_at, t.deactivated_at
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashToken(key)],
    );
    const k = r.rows[0];
    if (!k || k.deactivated_at) return res.status(401).json({ error: "invalid_api_key" });
    const plan = await getTenantPlan(k.tenant_id);
    if (!plan || !tierIncludes(plan.tier, "api_access")) return res.status(403).json({ error: "plan_feature_locked", feature: "api_access" });
    if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 60_000) {
      pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [k.id]).catch(() => {});
    }
    req.apiKey = { id: k.id, tenantId: k.tenant_id, name: k.name, scopes: k.scopes };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireScope(scope: ApiScope) {
  return (req: ApiRequest, res: Response, next: NextFunction) => {
    if (!req.apiKey?.scopes.includes(scope)) return res.status(403).json({ error: "insufficient_scope", needed: scope });
    next();
  };
}
