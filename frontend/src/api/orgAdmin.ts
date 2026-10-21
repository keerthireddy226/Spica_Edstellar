import type { CertifiedSummary } from "@/components/CertifiedCell";
import { api } from "@/lib/api";
import type { ActivityKind, LearnerProfile, ManagerDetail, ManagerOnboardedLearner } from "@/api/admin";
import type { LearnerAccess } from "@/api/licenses";
import type { BatchDetails, BatchLicenseStats, ExamFocus, LearnerDetails } from "@/api/details";
import type { Program, ReportResponse } from "@/api/practiceTests";

// Batch fields beyond the basics, as the API returns them.
export interface BatchExtras {
  description: string | null;
  department: string | null;
  location: string | null;
  examFocus: ExamFocus | null;
  weeklyMinutesGoal: number | null;
  capacity: number | null;
  defaultLicenseMonths: number | null;
  autoReminders: boolean;
}

export interface OrgAdminOverview {
  organizationName: string | null;
  onboardedBy: { id: string; email: string; name: string } | null;
  totalBatches: number;
  totalManagers: number;
  totalLearners: number;
  sessionsCompletedToday: number;
  activityFeed: { kind: ActivityKind; who: string; detail: string | null; occurredAt: string }[];
}

export function getOrgOverview(): Promise<OrgAdminOverview> {
  return api("/org-admin/overview");
}

export function updateOrganizationName(name: string): Promise<{ name: string }> {
  return api("/org-admin/organization", { method: "PATCH", body: JSON.stringify({ name }) });
}

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface OrgBatch extends BatchExtras {
  id: string;
  name: string;
  batchCode: string;
  startCefr: CefrLevel | null;
  targetCefr: CefrLevel | null;
  durationMonths: number | null;
  startDate: string | null;
  targetCutScore: number | null;
  learnerCount: number;
  managerNames: string[];
  createdAt: string;
  status: BatchStatus;
  endDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  fixedLicenses: number | null;
  licenses: BatchLicenseStats;
  createdBy: { name: string; role: string } | null;
}

export type BatchStatus = "active" | "completed" | "archived";

export function getBatches(): Promise<{ batches: OrgBatch[] }> {
  return api("/org-admin/batches");
}

export type CreateBatchPayload = BatchDetails & { licenseAllotment?: number };

export function createBatch(payload: CreateBatchPayload): Promise<{ id: string }> {
  return api("/org-admin/batches", { method: "POST", body: JSON.stringify(payload) });
}

export interface OrgBatchDetail extends BatchExtras {
  licenses: BatchLicenseStats;
  id: string;
  name: string;
  fixedLicenses: number | null;
  fixedLicensesUsed: number;
  assignments?: { total: number; fromFixed: number; fromManagerPools: number; fromOrgPool: number; used: number; notStarted: number };
  batchCode: string;
  startCefr: CefrLevel | null;
  targetCefr: CefrLevel | null;
  durationMonths: number | null;
  startDate: string | null;
  targetCutScore: number | null;
  managerNames: string[];
  createdAt: string;
  status: BatchStatus;
  endDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface OrgBatchLearner extends LearnerDetails {
  hasLoggedIn?: boolean;
  id: string;
  license?: LearnerAccess;
  participantId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  sessionCount: number;
  active: boolean;
  createdAt: string;
}

export function getBatchDetail(id: string): Promise<{ batch: OrgBatchDetail; learners: OrgBatchLearner[] }> {
  return api(`/org-admin/batches/${id}`);
}

export function deleteBatch(id: string): Promise<{ id: string }> {
  return api(`/org-admin/batches/${id}`, { method: "DELETE" });
}

export interface OrgManager {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  batchNames: string[];
  batchIds: string[];
  licensesAllotted: number | null;
  licensesUsed: number;
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
  jobTitle?: string | null;
  phone?: string | null;
  lastLoginAt?: string | null;
  learnerCount?: number;
  activeLearners7d?: number;
  pendingRequests?: number;
  invitedByName?: string | null;
  department?: string | null;
  city?: string | null;
}

export function getManagers(): Promise<{ managers: OrgManager[] }> {
  return api("/org-admin/managers");
}

export interface OnboardManagerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchIds: string[];
  licenseAllotment?: number | null;
  phone?: string;
  jobTitle?: string;
  department?: string;
  city?: string;
}

