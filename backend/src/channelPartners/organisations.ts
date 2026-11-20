// Organisations a Channel Partner brings, and the demo licences given to them
// (stage 2). Used by the partner portal and by Spica staff acting for a partner.
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendAdminInviteEmail } from "../auth/mailer.js";
import { recordAudit } from "../audit/service.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { demoStatus } from "./staffRoutes.js";
import { orgDemoBalance } from "./demoLicences.js";
import { assertPartnerCanAct } from "./partnership.js";

// Demo licences given to an organisation are valid for 7 days from the day
// they are given, then 3 days' grace; unused ones expire after that (user,
// 19 Nov 2026). The partner no longer chooses a date.
export const GIFT_VALID_DAYS = 7;
export const GIFT_GRACE_DAYS = 3;

// Public email providers: a shared domain says nothing about the organisation.
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com", "rediffmail.com", "aol.com", "zoho.com"]);
const ORG_INVITE_HOURS = 72;

// In its own module so partnership.ts can use it without an import cycle.
export { PartnerError } from "./errors.js";
import { PartnerError } from "./errors.js";

export async function partnerBalance(partnerId: string) {
  const p = (await pool.query(`SELECT * FROM channel_partners WHERE id = $1`, [partnerId])).rows[0];
  if (!p) throw new PartnerError("partner_not_found", 404);
  const given = Number((await pool.query(`SELECT coalesce(sum(licences), 0) AS n FROM partner_allocations WHERE partner_id = $1 AND kind = 'demo'`, [partnerId])).rows[0].n);
  return { partner: p, given, left: Math.max(0, p.demo_licences - given), status: demoStatus(p) };
}

// Another Spica customer already uses this email or this company email domain?
export async function duplicateCheck(adminEmail: string): Promise<{ emailTaken: boolean; sameDomainOrgs: string[] }> {
  const email = adminEmail.trim().toLowerCase();
  const emailTaken = !!(await pool.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])).rowCount;
  const domain = email.split("@")[1] ?? "";
  let sameDomainOrgs: string[] = [];
  if (domain && !FREE_MAIL.has(domain)) {
    const r = await pool.query(
      `SELECT DISTINCT t.name FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(split_part(u.email, '@', 2)) = $1 AND u.role IN ('org_admin', 'manager') AND t.deactivated_at IS NULL LIMIT 5`,
      [domain],
    );
    sameDomainOrgs = r.rows.map((x) => x.name as string);
  }
  return { emailTaken, sameDomainOrgs };
}

// Staff acting for a partner skip the agreement check, never the partnership
// period or the type; the minimum licences per organisation binds the partner.
async function assertCanGive(partnerId: string, licences: number, actor: { role: string }, newOrganisation = false) {
  const staff = actor.role === "admin" || actor.role === "super_admin";
  if (!staff) await assertPartnerCanAct(partnerId, "organisations");
  const b = await partnerBalance(partnerId);
  if (b.partner.deactivated_at) throw new PartnerError("partner_deactivated", 409);
  if (!["reseller", "channel_partner"].includes(b.partner.partner_type)) throw new PartnerError("not_for_partner_type", 403);
  if (b.status !== "active") throw new PartnerError("partnership_not_active", 409);
  const min = Number(b.partner.min_licences_per_org ?? 1);
  if (!staff && licences > 0 && licences < min) throw new PartnerError("below_min_licences", 400, { min });
  // A new organisation needs at least the minimum, unless the partner has no demo licences at all.
  if (!staff && newOrganisation && licences === 0 && b.left >= min) throw new PartnerError("below_min_licences", 400, { min });
  if (licences > b.left) throw new PartnerError("not_enough_licences", 409, { left: b.left });
  return b;
}

// Optional details about the organisation, asked when it is added.
export interface OrgDetails {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  address?: string | null;
  postalCode?: string | null;
  website?: string | null;
  phone?: string | null;
  expectedLearners?: number | null;
  adminPhone?: string | null;
}

