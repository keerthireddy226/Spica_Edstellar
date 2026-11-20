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
import { createPartnerOrganisation, giveDemoLicences, partnerOrganisations } from "./organisations.js";
import { licencesSchema, orgSchema, sendPartnerError } from "./portalRoutes.js";
import { notify } from "../notifications/service.js";
import {
  activeOrganisations, bringsOrganisations, CODE_PREFIX, PARTNER_TYPE_LABEL, PERIOD_START_SQL, PARTNER_TYPES, PARTNERSHIP_MONTHS,
  partnershipEnd, partnershipStatus, renewalBlock, renewedEnd, type PartnerType,
} from "./partnership.js";

export const channelPartnerStaffRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const DEFAULT_DEMO_MONTHS = PARTNERSHIP_MONTHS;
const INVITE_HOURS = 72;

// Codes avoid look-alike characters (0/O, 1/I/L) so they read well aloud.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newPartnerCode(type: PartnerType = "channel_partner"): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return `${CODE_PREFIX[type]}-${s}`;
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

async function sendInvite(userId: string, email: string, type: PartnerType = "channel_partner") {
  await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const token = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(token),
    new Date(Date.now() + INVITE_HOURS * 3600 * 1000),
  ]);
  await sendAdminInviteEmail(email, token, PARTNER_TYPE_LABEL[type] ?? "Channel Partner");
}

const audit = (req: AuthedRequest, action: string, p: { id: string; full_name: string }, details: Record<string, unknown> = {}) =>
  recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action, targetType: "channel_partner", targetId: p.id, targetLabel: p.full_name, details, ip: req.ip ?? null });

const SELECT = `
  SELECT cp.*, u.deleted_at AS user_deleted_at,
    (SELECT max(s.created_at) FROM auth_sessions s WHERE s.user_id = cp.user_id) AS last_sign_in,
    (SELECT count(*)::int FROM tenants t WHERE t.channel_partner_id = cp.id) AS organisations,
    (SELECT count(*)::int FROM tenants t WHERE t.channel_partner_id = cp.id AND t.deactivated_at IS NULL) AS active_organisations,
    (SELECT json_build_object('signedAt', a.signed_at, 'signedName', a.signed_name, 'version', a.version, 'periodEnd', a.period_end) FROM partner_agreements a
       WHERE a.partner_id = cp.id AND a.period_end IS NOT DISTINCT FROM cp.demo_ends_at ORDER BY a.signed_at DESC LIMIT 1) AS agreement,
    (SELECT max(a.signed_at) FROM partner_agreements a WHERE a.partner_id = cp.id) AS last_signed_at,
    ${PERIOD_START_SQL} AS period_start,
    (SELECT count(*)::int FROM partner_leads l WHERE l.partner_id = cp.id) AS leads,
    (SELECT count(*)::int FROM users r WHERE r.referred_by_partner_id = cp.id) AS referred_people,
    (SELECT coalesce(sum(a.licences), 0)::int FROM partner_allocations a WHERE a.partner_id = cp.id AND a.kind = 'demo') AS demo_given,
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
    demoLicencesGiven: r.demo_given ?? 0,
    demoStartsAt: r.demo_starts_at,
    demoEndsAt: r.demo_ends_at,
    demoEndedAt: r.demo_ended_at,
    demoStatus: demoStatus(r as any),
    partnerType: r.partner_type as PartnerType,
    partnerTypeLabel: PARTNER_TYPE_LABEL[r.partner_type as PartnerType],
    status: partnershipStatus(r as any),
    startsAt: r.period_start ?? r.demo_starts_at,
    endsAt: partnershipEnd(r as any),
    terminatedAt: r.terminated_at,
    terminationReason: r.termination_reason,
    minOrganisations: r.min_organisations,
    minLicencesPerOrg: r.min_licences_per_org,
    activeOrganisations: r.active_organisations ?? 0,
    discountPercent: Number(r.discount_percent ?? 0),
    referralFee: Number(r.referral_fee ?? 0),
    referralFeeCurrency: r.referral_fee_currency,
    agreement: r.agreement ?? null,
    lastSignedAt: r.last_signed_at ?? null,
    leads: r.leads ?? 0,
    referredPeople: r.referred_people ?? 0,
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
    const orgs = await partnerOrganisations(req.params.id as string);
    const renewals = await pool.query(
      `SELECT r.previous_end, r.new_end, r.organisations, r.min_organisations, r.override_reason, r.created_at,
         (SELECT coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) FROM users u WHERE u.id = r.renewed_by) AS by
       FROM partner_renewals r WHERE r.partner_id = $1 ORDER BY r.created_at DESC`,
      [req.params.id],
    );
    const agreements = await pool.query(
      `SELECT version, signed_name, signed_email, signed_at, period_start, period_end, ip FROM partner_agreements WHERE partner_id = $1 ORDER BY signed_at DESC`,
      [req.params.id],
    );
    const history = await pool.query(
      `SELECT action, actor_label, details, created_at FROM audit_log WHERE target_type = 'channel_partner' AND target_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.params.id],
    );
    res.json({
      partner: shape(r.rows[0]),
      organisations: orgs,
      renewals: renewals.rows.map((x) => ({ previousEnd: x.previous_end, newEnd: x.new_end, organisations: x.organisations, minOrganisations: x.min_organisations, overrideReason: x.override_reason, at: x.created_at, by: x.by })),
      agreements: agreements.rows.map((x) => ({ version: x.version, signedName: x.signed_name, signedEmail: x.signed_email, signedAt: x.signed_at, periodStart: x.period_start, periodEnd: x.period_end, ip: x.ip })),
      history: history.rows.map((h) => ({ action: h.action, by: h.actor_label, details: h.details, at: h.created_at })),
    });
  } catch (err) {
    next(err);
  }
});

