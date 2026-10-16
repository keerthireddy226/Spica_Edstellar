import { api } from "@/lib/api";
import { heldTestConsent } from "@/lib/testConsent";

export type ProctoringMode = "off" | "standard" | "strict";
export type ProctoringRegion = "global" | "eu" | "us" | "india";

export interface ProctoringPolicy {
  mode: ProctoringMode;
  region: ProctoringRegion;
  lockdown: boolean;
  requireFullscreen: boolean;
  multiMonitorCheck: boolean;
  randomizedForms: boolean;
  webcamMonitoring: boolean;
  faceMatch: boolean;
  voiceMatch: boolean;
  roomScan: boolean;
  idVerification: boolean;
  liveMonitoring: boolean;
  audioMonitoring: boolean;
  videoRecording: boolean;
  screenRecording: boolean;
  typingPattern: boolean;
  secureBrowser: boolean;
  sebConfigKeys: string[];
  retentionDays: number;
}

export type LearnerPolicy = Omit<ProctoringPolicy, "sebConfigKeys">;

export interface IdentityStatus {
  id: string;
  status: "pending" | "verified" | "rejected";
  created_at: string;
  review_note: string | null;
}

export interface ProctoringSetup {
  proctored: boolean;
  policy: LearnerPolicy;
  consentNeeded: boolean;
  consentVersion: string;
  biometric: boolean;
  biometricOptOut: boolean;
  identity: IdentityStatus | null;
  roomScanDone: boolean;
  voiceBaselineDone: boolean;
  voiceBaselineMinSeconds: number;
  secureBrowser: boolean | null;
  faceEnrolled: boolean;
  terminated: boolean;
}

// Safe Exam Browser exposes a per-page hash of its config key; the server
// compares it with the organization's keys.
interface SebWindow {
  SafeExamBrowser?: { security?: { configKey?: string; updateKeys?: (cb: () => void) => void } };
}

async function sebHeaders(): Promise<Record<string, string>> {
  const seb = (window as unknown as SebWindow).SafeExamBrowser?.security;
  if (!seb) return {};
  if (seb.updateKeys) await new Promise<void>((resolve) => seb.updateKeys!(resolve));
  if (!seb.configKey) return {};
  return { "X-SEB-Config-Key-Hash": seb.configKey, "X-SEB-Page-Url": window.location.href.split("#")[0] };
}

export async function getProctoringSetup(sessionId: string): Promise<ProctoringSetup> {
  const extra = await sebHeaders();
  // The agreement from the consent screen before the test, linked to this session.
  const consent = heldTestConsent();
  if (consent) extra["X-Test-Consent"] = consent;
  return api(`/proctoring/sessions/${sessionId}/setup`, { headers: { "Content-Type": "application/json", ...extra } });
}

// What the next test collects, for the consent screen before it.
// "module", "placement", or a test type id from the exam catalogue.
export type PreTestKind = string;

export interface PreTestInfo {
  proctored: boolean;
  policy: ProctoringSetup["policy"] | null;
  biometric: boolean;
  faceCheck: boolean;
  retentionDays: number;
  recordingsMonths: number | null;
  version: string;
}

// mode: a practice test's practice or mock mode. Practice mode isn't monitored.
export type DeliveryMode = "practice" | "mock";

export function getPreTestInfo(kind: PreTestKind, mode?: DeliveryMode): Promise<PreTestInfo> {
  return api(`/proctoring/pre-test?kind=${encodeURIComponent(kind)}${mode ? `&mode=${mode}` : ""}`);
}

export function givePreTestConsent(kind: PreTestKind, biometric: boolean, mode?: DeliveryMode): Promise<{ consentId: string; biometricOptOut: boolean }> {
  return api("/proctoring/pre-test/consent", { method: "POST", body: JSON.stringify({ kind, mode, accept: true, biometric }) });
}

export function giveProctoringConsent(sessionId: string, biometric: boolean): Promise<{ ok: boolean; biometricOptOut: boolean }> {
  return api(`/proctoring/sessions/${sessionId}/consent`, { method: "POST", body: JSON.stringify({ accept: true, biometric }) });
}

