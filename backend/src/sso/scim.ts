import { createHash, randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { createAndInviteUser } from "../auth/invite.js";
import { releaseQueuedMonths } from "../licenses/service.js";
import { recordAudit } from "../audit/service.js";
import { getTenantPlan } from "../plans/service.js";
import { tierIncludes } from "../plans/config.js";
import { applyLearnerDefaults } from "../orgAdmin/settings.js";
import { emitEvent } from "../webhooks/service.js";
import { APP_URL } from "./service.js";

// SCIM 2.0 (RFC 7643/7644) Users endpoint, so an identity provider (Okta,
// Entra ID, OneLogin…) can create, update and deactivate learners. Groups
// aren't supported: batches are managed in Spica.
export const scimRouter = Router();

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BASE = `${APP_URL}/api/scim/v2`;
const PG_UNIQUE_VIOLATION = "23505";

interface ScimRequest extends Request {
  scimTenantId?: string;
}

function scimError(res: Response, status: number, detail: string, scimType?: string) {
  res.status(status).type("application/scim+json").json({ schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) });
}

function send(res: Response, status: number, body: unknown) {
  res.status(status).type("application/scim+json").send(JSON.stringify(body));
}

scimRouter.use(async (req: ScimRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith("scim_")) return scimError(res, 401, "Missing bearer token");
    const t = (
      await pool.query(`SELECT id FROM tenants WHERE scim_token_hash = $1 AND deactivated_at IS NULL`, [createHash("sha256").update(token).digest("hex")])
    ).rows[0];
    if (!t) return scimError(res, 401, "Invalid token");
    const plan = await getTenantPlan(t.id);
    if (!plan || !tierIncludes(plan.tier, "sso")) return scimError(res, 403, "Provisioning needs the Enterprise plan");
    req.scimTenantId = t.id;
    next();
  } catch (err) {
    next(err);
  }
});

function toScim(u: Record<string, any>) {
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    externalId: u.external_id ?? undefined,
    userName: u.email,
    name: { givenName: u.first_name ?? "", familyName: u.last_name ?? "", formatted: [u.first_name, u.last_name].filter(Boolean).join(" ") },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: !u.deleted_at,
    meta: { resourceType: "User", created: u.created_at, lastModified: u.updated_at ?? u.created_at, location: `${BASE}/Users/${u.id}` },
  };
}

const USER_COLUMNS = `id, email, first_name, last_name, external_id, deleted_at, created_at, updated_at`;

async function findUser(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'learner' AND erased_at IS NULL`, [id, tenantId])
  ).rows[0];
}

async function setActive(tenantId: string, id: string, active: boolean) {
  if (active) {
    await pool.query(`UPDATE users SET deleted_at = NULL, updated_at = now() WHERE id = $1`, [id]);
  } else {
    await pool.query(`UPDATE users SET deleted_at = coalesce(deleted_at, now()), updated_at = now() WHERE id = $1`, [id]);
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    await releaseQueuedMonths({ tenantId, userId: id, actorId: id, reason: "Deactivated by the identity provider (SCIM)" });
  }
  await recordAudit({
    tenantId,
    actorId: null,
    actorRole: "scim",
    actorLabel: "Identity provider (SCIM)",
    action: active ? "learner.reactivated" : "learner.deactivated",
    targetType: "learner",
    targetId: id,
    targetLabel: (await pool.query(`SELECT email FROM users WHERE id = $1`, [id])).rows[0]?.email ?? null,
  });
}

scimRouter.get("/ServiceProviderConfig", (_req, res) => {
  send(res, 200, {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Token from Spica Settings → Single sign-on" }],
  });
});

scimRouter.get("/ResourceTypes", (_req, res) => {
  send(res, 200, {
    schemas: [LIST_SCHEMA],
    totalResults: 1,
    Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER_SCHEMA }],
  });
});

scimRouter.get("/Schemas", (_req, res) => {
  send(res, 200, { schemas: [LIST_SCHEMA], totalResults: 1, Resources: [{ id: USER_SCHEMA, name: "User", attributes: [] }] });
});

scimRouter.get("/Users", async (req: ScimRequest, res, next) => {
  try {
    const startIndex = Math.max(1, Number(req.query.startIndex) || 1);
    const count = Math.min(200, Math.max(0, Number(req.query.count ?? 100)));
    const filter = typeof req.query.filter === "string" ? req.query.filter : "";
    const params: unknown[] = [req.scimTenantId];
    let where = "";
    // Identity providers look users up with: userName eq "x" or externalId eq "x".
    const m = filter.match(/^\s*(userName|externalId|emails(?:\.value)?)\s+eq\s+"([^"]*)"\s*$/i);
    if (filter && !m) return scimError(res, 400, "Only 'userName eq', 'externalId eq' and 'emails eq' filters are supported", "invalidFilter");
    if (m) {
      params.push(m[1].toLowerCase() === "externalid" ? m[2] : m[2].toLowerCase());
      where = m[1].toLowerCase() === "externalid" ? `AND external_id = $2` : `AND lower(email) = $2`;
    }
    const total = (await pool.query(`SELECT count(*)::int n FROM users WHERE tenant_id = $1 AND role = 'learner' AND erased_at IS NULL ${where}`, params)).rows[0].n;
    const rows = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE tenant_id = $1 AND role = 'learner' AND erased_at IS NULL ${where}
       ORDER BY created_at, id OFFSET ${startIndex - 1} LIMIT ${count}`,
      params,
    );
    send(res, 200, { schemas: [LIST_SCHEMA], totalResults: total, startIndex, itemsPerPage: rows.rows.length, Resources: rows.rows.map(toScim) });
  } catch (err) {
    next(err);
  }
});

