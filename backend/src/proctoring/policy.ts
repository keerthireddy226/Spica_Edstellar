// What an organization switches on for its tests. Presets follow two choices:
// how strict (off / standard for employee skill checks / strict for
// recruitment) and which privacy rules apply (region). An organization can
// change any single option after picking a preset.
import { z } from "zod";
import { pool } from "../db.js";

export const PROCTORING_MODES = ["off", "standard", "strict"] as const;
export const PROCTORING_REGIONS = ["global", "eu", "us", "india"] as const;
export type ProctoringMode = (typeof PROCTORING_MODES)[number];
export type ProctoringRegion = (typeof PROCTORING_REGIONS)[number];

// Session types the policy applies to: the placement test and full mock tests.
export const PROCTORED_SESSION_TYPES = ["placement", "mocktest"];

export const policySchema = z.object({
  mode: z.enum(PROCTORING_MODES),
  region: z.enum(PROCTORING_REGIONS),
  // Blocks copy, paste and the context menu; logs tab switches and focus loss.
  lockdown: z.boolean(),
  requireFullscreen: z.boolean(),
  // Chrome and Edge report a second screen; other browsers can't tell.
  multiMonitorCheck: z.boolean(),
  // Each candidate gets questions drawn from every set of the product.
  randomizedForms: z.boolean(),
  // Camera snapshots during the test: face present, one face, no phone.
  webcamMonitoring: z.boolean(),
  // Biometric: the snapshot face compared with the enrolled face.
  faceMatch: z.boolean(),
  // Biometric: spoken answers compared with each other and a voice sample.
  voiceMatch: z.boolean(),
  roomScan: z.boolean(),
  idVerification: z.boolean(),
  liveMonitoring: z.boolean(),
  // Microphone open between answers: talking or whispering is recorded as
  // short clips for the reviewer.
  audioMonitoring: z.boolean(),
  // Webcam video and the learner's screen, recorded in segments.
  videoRecording: z.boolean(),
  screenRecording: z.boolean(),
  // Biometric: typing rhythm compared within the test and with earlier tests.
  typingPattern: z.boolean(),
  secureBrowser: z.boolean(),
  // Safe Exam Browser config keys accepted for this organization.
  sebConfigKeys: z.array(z.string().trim().regex(/^[0-9a-fA-F]{64}$/)).max(10),
  // Days to keep snapshots, scans, voice samples and ID images.
  retentionDays: z.number().int().min(1).max(365),
});
export type ProctoringPolicy = z.infer<typeof policySchema>;

// Biometric features are off by default in the EU: GDPR treats them as
// special-category data and an employee's consent is rarely "freely given".
// They can still be switched on; learners then always get a manual route.
const BIOMETRIC_DEFAULT: Record<ProctoringRegion, boolean> = { global: true, eu: false, us: true, india: true };
const RETENTION_DEFAULT: Record<ProctoringRegion, number> = { global: 90, eu: 30, us: 30, india: 90 };

export function presetPolicy(mode: ProctoringMode, region: ProctoringRegion): ProctoringPolicy {
  const base = {
    mode,
    region,
    sebConfigKeys: [],
    retentionDays: RETENTION_DEFAULT[region],
    secureBrowser: false,
  };
  if (mode === "off") {
    return {
      ...base,
      lockdown: false,
      requireFullscreen: false,
      multiMonitorCheck: false,
      randomizedForms: false,
      webcamMonitoring: false,
      faceMatch: false,
      voiceMatch: false,
      roomScan: false,
      idVerification: false,
      liveMonitoring: false,
      audioMonitoring: false,
      videoRecording: false,
      screenRecording: false,
      typingPattern: false,
    };
  }
  if (mode === "standard") {
    return {
      ...base,
      lockdown: true,
      requireFullscreen: false,
      multiMonitorCheck: true,
      randomizedForms: true,
      webcamMonitoring: true,
      faceMatch: false,
      voiceMatch: false,
      roomScan: false,
      idVerification: false,
      liveMonitoring: false,
      // Listening for talking between answers, and noise checks on spoken answers.
      audioMonitoring: true,
      videoRecording: false,
      screenRecording: false,
      typingPattern: false,
    };
  }
  const bio = BIOMETRIC_DEFAULT[region];
  return {
    ...base,
    lockdown: true,
    requireFullscreen: true,
    multiMonitorCheck: true,
    randomizedForms: true,
    webcamMonitoring: true,
    faceMatch: bio,
    voiceMatch: bio,
    roomScan: true,
    idVerification: true,
    liveMonitoring: true,
    audioMonitoring: true,
    // Camera video is the heaviest record and rarely needed: snapshots, face
    // matching and screenshots cover the checks. An organization can turn it on.
    videoRecording: false,
    screenRecording: true,
    typingPattern: bio,
  };
}