export function updateManager(id: string, payload: Omit<OnboardManagerPayload, "email">): Promise<{ id: string }> {
  return api(`/org-admin/managers/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function onboardManager(payload: OnboardManagerPayload): Promise<{ id: string; email: string }> {
  return api("/org-admin/managers", { method: "POST", body: JSON.stringify(payload) });
}

export function getOrgManagerDetail(id: string): Promise<{ manager: ManagerDetail; learners: ManagerOnboardedLearner[] }> {
  return api(`/org-admin/managers/${id}`);
}

export function deleteManager(id: string): Promise<{ id: string; releasedLicenses?: number }> {
  return api(`/org-admin/managers/${id}`, { method: "DELETE" });
}

export function deactivateManager(id: string): Promise<{ id: string; releasedLicenses?: number }> {
  return api(`/org-admin/managers/${id}/deactivate`, { method: "POST" });
}

export function reactivateManager(id: string): Promise<{ id: string }> {
  return api(`/org-admin/managers/${id}/reactivate`, { method: "POST" });
}

export interface OrgLearner extends LearnerDetails {
  id: string;
  // Their latest final assessment certificate.
  certified?: CertifiedSummary | null;
  batchId?: string | null;
  participantId: string | null;
  license?: LearnerAccess;
  email: string;
  firstName: string | null;
  lastName: string | null;
  batchName: string | null;
  sessionCount: number;
  active: boolean;
  hasLoggedIn?: boolean;
  createdAt: string;
}

export function getOrgLearners(): Promise<{ learners: OrgLearner[] }> {
  return api("/org-admin/learners");
}

// Shared row/result shapes for CSV bulk-upload flows elsewhere (e.g. the
// Admin console's own bulk invite) — Org Admins no longer onboard learners
// themselves, so no onboarding function lives in this file anymore.
export interface BulkLearnerRow extends Partial<LearnerDetails> {
  email: string;
  firstName: string;
  lastName: string;
}

export interface BulkLearnerResult {
  email: string;
  status: "created" | "duplicate" | "invalid";
  message?: string;
  licenseError?: string | null;
}

export function getOrgLearnerDetail(id: string): Promise<LearnerProfile> {
  return api(`/org-admin/learners/${id}`);
}

export function updateOrgLearnerDetails(id: string, d: LearnerDetails): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}/details`, { method: "PATCH", body: JSON.stringify(d) });
}

export function deleteLearner(id: string): Promise<{ id: string; reclaimedMonths?: number }> {
  return api(`/org-admin/learners/${id}`, { method: "DELETE" });
}

export function deactivateLearner(id: string): Promise<{ id: string; reclaimedMonths?: number }> {
  return api(`/org-admin/learners/${id}/deactivate`, { method: "POST" });
}

export function reactivateLearner(id: string): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}/reactivate`, { method: "POST" });
}

export function moveLearner(id: string, batchId: string, reason?: string): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}/move`, { method: "POST", body: JSON.stringify({ batchId, reason }) });
}

export type EmployeeCountBand = "1_50" | "51_200" | "201_1000" | "1001_5000" | "5000_plus";

export interface OrganizationProfile {
  name: string;
  category: string | null;
  legalName: string | null;
  industry: string | null;
  employeeCountBand: EmployeeCountBand | null;
  expectedLearnerCount: number | null;
  website: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  trainingGoal: string | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingContactPhone: string | null;
  purchaseOrderRef: string | null;
  createdAt: string;
}

export type OrganizationProfileUpdate = Partial<Omit<OrganizationProfile, "category" | "createdAt">>;

export function getOrganization(): Promise<OrganizationProfile> {
  return api("/org-admin/organization");
}

export function updateOrganization(update: OrganizationProfileUpdate): Promise<OrganizationProfile> {
  return api("/org-admin/organization", { method: "PATCH", body: JSON.stringify(update) });
}

export interface OrgAdminContact {
  phone: string | null;
  jobTitle: string | null;
}

export function getOrgAdminContact(): Promise<OrgAdminContact> {
  return api("/org-admin/me");
}