scimRouter.get("/Users/:id", async (req: ScimRequest, res, next) => {
  try {
    const u = await findUser(req.scimTenantId!, String(req.params.id));
    if (!u) return scimError(res, 404, "User not found");
    send(res, 200, toScim(u));
  } catch (err) {
    next(err);
  }
});

function readUser(body: any) {
  const email = String(body?.userName ?? body?.emails?.find((e: any) => e.primary)?.value ?? body?.emails?.[0]?.value ?? "").trim().toLowerCase();
  return {
    email,
    firstName: body?.name?.givenName ?? null,
    lastName: body?.name?.familyName ?? null,
    externalId: body?.externalId ?? null,
    active: body?.active !== false,
  };
}

scimRouter.post("/Users", async (req: ScimRequest, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const u = readUser(req.body);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) return scimError(res, 400, "userName must be an email address", "invalidValue");
    const sso = (await pool.query(`SELECT enabled FROM tenant_sso WHERE tenant_id = $1`, [tenantId])).rows[0]?.enabled;
    let id: string;
    try {
      if (sso) {
        // They'll sign in through the identity provider; no password invite.
        id = (
          await pool.query(
            `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, external_id, email_verified)
             VALUES ('learner', $1, $2, $3, $4, $5, $6, true) RETURNING id`,
            [tenantId, u.email, await bcrypt.hash(randomBytes(16).toString("hex"), 4), u.firstName, u.lastName, u.externalId],
          )
        ).rows[0].id;
        await applyLearnerDefaults(tenantId, id);
        await emitEvent(tenantId, "learner.created", { learnerId: id, email: u.email, source: "scim" });
      } else {
        id = (await createAndInviteUser({ role: "learner", tenantId, email: u.email, firstName: u.firstName ?? "", lastName: u.lastName ?? "", roleLabel: "a learner" })).id;
        await pool.query(`UPDATE users SET external_id = $2 WHERE id = $1`, [id, u.externalId]);
      }
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) return scimError(res, 409, "User already exists", "uniqueness");
      throw err;
    }
    await recordAudit({ tenantId, actorId: null, actorRole: "scim", actorLabel: "Identity provider (SCIM)", action: "learner.invited", targetType: "learner", targetId: id, targetLabel: u.email });
    if (!u.active) await setActive(tenantId, id, false);
    send(res, 201, toScim(await findUser(tenantId, id)));
  } catch (err) {
    next(err);
  }
});

scimRouter.put("/Users/:id", async (req: ScimRequest, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const cur = await findUser(tenantId, String(req.params.id));
    if (!cur) return scimError(res, 404, "User not found");
    const u = readUser(req.body);
    await pool.query(`UPDATE users SET first_name = $2, last_name = $3, external_id = coalesce($4, external_id), updated_at = now() WHERE id = $1`, [
      cur.id,
      u.firstName,
      u.lastName,
      u.externalId,
    ]);
    if (u.active === !!cur.deleted_at) await setActive(tenantId, cur.id, u.active);
    send(res, 200, toScim(await findUser(tenantId, cur.id)));
  } catch (err) {
    next(err);
  }
});

scimRouter.patch("/Users/:id", async (req: ScimRequest, res, next) => {
  try {
    const tenantId = req.scimTenantId!;
    const cur = await findUser(tenantId, String(req.params.id));
    if (!cur) return scimError(res, 404, "User not found");
    if (!Array.isArray(req.body?.schemas) || !req.body.schemas.includes(PATCH_SCHEMA)) return scimError(res, 400, "Expected a PatchOp", "invalidSyntax");
    let active: boolean | null = null;
    const names: { first?: string; last?: string } = {};
    for (const op of req.body.Operations ?? []) {
      if (!["replace", "add"].includes(String(op.op).toLowerCase())) continue;
      // Both styles: { path: "active", value: false } and { value: { active: false } } (Entra ID).
      const entries: [string, unknown][] = op.path ? [[String(op.path), op.value]] : Object.entries(op.value ?? {});
      for (const [path, value] of entries) {
        const p = path.toLowerCase();
        if (p === "active") active = value === true || value === "True" || value === "true";
        else if (p === "name.givenname") names.first = String(value);
        else if (p === "name.familyname") names.last = String(value);
        else if (p === "name" && value && typeof value === "object") {
          names.first = (value as any).givenName ?? names.first;
          names.last = (value as any).familyName ?? names.last;
        }
      }
    }
    if (names.first !== undefined || names.last !== undefined) {
      await pool.query(`UPDATE users SET first_name = coalesce($2, first_name), last_name = coalesce($3, last_name), updated_at = now() WHERE id = $1`, [
        cur.id,
        names.first ?? null,
        names.last ?? null,
      ]);
    }
    if (active !== null && active === !!cur.deleted_at) await setActive(tenantId, cur.id, active);
    send(res, 200, toScim(await findUser(tenantId, cur.id)));
  } catch (err) {
    next(err);
  }
});

// Deprovisioning deactivates rather than deletes, so history and license
// records stay; erasure is a separate, deliberate step.
scimRouter.delete("/Users/:id", async (req: ScimRequest, res, next) => {
  try {
    const cur = await findUser(req.scimTenantId!, String(req.params.id));
    if (!cur) return scimError(res, 404, "User not found");
    if (!cur.deleted_at) await setActive(req.scimTenantId!, cur.id, false);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

scimRouter.get("/Groups", (_req, res) => {
  send(res, 200, { schemas: [LIST_SCHEMA], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] });
});
scimRouter.all("/Groups/*splat", (_req, res) => scimError(res, 501, "Groups aren't supported; manage batches in Spica"));
