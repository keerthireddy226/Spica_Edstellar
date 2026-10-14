import { api } from "@/lib/api";
import type { ActivityKind, LearnerProfile, ManagerDetail, ManagerOnboardedLearner } from "@/api/admin";

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

export interface OrgBatch {
  id: string;
  name: string;
  learnerCount: number;
  managerNames: string[];
  createdAt: string;
}

export function getBatches(): Promise<{ batches: OrgBatch[] }> {
  return api("/org-admin/batches");
}

export function createBatch(name: string): Promise<{ id: string }> {
  return api("/org-admin/batches", { method: "POST", body: JSON.stringify({ name }) });
}

export interface OrgBatchDetail {
  id: string;
  name: string;
  managerNames: string[];
  createdAt: string;
}

export interface OrgBatchLearner {
  id: string;
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
  active: boolean;
  hasLoggedIn: boolean;
  createdAt: string;
}

export function getManagers(): Promise<{ managers: OrgManager[] }> {
  return api("/org-admin/managers");
}

export interface OnboardManagerPayload {
  email: string;
  firstName: string;
  lastName: string;
  batchIds: string[];
}

export function onboardManager(payload: OnboardManagerPayload): Promise<{ id: string; email: string }> {
  return api("/org-admin/managers", { method: "POST", body: JSON.stringify(payload) });
}

export function getOrgManagerDetail(id: string): Promise<{ manager: ManagerDetail; learners: ManagerOnboardedLearner[] }> {
  return api(`/org-admin/managers/${id}`);
}

export function deleteManager(id: string): Promise<{ id: string }> {
  return api(`/org-admin/managers/${id}`, { method: "DELETE" });
}

export function deactivateManager(id: string): Promise<{ id: string }> {
  return api(`/org-admin/managers/${id}/deactivate`, { method: "POST" });
}

export function reactivateManager(id: string): Promise<{ id: string }> {
  return api(`/org-admin/managers/${id}/reactivate`, { method: "POST" });
}

export interface OrgLearner {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  batchName: string | null;
  sessionCount: number;
  active: boolean;
  createdAt: string;
}

export function getOrgLearners(): Promise<{ learners: OrgLearner[] }> {
  return api("/org-admin/learners");
}

// Shared row/result shapes for CSV bulk-upload flows elsewhere (e.g. the
// Admin console's own bulk invite) — Org Admins no longer onboard learners
// themselves, so no onboarding function lives in this file anymore.
export interface BulkLearnerRow {
  email: string;
  firstName: string;
  lastName: string;
}

export interface BulkLearnerResult {
  email: string;
  status: "created" | "duplicate" | "invalid";
  message?: string;
}

export function getOrgLearnerDetail(id: string): Promise<LearnerProfile> {
  return api(`/org-admin/learners/${id}`);
}

export function deleteLearner(id: string): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}`, { method: "DELETE" });
}

export function deactivateLearner(id: string): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}/deactivate`, { method: "POST" });
}

export function reactivateLearner(id: string): Promise<{ id: string }> {
  return api(`/org-admin/learners/${id}/reactivate`, { method: "POST" });
}
