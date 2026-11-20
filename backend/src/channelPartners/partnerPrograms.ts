// What differs between the partner types (user, 19 Nov 2026):
//  - the partnership agreement each partner signs in the app, per period;
//  - Affiliates: a link and code; people who sign up with it (or enter the
//    code later) are credited to them, and they earn a % of those people's
//    paid purchases. They see anonymous purchase records only.
//  - Referral Partners: submit leads (organisations); a fixed fee when a lead
//    Spica marks as won makes its first paid purchase.
// Earnings are worked out from the payment records by syncEarnings (on page
// load and daily), so no payment path needs to know about partners.
import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { recordAudit } from "../audit/service.js";
import { notify } from "../notifications/service.js";
import { PAYMENT_CONFIG } from "../payments/providers.js";
import { PartnerError } from "./organisations.js";
import { sendPartnerError } from "./portalRoutes.js";
import { AGREEMENT_VERSION, agreementText, assertPartnerCanAct, canAct, currentAgreement, currentPeriodStart, partnershipStatus } from "./partnership.js";

export const partnerProgramRouter = Router();
export const staffPartnerProgramRouter = Router();
export const partnerCodeRouter = Router();

async function myPartner(req: AuthedRequest, res: Response): Promise<any | null> {
  if (req.user?.role !== "channel_partner") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const r = await pool.query(`SELECT * FROM channel_partners WHERE user_id = $1 AND deactivated_at IS NULL`, [req.user.id]);
  if (!r.rowCount) {
    res.status(403).json({ error: "partner_deactivated" });
    return null;
  }
  return r.rows[0];
}

// ---------- Affiliate attribution ----------

const CODE_RE = /^[A-Z]{2}-[A-Z0-9]{6}$/;

// The affiliate a code belongs to, if that partnership is running and signed.
export async function affiliateForCode(code: string | null | undefined): Promise<string | null> {
  const c = String(code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(c)) return null;
  const p = (await pool.query(`SELECT * FROM channel_partners WHERE code = $1 AND partner_type = 'affiliate'`, [c])).rows[0];
  if (!p || !canAct(partnershipStatus(p)) || !(await currentAgreement(p))) return null;
  return p.id;
}

// Credit a person to an affiliate, once (the first code wins).
export async function creditAffiliate(userId: string, code: string | null | undefined): Promise<boolean> {
  const partnerId = await affiliateForCode(code);
  if (!partnerId) return false;
  const r = await pool.query(`UPDATE users SET referred_by_partner_id = $2, referred_at = now() WHERE id = $1 AND referred_by_partner_id IS NULL`, [userId, partnerId]);
  return !!r.rowCount;
}