const termsSchema = {
  minOrganisations: z.number().int().min(0).max(10000),
  minLicencesPerOrg: z.number().int().min(1).max(100000),
  discountPercent: z.number().min(0).max(90),
  referralFee: z.number().int().min(0).max(100000000),
  referralFeeCurrency: z.enum(["INR", "USD"]),
};
const createSchema = z.object({
  partnerType: z.enum(PARTNER_TYPES).default("channel_partner"),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  commissionPercent: z.number().min(0).max(100).default(0),
  demoLicences: z.number().int().min(0).max(100000).default(250),
  // Start the 3-month partnership now (the licences become available today).
  startDemoNow: z.boolean().default(true),
  ownLicenceEnabled: z.boolean().default(false),
  notes: z.string().max(2000).optional(),
  minOrganisations: termsSchema.minOrganisations.default(10),
  minLicencesPerOrg: termsSchema.minLicencesPerOrg.default(1),
  discountPercent: termsSchema.discountPercent.default(0),
  referralFee: termsSchema.referralFee.default(0),
  referralFeeCurrency: termsSchema.referralFeeCurrency.default("INR"),
});

channelPartnerStaffRouter.post("/channel-partners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input", issues: parsed.error.issues });
  const b = parsed.data;
  const now = new Date();
  // The partnership is always 3 months; Spica renews it for another 3.
  const endsAt = b.startDemoNow ? addMonths(now, DEFAULT_DEMO_MONTHS) : null;
  const orgType = bringsOrganisations(b.partnerType);
  // Only Resellers and Channel Partners bring organisations, give demo
  // licences and have organisation minimums; only Resellers get a discount.
  const demoLicences = orgType ? b.demoLicences : 0;
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
            `INSERT INTO channel_partners (user_id, full_name, email, code, commission_percent, demo_licences, demo_starts_at, demo_ends_at, own_licence_enabled, notes, created_by,
               partner_type, min_organisations, min_licences_per_org, discount_percent, referral_fee, referral_fee_currency)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
            [user.rows[0].id, b.fullName, b.email, newPartnerCode(b.partnerType), b.partnerType === "reseller" ? 0 : b.commissionPercent, demoLicences, b.startDemoNow ? now : null, endsAt, orgType && b.ownLicenceEnabled, b.notes ?? null, req.user!.id,
             b.partnerType, orgType ? b.minOrganisations : 0, b.minLicencesPerOrg, b.partnerType === "reseller" ? b.discountPercent : 0, b.partnerType === "referral" ? b.referralFee : 0, b.referralFeeCurrency],
          )
        ).rows[0];
      } catch (err: any) {
        if (err?.code !== PG_UNIQUE_VIOLATION || !String(err?.constraint ?? "").includes("code")) throw err;
        await client.query("ROLLBACK TO SAVEPOINT code");
      }
    }
    if (!row) throw new Error("could not generate a unique partner code");
    await client.query("COMMIT");
    await audit(req, "channel_partner.created", row as any, { type: row.partner_type, code: row.code, demoLicences: row.demo_licences, commissionPercent: Number(row.commission_percent), endsAt: row.demo_ends_at, minOrganisations: row.min_organisations, minLicencesPerOrg: row.min_licences_per_org, discountPercent: Number(row.discount_percent), referralFee: row.referral_fee });
    let emailSent = true;
    await sendInvite(user.rows[0].id, b.email, b.partnerType).catch((err) => {
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
  minOrganisations: termsSchema.minOrganisations.optional(),
  minLicencesPerOrg: termsSchema.minLicencesPerOrg.optional(),
  discountPercent: termsSchema.discountPercent.optional(),
  referralFee: termsSchema.referralFee.optional(),
  referralFeeCurrency: termsSchema.referralFeeCurrency.optional(),
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
    const orgType = bringsOrganisations(p.partner_type);
    if (b.minOrganisations !== undefined && orgType) cols.push(["min_organisations", b.minOrganisations]);
    if (b.minLicencesPerOrg !== undefined && orgType) cols.push(["min_licences_per_org", b.minLicencesPerOrg]);
    if (b.discountPercent !== undefined && p.partner_type === "reseller") cols.push(["discount_percent", b.discountPercent]);
    if (b.referralFee !== undefined && p.partner_type === "referral") cols.push(["referral_fee", b.referralFee]);
    if (b.referralFeeCurrency !== undefined && p.partner_type === "referral") cols.push(["referral_fee_currency", b.referralFeeCurrency]);
    if (b.commissionPercent !== undefined && p.partner_type === "reseller") return res.status(400).json({ error: "reseller_has_no_commission" });
    if ((b.demoLicences !== undefined || b.ownLicenceEnabled !== undefined) && !orgType) return res.status(400).json({ error: "not_for_partner_type" });
    if (!cols.length) return res.json({ id: p.id });
    await pool.query(`UPDATE channel_partners SET ${cols.map(([c], i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [p.id, ...cols.map(([, v]) => v)]);
    if (b.fullName) {
      const { first, last } = splitName(b.fullName);
      await pool.query(`UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1`, [p.user_id, first, last]);
    }
    const changes = Object.fromEntries(cols.map(([c, v]) => [c, { from: ["commission_percent", "discount_percent"].includes(c) ? Number(p[c]) : p[c], to: v }]));
    const action = b.ownLicenceEnabled !== undefined && cols.length === 1 ? (b.ownLicenceEnabled ? "channel_partner.own_licence_on" : "channel_partner.own_licence_off") : "channel_partner.updated";
    await audit(req, action, p as any, changes);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

const windowSchema = z.object({ endsAt: z.string().datetime().optional() });

// Start the 3-month partnership (and the demo licences) today.
channelPartnerStaffRouter.post("/channel-partners/:id/demo/start", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = windowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (demoStatus(p as any) === "active") return res.status(409).json({ error: "demo_already_active" });
    const now = new Date();
    if (p.terminated_at) return res.status(409).json({ error: "partnership_terminated" });
    const endsAt = addMonths(now, DEFAULT_DEMO_MONTHS);
    await pool.query(`UPDATE channel_partners SET demo_starts_at = $2, demo_ends_at = $3, demo_ended_at = NULL, updated_at = now() WHERE id = $1`, [p.id, now, endsAt]);
    await audit(req, "channel_partner.demo_started", p as any, { endsAt });
    res.json({ id: p.id, demoStartsAt: now, demoEndsAt: endsAt });
  } catch (err) {
    next(err);
  }
});

