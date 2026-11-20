// Partner types and the partnership period (user, 19 Nov 2026).
// Four types share the channel_partner login: Reseller, Channel Partner,
// Affiliate and Referral Partner. A partnership lasts the length Spica chose
// for that partner (partnership_months, 3 by default; or a chosen end date)
// (demo_starts_at → demo_ends_at); Spica renews it for a length it picks, and
// renewal is blocked until a Reseller / Channel Partner has its minimum number
// of organisations, unless an Admin overrides it with a reason. When it ends
// (by date or terminated early) the portal is read-only. The partner signs the
// partnership agreement in the app for each period before it can act.
import { pool } from "../db.js";
import { PartnerError } from "./errors.js";

export const PARTNER_TYPES = ["reseller", "channel_partner", "affiliate", "referral"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_TYPE_LABEL: Record<PartnerType, string> = {
  reseller: "Reseller",
  channel_partner: "Channel Partner",
  affiliate: "Affiliate Partner",
  referral: "Referral Partner",
};
// Code prefixes, so a code says what kind of partner it belongs to.
export const CODE_PREFIX: Record<PartnerType, string> = { reseller: "RS", channel_partner: "CP", affiliate: "AF", referral: "RF" };

export const PARTNERSHIP_MONTHS = 3;
// "Ends soon" from 14 days before the end.
export const EXPIRING_DAYS = 14;
export const MIN_OVERRIDE_REASON = 10;

// Types that onboard organisations, give demo licences and place orders.
export const ORG_TYPES: readonly PartnerType[] = ["reseller", "channel_partner"];
export const bringsOrganisations = (t: string) => ORG_TYPES.includes(t as PartnerType);

export type PartnershipStatus = "not_started" | "active" | "expiring" | "expired" | "terminated" | "deactivated";

interface PartnerRow {
  partner_type?: string;
  demo_starts_at: Date | string | null;
  demo_ends_at: Date | string | null;
  demo_ended_at: Date | string | null;
  terminated_at?: Date | string | null;
  deactivated_at?: Date | string | null;
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

export function partnershipEnd(p: PartnerRow): Date | null {
  const e = ms(p.demo_ended_at) ?? ms(p.demo_ends_at);
  return e == null ? null : new Date(e);
}

export function partnershipStatus(p: PartnerRow, now = Date.now()): PartnershipStatus {
  if (p.deactivated_at) return "deactivated";
  if (p.terminated_at) return "terminated";
  if (!p.demo_starts_at) return "not_started";
  const end = partnershipEnd(p);
  if (end && end.getTime() <= now) return "expired";
  if (end && end.getTime() - now <= EXPIRING_DAYS * 86400000) return "expiring";
  return "active";
}

// The partner may add organisations, give licences, order or submit leads.
export const canAct = (s: PartnershipStatus) => s === "active" || s === "expiring";

export const daysLeft = (p: PartnerRow, now = Date.now()) => {
  const end = partnershipEnd(p);
  return end ? Math.max(0, Math.ceil((end.getTime() - now) / 86400000)) : null;
};

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + months);
  return r;
}

// Renewal: another 3 months from the current end, or from today if it has
// already ended. Returns why it is blocked, or null.
export function renewalBlock(args: { status: PartnershipStatus; type: string; organisations: number; minOrganisations: number; overrideReason?: string | null }): string | null {
  if (args.status === "deactivated") return "partner_deactivated";
  if (args.status === "terminated") return "partnership_terminated";
  if (args.status === "not_started") return "partnership_not_started";
  if (bringsOrganisations(args.type) && args.organisations < args.minOrganisations && (args.overrideReason ?? "").trim().length < MIN_OVERRIDE_REASON) return "minimum_not_met";
  return null;
}

export function renewedEnd(currentEnd: Date | null, now = new Date(), months = PARTNERSHIP_MONTHS): Date {
  const from = currentEnd && currentEnd > now ? currentEnd : now;
  return addMonths(from, months);
}

