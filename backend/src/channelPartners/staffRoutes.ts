// Channel Partners, staff side (stage 1 of the Channel Partner programme,
// 18 Nov 2026). Super Admins and Admins with "Manage organizations" register
// partners (partners never sign themselves up), give each a unique code, a
// commission rate (0 until the business decides) and a free demo allocation,
// open / extend / end the demo window, and switch on one demo licence for the
// partner's own demonstrations. The partner portal is stage 2.
import { Router } from "express";
import { randomUUID, randomInt } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendAdminInviteEmail } from "../auth/mailer.js";
import { recordAudit } from "../audit/service.js";

export const channelPartnerStaffRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const ROLE_LABEL = "Channel Partner";
const DEFAULT_DEMO_MONTHS = 3;
const INVITE_HOURS = 72;

// Codes avoid look-alike characters (0/O, 1/I/L) so they read well aloud.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newPartnerCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return `CP-${s}`;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

// "not_started" until Spica makes the licences available; "active" during the
// window; "ended" after it (by date, or ended early by Spica).
export function demoStatus(p: { demo_starts_at: Date | null; demo_ends_at: Date | null; demo_ended_at: Date | null }, now = new Date()): "not_started" | "active" | "ended" {
  if (!p.demo_starts_at) return "not_started";
  if (p.demo_ended_at || (p.demo_ends_at && p.demo_ends_at <= now)) return "ended";
  return "active";
}

const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(" ") };
};

async function sendInvite(userId: string, email: string) {
  await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const token = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(token),
    new Date(Date.now() + INVITE_HOURS * 3600 * 1000),
  ]);
  await sendAdminInviteEmail(email, token, ROLE_LABEL);
}

const audit = (req: AuthedRequest, action: string, p: { id: string; full_name: string }, details: Record<string, unknown> = {}) =>
  recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action, targetType: "channel_partner", targetId: p.id, targetLabel: p.full_name, details, ip: req.ip ?? null });

const SELECT = `
  SELECT cp.*, u.deleted_at AS user_deleted_at,
    (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id = cp.user_id) AS last_sign_in,
    (SELECT count(*)::int FROM tenants t WHERE t.channel_partner_id = cp.id) AS organisations,
    (SELECT coalesce(nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.email) FROM users c WHERE c.id = cp.created_by) AS created_by_name
  FROM channel_partners cp JOIN users u ON u.id = cp.user_id`;

function shape(r: Record<string, any>) {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    code: r.code,
    commissionPercent: Number(r.commission_percent),
    demoLicences: r.demo_licences,
    // Demo licences given to organisations arrive in stage 2.
    demoLicencesGiven: 0,
    demoStartsAt: r.demo_starts_at,
    demoEndsAt: r.demo_ends_at,
    demoEndedAt: r.demo_ended_at,
    demoStatus: demoStatus(r as any),
    ownLicenceEnabled: r.own_licence_enabled,
    notes: r.notes,
    active: !r.deactivated_at,
    deactivatedAt: r.deactivated_at,
    organisations: r.organisations,
    invitePending: !r.last_sign_in,
    lastSignIn: r.last_sign_in,
    createdAt: r.created_at,
    createdBy: r.created_by_name,
  };
}

channelPartnerStaffRouter.get("/channel-partners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const r = await pool.query(`${SELECT} ORDER BY cp.created_at DESC`);
    res.json({ partners: r.rows.map(shape) });
  } catch (err) {
    next(err);
  }
});

