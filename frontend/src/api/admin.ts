import type { LearnerDetails } from "@/api/details";
import { api } from "@/lib/api";
import type { BulkLearnerRow, BulkLearnerResult } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
export interface AdminStats {
  totalLearners: number;
  totalOrganizations: number;
  totalUniversities: number;
  totalAdmins: number;
  sessionsCompletedToday: number;
  partialSessionsToday: number;
  signupsThisWeek: number;
  activeNow: number;
}

export interface AdminPermissions {
  manageOrganizations?: boolean;
  inviteLearners?: boolean;
  viewLearnerInfo?: boolean;
  contentReview?: boolean;
  scoreReview?: boolean;
  viewReports?: boolean;
  manageAdmins?: boolean;
}

export const PERMISSION_LABELS: Record<keyof AdminPermissions, string> = {
  manageOrganizations: tr("Manage organizations"),
  inviteLearners: tr("Invite / bulk-upload learners"),
  viewLearnerInfo: tr("View learner information"),
  contentReview: tr("Content review"),
  scoreReview: tr("Score review"),
  viewReports: tr("View reports"),
  manageAdmins: tr("Manage Admins"),
};

export interface AdminAccount {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  department: string | null;
  permissions: AdminPermissions;
  managedOrgCount: number;
  managedOrgNames: string[];
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  region?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
  managedOrgIds?: string[];
}

export interface OnboardAdminPayload {
  email: string;
  firstName: string;
  lastName: string;
  department?: string;
  permissions: AdminPermissions;
  jobTitle?: string;
  phone?: string;
  region?: string;
  city?: string;
  country?: string;
  notes?: string;
  organizationIds?: string[];
}

export interface EditAdminPayload {
  firstName: string;
  lastName: string;
  department?: string;
  permissions: AdminPermissions;
  jobTitle?: string;
  phone?: string;
  region?: string;
  city?: string;
  country?: string;
  notes?: string;
  organizationIds?: string[];
}

export interface OrgAdminAccount {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantId: string;
  tenantName: string;
  tenantCategory: string | null;
  learnerCount: number;
  active: boolean;
  hasLoggedIn: boolean;
  managers: { id: string; name: string; learnerCount: number }[];
  createdAt: string;
  phone?: string | null;
  jobTitle?: string | null;
  planTier?: "starter" | "business" | "enterprise";
  orgActive?: boolean;
  lastLoginAt?: string | null;
  activeBatches?: number;
  ownerName?: string | null;
}

export interface ManagerAccount {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantName: string;
  tenantCategory: string | null;
  batchNames: string[];
  learnerCount: number;
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
  tenantId?: string;
  jobTitle?: string | null;
  lastLoginAt?: string | null;
  licensesAllotted?: number | null;
  licensesUsed?: number;
  activeLearners7d?: number;
}

export interface IndividualLearnerAccount {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  plan: string;
  sessionCount: number;
  active: boolean;
  createdAt: string;
}

export type ActivityKind = "signup" | "admin_created" | "session_completed" | "placement";

export interface AdminActivity {
  needsAttention: number;
  activityFeed: { kind: ActivityKind; who: string; detail: string | null; occurredAt: string }[];
  sessionsByType: { type: string; count: number }[];
  recentSignups: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    tenantName: string | null;
    tenantType: string | null;
    createdAt: string;
    active: boolean;
  }[];
}

export function getAdminStats(): Promise<AdminStats> {
  return api("/admin/stats");
}

export function getAdminActivity(): Promise<AdminActivity> {
  return api("/admin/activity");
}

export function getAdmins(): Promise<{ admins: AdminAccount[] }> {
  return api("/admin/admins");
}

export function onboardAdmin(payload: OnboardAdminPayload): Promise<{ id: string; email: string }> {
  return api("/admin/admins", { method: "POST", body: JSON.stringify(payload) });
}