export async function createPartnerOrganisation(args: {
  partnerId: string;
  actor: { id: string; role: string; ip?: string | null };
  name: string;
  category: "university" | "company";
  adminFullName: string;
  adminEmail: string;
  demoLicences: number;
  gstin?: string | null;
  details?: OrgDetails;
  // The partner confirmed after seeing the same-domain warning.
  confirmDuplicate?: boolean;
}) {
  const b = await assertCanGive(args.partnerId, args.demoLicences, args.actor, true);
  const x = args.details ?? {};
  if (!x.city?.trim() || !x.state?.trim() || !x.country?.trim()) throw new PartnerError("location_required", 400);
  const dup = await duplicateCheck(args.adminEmail);
  if (dup.emailTaken) throw new PartnerError("email_already_registered", 409);
  if (dup.sameDomainOrgs.length && !args.confirmDuplicate) throw new PartnerError("possible_duplicate", 409, { organisations: dup.sameDomainOrgs });
  const parts = args.adminFullName.trim().split(/\s+/);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // An Admin owner keeps it visible in that Admin's console: the one who registered the partner.
    const t = await client.query(
      `INSERT INTO tenants (name, type, category, managed_by, products, channel_partner_id, tax_id, city, state, country, address_line, postal_code, website, phone, expected_learner_count)
       VALUES ($1, 'cohort', $2, (SELECT u.id FROM users u WHERE u.id = $3 AND u.role = 'admin'), ARRAY['skills'], $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [args.name.trim(), args.category, b.partner.created_by, args.partnerId, args.gstin?.trim().toUpperCase() || null, x.city?.trim() || null, x.state?.trim() || null, x.country?.trim() || null, x.address?.trim() || null, x.postalCode?.trim() || null, x.website?.trim() || null, x.phone?.trim() || null, x.expectedLearners ?? null],
    );
    const tenantId = t.rows[0].id;
    const u = await client.query(
      `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, invited_by, email_verified, phone)
       VALUES ('org_admin', $1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [tenantId, args.adminEmail.trim().toLowerCase(), await bcrypt.hash(randomUUID(), 12), parts[0], parts.slice(1).join(" "), args.actor.id, x.adminPhone?.trim() || null],
    );
    if (args.demoLicences > 0) {
      await client.query(`INSERT INTO partner_allocations (partner_id, tenant_id, kind, licences, created_by, valid_until) VALUES ($1, $2, 'demo', $3, $4, current_date + $5::int)`, [args.partnerId, tenantId, args.demoLicences, args.actor.id, GIFT_VALID_DAYS]);
    }
    await client.query("COMMIT");
    const token = generateToken();
    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [u.rows[0].id, hashToken(token), new Date(Date.now() + ORG_INVITE_HOURS * 3600 * 1000)]);
    let emailSent = true;
    await sendAdminInviteEmail(args.adminEmail, token, "an Org Admin").catch((err) => {
      emailSent = false;
      console.error("partner org admin invite failed:", err);
    });
    await recordAudit({ tenantId, actorId: args.actor.id, actorRole: args.actor.role, action: "channel_partner.organisation_added", targetType: "channel_partner", targetId: args.partnerId, targetLabel: b.partner.full_name, details: { organisation: args.name, demoLicences: args.demoLicences, duplicateWarning: dup.sameDomainOrgs }, ip: args.actor.ip ?? null });
    return { tenantId, emailSent };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") throw new PartnerError("email_already_registered", 409);
    throw err;
  } finally {
    client.release();
  }
}

export async function giveDemoLicences(args: { partnerId: string; tenantId: string; licences: number; actor: { id: string; role: string; ip?: string | null } }) {
  const b = await assertCanGive(args.partnerId, args.licences, args.actor);
  const t = await pool.query(`SELECT name FROM tenants WHERE id = $1 AND channel_partner_id = $2`, [args.tenantId, args.partnerId]);
  if (!t.rowCount) throw new PartnerError("organisation_not_found", 404);
  const vu = (await pool.query(`INSERT INTO partner_allocations (partner_id, tenant_id, kind, licences, created_by, valid_until) VALUES ($1, $2, 'demo', $3, $4, current_date + $5::int) RETURNING valid_until`, [args.partnerId, args.tenantId, args.licences, args.actor.id, GIFT_VALID_DAYS])).rows[0].valid_until;
  const d = (x: Date) => x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const grace = new Date(new Date(vu).getTime() + GIFT_GRACE_DAYS * 86400000);
  for (const id of await orgAdminIds(args.tenantId)) {
    await notify({
      userId: id,
      kind: "partner_demo",
      title: `${args.licences} more demo licences`,
      body: `Your organisation now has ${args.licences} more demo licences. New learners you add get a 7-day demo automatically. Add learners by ${d(new Date(vu))} (3 days' grace to ${d(grace)}); unused licences expire after that.`,
      link: "/orgadmin/dashboard",
      email: true,
    });
  }
  await recordAudit({ tenantId: args.tenantId, actorId: args.actor.id, actorRole: args.actor.role, action: "channel_partner.licences_given", targetType: "channel_partner", targetId: args.partnerId, targetLabel: b.partner.full_name, details: { organisation: t.rows[0].name, licences: args.licences }, ip: args.actor.ip ?? null });
}

