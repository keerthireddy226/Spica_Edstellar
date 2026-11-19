// The Channel Partner portal API (stage 2): the signed-in partner's own
// account, organisations and demo licences. Partners never see scores,
// levels or reports — only names, emails, licence counts and status.
import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createPartnerOrganisation, giveDemoLicences, partnerBalance, partnerOrganisationDetail, partnerOrganisations, PartnerError } from "./organisations.js";

export const partnerPortalRouter = Router();

async function myPartnerId(req: AuthedRequest, res: Response): Promise<string | null> {
  if (req.user?.role !== "channel_partner") {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  const r = await pool.query(`SELECT id FROM channel_partners WHERE user_id = $1 AND deactivated_at IS NULL`, [req.user.id]);
  if (!r.rowCount) {
    res.status(403).json({ error: "partner_deactivated" });
    return null;
  }
  return r.rows[0].id;
}

export function sendPartnerError(err: unknown, res: Response): boolean {
  if (err instanceof PartnerError) {
    res.status(err.status).json({ error: err.code, ...err.extra });
    return true;
  }
  return false;
}

partnerPortalRouter.get("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  try {
    const b = await partnerBalance(id);
    const p = b.partner;
    res.json({
      partner: { id: p.id, fullName: p.full_name, email: p.email, code: p.code, ownLicenceEnabled: p.own_licence_enabled, commissionPercent: Number(p.commission_percent ?? 0) },
      demo: { total: p.demo_licences, given: b.given, left: b.left, status: b.status, startsAt: p.demo_starts_at, endsAt: p.demo_ended_at ?? p.demo_ends_at },
    });
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get("/organisations", requireAuth, async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  try {
    res.json({ organisations: await partnerOrganisations(id) });
  } catch (err) {
    next(err);
  }
});

partnerPortalRouter.get("/organisations/:tenantId", requireAuth, async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  if (!/^[0-9a-f-]{36}$/.test(String(req.params.tenantId))) return res.status(404).json({ error: "organisation_not_found" });
  try {
    res.json(await partnerOrganisationDetail(id, String(req.params.tenantId)));
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});

export const licencesSchema = z.object({ licences: z.number().int().min(1).max(100000), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });

export const orgSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.enum(["university", "company"]),
  adminFullName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email(),
  demoLicences: z.number().int().min(0).max(100000),
  gstin: z.string().trim().max(20).regex(/^[0-9A-Za-z]*$/).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  details: z
    .object({
      city: z.string().trim().max(100).nullish(),
      state: z.string().trim().max(100).nullish(),
      country: z.string().trim().max(100).nullish(),
      address: z.string().trim().max(300).nullish(),
      postalCode: z.string().trim().max(20).nullish(),
      website: z.string().trim().max(200).nullish(),
      phone: z.string().trim().max(30).nullish(),
      expectedLearners: z.number().int().min(0).max(1000000).nullish(),
      adminPhone: z.string().trim().max(30).nullish(),
    })
    .optional(),
  confirmDuplicate: z.boolean().optional(),
});

partnerPortalRouter.post("/organisations", requireAuth, async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  const parsed = orgSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    const r = await createPartnerOrganisation({ partnerId: id, actor: { id: req.user!.id, role: req.user!.role, ip: req.ip ?? null }, ...parsed.data });
    res.status(201).json(r);
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});

partnerPortalRouter.post("/organisations/:tenantId/licences", requireAuth, async (req: AuthedRequest, res, next) => {
  const id = await myPartnerId(req, res);
  if (!id) return;
  const parsed = licencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
  try {
    await giveDemoLicences({ partnerId: id, tenantId: req.params.tenantId as string, licences: parsed.data.licences, validUntil: parsed.data.validUntil ?? null, actor: { id: req.user!.id, role: req.user!.role, ip: req.ip ?? null } });
    res.json({ ok: true });
  } catch (err) {
    if (!sendPartnerError(err, res)) next(err);
  }
});
