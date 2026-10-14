import { api } from "@/lib/api";
import type { BulkLearnerResult, BulkLearnerRow, OrgLearner } from "@/api/orgAdmin";

export interface OnboardLearnerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchId: string;
}

export interface ManagerOverview {
  batches: { id: string; name: string; learnerCount: number }[];
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