// Organisations with their admin, licences given and learners (no scores).
export async function partnerOrganisations(partnerId: string) {
  const r = await pool.query(
    `SELECT t.id, t.name, t.category, t.created_at, t.deactivated_at, t.city, t.state, t.country, t.website, t.phone, t.expected_learner_count, t.address_line, t.postal_code, t.tax_id,
       (SELECT coalesce(json_agg(json_build_object('licences', a.licences, 'validUntil', to_char(a.valid_until, 'YYYY-MM-DD'), 'graceUntil', to_char(a.valid_until + 3, 'YYYY-MM-DD'), 'givenAt', a.created_at) ORDER BY a.created_at), '[]') FROM partner_allocations a WHERE a.tenant_id = t.id AND a.kind = 'demo') AS allocations,
       (SELECT coalesce(sum(a.licences), 0)::int FROM partner_allocations a WHERE a.tenant_id = t.id AND a.kind = 'demo') AS demo_licences,
       (SELECT count(*)::int FROM users l WHERE l.tenant_id = t.id AND l.role = 'learner' AND l.deleted_at IS NULL) AS learners,
       (SELECT count(*)::int FROM entitlements e WHERE e.tenant_id = t.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL) AS demo_used,
       (SELECT count(*)::int FROM entitlements e WHERE e.tenant_id = t.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL AND e.ends_at > now()) AS demo_active,
       (SELECT count(DISTINCT e.user_id)::int FROM entitlements e JOIN sessions s ON s.user_id = e.user_id AND s.started_at >= e.starts_at
          WHERE e.tenant_id = t.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL) AS demo_started,
       (SELECT count(*)::int FROM entitlements e JOIN sessions s ON s.user_id = e.user_id AND s.started_at >= e.starts_at AND s.started_at < e.ends_at
          WHERE e.tenant_id = t.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL) AS demo_practice_done,
       (SELECT count(*)::int FROM entitlements e JOIN sessions s ON s.user_id = e.user_id AND s.started_at >= e.starts_at AND s.started_at < e.ends_at
          WHERE e.tenant_id = t.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL) AS demo_mocks_done,
       (SELECT count(DISTINCT la.user_id)::int FROM license_assignments la WHERE la.tenant_id = t.id AND la.reclaimed_at IS NULL AND (la.ends_at IS NULL OR la.ends_at > now())) AS paid_assigned,
       (SELECT count(*)::int FROM partner_order_organisations po JOIN partner_orders o ON o.id = po.order_id WHERE po.tenant_id = t.id AND o.status <> 'cancelled') AS orders,
       (SELECT count(*)::int FROM partner_order_organisations po JOIN partner_orders o ON o.id = po.order_id WHERE po.tenant_id = t.id AND o.status IN ('confirmed', 'allocated', 'active')) AS orders_confirmed,
       oa.first_name AS admin_first, oa.last_name AS admin_last, oa.email AS admin_email,
       (SELECT max(e.created_at) FROM login_events e WHERE e.user_id = oa.id) AS admin_signed_in
     FROM tenants t
     LEFT JOIN LATERAL (SELECT * FROM users u WHERE u.tenant_id = t.id AND u.role = 'org_admin' ORDER BY u.created_at LIMIT 1) oa ON true
     WHERE t.channel_partner_id = $1 ORDER BY t.created_at DESC`,
    [partnerId],
  );
  // Licences not used yet and those past their "valid until" date, per organisation.
  const balances = await Promise.all(r.rows.map((o) => orgDemoBalance(o.id)));
  return r.rows.map((o, i) => ({
    id: o.id,
    name: o.name,
    category: o.category,
    createdAt: o.created_at,
    active: !o.deactivated_at,
    demoLicences: o.demo_licences,
    allocations: o.allocations as { licences: number; validUntil: string | null; graceUntil: string | null; givenAt: string }[],
    details: { city: o.city, state: o.state, country: o.country, website: o.website, phone: o.phone, expectedLearners: o.expected_learner_count, address: o.address_line, postalCode: o.postal_code, gstin: o.tax_id },
    learners: o.learners,
    // Usage of the demo licences: counts only, never scores.
    demoUsed: o.demo_used,
    demoLeft: balances[i]?.left ?? Math.max(0, o.demo_licences - o.demo_used),
    demoExpired: balances[i]?.expired ?? 0,
    demoActive: o.demo_active,
    demoStarted: o.demo_started,
    practiceDone: o.demo_practice_done,
    mocksDone: o.demo_mocks_done,
    paidAssigned: o.paid_assigned,
    orders: o.orders,
    ordersConfirmed: o.orders_confirmed,
    admin: { name: [o.admin_first, o.admin_last].filter(Boolean).join(" "), email: o.admin_email, invitePending: !o.admin_signed_in },
  }));
}

