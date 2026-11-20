import { api } from "@/lib/api";

export type DemoStatus = "not_started" | "active" | "ended";
export type PartnerType = "reseller" | "channel_partner" | "affiliate" | "referral";
export type PartnershipStatus = "not_started" | "active" | "expiring" | "expired" | "terminated" | "deactivated";
export const PARTNER_TYPES: PartnerType[] = ["reseller", "channel_partner", "affiliate", "referral"];
// Types that onboard organisations, give demo licences and place orders.
export const bringsOrganisations = (t: PartnerType) => t === "reseller" || t === "channel_partner";

export interface ChannelPartner {
  id: string;
  fullName: string;
  email: string;
  code: string;
  commissionPercent: number;
  demoLicences: number;
  demoLicencesGiven: number;
  demoStartsAt: string | null;
  demoEndsAt: string | null;
  demoEndedAt: string | null;
  demoStatus: DemoStatus;
  ownLicenceEnabled: boolean;
  notes: string | null;
  active: boolean;
  deactivatedAt: string | null;
  organisations: number;
  invitePending: boolean;
  lastSignIn: string | null;
  createdAt: string;
  createdBy: string | null;
  partnerType: PartnerType;
  partnerTypeLabel: string;
  status: PartnershipStatus;
  startsAt: string | null;
  endsAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  minOrganisations: number;
  minLicencesPerOrg: number;
  // Organisations at the licence minimum (they count); addedOrganisations = all active ones.
  activeOrganisations: number;
  addedOrganisations?: number;
  discountPercent: number;
  referralFee: number;
  referralFeeCurrency: "INR" | "USD";
  agreement: { signedAt: string; signedName: string; version: string; periodEnd: string | null } | null;
  lastSignedAt: string | null;
  leads: number;
  referredPeople: number;
}

export interface PartnerLead {
  id: string;
  organisationName: string;
  category: "university" | "company";
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  country: string;
  expectedLearners: number | null;
  notes: string | null;
  status: "submitted" | "contacted" | "won" | "lost" | "duplicate";
  createdAt: string;
  updatedAt: string;
  tenantId?: string | null;
  tenantName?: string | null;
  staffNote?: string | null;
}

export interface PartnerEarning {
  id: string;
  kind: "affiliate_sale" | "referral_fee";
  description: string;
  baseAmount: number;
  rate: number | null;
  amount: number;
  currency: string;
  earnedAt: string;
  status: "earned" | "paid" | "void";
  paidAt: string | null;
  paidReference: string | null;
  voidReason: string | null;
}
export interface EarningsResponse {
  earnings: PartnerEarning[];
  totals: Record<string, { earned: number; paid: number }>;
}

export interface ChannelPartnerDetail {
  partner: ChannelPartner;
  organisations: import("@/pages/partner/PartnerDashboard").PartnerOrg[];
  renewals: { previousEnd: string | null; newEnd: string; organisations: number; minOrganisations: number; overrideReason: string | null; at: string; by: string | null }[];
  agreements: { version: string; signedName: string; signedEmail: string; signedAt: string; periodStart: string | null; periodEnd: string | null; ip: string | null }[];
  history: { action: string; by: string | null; details: Record<string, unknown>; at: string }[];
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const listChannelPartners = () => api<{ partners: ChannelPartner[] }>("/admin/channel-partners");
export const getChannelPartner = (id: string) => api<ChannelPartnerDetail>(`/admin/channel-partners/${id}`);
export interface PartnerTerms {
  minOrganisations: number;
  minLicencesPerOrg: number;
  discountPercent: number;
  referralFee: number;
  referralFeeCurrency: "INR" | "USD";
}
export const createChannelPartner = (b: {
  partnerType: PartnerType;
  fullName: string;
  email: string;
  commissionPercent: number;
  demoLicences: number;
  startDemoNow: boolean;
  ownLicenceEnabled: boolean;
  notes?: string;
} & PartnerTerms) => api<{ id: string; code: string; emailSent: boolean }>("/admin/channel-partners", json(b));
export const updateChannelPartner = (id: string, b: Partial<Pick<ChannelPartner, "fullName" | "commissionPercent" | "demoLicences" | "ownLicenceEnabled" | "notes"> & PartnerTerms>) =>
  api<{ id: string }>(`/admin/channel-partners/${id}`, { ...json(b), method: "PATCH" });
export const startPartnership = (id: string) => api(`/admin/channel-partners/${id}/demo/start`, json({}));
export const renewPartnership = (id: string, overrideReason?: string) => api<{ endsAt: string; override: boolean }>(`/admin/channel-partners/${id}/renew`, json(overrideReason ? { overrideReason } : {}));
export const terminatePartnership = (id: string, reason: string) => api(`/admin/channel-partners/${id}/terminate`, json({ reason }));
export const partnerLeads = (id: string) => api<{ leads: PartnerLead[] }>(`/admin/channel-partners/${id}/leads`);
export const updatePartnerLead = (leadId: string, b: { status?: PartnerLead["status"]; tenantId?: string | null; staffNote?: string | null }) =>
  api(`/admin/partner-leads/${leadId}`, { ...json(b), method: "PATCH" });
export const partnerEarnings = (id: string) => api<EarningsResponse>(`/admin/channel-partners/${id}/earnings`);
export const markEarningPaid = (earningId: string, reference: string) => api(`/admin/partner-earnings/${earningId}/paid`, json({ reference }));
export const voidEarning = (earningId: string, reason: string) => api(`/admin/partner-earnings/${earningId}/void`, json({ reason }));
export const deactivatePartner = (id: string) => api(`/admin/channel-partners/${id}/deactivate`, json({}));
export const reactivatePartner = (id: string) => api(`/admin/channel-partners/${id}/reactivate`, json({}));
export const resendPartnerInvite = (id: string) => api(`/admin/channel-partners/${id}/resend-invite`, json({}));