export function editAdmin(id: string, payload: EditAdminPayload): Promise<{ id: string }> {
  return api(`/admin/admins/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteAdmin(id: string): Promise<void> {
  return api(`/admin/admins/${id}`, { method: "DELETE" });
}

export function reactivateAdmin(id: string): Promise<{ id: string }> {
  return api(`/admin/admins/${id}/reactivate`, { method: "POST" });
}

export interface BulkAdminRow {
  email: string;
  firstName: string;
  lastName: string;
  department?: string;
}

export interface BulkAdminResult {
  email: string;
  status: "created" | "duplicate" | "invalid";
  message?: string;
}

export function onboardAdminsBulk(rows: BulkAdminRow[]): Promise<{ results: BulkAdminResult[] }> {
  return api("/admin/admins/bulk", { method: "POST", body: JSON.stringify({ rows }) });
}

export function getOrgAdmins(): Promise<{ orgAdmins: OrgAdminAccount[] }> {
  return api("/admin/org-admins");
}

export function getManagers(): Promise<{ managers: ManagerAccount[] }> {
  return api("/admin/managers");
}

export interface AdminOnboardedOrg {
  id: string;
  name: string;
  category: string | null;
  learnerCount: number;
  orgAdmin: { id: string; email: string; name: string } | null;
  orgAdminStatus: "none" | "pending" | "active";
  active: boolean;
  managers: { id: string; name: string; email: string; learnerCount: number }[];
  createdAt: string;
}

export function getAdminActivityDetail(id: string): Promise<{ organizations: AdminOnboardedOrg[] }> {
  return api(`/admin/admins/${id}/activity`);
}

export interface OrgAdminDetail {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantName: string;
  tenantCategory: string | null;
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
}

export interface OrgAdminOnboardedManager {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  batchNames: string[];
  learnerCount: number;
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
}

export function getOrgAdminActivityDetail(id: string): Promise<{ orgAdmin: OrgAdminDetail; managers: OrgAdminOnboardedManager[] }> {
  return api(`/admin/org-admins/${id}/activity`);
}

export interface ManagerDetail {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantName: string;
  tenantCategory: string | null;
  batchNames: string[];
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
}

export interface ManagerOnboardedLearner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  batchName: string | null;
  sessionCount: number;
  active: boolean;
  createdAt: string;
}

export function getManagerActivityDetail(id: string): Promise<{ manager: ManagerDetail; learners: ManagerOnboardedLearner[] }> {
  return api(`/admin/managers/${id}/activity`);
}

export function getIndividualLearners(): Promise<{ learners: IndividualLearnerAccount[] }> {
  return api("/admin/learners");
}

export interface AdminConsoleOrg {
  id: string;
  name: string;
  category: string | null;
  learnerCount: number;
  hasOrgAdmin: boolean;
  orgAdminStatus: "none" | "pending" | "active";
  orgAdmin: { id: string; email: string; name: string; phone: string | null; jobTitle: string | null } | null;
  managers: { id: string; name: string; email: string; learnerCount: number }[];
  planTier: "starter" | "business" | "enterprise";
  products: ("skills" | "recruitment")[];
  assessmentCredits: number;
  candidatesInvited: number;
  health?: OrgHealth | null;
  pilotEndsAt: string | null;
  customPriceCents: number | null;
  legalName: string | null;
  website: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  employeeCountBand: string | null;
  trainingGoal: string | null;
  billingContactPhone: string | null;
  purchaseOrderRef: string | null;
  industry: string | null;
  expectedLearnerCount: number | null;
  country: string | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  taxId: string | null;
  active: boolean;
}

export interface AdminConsoleOverview {
  organizations: AdminConsoleOrg[];
  totalOrganizations: number;
  totalLearners: number;
  pendingInvitations: number;
  scopedToAssignedOrgs: boolean;
}

export function getAdminConsoleOverview(): Promise<AdminConsoleOverview> {
  return api("/admin/console/overview");
}

export interface ConsoleUserBreakdown {
  companyLearners: number;
  universityLearners: number;
  otherOrgLearners: number;
  individualLearners: number;
}

export function getConsoleUserBreakdown(): Promise<ConsoleUserBreakdown> {
  return api("/admin/console/user-breakdown");
}

export interface OnboardOrgPayload {
  name: string;
  // Employee skills, recruitment, or both.
  products?: ("skills" | "recruitment")[];
  initialCredits?: number;
  category: "company" | "university";
  industry?: string;
  expectedLearnerCount?: number;
  country?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  taxId?: string;
  legalName?: string;
  website?: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  employeeCountBand?: "1_50" | "51_200" | "201_1000" | "1001_5000" | "5000_plus";
  trainingGoal?: string;
  billingContactPhone?: string;
  purchaseOrderRef?: string;
  planTier?: "starter" | "business" | "enterprise";
  contractStart?: string;
  contractEnd?: string;
  contractValue?: number;
  contractCurrency?: string;
  ownerId?: string;
  orgAdmin: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    jobTitle?: string;
  };
}

export function onboardOrganization(payload: OnboardOrgPayload): Promise<{ tenantId: string; orgAdminId: string }> {
  return api("/admin/organizations", { method: "POST", body: JSON.stringify(payload) });
}

export interface EditOrgPayload {
  name: string;
  category: "company" | "university";
}

export function editOrganization(id: string, payload: EditOrgPayload): Promise<{ id: string }> {
  return api(`/admin/organizations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deactivateOrganization(id: string): Promise<void> {
  return api(`/admin/organizations/${id}`, { method: "DELETE" });
}

export function reactivateOrganization(id: string): Promise<{ id: string }> {
  return api(`/admin/organizations/${id}/reactivate`, { method: "POST" });
}

export interface ConsoleBatch {
  id: string;
  name: string;
  orgName: string;
}

export function getConsoleBatches(): Promise<{ batches: ConsoleBatch[] }> {
  return api("/admin/console/batches");
}

export interface ConsoleLearner {
  id: string;
  participantId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  type: "organization" | "university" | "individual";
  orgName: string;
  batchName: string | null;
  sessionCount: number;
  active: boolean;
  createdAt: string;
}

export function getConsoleLearners(): Promise<{ learners: ConsoleLearner[] }> {
  return api("/admin/console/learners");
}

export interface OnboardConsoleLearnerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchId: string;
}

export function onboardConsoleLearner(payload: OnboardConsoleLearnerPayload): Promise<{ id: string; email: string }> {
  return api("/admin/console/learners", { method: "POST", body: JSON.stringify(payload) });
}

export function onboardConsoleLearnersBulk(batchId: string, rows: BulkLearnerRow[]): Promise<{ results: BulkLearnerResult[] }> {
  return api("/admin/console/learners/bulk", { method: "POST", body: JSON.stringify({ batchId, rows }) });
}

export interface LearnerProfile {
  // Org learners only: what their organization records about them.
  employment?: LearnerDetails & { demographicsSource: "self" | "organization" | null };
  batchHistory?: { fromBatch: string | null; toBatch: string | null; reason: string | null; movedBy: string | null; movedAt: string }[];
  learner: {
    id: string;
    participantId: string | null;
    email: string;
    firstName: string | null;
    lastName: string | null;
    tenantName: string | null;
    tenantType: string | null;
    tenantCategory: string | null;
    batchName: string | null;
    active: boolean;
    createdAt: string;
  };
  onboarding: {
    complete: boolean;
    examPreference: string | null;
    goalLevel: string | null;
    scoreTarget: string | null;
    examReason: string | null;
    hasAppliedForExam: boolean | null;
    examDate: string | null;
    targetPrepDays: number | null;
    pastAttemptsStatus: string | null;
    prevScore: string | null;
    prevDate: string | null;
    dailyMinutesPreference: number | null;
    country: string | null;
    city: string | null;
    jobRole: string | null;
    gender: string | null;
    ageBand: string | null;
  } | null;
  placement: {
    cefrLevel: string;
    overallPercent: string;
    status: string;
    takenAt: string;
    skillPercents: Record<string, number>;
  } | null;
  roadmap: {
    pace: string;
    minutesPerDay: number;
    totalHoursEstimate: string;
    generatedAt: string;
  } | null;
  progress: {
    sessionsCount: number;
    questionsCompleted: number;
    practiceMinutes: string;
    streakDays: number;
    lastPracticeDate: string | null;
    totalXp: number;
    accuracyGraded: number;
    accuracyCorrect: number;
  } | null;
  skillStats: { skill: string; minutes: string; accuracyCorrect: number; accuracyGraded: number }[];
  activity: {
    totalSessions: number;
    genuinelyCompletedSessions: number;
    lastSessionAt: string | null;
    sessionsByType: { type: string; count: number }[];
  };
}

export function getLearnerProfile(id: string): Promise<LearnerProfile> {
  return api(`/admin/learners/${id}/profile`);
}

export function replaceOrgAdmin(
  tenantId: string,
  body: { email: string; firstName: string; lastName: string; phone?: string; jobTitle?: string },
): Promise<{ id: string }> {
  return api(`/admin/organizations/${tenantId}/org-admin`, { method: "POST", body: JSON.stringify(body) });
}

export function resendOrgAdminLink(tenantId: string): Promise<{ email: string }> {
  return api(`/admin/organizations/${tenantId}/org-admin/resend`, { method: "POST" });
}

export interface OrgAuditEntry {
  id: string;
  source: "action" | "license" | "plan";
  action: string;
  actorLabel: string | null;
  actorRole: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export function getOrgAudit(tenantId: string, before?: string): Promise<{ entries: OrgAuditEntry[]; hasMore: boolean }> {
  const p = new URLSearchParams({ limit: "25" });
  if (before) p.set("before", before);
  return api(`/admin/organizations/${tenantId}/audit?${p}`);
}

export interface QueueStats {
  counts: { queue: string; status: "queued" | "running" | "done" | "failed"; n: number }[];
  recentFailures: { id: number; queue: string; attempts: number; last_error: string | null; finished_at: string }[];
  readyBacklog: number;
  oldestReady: string | null;
}

export function getQueueStats(): Promise<QueueStats> {
  return api("/admin/jobs");
}

export function retryQueueJob(id: number): Promise<{ ok: true }> {
  return api(`/admin/jobs/${id}/retry`, { method: "POST" });
}

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  requiredByOrganization: boolean;
}

export const mfaApi = {
  status: () => api<MfaStatus>("/auth/mfa/status"),
  setup: () => api<{ secret: string; otpauthUrl: string; qrDataUrl: string }>("/auth/mfa/setup", { method: "POST" }),
  enable: (code: string) => api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: JSON.stringify({ code }) }),
  disable: (password: string, code: string) => api<{ enabled: false }>("/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password, code }) }),
  newRecoveryCodes: (code: string) => api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: JSON.stringify({ code }) }),
};

