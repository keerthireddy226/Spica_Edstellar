import type { NextFunction, Response } from "express";
import { pool } from "../db.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { recordAudit } from "./service.js";

interface Rule {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  path: string; // relative to where the router is mounted, e.g. "/batches/:id"
  action: string;
  targetType: "batch" | "manager" | "learner" | "organization" | "org_admin" | "settings" | "api_key" | "webhook" | "user";
}

const SECRET_KEYS = /pass|token|secret|code|otp/i;

function sanitize(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) continue;
    if (Array.isArray(v)) {
      out[k] =
        v.length > 0 && typeof v[0] === "object"
          ? { count: v.length, emails: v.slice(0, 50).map((x) => (x as { email?: string }).email).filter(Boolean) }
          : v.slice(0, 50);
    } else if (typeof v === "string") {
      out[k] = v.slice(0, 500);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function labelFor(id: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS l FROM users WHERE id = $1
     UNION ALL SELECT name FROM batches WHERE id = $1
     LIMIT 1`,
    [id],
  );
  return r.rows[0]?.l ?? null;
}

const UUID = "([0-9a-f-]{36})";

// Records every successful change made through a router, after it succeeds,
// without touching each handler. Names are captured before a delete so the
// entry still says who or what was removed.
export function auditTrail(rules: Rule[]) {
  const compiled = rules.map((r) => ({ ...r, re: new RegExp(`^${r.path.replace(":id", UUID)}/?$`) }));
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const rule = compiled.find((r) => r.method === req.method && r.re.test(req.path));
    if (!rule) return next();
    const targetId = req.path.match(rule.re)?.[1] ?? null;
    let label: string | null = null;
    if (targetId && req.method === "DELETE") label = await labelFor(targetId).catch(() => null);

    let responseBody: unknown = null;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      responseBody = body;
      return json(body);
    };

    res.on("finish", () => {
      if (res.statusCode >= 400 || !req.user) return;
      const created = (responseBody as { id?: string } | null)?.id;
      const id = targetId ?? (typeof created === "string" ? created : null);
      const body = sanitize(req.body);
      void (async () => {
        const resolved =
          label ??
          (id ? await labelFor(id).catch(() => null) : null) ??
          ((body.name as string) || (body.email as string) || null);
        await recordAudit({
          tenantId: req.user!.tenantId,
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: rule.action,
          targetType: rule.targetType,
          targetId: id,
          targetLabel: resolved,
          details: body,
          ip: req.ip ?? null,
        });
      })();
    });
    next();
  };
}

export const ORG_ADMIN_AUDIT: Rule[] = [
  { method: "POST", path: "/batches", action: "batch.created", targetType: "batch" },
  { method: "PATCH", path: "/batches/:id", action: "batch.updated", targetType: "batch" },
  { method: "DELETE", path: "/batches/:id", action: "batch.deleted", targetType: "batch" },
  { method: "POST", path: "/batches/:id/complete", action: "batch.completed", targetType: "batch" },
  { method: "POST", path: "/batches/:id/archive", action: "batch.archived", targetType: "batch" },
  { method: "POST", path: "/batches/:id/reopen", action: "batch.reopened", targetType: "batch" },
  { method: "POST", path: "/batches/:id/clone", action: "batch.cloned", targetType: "batch" },
  { method: "POST", path: "/managers", action: "manager.invited", targetType: "manager" },
  { method: "PATCH", path: "/managers/:id", action: "manager.updated", targetType: "manager" },
  { method: "DELETE", path: "/managers/:id", action: "manager.deleted", targetType: "manager" },
  { method: "POST", path: "/managers/:id/deactivate", action: "manager.deactivated", targetType: "manager" },
  { method: "POST", path: "/managers/:id/reactivate", action: "manager.reactivated", targetType: "manager" },
  { method: "POST", path: "/managers/:id/resend-invite", action: "manager.invite_resent", targetType: "manager" },
  { method: "POST", path: "/learners", action: "learner.invited", targetType: "learner" },
  { method: "POST", path: "/learners/bulk", action: "learner.bulk_invited", targetType: "learner" },
  { method: "DELETE", path: "/learners/:id", action: "learner.deleted", targetType: "learner" },
  { method: "POST", path: "/learners/:id/deactivate", action: "learner.deactivated", targetType: "learner" },
  { method: "POST", path: "/learners/:id/reactivate", action: "learner.reactivated", targetType: "learner" },
  { method: "POST", path: "/learners/:id/move", action: "learner.moved", targetType: "learner" },
  { method: "POST", path: "/learners/:id/resend-invite", action: "learner.invite_resent", targetType: "learner" },
  { method: "PATCH", path: "/organization", action: "organization.updated", targetType: "organization" },
  { method: "PATCH", path: "/settings", action: "organization.settings_updated", targetType: "settings" },
  { method: "POST", path: "/settings/logo", action: "organization.logo_updated", targetType: "settings" },
  { method: "DELETE", path: "/settings/logo", action: "organization.logo_removed", targetType: "settings" },
  { method: "POST", path: "/handover", action: "org_admin.handover", targetType: "org_admin" },
  { method: "POST", path: "/api-keys", action: "api_key.created", targetType: "api_key" },
  { method: "DELETE", path: "/api-keys/:id", action: "api_key.revoked", targetType: "api_key" },
  { method: "POST", path: "/webhooks", action: "webhook.created", targetType: "webhook" },
  { method: "DELETE", path: "/webhooks/:id", action: "webhook.deleted", targetType: "webhook" },
  { method: "PATCH", path: "/sso", action: "sso.updated", targetType: "settings" },
  { method: "POST", path: "/data-export", action: "data.exported", targetType: "organization" },
  { method: "POST", path: "/learners/:id/erase", action: "learner.erased", targetType: "learner" },
];

export const MANAGER_AUDIT: Rule[] = [
  { method: "POST", path: "/learners", action: "learner.invited", targetType: "learner" },
  { method: "POST", path: "/learners/bulk", action: "learner.bulk_invited", targetType: "learner" },
  { method: "POST", path: "/learners/:id/move", action: "learner.moved", targetType: "learner" },
  { method: "POST", path: "/batches", action: "batch.created", targetType: "batch" },
];