export interface ProctoringEvent {
  type: string;
  at?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export function sendProctoringEvents(sessionId: string, events: ProctoringEvent[]): Promise<{ accepted: number }> {
  return api(`/proctoring/sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ events }), keepalive: true });
}

export type SnapshotWarning = "no_face" | "multiple_people" | "phone" | "face_mismatch" | null;

export function sendSnapshot(sessionId: string, imageBase64: string): Promise<{ faces: number; warning: SnapshotWarning }> {
  return api(`/proctoring/sessions/${sessionId}/snapshot`, { method: "POST", body: JSON.stringify({ imageBase64 }) });
}

export function uploadRoomScan(sessionId: string, dataBase64: string, mimeType: string): Promise<{ ok: boolean }> {
  return api(`/proctoring/sessions/${sessionId}/room-scan`, { method: "POST", body: JSON.stringify({ dataBase64, mimeType }) });
}

export function uploadVoiceBaseline(sessionId: string, dataBase64: string, mimeType: string): Promise<{ ok: boolean; speechSeconds: number; minSeconds?: number }> {
  return api(`/proctoring/sessions/${sessionId}/voice-baseline`, { method: "POST", body: JSON.stringify({ dataBase64, mimeType }) });
}

export type SegmentKind = "video_segment" | "screen_segment" | "audio_clip";

export function uploadSegment(sessionId: string, body: { kind: SegmentKind; dataBase64: string; mimeType: string; seq?: number; durationMs?: number }): Promise<{ ok: boolean }> {
  return api(`/proctoring/sessions/${sessionId}/segment`, { method: "POST", body: JSON.stringify(body), keepalive: body.dataBase64.length < 60_000 });
}

export function getProctoringStatus(sessionId: string): Promise<{ terminated: boolean; terminateReason: string | null; message: string | null }> {
  return api(`/proctoring/sessions/${sessionId}/status`);
}

export function ackProctorMessage(sessionId: string): Promise<{ ok: boolean }> {
  return api(`/proctoring/sessions/${sessionId}/status/ack`, { method: "POST" });
}

export type DocumentType = "passport" | "national_id" | "driving_licence" | "other";

export function submitIdentity(body: { documentType: DocumentType; documentBase64: string; selfieBase64: string; sessionId?: string }): Promise<{ identity: IdentityStatus }> {
  return api(`/proctoring/identity`, { method: "POST", body: JSON.stringify(body) });
}

// ---- Policy ----

// Employees and recruitment candidates have separate policies.
export type PolicyAudience = "employees" | "candidates";

export function getOrgProctoringPolicy(audience: PolicyAudience = "employees"): Promise<{ policy: ProctoringPolicy }> {
  return api(`/proctoring/policy?audience=${audience}`);
}

export function saveOrgProctoringPolicy(policy: ProctoringPolicy, audience: PolicyAudience = "employees"): Promise<{ policy: ProctoringPolicy }> {
  return api(`/proctoring/policy?audience=${audience}`, { method: "PUT", body: JSON.stringify(policy) });
}

export function getTenantProctoringPolicy(tenantId: string, audience: PolicyAudience = "employees"): Promise<{ policy: ProctoringPolicy }> {
  return api(`/proctoring/tenants/${tenantId}/policy?audience=${audience}`);
}

export function saveTenantProctoringPolicy(tenantId: string, policy: ProctoringPolicy, audience: PolicyAudience = "employees"): Promise<{ policy: ProctoringPolicy }> {
  return api(`/proctoring/tenants/${tenantId}/policy?audience=${audience}`, { method: "PUT", body: JSON.stringify(policy) });
}

export function getProctoringPreset(mode: ProctoringMode, region: ProctoringRegion): Promise<{ policy: ProctoringPolicy }> {
  return api(`/proctoring/presets?mode=${mode}&region=${region}`);
}

// ---- Reviewers ----

export interface IntegrityReason {
  code: string;
  count: number;
  points: number;
}

export type IntegrityStatus = "in_progress" | "clear" | "flagged" | "cleared" | "violation";

export interface IntegritySessionRow {
  session_id: string;
  session_type: "placement" | "mocktest";
  status: IntegrityStatus;
  risk_score: number;
  risk_level: "low" | "medium" | "high";
  reasons: IntegrityReason[];
  biometric_opt_out: boolean;
  terminated_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  started_at: string;
  completed_at: string | null;
  test_code: string | null;
  user_id: string;
  email: string;
  name: string;
  org_name: string | null;
  exam_name: string | null;
  reviewer: string | null;
}

export interface IntegrityStats {
  flagged: number;
  violations: number;
  cleared: number;
  clear: number;
  live: number;
  pendingIds: number;
}

export function getIntegrityReviews(status: string, q = ""): Promise<{ sessions: IntegritySessionRow[]; stats: IntegrityStats }> {
  return api(`/proctoring/reviews?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
}

export interface ProctoringMediaRow {
  id: string;
  kind: "snapshot" | "room_scan" | "voice_baseline" | "id_document" | "id_selfie" | "video_segment" | "screen_segment" | "audio_clip";
  head_direction: "center" | "left" | "right" | "up" | "down" | null;
  segment_seq: number | null;
  duration_ms: number | null;
  face_count: number | null;
  face_decision: string | null;
  face_similarity: string | null;
  objects: { label: string; score: number }[] | null;
  created_at: string;
}

export interface MrzReading {
  format: string;
  checksumsValid: boolean;
  documentNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  birthDate: string | null;
  expirationDate: string | null;
  expired: boolean | null;
  nameMatches: boolean | null;
}

export interface TypingCheck {
  decision: "consistent" | "uncertain" | "inconsistent" | "insufficient_typing";
  keys: number;
  withinSession: number | null;
  vsHistory: number | null;
  historySessions: number;
}

export interface IntegrityDetail {
  integrity: IntegritySessionRow & {
    policy: LearnerPolicy;
    checks: { typing?: TypingCheck };
    live_message: string | null;
    terminate_reason: string | null;
    secure_browser: boolean | null;
    analyzed_at: string | null;
  };
  session: {
    started_at: string;
    completed_at: string | null;
    session_type: string;
    test_code: string | null;
    email: string;
    name: string;
    org_name: string | null;
    exam_name: string | null;
    answers: number;
  };
  events: { type: string; severity: "info" | "warn" | "high"; detail: Record<string, unknown> | null; at: string }[];
  media: ProctoringMediaRow[];
  faceChecks: { decision: string; similarity_score: string | null; liveness_score: string | null; face_count: number | null; created_at: string }[];
  voice: {
    decision: "match" | "uncertain" | "mismatch" | "insufficient_audio" | "error";
    similarity_score: string | null;
    detail: {
      totalSpeechSeconds?: number;
      answers?: number;
      baselineSeconds?: number;
      chunks?: { seconds: number; vsBaseline: number | null }[];
      pairs?: { a: number; b: number; score: number }[];
      reason?: string;
    } | null;
    created_at: string;
  } | null;
  identity: {
    id: string;
    status: "pending" | "verified" | "rejected";
    document_type: DocumentType;
    document_media_id: string | null;
    selfie_media_id: string | null;
    face_similarity: string | null;
    auto_decision: string | null;
    mrz: MrzReading | null;
    liveness_score: string | null;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
  } | null;
  placement: { id: string; status: string; cefr_level: string; overall_percent: number } | null;
}

export function getIntegrityDetail(sessionId: string): Promise<IntegrityDetail> {
  return api(`/proctoring/reviews/${sessionId}`);
}

export function decideIntegrity(sessionId: string, verdict: "cleared" | "violation", note?: string): Promise<{ status: string }> {
  return api(`/proctoring/reviews/${sessionId}/decision`, { method: "POST", body: JSON.stringify({ verdict, note }) });
}

export interface LiveSessionRow {
  session_id: string;
  session_type: "placement" | "mocktest";
  last_seen_at: string;
  test_code: string | null;
  live_message: string | null;
  live_message_at: string | null;
  live_message_seen_at: string | null;
  started_at: string;
  user_id: string;
  email: string;
  name: string;
  org_name: string | null;
  exam_name: string | null;
  answers: number;
  alerts: number;
  last_alert: string | null;
  snapshot: { id: string; face_count: number | null; objects: { label: string }[] | null; created_at: string } | null;
  video: { id: string; created_at: string } | null;
}

export type LearnerIntegrityRow = Omit<IntegritySessionRow, "user_id" | "email" | "name" | "org_name" | "biometric_opt_out" | "terminated_at">;

export function getLearnerIntegrity(userId: string): Promise<{ sessions: LearnerIntegrityRow[] }> {
  return api(`/proctoring/learners/${userId}/integrity`);
}

export function getLearnerIntegritySummary(
  sessionId: string,
): Promise<{ show: false } | { show: true; status: IntegrityStatus; reasons: { code: string; count: number }[] }> {
  return api(`/proctoring/sessions/${sessionId}/learner-summary`);
}

export function getPendingReviewCount(): Promise<{ flagged: number }> {
  return api("/proctoring/reviews/pending-count");
}

export type AlertEmailPreference = "instant" | "daily";

export function getAlertPreferences(): Promise<{ email: AlertEmailPreference }> {
  return api("/proctoring/alert-preferences");
}

export function saveAlertPreferences(email: AlertEmailPreference): Promise<{ email: AlertEmailPreference }> {
  return api("/proctoring/alert-preferences", { method: "PUT", body: JSON.stringify({ email }) });
}

export function getLiveSessions(): Promise<{ sessions: LiveSessionRow[] }> {
  return api(`/proctoring/live`);
}

export function sendLiveMessage(sessionId: string, message: string): Promise<{ ok: boolean }> {
  return api(`/proctoring/live/${sessionId}/message`, { method: "POST", body: JSON.stringify({ message }) });
}

export function terminateLiveSession(sessionId: string, reason: string): Promise<{ ok: boolean }> {
  return api(`/proctoring/live/${sessionId}/terminate`, { method: "POST", body: JSON.stringify({ reason }) });
}

export interface IdentityReviewRow {
  id: string;
  status: "pending" | "verified" | "rejected";
  document_type: DocumentType;
  document_media_id: string | null;
  selfie_media_id: string | null;
  face_similarity: string | null;
  auto_decision: string | null;
  mrz: MrzReading | null;
  liveness_score: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  user_id: string;
  email: string;
  name: string;
  org_name: string | null;
  reviewer: string | null;
}

export function getIdentityReviews(status: "pending" | "verified" | "rejected"): Promise<{ verifications: IdentityReviewRow[] }> {
  return api(`/proctoring/identity-reviews?status=${status}`);
}

export function decideIdentity(id: string, verdict: "verified" | "rejected", note?: string): Promise<{ status: string }> {
  return api(`/proctoring/identity-reviews/${id}/decision`, { method: "POST", body: JSON.stringify({ verdict, note }) });
}

// Media is served with the session cookie; an object URL lets <img>,
// <video> and <audio> show it.
export async function fetchMediaUrl(id: string): Promise<string | null> {
  const r = await fetch(`/api/proctoring/media/${id}`, { credentials: "include" });
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}
