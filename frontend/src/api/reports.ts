import { api } from "@/lib/api";

export type ReportFrequency = "weekly" | "monthly" | "off";

export function getReportSubscription() {
  return api<{ frequency: ReportFrequency; lastPeriod: string | null }>("/reports/subscription");
}

export function setReportSubscription(frequency: ReportFrequency) {
  return api<{ frequency: ReportFrequency; lastPeriod: string | null }>("/reports/subscription", { method: "PUT", body: JSON.stringify({ frequency }) });
}

export function previewReport(frequency: "weekly" | "monthly") {
  return api<{ text: string; summary: string } | null>(`/reports/preview?frequency=${frequency}`);
}

export interface CertificateSummary {
  id: string;
  code: string;
  learnerName: string;
  participantId: string | null;
  organizationName: string | null;
  batchName: string | null;
  cefrLevel: string | null;
  issuedAt: string;
  revokedAt: string | null;
  userId?: string | null;
  // A final assessment's certificate ("result"), or an earlier course one ("completion").
  kind?: "completion" | "result";
  testName?: string | null;
  spicaScore?: number | null;
  validUntil?: string | null;
  identityVerified?: boolean;
}

export function myCertificates() {
  return api<{ certificates: CertificateSummary[] }>("/certificates/mine");
}

export function orgCertificates(batchId?: string) {
  return api<{ certificates: CertificateSummary[] }>(`/certificates/org${batchId ? `?batchId=${batchId}` : ""}`);
}

export function issueCertificate(learnerId: string, batchId: string | null) {
  return api<CertificateSummary>("/certificates/org/issue", { method: "POST", body: JSON.stringify({ learnerId, batchId }) });
}

export function revokeCertificate(id: string) {
  return api<{ ok: true }>(`/certificates/org/${id}`, { method: "DELETE" });
}

export function managerCertificates(batchId?: string) {
  return api<{ certificates: CertificateSummary[] }>(`/certificates/manager${batchId ? `?batchId=${batchId}` : ""}`);
}

export function managerIssueCertificate(learnerId: string) {
  return api<CertificateSummary>("/certificates/manager/issue", { method: "POST", body: JSON.stringify({ learnerId }) });
}

export function managerRevokeCertificate(id: string) {
  return api<{ ok: true }>(`/certificates/manager/${id}`, { method: "DELETE" });
}
