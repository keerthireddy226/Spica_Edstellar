import type { Response } from "express";
import { pool } from "../db.js";
import type { AuthedRequest } from "../auth/middleware.js";

// Edstellar staff: a Super Admin sees and does everything; an Admin works on
// the organizations they own (onboarded, or are account manager for), within
// the permissions the Super Admin gave them.

export const STAFF_PERMISSIONS = ["manageOrganizations", "inviteLearners", "viewLearnerInfo", "contentReview", "scoreReview", "viewReports", "manageAdmins"] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const isSuperAdmin = (req: AuthedRequest) => req.user?.role === "super_admin";

export function requireStaff(req: AuthedRequest, res: Response): boolean {
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

export async function staffPermissions(req: AuthedRequest): Promise<Record<StaffPermission, boolean>> {
  if (isSuperAdmin(req)) return Object.fromEntries(STAFF_PERMISSIONS.map((p) => [p, true])) as Record<StaffPermission, boolean>;
  const r = await pool.query(`SELECT permissions FROM users WHERE id = $1`, [req.user!.id]);
  const p = (r.rows[0]?.permissions ?? {}) as Partial<Record<StaffPermission, boolean>>;
  return Object.fromEntries(STAFF_PERMISSIONS.map((k) => [k, p[k] === true])) as Record<StaffPermission, boolean>;
}

// Staff only, and for an Admin, only with this permission.
export async function requirePermission(req: AuthedRequest, res: Response, permission: StaffPermission): Promise<boolean> {
  if (!requireStaff(req, res)) return false;
  if (isSuperAdmin(req)) return true;
  if ((await staffPermissions(req))[permission]) return true;
  res.status(403).json({ error: "permission_required", permission });
  return false;
}

// SQL limiting a tenants alias to the organizations this person may see.
// `index` is the placeholder number for the user id.
export function orgScope(req: AuthedRequest, alias = "t", index = 1): { sql: string; params: string[] } {
  if (isSuperAdmin(req)) return { sql: "", params: [] };
  return { sql: `AND (${alias}.managed_by = $${index} OR ${alias}.account_manager_id = $${index})`, params: [req.user!.id] };
}

export async function staffOwnsTenant(req: AuthedRequest, tenantId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM tenants WHERE id = $1 AND type = 'cohort' AND ($2::boolean OR managed_by = $3 OR account_manager_id = $3)`,
    [tenantId, isSuperAdmin(req), req.user!.id],
  );
  return (r.rowCount ?? 0) > 0;
}

// A learner staff may look at: in one of their organizations, or an
// individual learner (who belongs to no organization).
export async function staffCanSeeUser(req: AuthedRequest, userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = $1 AND ($2::boolean OR t.type <> 'cohort' OR t.managed_by = $3 OR t.account_manager_id = $3)`,
    [userId, isSuperAdmin(req), req.user!.id],
  );
  return (r.rowCount ?? 0) > 0;
}

// An Admin who manages other Admins can only hand out permissions they
// hold themselves; a Super Admin can hand out any.
export async function clampPermissions(req: AuthedRequest, requested: Partial<Record<string, boolean | undefined>>) {
  const mine = await staffPermissions(req);
  return Object.fromEntries(Object.entries(requested).map(([k, v]) => [k, !!v && (isSuperAdmin(req) || mine[k as StaffPermission] === true)]));
}