channelPartnerStaffRouter.get("/channel-partners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const r = await pool.query(`${SELECT} WHERE cp.id = $1`, [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: "partner_not_found" });
    const orgs = await pool.query(
      `SELECT t.id, t.name, t.category, t.created_at FROM tenants t WHERE t.channel_partner_id = $1 ORDER BY t.created_at DESC`,
      [req.params.id],
    );
    const history = await pool.query(
      `SELECT action, actor_label, details, created_at FROM audit_log WHERE target_type = 'channel_partner' AND target_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id],
    );
    res.json({
      partner: shape(r.rows[0]),
      organisations: orgs.rows.map((o) => ({ id: o.id, name: o.name, category: o.category, createdAt: o.created_at })),
      history: history.rows.map((h) => ({ action: h.action, by: h.actor_label, details: h.details, at: h.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  commissionPercent: z.number().min(0).max(100).default(0),
  demoLicences: z.number().int().min(0).max(100000).default(250),
  // Open the demo window now (the licences become available today).
  startDemoNow: z.boolean().default(true),
  demoEndsAt: z.string().datetime().optional(),
  ownLicenceEnabled: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
});

channelPartnerStaffRouter.post("/channel-partners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
  const b = parsed.data;
  const now = new Date();
  const endsAt = b.startDemoNow ? (b.demoEndsAt ? new Date(b.demoEndsAt) : addMonths(now, DEFAULT_DEMO_MONTHS)) : null;
  if (endsAt && endsAt <= now) return res.status(400).json({ error: "demo_end_in_past" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { first, last } = splitName(b.fullName);
    const user = await client.query(
      `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, invited_by, email_verified)
       VALUES ('channel_partner', NULL, $1, $2, $3, $4, $5, true) RETURNING id`,
      [b.email, await bcrypt.hash(randomUUID(), 12), first, last, req.user!.id],
    );
    let row: Record<string, any> | null = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      try {
        await client.query("SAVEPOINT code");
        row = (
          await client.query(
            `INSERT INTO channel_partners (user_id, full_name, email, code, commission_percent, demo_licences, demo_starts_at, demo_ends_at, own_licence_enabled, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [user.rows[0].id, b.fullName, b.email, newPartnerCode(), b.commissionPercent, b.demoLicences, b.startDemoNow ? now : null, endsAt, b.ownLicenceEnabled, b.notes ?? null, req.user!.id],
          )
        ).rows[0];
      } catch (err: any) {
        if (err?.code !== PG_UNIQUE_VIOLATION || !String(err?.constraint ?? "").includes("code")) throw err;
        await client.query("ROLLBACK TO SAVEPOINT code");
      }
    }
    if (!row) throw new Error("could not generate a unique partner code");
    await client.query("COMMIT");
    await audit(req, "channel_partner.created", row as any, { code: row.code, demoLicences: row.demo_licences, commissionPercent: Number(row.commission_percent), demoEndsAt: row.demo_ends_at });
    let emailSent = true;
    await sendInvite(user.rows[0].id, b.email).catch((err) => {
      emailSent = false;
      console.error("channel partner invite email failed:", err);
    });
    res.status(201).json({ id: row.id, code: row.code, emailSent });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === PG_UNIQUE_VIOLATION) return res.status(409).json({ error: "email_already_registered" });
    next(err);
  } finally {
    client.release();
  }
});

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  demoLicences: z.number().int().min(0).max(100000).optional(),
  ownLicenceEnabled: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function loadPartner(id: string) {
  return (await pool.query(`SELECT * FROM channel_partners WHERE id = $1`, [id])).rows[0] as Record<string, any> | undefined;
}

