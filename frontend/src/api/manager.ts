import { api } from "@/lib/api";
import type { AuditEntry, BulkLearnerResult, BulkLearnerRow, OrgLearner } from "@/api/orgAdmin";
import type { LearnerProfile } from "@/api/admin";
import type { LearnerAccess } from "@/api/licenses";
import type { BatchExtras, CefrLevel } from "@/api/orgAdmin";
import type { BatchDetails, BatchLicenseStats, LearnerDetails } from "@/api/details";

export interface OnboardLearnerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchId: string;
  // Months of access to give them now; left out, the batch's default.
  licenseMonths?: number;
  details?: Partial<LearnerDetails>;
}

export interface ManagerPool {
  allotment: number | null;
  used: number;
  remaining: number | null;
}

export interface ManagerOverview {
  activeBatches: number;
  totalLearners: number;
  sessionsCompletedToday: number;
  myPool: ManagerPool | null;
  licenses: { licensed: number; unlicensed: number; grace: number; endingSoon: number; fromFixed: number; fromPool: number };
}

export interface ManagerBatch extends BatchExtras {
  id: string;
  name: string;
  batchCode: string;
  status: "active" | "completed" | "archived";
  startDate: string | null;
  durationMonths: number | null;
  endDate: string | null;
  startCefr: CefrLevel | null;
  targetCefr: CefrLevel | null;
  targetCutScore: number | null;
  createdAt: string;
  completedAt: string | null;
  fixedLicenses: number | null;
  licenses: BatchLicenseStats;
  managerNames: string[];
}

export function getManagerBatches(): Promise<{ batches: ManagerBatch[]; myPool: ManagerPool | null }> {
  return api("/manager/batches");
}

export function managerUpdateBatch(id: string, body: Partial<BatchDetails>): Promise<{ id: string }> {
  return api(`/manager/batches/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function managerUpdateLearnerDetails(id: string, d: LearnerDetails): Promise<{ id: string }> {
  return api(`/manager/learners/${id}/details`, { method: "PATCH", body: JSON.stringify(d) });
}

export function getManagerOverview(): Promise<ManagerOverview> {
  return api("/manager/overview");
}

export function getManagerLearners(): Promise<{ learners: OrgLearner[] }> {
  return api("/manager/learners");
}

export function managerOnboardLearner(
  payload: OnboardLearnerPayload,
): Promise<{ id: string; email: string; licenseMonths: number; licenseError: string | null }> {
  return api("/manager/learners", { method: "POST", body: JSON.stringify(payload) });
}

export function managerOnboardLearnersBulk(
  batchId: string,
  rows: BulkLearnerRow[],
  licenseMonths?: number,
): Promise<{ results: BulkLearnerResult[]; licenseMonths: number }> {
  return api("/manager/learners/bulk", { method: "POST", body: JSON.stringify({ batchId, rows, licenseMonths }) });
}

export function managerMoveLearner(id: string, batchId: string, reason?: string): Promise<{ id: string }> {
  return api(`/manager/learners/${id}/move`, { method: "POST", body: JSON.stringify({ batchId, reason }) });
}

export function managerCreateBatch(body: BatchDetails): Promise<{ id: string }> {
  return api("/manager/batches", { method: "POST", body: JSON.stringify(body) });
}

export function getManagerLearnerDetail(id: string): Promise<LearnerProfile> {
  return api(`/manager/learners/${id}`);
}

export function managerResendInvite(id: string): Promise<{ id: string; email: string }> {
  return api(`/manager/learners/${id}/resend-invite`, { method: "POST" });
}

export function managerDeactivateLearner(id: string): Promise<{ id: string; returnRequested: number }> {
  return api(`/manager/learners/${id}/deactivate`, { method: "POST" });
}

export function managerReactivateLearner(id: string): Promise<{ id: string }> {
  return api(`/manager/learners/${id}/reactivate`, { method: "POST" });
}

export interface ManagerBatchDetail {
  batch: BatchExtras & {
    licenses: BatchLicenseStats;
    id: string;
    name: string;
    batchCode: string;
    status: "active" | "completed" | "archived";
    startDate: string | null;
    durationMonths: number | null;
    endDate: string | null;
    startCefr: CefrLevel | null;
    targetCefr: CefrLevel | null;
    targetCutScore: number | null;
    createdAt: string;
    completedAt: string | null;
    fixedLicenses: number | null;
    fixedLicensesUsed: number;
    managerNames: string[];
  };
  learners: (LearnerDetails & {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    participantId: string | null;
    active: boolean;
    hasLoggedIn: boolean;
    sessionCount: number;
    license?: LearnerAccess;
  })[];
}

export function getManagerBatch(id: string): Promise<ManagerBatchDetail> {
  return api(`/manager/batches/${id}`);
}

export function managerCompleteBatch(id: string): Promise<{ id: string; releasedLicenses: number; certificatesIssued: number }> {
  return api(`/manager/batches/${id}/complete`, { method: "POST" });
}

export function managerCloneBatch(id: string, body: { name: string; startDate?: string }): Promise<{ id: string }> {
  return api(`/manager/batches/${id}/clone`, { method: "POST", body: JSON.stringify(body) });
}

export function getManagerActivity(before?: string) {
  const p = new URLSearchParams({ limit: "50" });
  if (before) p.set("before", before);
  return api<{ entries: AuditEntry[]; hasMore: boolean }>(`/manager/activity?${p}`);
}

export function getManagerPreferences() {
  return api<{ dailyDigest: boolean; poolAlerts: boolean }>("/manager/preferences");
}

export function saveManagerPreferences(body: { dailyDigest: boolean; poolAlerts: boolean }) {
  return api<{ dailyDigest: boolean; poolAlerts: boolean }>("/manager/preferences", { method: "PUT", body: JSON.stringify(body) });
}
