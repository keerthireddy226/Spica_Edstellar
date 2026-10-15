import { api } from "@/lib/api";

export type Product = "skills" | "recruitment";
export type TestKind = "placement" | "fourSkills" | "speakingListening" | "writing" | "professional";
export type Cefr = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type AssessmentStatus = "invited" | "started" | "completed" | "expired" | "cancelled";
export type Decision = "shortlisted" | "rejected" | "hired";

export interface AssessmentResult {
  kind: "placement" | "exam";
  overallPercent?: number | null;
  cefrLevel?: Cefr;
  skillPercents?: Record<string, number>;
  skillLevels?: Record<string, string>;
  partResults?: { label: string; gradedCount: number; correctCount: number }[];
  pendingCount?: number;
  pending?: boolean;
  meetsMinimum?: boolean | null;
}

// ---- Candidate ----

export interface InviteInfo {
  status: "invited" | "started" | "completed" | "expired";
  organization: { name: string; logoUrl: string | null };
  job: { title: string; description: string | null };
  testKind: TestKind;
  firstName: string | null;
  expiresAt: string;
  proctoring: { camera: boolean; microphone: boolean; screen: boolean; idDocument: boolean; secureBrowser: boolean };
}

export function getInvite(token: string): Promise<InviteInfo> {
  return api(`/recruitment/invite/${encodeURIComponent(token)}`);
}

export function startInvite(token: string): Promise<{ ok: boolean }> {
  return api(`/recruitment/invite/${encodeURIComponent(token)}/start`, { method: "POST" });
}

export interface CandidateAssessment {
  id: string;
  status: "invited" | "started" | "completed" | "expired";
  organization: string;
  jobTitle: string;
  testKind: TestKind;
  examId: string | null;
  sessionId: string | null;
  firstName: string | null;
  expiresAt: string;
  result: AssessmentResult | null;
}

export function getCandidateAssessment(): Promise<CandidateAssessment> {
  return api(`/recruitment/candidate/me`);
}

// ---- Recruiter console ----

export interface RecruitmentOverview {
  credits: number;
  unitPriceCents: number;
  retentionDays: number;
  counts: { open: number; to_decide: number; completed_30d: number; hired: number; open_jobs: number };
  recent: { id: string; first_name: string | null; last_name: string | null; email: string; completed_at: string; result: AssessmentResult | null; decision: Decision | null; job_title: string }[];
}

export function getRecruitmentOverview(): Promise<RecruitmentOverview> {
  return api(`/recruitment/overview`);
}

export interface Job {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  test_kind: TestKind;
  min_cefr: Cefr | null;
  invite_valid_days: number;
  show_result_to_candidate: boolean;
  status: "open" | "closed";
  created_at: string;
  created_by_name: string | null;
  invited: number;
  completed: number;
  pending: number;
  shortlisted: number;
  hired: number;
}

export interface JobInput {
  title: string;
  department?: string | null;
  location?: string | null;
  description?: string | null;
  testKind: TestKind;
  minCefr?: Cefr | null;
  inviteValidDays: number;
  showResultToCandidate: boolean;
}

export function getJobs(): Promise<{ jobs: Job[] }> {
  return api(`/recruitment/jobs`);
}

export function createJob(body: JobInput): Promise<{ id: string }> {
  return api(`/recruitment/jobs`, { method: "POST", body: JSON.stringify(body) });
}

