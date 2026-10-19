import { api } from "@/lib/api";

import { tr } from "@/i18n/tr";
export type AccessStatus = "active" | "grace" | "expired" | "none";

export interface LearnerAccess {
  status: AccessStatus;
  accessEndsAt: string | null;
  graceEndsAt: string | null;
  currentEndsAt: string | null;
  queuedMonths: number;
  totalMonths: number;
}

export interface PoolSummary {
  reservedForBatches: number;
  reservedForManagers: number;
  unreserved: number;
  purchased: number;
  available: number;
  assigned: number;
  expiredUnused: number;
  nextPoolExpiry: string | null;
  nextPoolExpiryQuantity: number;
  activeLearners: number;
  graceLearners: number;
  expiredLearners: number;
  unlicensedLearners: number;
  expiringSoonLearners: number;
  queuedMonths: number;
}

export interface LicensePurchase {
  id: string;
  quantity: number;
  used: number;
  remaining: number;
  unitPriceCents: number;
  totalCents: number;
  currency: string;
  source: "purchase" | "credit" | "comp";
  reference: string | null;
  note: string | null;
  createdBy: string | null;
  purchasedAt: string;
  poolExpiresAt: string;
  poolExpired: boolean;
}

export interface LicenseEvent {
  id: string;
  kind: "purchase" | "credit" | "comp" | "assign" | "extend" | "reclaim" | "budget";
  quantity: number;
  learnerEmail: string | null;
  batchName: string | null;
  actor: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
}

export interface LearnerLicenseRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  participantId: string | null;
  active: boolean;
  batchId: string | null;
  batchName: string | null;
  license: LearnerAccess;
}

export interface BatchBudget {
  batchId: string;
  batchName: string;
  batchCode: string;
  status?: "active" | "completed" | "archived";
  budget: number | null;
  used: number;
  remaining: number | null;
}

export interface ManagerPool {
  managerId: string;
  name: string;
  email: string;
  allotment: number | null;
  used: number;
  remaining: number | null;
}

export interface OrgLicenseOverview {
  managers: ManagerPool[];
  summary: PoolSummary;
  purchases: LicensePurchase[];
  learners: LearnerLicenseRow[];
  events: LicenseEvent[];
  batches: BatchBudget[];
  pricePerLicenseCents: number;
}

export interface FreeTierUsage {
  practiceUsed: number;
  practiceLimit: number;
  hasOpenPractice: boolean;
  placementTaken: boolean;
}

export type MyLicense = LearnerAccess & { required: boolean; individual: boolean; freeTier: FreeTierUsage | null };

export function getMyLicense(): Promise<MyLicense> {
  return api("/licenses/me");
}

export type KeepGoingReason = "access_expired" | "access_grace" | "access_ending" | "quota_mocks" | "quota_practice" | "tests_done" | "exam_near";

// What a learner needs to keep going (more time or tests) and how to get it.
export interface KeepGoing {
  kind: "org" | "individual" | "other";
  reasons: KeepGoingReason[];
  access: { status: AccessStatus; accessEndsAt: string | null; graceEndsAt: string | null; daysLeft: number | null };
  goal: { current: string | null; goal: string | null; reached: boolean; examDays: number | null };
  quota: { practiceLeft: number | null; mocksLeft: number | null; resetsOn: string } | null;
  sets: { total: number; done: number };
  // An organization learner's latest request for more time.
  request: { id: string; months: number; status: "pending" | "approved" | "rejected" | "cancelled"; createdAt: string; decidedAt: string | null; note: string | null } | null;
}

export function getKeepGoing(): Promise<KeepGoing> {
  return api("/licenses/me/keep-going");
}

export function requestMoreTime(months: 1 | 3, reason: string): Promise<{ id: string }> {
  return api("/licenses/me/request", { method: "POST", body: JSON.stringify({ months, reason }) });
}

export function getOrgLicenseOverview(): Promise<OrgLicenseOverview> {
  return api("/licenses/org/overview");
}

export function getOrgLicenseSummary(): Promise<PoolSummary> {
  return api("/licenses/org/summary");
}

export function orgAssignLicenses(learnerId: string, months: number): Promise<{ kind: "assign" | "extend"; accessEndsAt: string }> {
  return api(`/licenses/org/learners/${learnerId}/assign`, { method: "POST", body: JSON.stringify({ months }) });
}

export function orgReclaimLicenses(learnerId: string, months: number, reason: string): Promise<{ reclaimed: number }> {
  return api(`/licenses/org/learners/${learnerId}/reclaim`, { method: "POST", body: JSON.stringify({ months, reason }) });
}

export function setBatchBudget(batchId: string, budget: number | null): Promise<{ budget: number | null }> {
  return api(`/licenses/org/batches/${batchId}/budget`, { method: "PATCH", body: JSON.stringify({ budget }) });
}

