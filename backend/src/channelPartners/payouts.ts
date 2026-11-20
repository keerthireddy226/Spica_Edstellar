// Payout details (owner, 20 Nov 2026): where Spica sends a partner's earnings.
// The partner fills them in once in their Profile. Spica pays only partners
// who have: marking an earning or a commission paid is refused without them,
// and partners with money waiting are reminded to add them.
// Defaults until Finance decides otherwise: bank transfer for everyone, PayPal
// as an option for partners outside India; no tax deducted and no invoice from
// the partner.
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { requirePermission } from "../admin/staff.js";
import { recordAudit } from "../audit/service.js";

// The partner types that earn money from Spica (a Reseller earns a discount instead).
export const EARNING_TYPES = ["channel_partner", "affiliate", "referral"];

export async function hasPayoutDetails(partnerId: string): Promise<boolean> {
  return !!(await pool.query(`SELECT 1 FROM partner_payout_details WHERE partner_id = $1`, [partnerId])).rowCount;
}

const tail = (v: string | null) => (v ? `•••• ${v.slice(-4)}` : null);

// The partner sees their own details in full; staff with Finance see them in
// full to make the payment; nobody else sees them.
export function payoutRow(d: Record<string, any> | undefined) {
  if (!d) return null;
  return {
    method: d.method as "bank" | "paypal",
    accountName: d.account_name,
    accountNumber: d.account_number,
    accountNumberMasked: tail(d.account_number),
    bankName: d.bank_name,
    bankCode: d.bank_code,
    bankCountry: d.bank_country,
    paypalEmail: d.paypal_email,
    pan: d.pan,
    gstin: d.gstin,
    updatedAt: d.updated_at,
  };
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const SWIFT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const up = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().replace(/\s+/g, "") : v);
const opt = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const detailsSchema = z
  .object({
    method: z.enum(["bank", "paypal"]),
    accountName: z.preprocess(opt, z.string().trim().min(2).max(120).nullish()),
    accountNumber: z.preprocess((v) => opt(up(v)), z.string().regex(/^[A-Z0-9]{6,34}$/).nullish()),
    bankName: z.preprocess(opt, z.string().trim().max(120).nullish()),
    bankCode: z.preprocess((v) => opt(up(v)), z.string().max(11).nullish()),
    bankCountry: z.preprocess(opt, z.string().trim().min(2).max(60).nullish()),
    paypalEmail: z.preprocess(opt, z.string().trim().toLowerCase().email().nullish()),
    pan: z.preprocess((v) => opt(up(v)), z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).nullish()),
    gstin: z.preprocess((v) => opt(up(v)), z.string().regex(/^[0-9]{2}[A-Z0-9]{13}$/).nullish()),
  })
  .superRefine((d, ctx) => {
    if (d.method === "bank") {
      if (!d.accountName) ctx.addIssue({ code: "custom", path: ["accountName"], message: "required" });
      if (!d.accountNumber) ctx.addIssue({ code: "custom", path: ["accountNumber"], message: "required" });
      const india = !d.bankCountry || /^(india|in)$/i.test(d.bankCountry);
      if (!d.bankCode || !(india ? IFSC : SWIFT).test(d.bankCode)) ctx.addIssue({ code: "custom", path: ["bankCode"], message: india ? "ifsc" : "swift" });
    }
    if (d.method === "paypal" && !d.paypalEmail) ctx.addIssue({ code: "custom", path: ["paypalEmail"], message: "required" });
  });

async function myEarningPartner(req: AuthedRequest) {
  if (req.user?.role !== "channel_partner") return null;
  return (await pool.query(`SELECT id, partner_type, full_name FROM channel_partners WHERE user_id = $1 AND deactivated_at IS NULL`, [req.user.id])).rows[0] ?? null;
}

// ---- Partner: their own details (Profile) ----
export const partnerPayoutRouter = Router();
partnerPayoutRouter.get("/payout-details", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await myEarningPartner(req);
    if (!p) return res.status(403).json({ error: "forbidden" });
    const d = (await pool.query(`SELECT * FROM partner_payout_details WHERE partner_id = $1`, [p.id])).rows[0];
    // Money waiting to be paid (earnings, or Channel Partner commission).
    const waiting = (
      await pool.query(
        `SELECT (SELECT count(*) FROM partner_earnings WHERE partner_id = $1 AND status = 'earned')
              + (SELECT count(*) FROM partner_orders WHERE partner_id = $1 AND commission_amount > 0 AND commission_paid_at IS NULL AND status IN ('confirmed', 'allocated', 'active', 'expired')) AS n`,
        [p.id],
      )
    ).rows[0].n;
    res.json({ needed: EARNING_TYPES.includes(p.partner_type), details: payoutRow(d), moneyWaiting: Number(waiting) > 0 });
  } catch (err) {
    next(err);
  }
});
partnerPayoutRouter.put("/payout-details", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const p = await myEarningPartner(req);
    if (!p || !EARNING_TYPES.includes(p.partner_type)) return res.status(403).json({ error: "forbidden" });
    const parsed = detailsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "invalid_input", fields: parsed.error.issues.map((i) => ({ field: i.path[0], problem: i.message })) });
    const d = parsed.data;
    const bank = d.method === "bank";
    await pool.query(
      `INSERT INTO partner_payout_details (partner_id, method, account_name, account_number, bank_name, bank_code, bank_country, paypal_email, pan, gstin, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       ON CONFLICT (partner_id) DO UPDATE SET method = EXCLUDED.method, account_name = EXCLUDED.account_name, account_number = EXCLUDED.account_number,
         bank_name = EXCLUDED.bank_name, bank_code = EXCLUDED.bank_code, bank_country = EXCLUDED.bank_country, paypal_email = EXCLUDED.paypal_email,
         pan = EXCLUDED.pan, gstin = EXCLUDED.gstin, updated_at = now()`,
      [p.id, d.method, bank ? d.accountName : null, bank ? d.accountNumber : null, bank ? d.bankName ?? null : null, bank ? d.bankCode : null, bank ? d.bankCountry ?? "India" : null, bank ? null : d.paypalEmail, d.pan ?? null, d.gstin ?? null],
    );
    // The audit log records the change, never the numbers themselves.
    await recordAudit({ tenantId: null, actorId: req.user!.id, actorRole: req.user!.role, action: "channel_partner.payout_details_saved", targetType: "channel_partner", targetId: p.id, targetLabel: p.full_name, details: { method: d.method }, ip: req.ip ?? null });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---- Spica staff with Finance: to make the payment ----
export const staffPayoutRouter = Router();
staffPayoutRouter.get("/channel-partners/:id/payout-details", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "finance"))) return;
  try {
    const d = (await pool.query(`SELECT * FROM partner_payout_details WHERE partner_id = $1`, [req.params.id])).rows[0];
    res.json({ details: payoutRow(d) });
  } catch (err) {
    next(err);
  }
});
