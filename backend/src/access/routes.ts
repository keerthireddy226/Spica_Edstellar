import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requireStaff } from "../admin/staff.js";
import { accessCache } from "../licenses/accessCache.js";
import { accessOf, allowedItemTypes } from "./entitlements.js";

// What a learner owns (for the app's menus, home page and locks), the product
// list, and Spica staff's tools: prices, and granting a product by hand.
export const accessRouter = Router();

accessRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const a = await accessOf(req.user!.id);
    res.json({ ...a, itemTypes: await allowedItemTypes(a) });
  } catch (err) {
    next(err);
  }
});

const productRow = (p: Record<string, unknown>) => ({
  id: p.id,
  kind: p.kind,
  testTypeId: p.test_type_id,
  testTypeName: p.test_type_name ?? null,
  name: p.name,
  description: p.description,
  pricePaise: p.price_paise,
  credits: p.credits,
  durationDays: p.duration_days,
  attempts: p.attempts,
  active: p.active,
  sortOrder: p.sort_order,
});

accessRouter.get("/products", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const staff = ["admin", "super_admin"].includes(req.user!.role);
    const r = await pool.query(
      `SELECT p.*, tt.name AS test_type_name FROM products p LEFT JOIN test_types tt ON tt.id = p.test_type_id
       WHERE $1 OR p.active ORDER BY p.sort_order`,
      [staff],
    );
    res.json({ products: r.rows.map(productRow) });
  } catch (err) {
    next(err);
  }
});

// ---- Spica staff ----

accessRouter.patch("/products/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500),
        pricePaise: z.number().int().min(0).max(100_000_000),
        credits: z.number().int().min(0).max(1000).nullable(),
        durationDays: z.number().int().min(1).max(730),
        attempts: z.number().int().min(0).max(10),
        active: z.boolean(),
      })
      .partial()
      .parse(req.body);
    const cols: [string, unknown][] = [
      ["name", body.name],
      ["description", body.description],
      ["price_paise", body.pricePaise],
      ["credits", body.credits],
      ["duration_days", body.durationDays],
      ["attempts", body.attempts],
      ["active", body.active],
    ].filter(([, v]) => v !== undefined) as [string, unknown][];
    if (!cols.length) return res.status(400).json({ error: "nothing_to_change" });
    const r = await pool.query(
      `UPDATE products SET ${cols.map(([c], i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
      [String(req.params.id), ...cols.map(([, v]) => v)],
    );
    if (!r.rows[0]) return res.status(404).json({ error: "product_not_found" });
    res.json(productRow(r.rows[0]));
  } catch (err) {
    next(err);
  }
});

// Give a learner a product by hand (support, pilots, testing before payments).
accessRouter.post("/grants", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const body = z
      .object({ email: z.string().email(), productId: z.string(), level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(), days: z.number().int().min(1).max(730).optional() })
      .parse(req.body);
    const p = (await pool.query(`SELECT * FROM products WHERE id = $1`, [body.productId])).rows[0];
    if (!p) return res.status(404).json({ error: "product_not_found" });
    if (p.kind === "level" && !body.level) return res.status(400).json({ error: "level_required" });
    const u = (await pool.query(`SELECT id, tenant_id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [body.email])).rows[0];
    if (!u) return res.status(404).json({ error: "user_not_found" });
    const r = await pool.query(
      `INSERT INTO entitlements (user_id, product_id, test_type_id, level, attempts_total, ends_at, source, tenant_id, granted_by)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), 'grant', $7, $8) RETURNING id, ends_at`,
      [u.id, p.id, p.test_type_id, p.kind === "level" ? body.level : null, p.attempts, body.days ?? p.duration_days, u.tenant_id, req.user!.id],
    );
    accessCache.delete(u.id);
    res.status(201).json({ id: r.rows[0].id, endsAt: r.rows[0].ends_at });
  } catch (err) {
    next(err);
  }
});

accessRouter.delete("/grants/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireStaff(req, res)) return;
  try {
    const r = await pool.query(`UPDATE entitlements SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING user_id`, [String(req.params.id)]);
    if (!r.rows[0]) return res.status(404).json({ error: "grant_not_found" });
    accessCache.delete(r.rows[0].user_id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