export function updateOrgAdminContact(contact: OrgAdminContact): Promise<OrgAdminContact> {
  return api("/org-admin/me", { method: "PATCH", body: JSON.stringify(contact) });
}

export interface OrgInviteOptions {
  batchId: string | null;
  licenseMonths: number;
}

export function inviteLearner(
  payload: OrgInviteOptions & { email: string; firstName: string; lastName: string; details?: Partial<LearnerDetails> },
): Promise<{ id: string; email: string; licenseError: string | null }> {
  return api("/org-admin/learners", { method: "POST", body: JSON.stringify(payload) });
}

export function inviteLearnersBulk(
  options: OrgInviteOptions,
  rows: BulkLearnerRow[],
): Promise<{ results: (BulkLearnerResult & { licenseError?: string | null })[] }> {
  return api("/org-admin/learners/bulk", { method: "POST", body: JSON.stringify({ ...options, rows }) });
}

export type EditBatchPayload = Partial<BatchDetails>;

export function updateBatch(id: string, payload: EditBatchPayload): Promise<{ id: string }> {
  return api(`/org-admin/batches/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function resendInvite(kind: "managers" | "learners", id: string): Promise<{ id: string; email: string }> {
  return api(`/org-admin/${kind}/${id}/resend-invite`, { method: "POST" });
}

export function handOverOrgAdmin(body: { email: string; firstName: string; lastName: string; jobTitle?: string; phone?: string }) {
  return api<{ id: string }>("/org-admin/handover", { method: "POST", body: JSON.stringify({ ...body, confirm: true }) });
}

export interface AuditEntry {
  id: string;
  source: "action" | "license" | "plan";
  action: string;
  actorLabel: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface AuditFilters {
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
  before?: string;
}

function auditQuery(f: AuditFilters & { limit?: number }): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") p.set(k, String(v));
  return p.toString();
}

export function getAuditLog(f: AuditFilters & { limit?: number }) {
  return api<{ entries: AuditEntry[]; actors: { id: string; name: string; role: string }[]; hasMore: boolean }>(
    `/org-admin/audit?${auditQuery(f)}`,
  );
}

export function auditExportPath(f: AuditFilters): string {
  return `/org-admin/audit/export.csv?${auditQuery(f)}`;
}

export function validateBulkEmails(scope: "org-admin" | "manager", emails: string[]): Promise<{ existing: string[]; maxRows: number }> {
  return api(`/${scope}/learners/bulk/validate`, { method: "POST", body: JSON.stringify({ emails }) });
}

export function completeBatch(id: string): Promise<{ id: string; releasedLicenses: number }> {
  return api(`/org-admin/batches/${id}/complete`, { method: "POST" });
}

export function archiveBatch(id: string): Promise<{ id: string }> {
  return api(`/org-admin/batches/${id}/archive`, { method: "POST" });
}

export function reopenBatch(id: string): Promise<{ id: string }> {
  return api(`/org-admin/batches/${id}/reopen`, { method: "POST" });
}

export function cloneBatch(id: string, body: { name: string; startDate?: string; copyManagers: boolean }): Promise<{ id: string }> {
  return api(`/org-admin/batches/${id}/clone`, { method: "POST", body: JSON.stringify(body) });
}

export interface OrgSettings {
  logoUrl: string | null;
  brandColor: string | null;
  defaultLanguage: string | null;
  timezone: string;
  reminderDefaultEnabled: boolean;
  reminderDefaultTime: string;
  faceCheckRequired: boolean;
  // Modules (one skill at a time) for the organization's learners.
  modulesEnabled: boolean;
  // Managers may open each learner's full score report from the Batch report.
  managersSeeReports: boolean;
  // Course certificates issued as soon as a learner is eligible (else approved by an Org Admin).
  certificatesAuto: boolean;
  allowedTestProducts: string[] | null;
  mfaRequired: boolean;
  ipAllowlist: string[] | null;
  sessionIdleMinutes: number | null;
  passwordMinLength: number;
  inviteExpiryHours: number;
}

export function getOrgSettings(): Promise<OrgSettings> {
  return api("/org-admin/settings");
}

export function updateOrgSettings(body: Partial<Omit<OrgSettings, "logoUrl">>): Promise<OrgSettings> {
  return api("/org-admin/settings", { method: "PATCH", body: JSON.stringify(body) });
}

export function uploadOrgLogo(imageBase64: string): Promise<OrgSettings> {
  return api("/org-admin/settings/logo", { method: "POST", body: JSON.stringify({ imageBase64 }) });
}

export function removeOrgLogo(): Promise<OrgSettings> {
  return api("/org-admin/settings/logo", { method: "DELETE" });
}

export function handOverManager(id: string, body: { toManagerId: string; movePool: boolean; deactivate: boolean }) {
  return api<{ batchesMoved: number; poolMoved: number }>(`/org-admin/managers/${id}/handover`, { method: "POST", body: JSON.stringify(body) });
}

export function viewAsManager(id: string) {
  return api<{ ok: true }>(`/org-admin/managers/${id}/view-as`, { method: "POST" });
}

// ---- Programs: a batch's exam goal and its members' test schedules ----

export type ProgramDomain = "general" | "banking" | "bpo" | "it" | "insurance" | "healthcare";

export interface ProgramInput {
  name: string;
  batchId: string;
  testTypeId: string;
  domain: ProgramDomain;
  targetLevel: string;
  targetSkills: Partial<Record<"listening" | "speaking" | "reading" | "writing", string>>;
  startsOn: string;
  targetDate: string;
  finalAssessment?: boolean;
  finalAssessmentDays?: number;
}

export interface ProgramSummary extends Program {
  batchName: string;
  members: number;
  items: { done: number; missed: number; due: number };
  // Final assessments given, started and certified.
  final: { given: number; taken: number; certified: number };
}

export type MemberStatus = "at_target" | "on_track" | "at_risk" | "too_early";

export interface ProgramMember {
  userId: string;
  name: string;
  email: string;
  latestLevel: string | null;
  skillLevels: Partial<Record<"listening" | "speaking" | "reading" | "writing", string>>;
  levelSource: "mock" | "placement" | null;
  // CEFR steps still to go; null until the level is known.
  gap: number | null;
  status: MemberStatus;
  // The level the trend across mocks reaches by the target date.
  projected: string | null;
  statusReason: string;
  mocks: { sessionId: string; date: string; cefrLevel: string | null; percent: number | null }[];
  lastActivity: string | null;
  inactiveDays: number | null;
  done: number;
  missed: number;
  missedMocks: number;
  next: { dueOn: string; kind: "practice" | "mock" } | null;
  integrity: { status: string | null; risk: string | null } | null;
}

export interface ProgramAlert {
  userId: string;
  name: string;
  kind: "at_risk" | "inactive" | "missed_mock";
  detail: string | null;
  createdAt: string;
}

// Programs are seen by the Org Admin and, read only, by the batch's Managers.
export type ProgramViewer = "org-admin" | "manager";

export function listPrograms(viewer: ProgramViewer = "org-admin"): Promise<{ programs: ProgramSummary[] }> {
  return api(`/${viewer}/programs`);
}

export function createProgram(input: ProgramInput): Promise<Program> {
  return api("/org-admin/programs", { method: "POST", body: JSON.stringify(input) });
}

export function getProgramDetail(id: string, viewer: ProgramViewer = "org-admin"): Promise<{ program: Program; members: ProgramMember[]; alerts: ProgramAlert[] }> {
  return api(`/${viewer}/programs/${id}`);
}

export function programExportPath(id: string, viewer: ProgramViewer = "org-admin"): string {
  return `/${viewer}/programs/${id}/export.csv`;
}

export function getMemberReport(programId: string, sessionId: string, viewer: ProgramViewer = "org-admin"): Promise<ReportResponse & { integrity?: { status: string | null; risk: string | null } }> {
  return api(`/${viewer}/programs/${programId}/reports/${sessionId}`);
}

export function updateProgram(
  id: string,
  input: Partial<Pick<ProgramInput, "name" | "domain" | "targetLevel" | "targetSkills" | "targetDate" | "finalAssessment" | "finalAssessmentDays">> & { status?: Program["status"] },
): Promise<Program> {
  return api(`/org-admin/programs/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}