// Renew for another 3 months (from the current end, or from today if it has
// ended). Resellers and Channel Partners below their organisation minimum can
// only be renewed with a written reason. The partner signs the agreement again.
const renewSchema = z.object({ overrideReason: z.string().trim().max(1000).optional() });
channelPartnerStaffRouter.post("/channel-partners/:id/renew", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = renewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    const status = partnershipStatus(p as any);
    const organisations = await activeOrganisations(p.id);
    const block = renewalBlock({ status, type: p.partner_type, organisations, minOrganisations: p.min_organisations, overrideReason: parsed.data.overrideReason });
    if (block) return res.status(409).json({ error: block, organisations, minOrganisations: p.min_organisations });
    const previousEnd = partnershipEnd(p as any);
    const newEnd = renewedEnd(previousEnd);
    const override = bringsOrganisations(p.partner_type) && organisations < p.min_organisations ? parsed.data.overrideReason!.trim() : null;
    await pool.query(`UPDATE channel_partners SET demo_ends_at = $2, demo_ended_at = NULL, updated_at = now() WHERE id = $1`, [p.id, newEnd]);
    await pool.query(
      `INSERT INTO partner_renewals (partner_id, previous_end, new_end, organisations, min_organisations, override_reason, renewed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [p.id, previousEnd, newEnd, organisations, p.min_organisations, override, req.user!.id],
    );
    await audit(req, "channel_partner.renewed", p as any, { from: previousEnd, to: newEnd, organisations, minOrganisations: p.min_organisations, overrideReason: override });
    await notify({
      userId: p.user_id,
      kind: "partner_demo",
      title: "Your Spica partnership is renewed",
      body: `Your partnership now runs until ${newEnd.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Sign the partnership agreement for the new period to continue.`,
      link: "/partner/agreement",
      email: true,
    }).catch(() => {});
    res.json({ id: p.id, endsAt: newEnd, override: !!override });
  } catch (err) {
    next(err);
  }
});

// End the partnership early (termination). The portal becomes read-only;
// organisations and learners keep what they already have.
const terminateSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
channelPartnerStaffRouter.post("/channel-partners/:id/terminate", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = terminateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "reason_required" });
  try {
    const p = await loadPartner(req.params.id as string);
    if (!p) return res.status(404).json({ error: "partner_not_found" });
    if (p.terminated_at) return res.status(409).json({ error: "partnership_terminated" });
    await pool.query(
      `UPDATE channel_partners SET terminated_at = now(), termination_reason = $2, terminated_by = $3, demo_ended_at = coalesce(demo_ended_at, now()), updated_at = now() WHERE id = $1`,
      [p.id, parsed.data.reason, req.user!.id],
    );
    await audit(req, "channel_partner.terminated", p as any, { reason: parsed.data.reason, plannedEnd: p.demo_ends_at });
    await notify({
      userId: p.user_id,
      kind: "partner_demo",
      title: "Your Spica partnership has ended",
      body: `Edstellar has ended your partnership. Reason: ${parsed.data.reason}. Your portal is now read-only: you can still see your history, invoices and earnings.`,
      link: "/partner/dashboard",
      email: true,
    }).catch(() => {});
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
    await sendInvite(p.user_id, p.email, p.partner_type);
    await audit(req, "channel_partner.invite_resent", p as any);
    res.json({ id: p.id });
  } catch (err) {
    next(err);
  }
});

// Spica staff adding an organisation for a partner, or giving it more demo licences.
channelPartnerStaffRouter.post("/channel-partners/:id/organisations", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = orgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    res.status(201).json(await createPartnerOrganisation({ partnerId: req.params.id as string, actor: { id: req.user!.id, role: req.user!.role, ip: req.ip ?? null }, ...parsed.data }));
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});

channelPartnerStaffRouter.post("/channel-partners/:id/organisations/:tenantId/licences", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = licencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    await giveDemoLicences({ partnerId: req.params.id as string, tenantId: req.params.tenantId as string, licences: parsed.data.licences, actor: { id: req.user!.id, role: req.user!.role, ip: req.ip ?? null } });
    res.json({ ok: true });
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});
