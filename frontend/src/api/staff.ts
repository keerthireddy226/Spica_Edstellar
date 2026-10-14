import { api } from "@/lib/api";
import type { LearnerAccess } from "@/api/licenses";
import type { PlanTier } from "@/api/plans";

// Edstellar staff consoles (Super Admin and Admin).

export interface StaffPermissions {
  manageOrganizations: boolean;
  inviteLearners: boolean;
  viewLearnerInfo: boolean;
  contentReview: boolean;
  scoreReview: boolean;
  viewReports: boolean;
}

export interface Money {
  currency: string;
  thisMonth: number;
  lastMonth: number;
  thisYear: number;
}

export interface Portfolio {
  scope: "platform" | "portfolio";
  permissions: StaffPermissions;
  organizations: {
    active: number;
    deactivated: number;
    companies: number;
    universities: number;
    pilots: number;
    byTier: { tier: PlanTier; count: number }[];
    healthy: number;
    watch: number;
    atRisk: number;
  };
  learners: { total: number; active7: number; new7: number };
  individuals: { total: number; paid: number; active7: number; new7: number };
  licenses: { bought: number; assigned: number; utilization: number | null; expiringUnused: number };
  revenue: Money[];
  outstanding: { currency: string; count: number; total: number; overdue: number }[];
  pendingReviews: number;
  renewals: { id: string; name: string; contractEnd: string; ownerName: string | null }[];
  attention: { kind: string; orgId: string | null; title: string; detail: string }[];
  health: { id: string; name: string; score: number; band: "healthy" | "watch" | "at_risk"; flags: string[]; learners: number; active7: number }[];
  trend: { week: string; signups: number; active: number }[];
  recent: { action: string; actorLabel: string | null; actorRole: string | null; targetLabel: string | null; orgName: string | null; createdAt: string }[];
  admins:
    | {
        id: string;
        name: string;
        email: string;
        department: string | null;
        active: boolean;
        lastLoginAt: string | null;
        organizations: number;
        learners: number;
        atRisk: number;
      }[]
    | null;
  system: { failedJobs: number; readyJobs: number } | null;
}

export const getPortfolio = () => api<Portfolio>("/admin/portfolio");

export interface OrgMetrics {
  id: string;
  createdAt: string;
  contractEnd: string | null;
  owner: { id: string; name: string } | null;
  accountManager: { id: string; name: string } | null;
  activeBatches: number;
  managers: number;
  active7: number;
  licensesBought: number;
  licensesAssigned: number;
  unpaidInvoices: number;
  lastActivityAt: string | null;
}

export const getOrgMetrics = () => api<{ metrics: OrgMetrics[] }>("/admin/organizations/metrics");
export const getStaffAdmins = () => api<{ admins: { id: string; name: string; email: string }[] }>("/admin/staff");
export const setOrgOwner = (orgId: string, adminId: string) =>
  api<{ id: string }>(`/admin/organizations/${orgId}/owner`, { method: "PATCH", body: JSON.stringify({ adminId }) });

export interface BillingOrder {
  id: string;
  kind: "org_licenses" | "individual_plan";
  tenantId: string;
  orgName: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  quantity: number;
  currency: string;
  total: number;
  status: "created" | "paid";
  provider: string;
  createdAt: string;
  paidAt: string | null;
  dueDate: string | null;
  overdue: boolean;
  poNumber: string | null;
  quoteNumber: string | null;
  paymentReference: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface BillingContract {
  id: string;
  name: string;
  contractStart: string | null;
  contractEnd: string;
  valueCents: number | null;
  currency: string | null;
  planTier: PlanTier;
  ownerName: string | null;
}

export const getStaffBilling = () => api<{ orders: BillingOrder[]; contracts: BillingContract[] }>("/admin/billing");

export interface StaffAuditEntry {
  id: string;
  action: string;
  actorLabel: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  tenantId: string | null;
  orgName: string | null;
}

export interface StaffAuditFilters {
  action?: string;
  tenantId?: string;
  actorRole?: string;
  from?: string;
  to?: string;
  before?: string;
}

export function getStaffAudit(f: StaffAuditFilters) {
  const p = new URLSearchParams({ limit: "50" });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return api<{ entries: StaffAuditEntry[]; hasMore: boolean }>(`/admin/audit?${p}`);
}

export interface IndividualLearner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  participantId: string | null;
  plan: "free" | "paid" | "complimentary";
  active: boolean;
  hasLoggedIn: boolean;
  lastActiveOn: string | null;
  sessions: number;
  cefr: string | null;
  source: "invited" | "signup";
  invitedByName: string | null;
  paidTotal: number;
  paidCurrency: string | null;
  license?: LearnerAccess;
  createdAt: string;
}

export const getIndividuals = () => api<{ learners: IndividualLearner[] }>("/admin/individuals");
export const inviteIndividual = (body: { email: string; firstName: string; lastName: string; compMonths: number }) =>
  api<{ id: string; email: string; accessError: string | null }>("/admin/individuals", { method: "POST", body: JSON.stringify(body) });
export const inviteIndividualsBulk = (compMonths: number, rows: { email: string; firstName: string; lastName: string }[]) =>
  api<{ results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string; licenseError?: string | null }[] }>("/admin/individuals/bulk", {
    method: "POST",
    body: JSON.stringify({ compMonths, rows }),
  });
export const validateIndividualEmails = (emails: string[]) =>
  api<{ existing: string[] }>("/admin/individuals/bulk/validate", { method: "POST", body: JSON.stringify({ emails }) });
export const grantIndividualAccess = (id: string, months: number) =>
  api<{ id: string }>(`/admin/individuals/${id}/access`, { method: "POST", body: JSON.stringify({ months }) });
export const deactivateIndividual = (id: string) => api<{ id: string }>(`/admin/individuals/${id}/deactivate`, { method: "POST" });
export const reactivateIndividual = (id: string) => api<{ id: string }>(`/admin/individuals/${id}/reactivate`, { method: "POST" });
export const resendIndividualInvite = (id: string) => api<{ id: string; email: string }>(`/admin/individuals/${id}/resend-invite`, { method: "POST" });

export interface OrgLearnerRow {
  id: string;
  participantId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  type: "organization" | "university";
  orgName: string;
  batchName: string | null;
  sessionCount: number;
  active: boolean;
  createdAt: string;
  tenantId: string;
  batchId: string | null;
  department: string | null;
  employeeId: string | null;
  hasLoggedIn: boolean;
  lastActiveOn: string | null;
  cefr: string | null;
  license?: LearnerAccess;
}

export const getStaffOrgLearners = () => api<{ learners: OrgLearnerRow[] }>("/admin/console/learners");

export function money(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / 100);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}
