import { StatusPill } from "@/components/staff/StaffKit";
import { tr } from "@/i18n/tr";
import type { PartnerType, PartnershipStatus } from "@/api/channelPartners";

// Shared words for the four partner types (user, 19 Nov 2026).
export const typeLabel = (t: PartnerType) =>
  ({ reseller: tr("Reseller"), channel_partner: tr("Channel Partner"), affiliate: tr("Affiliate Partner"), referral: tr("Referral Partner") })[t] ?? t;

export const typeBlurb = (t: PartnerType) =>
  ({
    reseller: tr("Buys licences from Spica at a discount and resells them to its own customers at its own price."),
    channel_partner: tr("Brings organisations to Spica, gives them demo licences and places orders for them; earns a commission."),
    affiliate: tr("Promotes Spica with a link and code; earns a commission on purchases made through them."),
    referral: tr("Introduces organisations to Spica; earns a fixed fee when one completes its first paid purchase."),
  })[t] ?? "";

export const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

export const minorMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: currency === "INR" ? 0 : 2 }).format(minor / 100);

export function statusLabel(s: PartnershipStatus) {
  return {
    not_started: tr("Not started"),
    active: tr("Active"),
    expiring: tr("Ends soon"),
    expired: tr("Ended · read-only"),
    terminated: tr("Terminated · read-only"),
    deactivated: tr("Deactivated"),
  }[s];
}

export function PartnershipPill({ status, endsAt }: { status: PartnershipStatus; endsAt?: string | null }) {
  const tone = status === "active" ? "success" : status === "expiring" ? "warning" : status === "not_started" ? "muted" : "error";
  const days = endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000)) : null;
  return (
    <StatusPill tone={tone}>
      {statusLabel(status)}
      {(status === "active" || status === "expiring") && days !== null ? ` · ${tr("{{n}} days left", { n: days })}` : ""}
    </StatusPill>
  );
}

export const leadStatusLabel = (s: string) =>
  ({ submitted: tr("Submitted"), contacted: tr("Contacted"), won: tr("Won"), lost: tr("Lost"), duplicate: tr("Already known"), withdrawn: tr("Withdrawn") })[s] ?? s;