// A signed-in individual learner enters a partner code (e.g. on the plans page).
partnerCodeRouter.post("/partner-code", requireAuth, async (req: AuthedRequest, res, next) => {
  if (req.user!.role !== "learner") return res.status(403).json({ error: "forbidden" });
  const parsed = z.object({ code: z.string().trim().min(4).max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_code" });
  try {
    const u = (await pool.query(`SELECT u.referred_by_partner_id, t.type FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [req.user!.id])).rows[0];
    if (!u || !String(u.type).startsWith("individual")) return res.status(403).json({ error: "individuals_only" });
    if (u.referred_by_partner_id) return res.status(409).json({ error: "code_already_used" });
    if (!(await creditAffiliate(req.user!.id, parsed.data.code))) return res.status(404).json({ error: "invalid_code" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

partnerCodeRouter.get("/partner-code", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = (await pool.query(`SELECT p.code FROM users u JOIN channel_partners p ON p.id = u.referred_by_partner_id WHERE u.id = $1`, [req.user!.id])).rows[0];
    res.json({ code: r?.code ?? null });
  } catch (err) {
    next(err);
  }
});

// ---------- Earnings ----------

// Affiliates: a % of each paid purchase (before tax) by a person credited to
// them, made after they were credited and inside the partnership period.
// Referral Partners: the fixed fee once, at a won lead's first paid licence purchase.
export async function syncEarnings(partnerId?: string) {
  await pool.query(
    `INSERT INTO partner_earnings (partner_id, kind, source_type, source_id, description, base_amount, rate, amount, currency, earned_at)
     SELECT p.id, 'affiliate_sale', 'payment_order', o.id,
       coalesce(pr.name, CASE o.kind WHEN 'individual_plan' THEN 'Full access' ELSE 'Spica purchase' END),
       o.subtotal, p.commission_percent, round(o.subtotal * p.commission_percent / 100)::int, o.currency, o.paid_at
     FROM payment_orders o
     JOIN users u ON u.id = o.buyer_id
     JOIN channel_partners p ON p.id = u.referred_by_partner_id AND p.partner_type = 'affiliate'
     LEFT JOIN products pr ON pr.id = o.product_id
     WHERE o.status = 'paid' AND o.paid_at IS NOT NULL AND o.paid_at >= u.referred_at
       AND o.paid_at >= p.demo_starts_at AND o.paid_at <= coalesce(p.demo_ended_at, p.demo_ends_at)
       AND ($1::uuid IS NULL OR p.id = $1)
     ON CONFLICT (kind, source_type, source_id) DO NOTHING`,
    [partnerId ?? null],
  );
  await pool.query(
    `INSERT INTO partner_earnings (partner_id, kind, source_type, source_id, lead_id, description, base_amount, rate, amount, currency, earned_at)
     SELECT p.id, 'referral_fee', 'license_purchase', lp.id, l.id, 'Referral: ' || l.organisation_name,
       lp.quantity * lp.unit_price_cents, NULL, p.referral_fee, p.referral_fee_currency, lp.purchased_at
     FROM partner_leads l
     JOIN channel_partners p ON p.id = l.partner_id AND p.partner_type = 'referral'
     JOIN LATERAL (
       SELECT x.* FROM license_purchases x WHERE x.tenant_id = l.tenant_id AND x.source = 'purchase' AND x.unit_price_cents > 0 AND x.purchased_at >= l.created_at
       ORDER BY x.purchased_at LIMIT 1
     ) lp ON true
     WHERE l.status = 'won' AND l.tenant_id IS NOT NULL
       AND lp.purchased_at >= p.demo_starts_at AND lp.purchased_at <= coalesce(p.demo_ended_at, p.demo_ends_at)
       AND NOT EXISTS (SELECT 1 FROM partner_earnings e WHERE e.lead_id = l.id AND e.kind = 'referral_fee')
       AND ($1::uuid IS NULL OR p.id = $1)
     ON CONFLICT (kind, source_type, source_id) DO NOTHING`,
    [partnerId ?? null],
  );
}

const earningRow = (e: Record<string, any>) => ({
  id: e.id,
  kind: e.kind,
  description: e.description,
  baseAmount: e.base_amount,
  rate: e.rate == null ? null : Number(e.rate),
  amount: e.amount,
  currency: e.currency,
  earnedAt: e.earned_at,
  status: e.status,
  paidAt: e.paid_at,
  paidReference: e.paid_reference,
  voidReason: e.void_reason,
});

async function earningsFor(partnerId: string) {
  await syncEarnings(partnerId);
  const r = await pool.query(`SELECT * FROM partner_earnings WHERE partner_id = $1 ORDER BY earned_at DESC LIMIT 1000`, [partnerId]);
  const totals: Record<string, { earned: number; paid: number }> = {};
  for (const e of r.rows) {
    if (e.status === "void") continue;
    const t = (totals[e.currency] ??= { earned: 0, paid: 0 });
    t.earned += e.amount;
    if (e.status === "paid") t.paid += e.amount;
  }
  return { earnings: r.rows.map(earningRow), totals };
}

// ---------- Partner portal ----------

partnerProgramRouter.get("/agreement", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  try {
    p.period_start = await currentPeriodStart(p.id);
    const signed = await currentAgreement(p);
    const all = await pool.query(`SELECT version, signed_name, signed_at, period_start, period_end FROM partner_agreements WHERE partner_id = $1 ORDER BY signed_at DESC`, [p.id]);
    res.json({
      agreement: agreementText(p),
      signed: signed ? { signedName: signed.signed_name, signedAt: signed.signed_at, version: signed.version } : null,
      history: all.rows.map((a) => ({ version: a.version, signedName: a.signed_name, signedAt: a.signed_at, periodStart: a.period_start, periodEnd: a.period_end })),
      status: partnershipStatus(p),
    });
  } catch (err) {
    next(err);
  }
});

const signSchema = z.object({ fullName: z.string().trim().min(2).max(160), agree: z.literal(true) });

partnerProgramRouter.post("/agreement/sign", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "sign_required" });
  try {
    const s = partnershipStatus(p);
    if (!canAct(s)) return res.status(409).json({ error: "partnership_not_active", status: s });
    if (await currentAgreement(p)) return res.json({ ok: true, alreadySigned: true });
    p.period_start = await currentPeriodStart(p.id);
    const text = agreementText(p);
    await pool.query(
      `INSERT INTO partner_agreements (partner_id, version, partner_type, period_start, period_end, signed_name, signed_email, ip, user_agent, terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [p.id, AGREEMENT_VERSION, p.partner_type, p.period_start, p.demo_ends_at, parsed.data.fullName, p.email, req.ip ?? null, String(req.headers["user-agent"] ?? "").slice(0, 300), JSON.stringify(text)],
    );
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.agreement_signed", targetType: "channel_partner", targetId: p.id, targetLabel: p.full_name, details: { version: AGREEMENT_VERSION, signedName: parsed.data.fullName, periodEnd: p.demo_ends_at }, ip: req.ip ?? null });
    if (p.created_by) {
      await notify({ userId: p.created_by, kind: "partner_demo", title: `${p.full_name} signed the partnership agreement`, body: `Version ${AGREEMENT_VERSION}, signed as "${parsed.data.fullName}".`, link: "/admin/channel-partners" }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

partnerProgramRouter.get("/affiliate", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  if (p.partner_type !== "affiliate") return res.status(403).json({ error: "not_for_partner_type" });
  try {
    const people = (
      await pool.query(
        `SELECT count(*)::int AS signups,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_orders o WHERE o.buyer_id = u.id AND o.status = 'paid'))::int AS buyers
         FROM users u WHERE u.referred_by_partner_id = $1`,
        [p.id],
      )
    ).rows[0];
    const e = await earningsFor(p.id);
    res.json({
      code: p.code,
      link: `${PAYMENT_CONFIG.frontendUrl}/signup?ref=${encodeURIComponent(p.code)}`,
      ratePercent: Number(p.commission_percent),
      signups: people.signups,
      buyers: people.buyers,
      ...e,
    });
  } catch (err) {
    next(err);
  }
});

partnerProgramRouter.get("/earnings", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  try {
    res.json(await earningsFor(p.id));
  } catch (err) {
    next(err);
  }
});

const leadRow = (l: Record<string, any>, staff = false) => ({
  id: l.id,
  organisationName: l.organisation_name,
  category: l.category,
  contactName: l.contact_name,
  contactEmail: l.contact_email,
  contactPhone: l.contact_phone,
  country: l.country,
  expectedLearners: l.expected_learners,
  notes: l.notes,
  status: l.status,
  createdAt: l.created_at,
  updatedAt: l.updated_at,
  // Which organisation it became and Spica's notes stay with Spica.
  ...(staff ? { tenantId: l.tenant_id, tenantName: l.tenant_name ?? null, staffNote: l.staff_note, partnerId: l.partner_id, partnerName: l.partner_name ?? null } : {}),
});

partnerProgramRouter.get("/leads", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  if (p.partner_type !== "referral") return res.status(403).json({ error: "not_for_partner_type" });
  try {
    const r = await pool.query(`SELECT * FROM partner_leads WHERE partner_id = $1 ORDER BY created_at DESC`, [p.id]);
    res.json({ leads: r.rows.map((l) => leadRow(l)) });
  } catch (err) {
    next(err);
  }
});

const leadSchema = z.object({
  organisationName: z.string().trim().min(2).max(160),
  category: z.enum(["university", "company"]),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().toLowerCase().email(),
  contactPhone: z.string().trim().max(30).nullish(),
  country: z.string().trim().min(2).max(100),
  expectedLearners: z.number().int().min(0).max(1000000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  // The partner confirms the contact agreed to be contacted by Edstellar.
  contactAgreed: z.literal(true),
});

partnerProgramRouter.post("/leads", requireAuth, async (req: AuthedRequest, res, next) => {
  const p = await myPartner(req, res);
  if (!p) return;
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.some((i) => i.path[0] === "contactAgreed") ? "contact_agreement_required" : "invalid_input" });
  try {
    await assertPartnerCanAct(p.id, "referral");
    const b = parsed.data;
    // Already a Spica customer, or already introduced by someone?
    const domain = b.contactEmail.split("@")[1];
    const dup = await pool.query(
      `SELECT 1 FROM partner_leads WHERE (lower(contact_email) = $1 OR lower(organisation_name) = lower($2)) AND status IN ('submitted', 'contacted', 'won')
       UNION ALL SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1`,
      [b.contactEmail, b.organisationName],
    );
    const r = await pool.query(
      `INSERT INTO partner_leads (partner_id, organisation_name, category, contact_name, contact_email, contact_phone, country, expected_learners, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [p.id, b.organisationName, b.category, b.contactName, b.contactEmail, b.contactPhone || null, b.country, b.expectedLearners ?? null, b.notes || null, dup.rowCount ? "duplicate" : "submitted"],
    );
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.lead_submitted", targetType: "channel_partner", targetId: p.id, targetLabel: p.full_name, details: { organisation: b.organisationName, domain, duplicate: !!dup.rowCount }, ip: req.ip ?? null });
    if (p.created_by) {
      await notify({ userId: p.created_by, kind: "partner_demo", title: `New referral from ${p.full_name}`, body: `${b.organisationName} (${b.country}), contact ${b.contactName}.${dup.rowCount ? " Possible duplicate." : ""}`, link: "/admin/channel-partners", email: true }).catch(() => {});
    }
    res.status(201).json({ lead: leadRow(r.rows[0]) });
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});

// ---------- Spica staff ----------

staffPartnerProgramRouter.get("/channel-partners/:id/leads", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    const r = await pool.query(`SELECT l.*, t.name AS tenant_name FROM partner_leads l LEFT JOIN tenants t ON t.id = l.tenant_id WHERE l.partner_id = $1 ORDER BY l.created_at DESC`, [req.params.id]);
    res.json({ leads: r.rows.map((l) => leadRow(l, true)) });
  } catch (err) {
    next(err);
  }
});

const leadUpdate = z.object({
  status: z.enum(["submitted", "contacted", "won", "lost", "duplicate"]).optional(),
  tenantId: z.string().uuid().nullable().optional(),
  staffNote: z.string().trim().max(2000).nullable().optional(),
});

staffPartnerProgramRouter.patch("/partner-leads/:leadId", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  const parsed = leadUpdate.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const l = (await pool.query(`SELECT l.*, p.user_id, p.full_name FROM partner_leads l JOIN channel_partners p ON p.id = l.partner_id WHERE l.id = $1`, [req.params.leadId])).rows[0];
    if (!l) return res.status(404).json({ error: "lead_not_found" });
    const b = parsed.data;
    if (b.status === "won" && !(b.tenantId ?? l.tenant_id)) return res.status(400).json({ error: "organisation_required" });
    if (b.tenantId && !(await pool.query(`SELECT 1 FROM tenants WHERE id = $1`, [b.tenantId])).rowCount) return res.status(404).json({ error: "organisation_not_found" });
    await pool.query(
      `UPDATE partner_leads SET status = coalesce($2, status), tenant_id = CASE WHEN $3::boolean THEN $4::uuid ELSE tenant_id END, staff_note = CASE WHEN $5::boolean THEN $6 ELSE staff_note END, updated_at = now() WHERE id = $1`,
      [l.id, b.status ?? null, b.tenantId !== undefined, b.tenantId ?? null, b.staffNote !== undefined, b.staffNote ?? null],
    );
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.lead_updated", targetType: "channel_partner", targetId: l.partner_id, targetLabel: l.full_name, details: { lead: l.organisation_name, from: l.status, to: b.status ?? l.status }, ip: req.ip ?? null });
    if (b.status && b.status !== l.status) {
      await notify({ userId: l.user_id, kind: "partner_demo", title: `Referral ${l.organisation_name}: ${b.status}`, body: `Spica updated your referral of ${l.organisation_name} to "${b.status}".`, link: "/partner/referrals" }).catch(() => {});
    }
    await syncEarnings(l.partner_id);
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "23505") return res.status(409).json({ error: "organisation_already_linked" });
    next(err);
  }
});

staffPartnerProgramRouter.get("/channel-partners/:id/earnings", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    res.json(await earningsFor(req.params.id as string));
  } catch (err) {
    next(err);
  }
});

async function financeOk(req: AuthedRequest, res: Response) {
  // Paying partners is a Finance job; Super Admins have every permission.
  return requirePermission(req, res, "finance");
}

staffPartnerProgramRouter.post("/partner-earnings/:id/paid", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await financeOk(req, res))) return;
  const parsed = z.object({ reference: z.string().trim().min(2).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "reference_required" });
  try {
    const r = await pool.query(`UPDATE partner_earnings SET status = 'paid', paid_at = now(), paid_reference = $2 WHERE id = $1 AND status = 'earned' RETURNING partner_id, amount, currency`, [req.params.id, parsed.data.reference]);
    if (!r.rowCount) return res.status(409).json({ error: "not_payable" });
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.earning_paid", targetType: "channel_partner", targetId: r.rows[0].partner_id, details: { earning: req.params.id, amount: r.rows[0].amount, currency: r.rows[0].currency, reference: parsed.data.reference }, ip: req.ip ?? null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

staffPartnerProgramRouter.post("/partner-earnings/:id/void", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await financeOk(req, res))) return;
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "reason_required" });
  try {
    const r = await pool.query(`UPDATE partner_earnings SET status = 'void', void_reason = $2 WHERE id = $1 AND status = 'earned' RETURNING partner_id`, [req.params.id, parsed.data.reason]);
    if (!r.rowCount) return res.status(409).json({ error: "not_voidable" });
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.earning_voided", targetType: "channel_partner", targetId: r.rows[0].partner_id, details: { earning: req.params.id, reason: parsed.data.reason }, ip: req.ip ?? null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export { PartnerError };
