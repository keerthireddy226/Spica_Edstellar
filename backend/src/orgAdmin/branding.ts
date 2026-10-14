import path from "node:path";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { LOGO_DIR, learnerOrgPolicy } from "./settings.js";

// What the app shell shows for the signed-in person's organization, plus the
// organization policies the learner screens need.
export const brandingRouter = Router();

brandingRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT t.id, t.name, t.type, t.logo_path, t.brand_color FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [req.user!.id],
    );
    const t = r.rows[0];
    const policy = await learnerOrgPolicy(req.user!.id);
    if (!t || t.type !== "cohort") return res.json({ organization: null, ...policy });
    res.json({
      organization: {
        name: t.name,
        logoUrl: t.logo_path ? `/api/branding/logo/${t.id}?v=${encodeURIComponent(t.logo_path)}` : null,
        brandColor: t.brand_color,
      },
      ...policy,
    });
  } catch (err) {
    next(err);
  }
});

// Only people in that organization, or Edstellar staff, can load its logo.
brandingRouter.get("/logo/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const tenantId = String(req.params.tenantId);
    const staff = ["admin", "super_admin"].includes(req.user!.role);
    if (!staff && req.user!.tenantId !== tenantId) return res.status(404).end();
    const t = await pool.query(`SELECT logo_path FROM tenants WHERE id = $1`, [tenantId]);
    if (!t.rows[0]?.logo_path) return res.status(404).end();
    res.set("Cache-Control", "private, max-age=86400");
    res.sendFile(path.join(LOGO_DIR, `${tenantId}.png`), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  } catch (err) {
    next(err);
  }
});