export function usesBiometrics(p: ProctoringPolicy): boolean {
  return p.faceMatch || p.voiceMatch || p.idVerification || p.typingPattern;
}

export function usesCamera(p: ProctoringPolicy): boolean {
  return p.webcamMonitoring || p.faceMatch || p.roomScan || p.idVerification || p.liveMonitoring || p.videoRecording;
}

// Anything that records the learner needs their consent first.
export function needsConsent(p: ProctoringPolicy): boolean {
  return usesCamera(p) || p.voiceMatch || p.audioMonitoring || p.screenRecording || p.typingPattern;
}

// Features above the standard preset are a paid-plan feature.
export function needsSecureProctoringPlan(p: ProctoringPolicy): boolean {
  return (
    p.mode === "strict" ||
    p.idVerification ||
    p.liveMonitoring ||
    p.secureBrowser ||
    p.roomScan ||
    p.voiceMatch ||
    p.videoRecording ||
    p.screenRecording ||
    p.typingPattern
  );
}

// Options added after a policy was saved start off, so an organization
// never collects more than it agreed to without saving again.
const LATER_OPTIONS = ["audioMonitoring", "videoRecording", "screenRecording", "typingPattern"] as const;

// Individuals: copy and paste blocked and randomized forms, no camera beyond
// the face check they already do before a test.
const INDIVIDUAL_POLICY: ProctoringPolicy = { ...presetPolicy("standard", "global"), webcamMonitoring: false, multiMonitorCheck: false, audioMonitoring: false };

// An organization that never saved a policy keeps tests free of cameras:
// the lockdown, randomized forms and listening of the standard preset.
const UNSAVED_POLICY: ProctoringPolicy = { ...presetPolicy("standard", "global"), webcamMonitoring: false };

export function normalizePolicy(stored: unknown): ProctoringPolicy {
  if (stored === null || stored === undefined) return UNSAVED_POLICY;
  const parsed = policySchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  // Older or partial rows: fill gaps from the matching preset.
  const s = (stored ?? {}) as Partial<ProctoringPolicy>;
  const mode = PROCTORING_MODES.includes(s.mode as ProctoringMode) ? (s.mode as ProctoringMode) : "standard";
  const region = PROCTORING_REGIONS.includes(s.region as ProctoringRegion) ? (s.region as ProctoringRegion) : "global";
  const merged: Record<string, unknown> = { ...presetPolicy(mode, region), ...s, mode, region };
  for (const k of LATER_OPTIONS) if (typeof s[k] !== "boolean") merged[k] = false;
  return policySchema.safeParse(merged).success ? (merged as ProctoringPolicy) : presetPolicy(mode, region);
}

// Employees and recruitment candidates have separate policies: an
// organization usually checks its own staff lightly and candidates strictly.
export type PolicyAudience = "employees" | "candidates";
const POLICY_COLUMN: Record<PolicyAudience, string> = { employees: "proctoring", candidates: "recruitment_proctoring" };