// One organisation for its partner: the admin, each learner's licence and
// whether they finished the mock test / a real test (yes or no only, never
// scores), and the orders that name it.
export async function partnerOrganisationDetail(partnerId: string, tenantId: string) {
  const t = (await pool.query(`SELECT id, name, category, created_at, deactivated_at FROM tenants WHERE id = $1 AND channel_partner_id = $2`, [tenantId, partnerId])).rows[0];
  if (!t) throw new PartnerError("organisation_not_found", 404);
  const [summary] = (await partnerOrganisations(partnerId)).filter((o) => o.id === tenantId);
  const admin = (
    await pool.query(
      `SELECT u.first_name, u.last_name, u.email, u.phone, (SELECT max(e.created_at) FROM login_events e WHERE e.user_id = u.id) AS signed_in
       FROM users u WHERE u.tenant_id = $1 AND u.role = 'org_admin' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1`,
      [tenantId],
    )
  ).rows[0];
  const learners = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.created_at,
       d.ends_at AS demo_ends, d.revoked_at AS demo_revoked,
       la.ends_at AS paid_ends,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id) AS started,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL) AS mock_done,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.session_type = 'mocktest' AND s.delivery_mode = 'certified' AND s.completed_at IS NOT NULL) AS final_done
     FROM users u
     LEFT JOIN LATERAL (SELECT ends_at, revoked_at FROM entitlements e WHERE e.user_id = u.id AND e.source = 'partner_demo' AND e.revoked_at IS NULL ORDER BY e.ends_at DESC LIMIT 1) d ON true
     LEFT JOIN LATERAL (SELECT coalesce(a.ends_at, 'infinity'::timestamptz) AS ends_at FROM license_assignments a WHERE a.user_id = u.id AND a.reclaimed_at IS NULL ORDER BY a.ends_at DESC NULLS FIRST LIMIT 1) la ON true
     WHERE u.tenant_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 2000`,
    [tenantId],
  );
  const now = Date.now();
  const orders = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.total, o.currency, to_char(o.valid_until, 'YYYY-MM-DD') AS valid_until,
       (SELECT coalesce(sum(quantity), 0)::int FROM partner_order_lines l WHERE l.order_id = o.id AND l.kind = 'full_access') AS licences
     FROM partner_order_organisations x JOIN partner_orders o ON o.id = x.order_id WHERE x.tenant_id = $1 ORDER BY o.created_at DESC`,
    [tenantId],
  );
  return {
    organisation: summary,
    admin: admin
      ? { name: [admin.first_name, admin.last_name].filter(Boolean).join(" "), email: admin.email, phone: admin.phone ?? null, invitePending: !admin.signed_in, lastSignIn: admin.signed_in ?? null }
      : null,
    learners: learners.rows.map((l) => {
      const paidEnds = l.paid_ends ? new Date(l.paid_ends) : null;
      const paid = !!paidEnds;
      const endsAt = paid ? (Number.isFinite(paidEnds!.getTime()) ? paidEnds!.toISOString() : null) : l.demo_ends ? new Date(l.demo_ends).toISOString() : null;
      return {
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" "),
        email: l.email,
        addedAt: l.created_at,
        licence: paid ? "paid" : l.demo_ends ? "demo" : "none",
        licenceEndsAt: endsAt,
        licenceActive: paid ? !endsAt || new Date(endsAt).getTime() > now : !!l.demo_ends && new Date(l.demo_ends).getTime() > now,
        started: l.started,
        mockDone: l.mock_done,
        finalDone: l.final_done,
      };
    }),
    orders: orders.rows.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, total: o.total, currency: o.currency, validUntil: o.valid_until, licences: o.licences })),
  };
}
