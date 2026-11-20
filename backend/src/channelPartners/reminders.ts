// Channel Partners stage 4: reminders about demo licences, run with the other
// notification jobs (every 15 minutes; each reminder is sent once).
//  - Partner (and the Spica staff member who registered them): the demo window
//    ends in 14 days, in 3 days, and has ended.
//  - Org Admins of the partner's organisations: 3 days before the window ends
//    (licences not given out by then can't be given), and when it has ended.
//  - Learners with a demo licence: 2 days and 1 day before it ends, and when
//    it has ended.
import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { syncEarnings } from "./partnerPrograms.js";
import { DEMO_GRACE_DAYS } from "./demoLicences.js";

const DAY = 86400000;
const shortDate = (d: Date | string | number) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dayKey = (d: Date | string | number) => new Date(d).toISOString().slice(0, 10);

const STAFF_LINK: Record<string, string> = { admin: "/admin/channel-partners", super_admin: "/superadmin/channel-partners" };

export async function runPartnerDemoAlerts(now = Date.now()): Promise<number> {
  let sent = 0;

  // ---- The partner's demo window ----
  const partners = await pool.query(
    `SELECT p.id, p.user_id, p.full_name, p.created_by, p.partner_type, p.terminated_at, coalesce(p.demo_ended_at, p.demo_ends_at) AS ends_at, s.role AS staff_role
     FROM channel_partners p LEFT JOIN users s ON s.id = p.created_by AND s.deleted_at IS NULL
     WHERE p.deactivated_at IS NULL AND p.demo_starts_at IS NOT NULL AND coalesce(p.demo_ended_at, p.demo_ends_at) IS NOT NULL
       AND coalesce(p.demo_ended_at, p.demo_ends_at) BETWEEN now() - interval '2 days' AND now() + interval '14 days'`,
  );
  for (const p of partners.rows) {
    const ends = new Date(p.ends_at).getTime();
    const stage = ends <= now ? "ended" : ends - now <= 3 * DAY ? "3d" : "14d";
    const key = `cpdemo:${p.id}:${dayKey(ends)}:${stage}`;
    // A terminated partner was told at the time; no expiry reminders.
    if (p.terminated_at) continue;
    const orgType = ["reseller", "channel_partner"].includes(p.partner_type);
    const partnerCopy =
      stage === "ended"
        ? { title: "Your Spica partnership has ended", body: "Your partner portal is now read-only: you can still see your history, invoices and earnings. Talk to Spica about renewing." }
        : {
            title: `Your Spica partnership ends on ${shortDate(ends)}`,
            body: orgType
              ? "After that your portal becomes read-only. Renewal needs your minimum number of organisations. Give your remaining demo licences before then."
              : "After that your portal becomes read-only. Talk to Spica about renewing.",
          };
    if (await notify({ userId: p.user_id, kind: "partner_demo", ...partnerCopy, link: "/partner/dashboard", dedupeKey: key, email: true })) sent++;

    if (p.created_by && STAFF_LINK[p.staff_role]) {
      const staffCopy =
        stage === "ended"
          ? { title: `${p.full_name}: partnership ended`, body: "The partnership has ended and the partner's portal is read-only. Renew it from Partners if it should continue." }
          : { title: `${p.full_name}: partnership ends on ${shortDate(ends)}`, body: "Renew it from Partners. Below the organisation minimum, renewal needs a written reason." };
      if (await notify({ userId: p.created_by, kind: "partner_demo", ...staffCopy, link: STAFF_LINK[p.staff_role], dedupeKey: `${key}:staff`, email: true })) sent++;
    }

    if (stage !== "14d" && orgType) {
      const orgs = await pool.query(`SELECT id FROM tenants WHERE channel_partner_id = $1 AND deactivated_at IS NULL`, [p.id]);
      const orgCopy =
        stage === "ended"
          ? { title: "The demo period has ended", body: "New learners no longer get a demo licence. Learners who have one keep it until it ends." }
          : { title: `Demo licences can be given until ${shortDate(ends)}`, body: "New learners you add before then get a 7-day demo automatically." };
      for (const o of orgs.rows) {
        for (const id of await orgAdminIds(o.id)) {
          if (await notify({ userId: id, kind: "partner_demo", ...orgCopy, link: "/orgadmin/dashboard", dedupeKey: `${key}:org:${id}`, email: true })) sent++;
        }
      }
    }
  }

  // ---- Learners' 7-day demo licences ----
  const learners = await pool.query(
    `SELECT e.id, e.user_id, e.ends_at FROM entitlements e JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL
     WHERE e.source = 'partner_demo' AND e.revoked_at IS NULL AND e.ends_at BETWEEN now() - interval '2 days' AND now() + interval '2 days'`,
  );
  for (const l of learners.rows) {
    const ends = new Date(l.ends_at).getTime();
    const stage = ends <= now ? "ended" : ends - now <= DAY ? "1d" : "2d";
    const copy =
      stage === "ended"
        ? {
            title: "Your 7-day demo has ended",
            body: `For the next ${DEMO_GRACE_DAYS} days you can still sign in and see your reports, but not practise. After that you need a paid licence to sign in. Ask your organisation's admin about full access.`,
            link: "/my-reports",
          }
        : {
            title: stage === "1d" ? "Your demo ends tomorrow" : "Your demo ends in 2 days",
            body: `Your demo ends on ${shortDate(ends)}. Finish your practice tests and the mock test before then.`,
            link: "/practice-tests",
          };
    if (await notify({ userId: l.user_id, kind: "partner_demo", ...copy, dedupeKey: `demo:${l.id}:${stage}`, email: true })) sent++;
  }
  // Affiliate and referral earnings from the day's payments.
  await syncEarnings().catch((err) => console.error("partner earnings sync failed:", err));
  sent += await referralAndPayoutReminders().catch((err) => {
    console.error("partner referral/payout reminders failed:", err);
    return 0;
  });
  return sent;
}

