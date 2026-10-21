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

// Each learner's certificate to show: a final assessment's before a course
// one, the newest of each.
export function certificateByLearner(certs: CertificateSummary[]): Map<string, CertificateSummary> {
  const rank = (c: CertificateSummary) => `${c.kind === "result" ? 1 : 0}${c.issuedAt}`;
  const sorted = certs.filter((c) => !c.revokedAt && c.userId).sort((a, b) => rank(a).localeCompare(rank(b)));
  return new Map(sorted.map((c) => [c.userId!, c]));
}

export function myCertificates() {
  return api<{ certificates: CertificateSummary[] }>("/certificates/mine");
}

export function orgCertificates(batchId?: string) {
  return api<{ certificates: CertificateSummary[] }>(`/certificates/org${batchId ? `?batchId=${batchId}` : ""}`);
}


export function revokeCertificate(id: string) {
  return api<{ ok: true }>(`/certificates/org/${id}`, { method: "DELETE" });
}

export function managerCertificates(batchId?: string) {
  return api<{ certificates: CertificateSummary[] }>(`/certificates/manager${batchId ? `?batchId=${batchId}` : ""}`);
}


export function managerRevokeCertificate(id: string) {
  return api<{ ok: true }>(`/certificates/manager/${id}`, { method: "DELETE" });
}