// Candidates of an organization that never saved their policy get the
// strict preset.
export function normalizeCandidatePolicy(stored: unknown): ProctoringPolicy {
  return stored === null || stored === undefined ? presetPolicy("strict", "global") : normalizePolicy(stored);
}

export async function tenantPolicy(tenantId: string, audience: PolicyAudience = "employees"): Promise<ProctoringPolicy> {
  const r = await pool.query(`SELECT ${POLICY_COLUMN[audience]} AS p FROM tenants WHERE id = $1`, [tenantId]);
  return audience === "candidates" ? normalizeCandidatePolicy(r.rows[0]?.p) : normalizePolicy(r.rows[0]?.p);
}

export async function saveTenantPolicy(tenantId: string, policy: ProctoringPolicy, audience: PolicyAudience = "employees"): Promise<void> {
  await pool.query(`UPDATE tenants SET ${POLICY_COLUMN[audience]} = $2 WHERE id = $1`, [tenantId, JSON.stringify(policy)]);
}

// The policy that applies to one learner: their organization's, or the
// individual default.
export async function learnerPolicy(userId: string): Promise<{ policy: ProctoringPolicy; tenantId: string | null; candidate?: boolean }> {
  const r = await pool.query(
    `SELECT u.role, t.id, t.type, t.proctoring, t.recruitment_proctoring FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [userId],
  );
  const t = r.rows[0];
  if (t?.role === "candidate") return { policy: normalizeCandidatePolicy(t.recruitment_proctoring), tenantId: t.id, candidate: true };
  if (!t || t.type !== "cohort") return { policy: INDIVIDUAL_POLICY, tenantId: t?.id ?? null };
  return { policy: normalizePolicy(t.proctoring), tenantId: t.id };
}

// A practice test runs the same anti-cheating checks in the background as a
// mock test (copy and paste off, leaving the tab recorded, camera snapshots
// and listening between answers where the organization uses them), but
// nothing that adds a screen or a prompt: no full screen, no screen or video
// recording, no live proctor, no Safe Exam Browser. Pausing stays allowed.
export function practicePolicy(p: ProctoringPolicy): ProctoringPolicy {
  if (p.mode === "off") return { ...presetPolicy("off", p.region), retentionDays: p.retentionDays };
  return { ...mockPolicy(p), requireFullscreen: false, screenRecording: false, videoRecording: false, liveMonitoring: false, secureBrowser: false };
}

// A learner's mock test starts with the same screens as a practice test: the
// organization's monitoring during the test stays, but the ID photo, room scan
// and voice sample are only asked before the real assessment (and its sample).
// Candidates keep their recruiter's policy.
export function mockPolicy(p: ProctoringPolicy): ProctoringPolicy {
  return { ...p, idVerification: false, roomScan: false, voiceMatch: false };
}

// The real assessment attempt is always strictly proctored (biometrics follow
// the region's rules); its sample runs the same way, so the learner meets
// every check before the attempt that counts.
export function certifiedPolicy(p: ProctoringPolicy): ProctoringPolicy {
  return presetPolicy("strict", p.region);
}

// The policy for one session: the learner's, made light for a practice
// session and a mock test, and strict for a real attempt or its sample.
export async function sessionPolicy(sessionId: string, userId: string): Promise<{ policy: ProctoringPolicy; tenantId: string | null }> {
  const { policy, tenantId, candidate } = await learnerPolicy(userId);
  const s = (await pool.query(`SELECT delivery_mode FROM sessions WHERE id = $1`, [sessionId])).rows[0];
  const mode = s?.delivery_mode;
  return {
    policy:
      mode === "practice"
        ? practicePolicy(policy)
        : mode === "certified" || mode === "sample"
          ? certifiedPolicy(policy)
          : mode === "mock" && !candidate
            ? mockPolicy(policy)
            : policy,
    tenantId,
  };
}

// Consent wording version. Changing the wording means a new version, so
// learners are asked again.
export function consentVersion(p: ProctoringPolicy): string {
  return `proctoring-v2-${p.region}`;
}