export function updateJob(id: string, body: Partial<JobInput> & { status?: "open" | "closed" }): Promise<{ ok: boolean }> {
  return api(`/recruitment/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export interface CandidateRow {
  id: string;
  candidate_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: AssessmentStatus;
  result: AssessmentResult | null;
  decision: Decision | null;
  decision_note: string | null;
  decided_at: string | null;
  invited_at: string;
  expires_at: string;
  started_at: string | null;
  completed_at: string | null;
  session_id: string | null;
  integrity_status: "in_progress" | "clear" | "flagged" | "cleared" | "violation" | null;
  risk_level: "low" | "medium" | "high" | null;
  risk_score: number | null;
  invited_by_name: string | null;
}

export function getJob(id: string): Promise<{ job: Job; candidates: CandidateRow[] }> {
  return api(`/recruitment/jobs/${id}`);
}

export function inviteCandidates(jobId: string, people: { email: string; firstName?: string; lastName?: string }[]): Promise<{ invited: { id: string; email: string }[]; skipped: number }> {
  return api(`/recruitment/jobs/${jobId}/invites`, { method: "POST", body: JSON.stringify({ people }) });
}

export function resendInvite(id: string): Promise<{ ok: boolean; emailed: boolean }> {
  return api(`/recruitment/assessments/${id}/resend`, { method: "POST" });
}

export function cancelInvite(id: string): Promise<{ ok: boolean }> {
  return api(`/recruitment/assessments/${id}/cancel`, { method: "POST" });
}

export interface AssessmentReport extends Omit<CandidateRow, "invited_by_name"> {
  job_id: string;
  job_title: string;
  test_kind: TestKind;
  min_cefr: Cefr | null;
  department: string | null;
  location: string | null;
  exam_name: string | null;
  integrity_reasons: { code: string; count: number; points: number }[] | null;
  integrity_reviewed_at: string | null;
  identity_status: "pending" | "verified" | "rejected" | null;
  invited_by_name: string | null;
  decided_by_name: string | null;
}

export function getAssessment(id: string): Promise<{ assessment: AssessmentReport }> {
  return api(`/recruitment/assessments/${id}`);
}

export function decideAssessment(id: string, decision: Decision | null, note?: string): Promise<{ ok: boolean }> {
  return api(`/recruitment/assessments/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, note }) });
}

export function jobExportUrl(id: string): string {
  return `/api/recruitment/jobs/${id}/export.csv`;
}

export interface CreditEvent {
  delta: number;
  reason: "grant" | "purchase" | "invite" | "refund" | "adjustment";
  note: string | null;
  created_at: string;
  actor: string | null;
}

export function getCredits(): Promise<{ balance: number; used: number; events: CreditEvent[] }> {
  return api(`/recruitment/credits`);
}

export function requestCredits(quantity: number, note?: string): Promise<{ ok: boolean; unitPriceCents: number }> {
  return api(`/recruitment/credits/request`, { method: "POST", body: JSON.stringify({ quantity, note }) });
}

export function saveRecruitmentSettings(retentionDays: number): Promise<{ ok: boolean }> {
  return api(`/recruitment/settings`, { method: "PUT", body: JSON.stringify({ retentionDays }) });
}

export interface Recruiter {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  last_login_at: string | null;
  invited: number;
}

export function getRecruiters(): Promise<{ recruiters: Recruiter[] }> {
  return api(`/recruitment/team`);
}

export function addRecruiter(body: { email: string; firstName: string; lastName: string }): Promise<{ id: string }> {
  return api(`/recruitment/team`, { method: "POST", body: JSON.stringify(body) });
}

export function removeRecruiter(id: string): Promise<void> {
  return api(`/recruitment/team/${id}`, { method: "DELETE" });
}

// ---- Edstellar staff ----

export interface StaffRecruitment {
  products: Product[];
  credits: number;
  customPriceCents: number | null;
  rateCard: { minQuantity: number; unitPriceCents: number }[];
  retentionDays: number;
  usage: { invited: number; completed: number; jobs: number };
  events: CreditEvent[];
}

export function getStaffRecruitment(tenantId: string): Promise<StaffRecruitment> {
  return api(`/recruitment/admin/orgs/${tenantId}`);
}

export function setProducts(tenantId: string, products: Product[], note?: string): Promise<{ products: Product[] }> {
  return api(`/recruitment/admin/orgs/${tenantId}/products`, { method: "PUT", body: JSON.stringify({ products, note }) });
}

export function grantCredits(tenantId: string, amount: number, reason: "grant" | "purchase" | "adjustment", note?: string): Promise<{ balance: number }> {
  return api(`/recruitment/admin/orgs/${tenantId}/credits`, { method: "POST", body: JSON.stringify({ amount, reason, note }) });
}

export function setAssessmentPrice(tenantId: string, customPriceCents: number | null): Promise<{ ok: boolean }> {
  return api(`/recruitment/admin/orgs/${tenantId}/price`, { method: "PUT", body: JSON.stringify({ customPriceCents }) });
}