export interface OrgHealth {
  tenantId: string;
  score: number;
  band: "healthy" | "watch" | "at_risk";
  flags: string[];
  learners: number;
  active7: number;
  licenseUtilization: number | null;
  orgAdminLastLoginAt: string | null;
}

export interface OrgCommercial {
  contract: { start: string | null; end: string | null; valueCents: number | null; currency: string | null; notes: string | null };
  accountManager: { id: string; name: string } | null;
  accountManagerOptions: { id: string; name: string }[];
  orders: {
    id: string;
    provider: string;
    quoteNumber: string | null;
    poNumber: string | null;
    quantity: number;
    currency: string;
    total: number;
    status: string;
    dueDate: string | null;
    createdAt: string;
    invoiceId: string | null;
    invoiceNumber: string | null;
    credited: number;
  }[];
  health: OrgHealth | null;
}

export const commercialApi = {
  get: (tenantId: string) => api<OrgCommercial>(`/admin/organizations/${tenantId}/commercial`),
  update: (tenantId: string, body: Record<string, unknown>) =>
    api<{ ok: true }>(`/admin/organizations/${tenantId}/commercial`, { method: "PATCH", body: JSON.stringify(body) }),
  markPaid: (tenantId: string, orderId: string, reference: string) =>
    api(`/admin/organizations/${tenantId}/orders/${orderId}/mark-paid`, { method: "POST", body: JSON.stringify({ reference }) }),
  cancel: (tenantId: string, orderId: string) => api(`/admin/organizations/${tenantId}/orders/${orderId}/cancel`, { method: "POST" }),
  creditNote: (tenantId: string, invoiceId: string, body: { amount: number; licensesToRemove: number; reason: string }) =>
    api<{ creditNoteNumber: string }>(`/admin/organizations/${tenantId}/invoices/${invoiceId}/credit-notes`, { method: "POST", body: JSON.stringify(body) }),
  viewAs: (tenantId: string) => api<{ ok: true }>(`/admin/organizations/${tenantId}/view-as`, { method: "POST" }),
  health: () => api<{ organizations: (OrgHealth & { id: string; name: string })[] }>("/admin/health"),
};

// Monthly practice-test and mock-exam limits per segment and tier (Super Admin).
export interface PlanQuota {
  segment: "individual" | "company" | "university";
  tier: string;
  practicePerMonth: number | null;
  mocksPerMonth: number | null;
  reportLevel: "summary" | "full";
  updatedAt: string;
}

export function getPlanQuotas(): Promise<{ quotas: PlanQuota[] }> {
  return api("/admin/plan-quotas");
}

export function savePlanQuota(q: Pick<PlanQuota, "segment" | "tier" | "practicePerMonth" | "mocksPerMonth" | "reportLevel">) {
  return api(`/admin/plan-quotas/${q.segment}/${q.tier}`, {
    method: "PUT",
    body: JSON.stringify({ practicePerMonth: q.practicePerMonth, mocksPerMonth: q.mocksPerMonth, reportLevel: q.reportLevel }),
  });
}