channelPartnerStaffRouter.patch("/channel-partners/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    const b = parsed.data;
    const cols: [string, unknown][] = [];
    if (b.fullName !== undefined) cols.push(["full_name", b.fullName]);
    if (b.commissionPercent !== undefined) cols.push(["commission_percent", b.commissionPercent]);
    if (b.demoLicences !== undefined) cols.push(["demo_licences", b.demoLicences]);
    if (b.ownLicenceEnabled !== undefined) cols.push(["own_licence_enabled", b.ownLicenceEnabled]);
    if (b.notes !== undefined) cols.push(["notes", b.notes]);
    if (!cols.length) return res.json({ id: p.id });
    await pool.query(`UPDATE channel_partners SET ${cols.map(([c], i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [p.id, ...cols.map(([, v]) => v)]);
    if (b.fullName) {
      const { first, last } = splitName(b.fullName);
      await pool.query(`UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1`, [p.user_id, first, last]);
    }
    const changes = Object.fromEntries(cols.map(([c, v]) => [c, { from: c === "commission_percent" ? Number(p[c]) : p[c], to: v }]));
    const action = b.ownLicenceEnabled !== undefined && cols.length === 1 ? (b.ownLicenceEnabled ? "channel_partner.own_licence_on" : "channel_partner.own_licence_off") : "channel_partner.updated";
    await audit(req, action, p as any, changes);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

const windowSchema = z.object({ endsAt: z.string().datetime().optional() });

// Make the demo licences available: the window starts today.
channelPartnerStaffRouter.post("/channel-partners/:id/demo/start", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = windowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (demoStatus(p as any) === "active") return res.status(409).json({ error: "demo_already_active" });
    const now = new Date();
    const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : addMonths(now, DEFAULT_DEMO_MONTHS);
    if (endsAt <= now) return res.status(400).json({ error: "demo_end_in_past" });
    await pool.query(`UPDATE channel_partners SET demo_starts_at = $2, demo_ends_at = $3, demo_ended_at = NULL, updated_at = now() WHERE id = $1`, [p.id, now, endsAt]);
    await audit(req, "channel_partner.demo_started", p as any, { endsAt });
    res.json({ id: p.id, demoStartsAt: now, demoEndsAt: endsAt });
  } catch (err) {
    next(err);
  }
});

// Move the end date (later to extend; an earlier future date also allowed).
channelPartnerStaffRouter.post("/channel-partners/:id/demo/extend", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = windowSchema.required().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (!p.demo_starts_at) return res.status(409).json({ error: "demo_not_started" });
    const endsAt = new Date(parsed.data.endsAt);
    if (endsAt <= new Date() || endsAt <= p.demo_starts_at) return res.status(400).json({ error: "demo_end_in_past" });
    await pool.query(`UPDATE channel_partners SET demo_ends_at = $2, demo_ended_at = NULL, updated_at = now() WHERE id = $1`, [p.id, endsAt]);
    await audit(req, "channel_partner.demo_extended", p as any, { from: p.demo_ends_at, to: endsAt });
    res.json({ id: p.id, demoEndsAt: endsAt });
  } catch (err) {
    next(err);
  }
});

channelPartnerStaffRouter.post("/channel-partners/:id/demo/end", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (demoStatus(p as any) !== "active") return res.status(409).json({ error: "demo_not_active" });
    await pool.query(`UPDATE channel_partners SET demo_ended_at = now(), updated_at = now() WHERE id = $1`, [p.id]);
    await audit(req, "channel_partner.demo_ended", p as any, { plannedEnd: p.demo_ends_at });
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

// Deactivating blocks the partner's sign-in (and signs them out) but keeps
// their record, organisations and history.
channelPartnerStaffRouter.post("/channel-partners/:id/deactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (p.deactivated_at) return res.json({ id: p.id });
    await pool.query(`UPDATE channel_partners SET deactivated_at = now(), updated_at = now() WHERE id = $1`, [p.id]);
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [p.user_id]);
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [p.user_id]);
    await audit(req, "channel_partner.deactivated", p as any);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

channelPartnerStaffRouter.post("/channel-partners/:id/reactivate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    await pool.query(`UPDATE channel_partners SET deactivated_at = NULL, updated_at = now() WHERE id = $1`, [p.id]);
    await pool.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [p.user_id]);
    await audit(req, "channel_partner.reactivated", p as any);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

channelPartnerStaffRouter.post("/channel-partners/:id/resend-invite", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (p.deactivated_at) return res.status(409).json({ error: "partner_deactivated" });
    await sendInvite(p.user_id, p.email);
    await audit(req, "channel_partner.invite_resent", p as any);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});
