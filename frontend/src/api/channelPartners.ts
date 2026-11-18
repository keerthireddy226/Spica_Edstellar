import { api } from "@/lib/api";

export type DemoStatus = "not_started" | "active" | "ended";

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
}

export interface ChannelPartnerDetail {
  partner: ChannelPartner;
  organisations: import("@/pages/partner/PartnerDashboard").PartnerOrg[];
  history: { action: string; by: string | null; details: Record<string, unknown>; at: string }[];
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const listChannelPartners = () => api<{ partners: ChannelPartner[] }>("/admin/channel-partners");
export const getChannelPartner = (id: string) => api<ChannelPartnerDetail>(`/admin/channel-partners/${id}`);
export const createChannelPartner = (b: {
  fullName: string;
  email: string;
  commissionPercent: number;
  demoLicences: number;
  startDemoNow: boolean;
  demoEndsAt?: string;
  ownLicenceEnabled: boolean;
  notes?: string;
}) => api<{ id: string; code: string; emailSent: boolean }>("/admin/channel-partners", json(b));
export const updateChannelPartner = (id: string, b: Partial<Pick<ChannelPartner, "fullName" | "commissionPercent" | "demoLicences" | "ownLicenceEnabled" | "notes">>) =>
  api<{ id: string }>(`/admin/channel-partners/${id}`, { ...json(b), method: "PATCH" });
export const startDemo = (id: string, endsAt?: string) => api(`/admin/channel-partners/${id}/demo/start`, json(endsAt ? { endsAt } : {}));
export const extendDemo = (id: string, endsAt: string) => api(`/admin/channel-partners/${id}/demo/extend`, json({ endsAt }));
export const endDemo = (id: string) => api(`/admin/channel-partners/${id}/demo/end`, json({}));
export const deactivatePartner = (id: string) => api(`/admin/channel-partners/${id}/deactivate`, json({}));
export const reactivatePartner = (id: string) => api(`/admin/channel-partners/${id}/reactivate`, json({}));
export const resendPartnerInvite = (id: string) => api(`/admin/channel-partners/${id}/resend-invite`, json({}));
