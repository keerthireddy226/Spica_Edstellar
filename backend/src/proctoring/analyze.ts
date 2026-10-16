// Turns a proctored session's signals into a risk score and a list of
// reasons a reviewer can read. The score only decides what a person looks
// at first: "flagged" means "needs a human", never "cheated".
import { pool } from "../db.js";
import { notifyFlagged } from "./alerts.js";
import { enqueue } from "../queue/queue.js";
import { learnerPolicy, needsConsent, normalizePolicy } from "./policy.js";
import { runTypingCheck } from "./typing.js";

export interface IntegrityReason {
  code: string;
  count: number;
  points: number;
}

// Points per occurrence and a cap, so one noisy signal can't dominate.
const EVENT_WEIGHTS: Record<string, { each: number; cap: number }> = {
  tab_hidden: { each: 2, cap: 12 },
  window_blur: { each: 1, cap: 6 },
  fullscreen_exit: { each: 2, cap: 10 },
  paste_blocked: { each: 3, cap: 12 },
  copy_blocked: { each: 1, cap: 5 },
  cut_blocked: { each: 1, cap: 5 },
  context_menu: { each: 1, cap: 3 },
  print_screen: { each: 5, cap: 10 },
  multi_monitor: { each: 10, cap: 10 },
  second_tab: { each: 10, cap: 10 },
  typing_burst: { each: 5, cap: 15 },
  camera_off: { each: 8, cap: 16 },
  mic_off: { each: 4, cap: 8 },
  devtools: { each: 5, cap: 10 },
  camera_covered: { each: 8, cap: 16 },
  camera_frozen: { each: 8, cap: 16 },
  background_speech: { each: 4, cap: 16 },
  screen_share_stopped: { each: 8, cap: 16 },
  screen_not_entire: { each: 10, cap: 10 },
  // Not misconduct: listed so the learner and reviewer see it, adds no risk.
  noisy_answer: { each: 0, cap: 0 },
};

// A snapshot counts as looking away when the head turns this far from the
// learner's own usual position in the same test (see headPose.ts).
const AWAY_YAW = 0.35;
const AWAY_PITCH = 0.3;

const CAMERA_ISSUES = new Set([
  "away_from_camera",
  "multiple_faces",
  "extra_person",
  "face_mismatch",
  "face_unconfirmed",
  "face_check_flagged",
  "face_check_uncertain",
  "face_missing",
  "extra_face",
  "camera_off",
  "camera_covered",
  "camera_frozen",
  "no_snapshots",
]);

const HIGH_AT = 30;
const MEDIUM_AT = 12;