export function setManagerPoolAllotment(managerId: string, allotment: number | null): Promise<{ allotment: number | null }> {
  return api(`/licenses/org/managers/${managerId}/allotment`, { method: "PATCH", body: JSON.stringify({ allotment }) });
}

export function getManagerLicenseOverview(): Promise<{ batches: BatchBudget[]; learners: LearnerLicenseRow[]; myPool: ManagerPool | undefined }> {
  return api("/licenses/manager/overview");
}

export function managerAssignLicenses(learnerId: string, months: number): Promise<{ kind: "assign" | "extend"; accessEndsAt: string }> {
  return api(`/licenses/manager/learners/${learnerId}/assign`, { method: "POST", body: JSON.stringify({ months }) });
}

export function getAdminOrgLicenses(
  tenantId: string,
): Promise<{ summary: PoolSummary; purchases: LicensePurchase[]; events: LicenseEvent[]; pricePerLicenseCents: number }> {
  return api(`/licenses/admin/orgs/${tenantId}`);
}

export function creditOrgLicenses(
  tenantId: string,
  body: {
    quantity: number;
    source: "purchase" | "credit" | "comp";
    unitPriceCents?: number;
    reference?: string;
    note?: string;
    validityMonths?: number;
  },
): Promise<{ id: string }> {
  return api(`/licenses/admin/orgs/${tenantId}/credit`, { method: "POST", body: JSON.stringify(body) });
}

export const LICENSE_ERROR_TEXT: Record<string, string> = {
  insufficient_licenses: tr("Not enough licenses in the pool."),
  insufficient_unreserved: tr("Not enough unreserved licenses — the rest are set aside for batches and Managers. Buy more or reduce an allotment."),
  below_used: tr("Can't go below what's already been assigned from it."),
  no_budget: tr("No licenses allotted to you or this batch yet — request some from your Org Admin."),
  budget_exceeded: tr("Not enough licenses left in this batch's allotment or your pool — request more from your Org Admin."),
  nothing_to_reclaim: tr("No unstarted months to reclaim — the current month can't be returned."),
  learner_not_found: tr("Learner not found."),
};

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

export function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export type LicenseRequestKind = "increase_allotment" | "decrease_allotment" | "unassign_learner" | "learner_extension";

export interface LicenseRequest {
  id: string;
  kind: LicenseRequestKind;
  quantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  batchId: string | null;
  batchName: string | null;
  batchAllotment: number | null;
  batchUsed: number;
  learnerId: string | null;
  learnerName: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedQuantity: number | null;
  createdAt: string;
}

export function requestLicenseChange(body: {
  kind: LicenseRequestKind;
  quantity: number;
  batchId?: string | null;
  learnerId?: string | null;
  reason: string;
}): Promise<{ id: string }> {
  return api("/licenses/manager/requests", { method: "POST", body: JSON.stringify(body) });
}

export function getMyLicenseRequests(): Promise<{ requests: LicenseRequest[] }> {
  return api("/licenses/manager/requests");
}

export function cancelLicenseRequest(id: string): Promise<void> {
  return api(`/licenses/manager/requests/${id}/cancel`, { method: "POST" });
}

export function getOrgLicenseRequests(): Promise<{ requests: LicenseRequest[]; pending: number }> {
  return api("/licenses/org/requests");
}

export function decideLicenseRequest(id: string, approve: boolean, note?: string): Promise<{ status: string; appliedQuantity: number | null }> {
  return api(`/licenses/org/requests/${id}/${approve ? "approve" : "reject"}`, { method: "POST", body: JSON.stringify({ note }) });
}

export function describeLicenseRequest(r: Pick<LicenseRequest, "kind" | "quantity" | "batchName" | "learnerName">): string {
  const n = `${r.quantity} license${r.quantity === 1 ? "" : "s"}`;
  const target = r.batchName ?? tr("the Manager's own pool");
  if (r.kind === "increase_allotment") return tr("{{n}} more for {{target}}", { n: n, target: target });
  if (r.kind === "decrease_allotment") return tr("{{n}} fewer for {{target}}", { n: n, target: target });
  if (r.kind === "learner_extension")
    return r.quantity === 1 ? tr("1 more month of access for {{name}}", { name: r.learnerName ?? tr("a learner") }) : tr("{{n}} more months of access for {{name}}", { n: r.quantity, name: r.learnerName ?? tr("a learner") });
  return tr("Return {{quantity}} unused month{{v}} from {{v2}}", { quantity: r.quantity, v: r.quantity === 1 ? "" : "s", v2: r.learnerName ?? "a learner" });
}

export const REQUEST_STATUS_CLASS: Record<LicenseRequest["status"], string> = {
  pending: "bg-warning/15 text-navy-deep",
  approved: "bg-success/15 text-success",
  rejected: "bg-error/15 text-error",
  cancelled: "bg-muted/15 text-muted",
};
