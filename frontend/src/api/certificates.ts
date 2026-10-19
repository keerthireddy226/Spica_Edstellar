import { api } from "@/lib/api";

export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type SkillName = "listening" | "speaking" | "reading" | "writing";
export type SkillResult = { level?: Level; score?: number };

export interface VersantResult {
  id: string;
  takenOn: string;
  overallLevel: Level;
  overallScore: number | null;
  skills: Partial<Record<SkillName, SkillResult>>;
  hasProof: boolean;
  proofType: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface CertificateStatus {
  reviewer: "org" | "staff";
  eligible: boolean;
  practice: { total: number; done: number };
  mocks: number;
  tests: number;
  access: { status: "active" | "grace" | "expired" | "none"; endsAt: string | null; ended: boolean };
  period: { from: string; to: string };
  goal: Level | null;
  level: Level | null;
  goalReached: boolean;
  versant: VersantResult | null;
  versantGoalReached: boolean;
  request: { id: string; status: "pending" | "issued" | "declined"; note: string | null; decidedAt: string | null; createdAt: string } | null;
  certificate: { code: string; issuedAt: string } | null;
}

export type CertificateSnapshot = Omit<CertificateStatus, "versant" | "request" | "certificate">;

export interface CertificateRequest {
  id: string;
  status: "pending" | "issued" | "declined";
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
  learner: { id: string; name: string; email: string; learnerId: string | null; org: string | null; batch: string | null };
  snapshot: CertificateSnapshot;
  certificateCode: string | null;
  versant: VersantResult | null;
}

export const getCertificateStatus = () => api<CertificateStatus>("/certificates/me/status");

export const saveVersantResult = (body: {
  takenOn: string;
  overallLevel: Level;
  overallScore?: number | null;
  skills?: Partial<Record<SkillName, SkillResult>>;
  proofBase64?: string | null;
}) => api<VersantResult>("/certificates/me/versant", { method: "POST", body: JSON.stringify(body) });

export const requestCertificate = () => api<{ id: string }>("/certificates/me/request", { method: "POST", body: "{}" });

export const versantProofUrl = (id: string) => `/api/certificates/versant/${id}/proof`;

export const getCertificateRequests = (status: "pending" | "all") => api<{ requests: CertificateRequest[] }>(`/certificates/requests?status=${status}`);

export const decideCertificateRequest = (id: string, decision: { issue: true; includeVersant: boolean } | { issue: false; note: string }) =>
  api<{ issued: boolean; code?: string }>(`/certificates/requests/${id}/decide`, { method: "POST", body: JSON.stringify(decision) });

export const emailTestDates = () => api<{ sent: number }>("/roadmap/calendar/email", { method: "POST", body: "{}" });

export const CALENDAR_FILE_URL = "/api/roadmap/calendar.ics";

// A calendar day ("2026-10-15") in the reader's format, without shifting it a day by timezone.
export function formatDay(day: string | null, long = false): string {
  if (!day) return "—";
  return new Date(`${day.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { year: "numeric", month: long ? "long" : "short", day: "numeric" });
}