// Staff: a referral still "Submitted" after 3 and 10 days, and an organisation
// that may be a referral that signed up by itself. Partner: money is waiting
// but there are no payout details (once a week). (Owner, 20 Nov 2026.)
async function referralAndPayoutReminders(): Promise<number> {
  let sent = 0;
  const supers = (await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows.map((r) => r.id as string);
  const staffFor = async (createdBy: string | null) => {
    const ok = createdBy ? (await pool.query(`SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL`, [createdBy])).rows[0] : null;
    return ok ? [{ id: ok.id as string, link: STAFF_LINK[ok.role] ?? "/admin/channel-partners" }] : supers.map((id) => ({ id, link: STAFF_LINK.super_admin }));
  };

  const stale = await pool.query(
    `SELECT l.id, l.organisation_name, l.created_at, p.full_name, p.created_by FROM partner_leads l JOIN channel_partners p ON p.id = l.partner_id
     WHERE l.status = 'submitted' AND l.created_at < now() - interval '3 days'`,
  );
  for (const l of stale.rows) {
    const days = Math.floor((Date.now() - new Date(l.created_at).getTime()) / DAY);
    const stage = days >= 10 ? "10d" : "3d";
    for (const s of await staffFor(l.created_by)) {
      const r = await notify({
        userId: s.id,
        kind: "partner_demo",
        title: `Referral waiting: ${l.organisation_name}`,
        body: `${l.full_name} referred ${l.organisation_name} ${days} days ago and nobody has contacted them yet. Contact them and update the referral.`,
        link: s.link,
        dedupeKey: `lead-stale:${l.id}:${stage}:${s.id}`,
        email: true,
      });
      if (r) sent++;
    }
  }

  const { leadMatches } = await import("./partnerPrograms.js");
  for (const m of await leadMatches()) {
    for (const s of await staffFor(m.created_by)) {
      const r = await notify({
        userId: s.id,
        kind: "partner_demo",
        title: `Possible match for a referral: ${m.tenant_name}`,
        body: `${m.tenant_name} looks like ${m.organisation_name}, referred by ${m.full_name}. If it is, mark the referral won and link the organisation.`,
        link: s.link,
        dedupeKey: `lead-match:${m.lead_id}:${m.tenant_id}:${s.id}`,
      });
      if (r) sent++;
    }
  }

  const week = (() => {
    const d = new Date();
    const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return `${d.getUTCFullYear()}-${Math.ceil(((d.getTime() - start.getTime()) / DAY + start.getUTCDay() + 1) / 7)}`;
  })();
  const owed = await pool.query(
    `SELECT p.id, p.user_id FROM channel_partners p
     WHERE p.deactivated_at IS NULL AND p.partner_type IN ('channel_partner', 'affiliate', 'referral')
       AND NOT EXISTS (SELECT 1 FROM partner_payout_details d WHERE d.partner_id = p.id)
       AND (EXISTS (SELECT 1 FROM partner_earnings e WHERE e.partner_id = p.id AND e.status = 'earned')
         OR EXISTS (SELECT 1 FROM partner_orders o WHERE o.partner_id = p.id AND o.commission_amount > 0 AND o.commission_paid_at IS NULL AND o.status IN ('confirmed', 'allocated', 'active', 'expired')))`,
  );
  for (const p of owed.rows) {
    const r = await notify({
      userId: p.user_id,
      kind: "partner_demo",
      title: "Add your payout details",
      body: "Spica has money waiting for you. Add your bank or PayPal details in your Profile so Spica can pay you.",
      link: "/partner/profile",
      dedupeKey: `payout-details:${p.id}:${week}`,
      email: true,
    });
    if (r) sent++;
  }
  return sent;
}
