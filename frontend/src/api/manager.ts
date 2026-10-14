import { api } from "@/lib/api";
import type { AuditEntry, BulkLearnerResult, BulkLearnerRow, OrgLearner } from "@/api/orgAdmin";
import type { LearnerProfile } from "@/api/admin";
import type { LearnerAccess } from "@/api/licenses";

export interface OnboardLearnerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchId: string;
}

export interface ManagerOverview {
  batches: { id: string; name: string; learnerCount: number; status?: "active" | "completed" | "archived" }[];
  totalLearners: number;
  sessionsCompletedToday: number;
}

export function getManagerOverview(): Promise<ManagerOverview> {
  return api("/manager/overview");
}

export function getManagerLearners(): Promise<{ learners: OrgLearner[] }> {
  return api("/manager/learners");
}

export function managerOnboardLearner(payload: OnboardLearnerPayload): Promise<{ id: string; email: string }> {
  return api("/manager/learners", { method: "POST", body: JSON.stringify(payload) });
}

export function managerOnboardLearnersBulk(batchId: string, rows: BulkLearnerRow[]): Promise<{ results: BulkLearnerResult[] }> {
  return api("/manager/learners/bulk", { method: "POST", body: JSON.stringify({ batchId, rows }) });
}

export function managerMoveLearner(id: string, batchId: string, reason?: string): Promise<{ id: string }> {
  return api(`/manager/learners/${id}/move`, { method: "POST", body: JSON.stringify({ batchId, reason }) });
}

export function managerCreateBatch(body: {
  name: string;
  durationMonths?: number;
  startDate?: string;
  startCefr?: string;
  targetCefr?: string;
}): Promise<{ id: string }> {
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
  batch: {
    id: string;
    name: string;
    batchCode: string;
    status: "active" | "completed" | "archived";
    startDate: string | null;
    durationMonths: number | null;
    endDate: string | null;
    startCefr: string | null;
    targetCefr: string | null;
    targetCutScore: number | null;
    autoReminders: boolean;
    createdAt: string;
    completedAt: string | null;
    fixedLicenses: number | null;
    fixedLicensesUsed: number;
    managerNames: string[];
  };
  learners: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    participantId: string | null;
    active: boolean;
    hasLoggedIn: boolean;
    sessionCount: number;
    license?: LearnerAccess;
  }[];
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