export async function analyzeSession(sessionId: string): Promise<{ riskScore: number; riskLevel: string; status: string } | null> {
  const si = (await pool.query(`SELECT * FROM session_integrity WHERE session_id = $1`, [sessionId])).rows[0];
  if (!si) return null;
  const policy = si.policy ?? {};
  const reasons: IntegrityReason[] = [];
  const add = (code: string, count: number, points: number) => {
    if (count > 0) reasons.push({ code, count, points });
  };

  const events = await pool.query(`SELECT type, count(*)::int AS n FROM proctoring_events WHERE session_id = $1 GROUP BY type`, [sessionId]);
  for (const e of events.rows) {
    const w = EVENT_WEIGHTS[e.type];
    if (w) add(e.type, e.n, Math.min(w.cap, w.each * e.n));
  }

  const snaps = (
    await pool.query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE face_count = 0)::int AS no_face,
         count(*) FILTER (WHERE face_count > 1)::int AS multiple_faces,
         count(*) FILTER (WHERE face_decision = 'mismatch')::int AS face_mismatch,
         count(*) FILTER (WHERE face_decision = 'uncertain')::int AS face_uncertain,
         count(*) FILTER (WHERE objects @> '[{"label":"cell_phone"}]')::int AS phone,
         count(*) FILTER (WHERE (SELECT count(*) FROM jsonb_array_elements(coalesce(objects, '[]')) o WHERE o->>'label' = 'person') > 1)::int AS extra_person
       FROM proctoring_media WHERE session_id = $1 AND kind = 'snapshot'`,
      [sessionId],
    )
  ).rows[0];
  add("away_from_camera", snaps.no_face, Math.min(16, snaps.no_face * 4));
  add("multiple_faces", snaps.multiple_faces, Math.min(20, snaps.multiple_faces * 10));
  add("extra_person", snaps.extra_person, Math.min(16, snaps.extra_person * 8));
  add("face_mismatch", snaps.face_mismatch, Math.min(30, snaps.face_mismatch * 15));
  add("face_unconfirmed", snaps.face_uncertain, Math.min(15, snaps.face_uncertain * 5));
  add("phone_in_view", snaps.phone, Math.min(20, snaps.phone * 10));
  if (policy.webcamMonitoring && snaps.total === 0) add("no_snapshots", 1, 10);

  // Looking away: compared with this learner's median head position, since a
  // camera beside the screen shifts everyone's baseline.
  const poses = (
    await pool.query(`SELECT head_yaw::float AS yaw, head_pitch::float AS pitch FROM proctoring_media WHERE session_id = $1 AND kind = 'snapshot' AND head_yaw IS NOT NULL`, [
      sessionId,
    ])
  ).rows as { yaw: number; pitch: number }[];
  if (poses.length >= 4) {
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const my = median(poses.map((p) => p.yaw));
    const mp = median(poses.map((p) => p.pitch));
    const away = poses.filter((p) => Math.abs(p.yaw - my) > AWAY_YAW || Math.abs(p.pitch - mp) > AWAY_PITCH).length;
    // Glancing away now and then is normal; a fifth of the test is not.
    if (away / poses.length > 0.2) add("looking_away", away, Math.min(15, 3 + away * 2));
  }

  for (const [flag, kind, code] of [
    ["videoRecording", "video_segment", "video_missing"],
    ["screenRecording", "screen_segment", "screen_missing"],
  ] as const) {
    if (!policy[flag]) continue;
    const n = (await pool.query(`SELECT count(*)::int AS n FROM proctoring_media WHERE session_id = $1 AND kind = $2`, [sessionId, kind])).rows[0].n;
    if (n === 0) add(code, 1, 10);
  }

  const typing = si.checks?.typing;
  if (typing?.decision === "inconsistent") add("typing_inconsistent", 1, 8);
  if (typing?.decision === "uncertain") add("typing_uncertain", 1, 2);

  // The face check during the test, about once a minute at random moments.
  const checks = (
    await pool.query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE decision IN ('mismatch', 'spoof'))::int AS failed,
         count(*) FILTER (WHERE decision = 'uncertain')::int AS uncertain,
         count(*) FILTER (WHERE decision = 'no_face')::int AS no_face,
         count(*) FILTER (WHERE decision = 'multiple_faces')::int AS multiple
       FROM face_check_results WHERE session_id = $1`,
      [sessionId],
    )
  ).rows[0];
  add("face_check_flagged", checks.failed, Math.min(30, checks.failed * 15));
  add("face_check_uncertain", checks.uncertain, Math.min(15, checks.uncertain * 5));
  add("face_missing", checks.no_face, Math.min(16, checks.no_face * 4));
  add("extra_face", checks.multiple, Math.min(20, checks.multiple * 10));

  const voice = (
    await pool.query(`SELECT decision FROM voice_check_results WHERE session_id = $1 AND method = 'session_consistency' ORDER BY created_at DESC LIMIT 1`, [sessionId])
  ).rows[0];
  if (voice?.decision === "mismatch") add("voice_mismatch", 1, 25);
  if (voice?.decision === "uncertain") add("voice_uncertain", 1, 6);

  if (policy.roomScan) {
    const scan = (await pool.query(`SELECT 1 FROM proctoring_media WHERE session_id = $1 AND kind = 'room_scan' LIMIT 1`, [sessionId])).rows[0];
    if (!scan) add("room_scan_missing", 1, 8);
  }
  if (policy.secureBrowser && si.secure_browser !== true) add("secure_browser_missing", 1, 15);

  let needsHuman = false;
  if (policy.idVerification) {
    const id = (await pool.query(`SELECT status, mrz, liveness_score, auto_decision FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [si.user_id])).rows[0];
    // What was read from the document, while a reviewer hasn't decided yet.
    if (id && id.status === "pending") {
      if (id.mrz?.expired === true) add("id_expired", 1, 15);
      if (id.mrz?.nameMatches === false && id.mrz?.checksumsValid) add("id_name_mismatch", 1, 10);
      if (id.auto_decision === "faces_differ") add("id_face_differs", 1, 10);
      if (id.liveness_score !== null && Number(id.liveness_score) < 0.5) add("id_selfie_not_live", 1, 15);
    }
    if (!id) add("id_missing", 1, 15);
    else if (id.status === "rejected") add("id_rejected", 1, 30);
    else if (id.status === "pending") {
      add("id_pending", 1, 0);
      needsHuman = true;
    }
  }
  if (si.biometric_opt_out && (policy.faceMatch || policy.voiceMatch)) {
    add("manual_identity_check", 1, 0);
    needsHuman = true;
  }
  if (si.terminated_at) add("terminated", 1, 40);

  // No face, another face, an unconfirmed face or an empty, dark or frozen
  // camera: even once is enough for a person to look at the test.
  if (reasons.some((r) => CAMERA_ISSUES.has(r.code))) needsHuman = true;

  const riskScore = reasons.reduce((n, r) => n + r.points, 0);
  const riskLevel = riskScore >= HIGH_AT ? "high" : riskScore >= MEDIUM_AT ? "medium" : "low";
  const flagged = riskLevel !== "low" || needsHuman;
  // A reviewer's decision stands; only unreviewed sessions change status.
  const status = si.reviewed_at ? si.status : flagged ? "flagged" : "clear";

  await pool.query(
    `UPDATE session_integrity SET risk_score = $2, risk_level = $3, reasons = $4, status = $5, analyzed_at = now(), updated_at = now() WHERE session_id = $1`,
    [sessionId, riskScore, riskLevel, JSON.stringify(reasons), status],
  );

  // A flagged placement waits for review instead of standing as certified.
  if (status === "flagged" && si.session_type === "placement") {
    await pool.query(`UPDATE placements SET status = 'pending_review' WHERE session_id = $1 AND status = 'certified' AND reviewed_at IS NULL`, [sessionId]);
  }

  // Every newly flagged test reaches its reviewers, whatever the risk level.
  if (status === "flagged" && si.status !== "flagged") {
    await notifyFlagged(sessionId, riskLevel, reasons).catch((err) => console.error("integrity notification failed:", err));
  }
  return { riskScore, riskLevel, status };
}

// Called when a proctored session completes: score it now from what's
// already known, then run the slower voice check in the background.
export async function finishProctoredSession(sessionId: string) {
  const si = (await pool.query(`SELECT policy, biometric_opt_out FROM session_integrity WHERE session_id = $1`, [sessionId])).rows[0];
  if (!si) return null;
  await runTypingCheck(sessionId).catch((err) => console.error("typing check failed:", err));
  const result = await analyzeSession(sessionId);
  if (si.policy?.voiceMatch && !si.biometric_opt_out) await enqueue("proctoring.voice", { sessionId }, { dedupeKey: `proctoring.voice:${sessionId}` });
  return result;
}

export async function isTerminated(sessionId: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM session_integrity WHERE session_id = $1 AND terminated_at IS NOT NULL`, [sessionId]);
  return (r.rowCount ?? 0) > 0;
}

// Why an answer can't be saved yet: the proctor ended the session, or the
// learner hasn't been through the consent step the policy needs. null = fine.
export async function proctoringBlock(sessionId: string, userId: string): Promise<"session_terminated" | "proctoring_setup_required" | null> {
  const si = (await pool.query(`SELECT terminated_at, consent_record_id, policy FROM session_integrity WHERE session_id = $1`, [sessionId])).rows[0];
  if (si?.terminated_at) return "session_terminated";
  if (si) return needsConsent(normalizePolicy(si.policy)) && !si.consent_record_id ? "proctoring_setup_required" : null;
  const { policy } = await learnerPolicy(userId);
  return policy.mode !== "off" && needsConsent(policy) ? "proctoring_setup_required" : null;
}