// A chosen end date ("YYYY-MM-DD"): the end of that day in India.
export function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59+05:30`);
}

export const AGREEMENT_VERSION = "2026-11-20";

// The agreement covers one partnership period: signed for the current period
// when the signature's period end matches the partnership's end.
export async function currentAgreement(partner: { id: string; demo_ends_at: Date | string | null }) {
  const r = await pool.query(
    `SELECT id, version, signed_name, signed_email, signed_at, period_start, period_end FROM partner_agreements
     WHERE partner_id = $1 AND period_end IS NOT DISTINCT FROM $2::timestamptz ORDER BY signed_at DESC LIMIT 1`,
    [partner.id, partner.demo_ends_at],
  );
  return r.rows[0] ?? null;
}

// When the current 3-month period began: the original start, or after a
// renewal the old end (renewed early) or the renewal day (renewed after it ended).
export const PERIOD_START_SQL = `coalesce((SELECT greatest(r.previous_end, r.created_at) FROM partner_renewals r WHERE r.partner_id = cp.id ORDER BY r.created_at DESC LIMIT 1), cp.demo_starts_at)`;
export async function currentPeriodStart(partnerId: string): Promise<Date | null> {
  const r = await pool.query(`SELECT ${PERIOD_START_SQL} AS s FROM channel_partners cp WHERE cp.id = $1`, [partnerId]);
  return r.rows[0]?.s ?? null;
}

// All licences an organisation has had from its partner: demo licences given
// plus paid licences allocated from orders (not cancelled). `t` is the tenants alias.
export const ORG_LICENCES_SQL = (t: string) => `(
  (SELECT coalesce(sum(a.licences), 0) FROM partner_allocations a WHERE a.tenant_id = ${t}.id AND a.kind = 'demo')
  + (SELECT coalesce(sum(a.licences), 0) FROM partner_order_allocations a JOIN partner_orders o ON o.id = a.order_id WHERE a.tenant_id = ${t}.id AND o.status <> 'cancelled')
)::int`;

// Organisations that count towards the partner's minimum: active ones that
// have reached the minimum licences per organisation in total (owner, 20 Nov
// 2026). Licences can be given in any amounts; only the total matters.
export async function activeOrganisations(partnerId: string): Promise<number> {
  return Number(
    (
      await pool.query(
        `SELECT count(*) AS n FROM tenants t JOIN channel_partners cp ON cp.id = t.channel_partner_id
         WHERE t.channel_partner_id = $1 AND t.deactivated_at IS NULL AND ${ORG_LICENCES_SQL("t")} >= greatest(cp.min_licences_per_org, 1)`,
        [partnerId],
      )
    ).rows[0].n,
  );
}
// Every active organisation the partner added, whether it has reached the minimum or not.
export async function addedOrganisations(partnerId: string): Promise<number> {
  return Number((await pool.query(`SELECT count(*) AS n FROM tenants WHERE channel_partner_id = $1 AND deactivated_at IS NULL`, [partnerId])).rows[0].n);
}

// Every write a partner makes goes through this: the partnership is running,
// the agreement for this period is signed, and the action fits the type.
export async function assertPartnerCanAct(partnerId: string, need?: "organisations" | "affiliate" | "referral") {
  const p = (await pool.query(`SELECT * FROM channel_partners WHERE id = $1`, [partnerId])).rows[0];
  if (!p) throw new PartnerError("partner_not_found", 404);
  const s = partnershipStatus(p);
  if (s === "deactivated") throw new PartnerError("partner_deactivated", 409);
  if (!canAct(s)) throw new PartnerError("partnership_not_active", 409, { status: s });
  if (!(await currentAgreement(p))) throw new PartnerError("agreement_not_signed", 409);
  if (need === "organisations" && !bringsOrganisations(p.partner_type)) throw new PartnerError("not_for_partner_type", 403);
  if (need === "affiliate" && p.partner_type !== "affiliate") throw new PartnerError("not_for_partner_type", 403);
  if (need === "referral" && p.partner_type !== "referral") throw new PartnerError("not_for_partner_type", 403);
  return p as Record<string, any>;
}

const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "[start date]");
const money = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// The partnership agreement, filled in for this partner. The partner signs it
// in the app; the same text is the lawyer's draft (Legal Documents, folder 3).
export function agreementText(p: Record<string, any>) {
  const type = (p.partner_type ?? "channel_partner") as PartnerType;
  const label = PARTNER_TYPE_LABEL[type];
  const orgs = bringsOrganisations(type);
  const commercial: Record<PartnerType, string[]> = {
    reseller: [
      `The Reseller buys Spica licences and credits from Edstellar at Spica's list price less a discount of ${Number(p.discount_percent ?? 0)}%, and pays Edstellar for every order before the licences are allocated.`,
      "The Reseller sets its own selling price to its customers and invoices them itself. Edstellar does not invoice the Reseller's customers.",
      "The Reseller must follow Spica's published product descriptions, price list structure, licence rules and the Score Use Policy when it sells. [To confirm: whether a minimum resale price applies.]",
      "No commission is paid to a Reseller; its earnings are the difference between its buying and selling prices.",
    ],
    channel_partner: [
      "The Channel Partner brings universities, colleges and companies to Spica, gives them free demo licences from its allocation, and places paid orders for them at Spica's normal prices.",
      `Edstellar invoices the organisations (proforma, then tax invoice). The Channel Partner earns a commission of ${Number(p.commission_percent ?? 0)}% of the value, before tax, of each paid and confirmed order it placed.`,
      "Commission is paid after Edstellar receives payment, with a payment reference, as set out in the Channel Partner Programme rules.",
    ],
    affiliate: [
      "The Affiliate promotes Spica using its own referral link and code. A person is credited to the Affiliate when they sign up with the link or enter the code at sign-up or checkout. No tracking cookies are used.",
      `The Affiliate earns ${Number(p.commission_percent ?? 0)}% of the value, before tax, of each paid purchase made by a person credited to it during the partnership period. Refunded purchases earn nothing.`,
      "The Affiliate sees the date, product, amount and its commission for each purchase, never the person's name, contact details, scores or reports.",
      "The Affiliate must not make claims about Spica that are not in Spica's published materials, must not use paid search on Spica's or Edstellar's brand names, and must say clearly that it is paid for referrals.",
    ],
    referral: [
      "The Referral Partner introduces organisations by submitting their details in the partner portal, with the contact person's agreement to be contacted by Edstellar.",
      `When a referred organisation that Edstellar accepts as new completes its first paid purchase (licences or credits, bought directly or through a partner) within 6 months of the referral, the Referral Partner earns a fixed referral fee of ${money(Number(p.referral_fee ?? 0), p.referral_fee_currency ?? "USD")}. One fee per organisation. A purchase refunded in full earns no fee; a fee already paid on it is recovered.`,
      "Edstellar decides whether an introduction is new (not already a customer or an active lead, including another contact at the same company email domain). The Referral Partner does not sell, price or invoice anything.",
    ],
  };
  const sections: { h: string; items: string[] }[] = [
    {
      h: "1. Parties and purpose",
      items: [
        `This agreement is between Edstellar [legal entity name, address] ("Edstellar"), which runs Spica, and ${p.full_name} (${p.email}), the "${label}", partner code ${p.code}.`,
        `The ${label} works with Spica under the ${label} model described in section 4. It is not an employee, agent or legal representative of Edstellar and cannot make commitments for Edstellar.`,
      ],
    },
    {
      h: "2. Duration, expiry and renewal",
      items: [
        `The partnership runs from ${fmt(p.period_start ?? p.demo_starts_at)} to ${fmt(p.demo_ends_at)}.`,
        "Edstellar may renew it for a further period of its choosing. Each renewal needs this agreement to be signed again for the new period.",
        orgs
          ? `Renewal needs at least ${p.min_organisations ?? 10} organisations onboarded through the partner portal. Edstellar may renew below this minimum only for a recorded reason.`
          : "Renewal depends on the partner's activity and conduct during the period.",
        "If the partnership ends and is not renewed, the partner portal becomes read-only: the partner can still see its history, invoices and earnings, but cannot add organisations, give licences, place orders or submit introductions.",
      ],
    },
    {
      h: "3. Minimums fixed by Edstellar",
      items: orgs
        ? [
            `The ${label} must onboard at least ${p.min_organisations ?? 10} organisations during each partnership period.`,
            `Each organisation should reach at least ${p.min_licences_per_org ?? 1} licences in total (demo and paid licences together). Licences can be given in any amounts at a time.`,
            `Only organisations that have reached ${p.min_licences_per_org ?? 1} licences count towards the minimum number of organisations.`,
            "Only Edstellar staff can change these minimums.",
          ]
        : ["No organisation minimum applies to this partner type."],
    },
    { h: "4. Commercial terms", items: commercial[type] },
    ...(orgs
      ? [
          {
            h: "5. Demo licences",
            items: [
              `Edstellar gives the partner ${p.demo_licences ?? 0} free demo licences for the partnership period.`,
              "Demo licences given to an organisation must be used (given to learners) within 7 days of being given, with a further 3-day grace period. Licences not used by the end of the grace period expire.",
              "Each learner's demo lasts 7 days. For 3 more days the learner can sign in and see their results but cannot practise. After that the learner needs a paid licence to sign in.",
              "Demo licences give no real test and no certificate.",
            ],
          },
        ]
      : []),
    {
      h: `${orgs ? 6 : 5}. Responsibilities`,
      items: [
        "Describe Spica accurately, using Spica's published materials. Never call Spica certificates official, accredited or equivalent to another test.",
        "Only introduce organisations or people who have agreed to be contacted, and give them Spica's privacy notices where needed.",
        "Keep Spica sign-in details secret and use the portal only for the partner's own business.",
        "Edstellar provides the portal, product training, sales materials and support, and runs Spica for the organisations and learners.",
      ],
    },
    {
      h: `${orgs ? 7 : 6}. Data protection and confidentiality`,
      items: [
        "The partner sees only what its type needs: organisations' details and counts (Resellers, Channel Partners), anonymous purchase records (Affiliates) or the status of its introductions (Referral Partners). It never sees scores, reports, recordings or certificates.",
        "The partner keeps confidential everything it learns about Spica, Edstellar and Spica's customers, during and after the partnership, and uses personal data only for the partnership and as the Spica Privacy Notice for Partners describes.",
      ],
    },
    {
      h: `${orgs ? 8 : 7}. Termination`,
      items: [
        "Either side may end the partnership early with 30 days' written notice.",
        "Edstellar may end it at once if the partner breaches this agreement, misrepresents Spica, misuses data or acts in a way that harms Spica's customers or reputation.",
        "When the partnership ends, the portal becomes read-only. Organisations and learners keep the licences already given or paid for. Earnings for purchases paid before the end are paid as usual; nothing is earned after it.",
        "Sections on confidentiality and data protection continue after the end.",
      ],
    },
    {
      h: `${orgs ? 9 : 8}. General`,
      items: [
        "Edstellar may update the Spica price list and product rules; changes apply to orders placed after they are published.",
        "This agreement is governed by the laws of India, with courts at [city]. [Lawyer to confirm.]",
        "The English version of this agreement is the one that applies.",
      ],
    },
  ];
  return { version: AGREEMENT_VERSION, title: `Spica ${label} Agreement`, type, label, periodStart: p.period_start ?? p.demo_starts_at, periodEnd: p.demo_ends_at, sections };
}
