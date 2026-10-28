// Telling reviewers about a test session: right away when something serious
// shows on camera, and once more when a finished test is flagged, so nobody
// has to keep opening Test integrity to find problems.
import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { PROCTORED_SESSION_TYPES } from "./policy.js";

export type LiveAlertKind =
  | "multiple_people"
  | "face_mismatch"
  | "face_unconfirmed"
  | "spoof"
  | "phone"
  | "away"
  | "camera_off"
  | "camera_covered"
  | "camera_frozen";

const ALERT_TITLE: Record<LiveAlertKind, string> = {
  multiple_people: "Two people in view",
  face_mismatch: "A different face on camera",
  face_unconfirmed: "Face couldn't be confirmed",
  spoof: "A photo or screen held up to the camera",
  phone: "A phone in view",
  away: "Learner left the camera's view",
  camera_off: "Camera turned off",
  camera_covered: "Camera covered",
  camera_frozen: "Camera picture froze",
};

const ALERT_TEXT: Record<LiveAlertKind, string> = {
  multiple_people: "more than one person was seen on camera",
  face_mismatch: "the face on camera doesn't match the learner's enrolled face",
  face_unconfirmed: "the face on camera couldn't be confirmed as the learner",
  spoof: "a photo or screen was held up to the camera instead of a live face",
  phone: "a phone was seen on camera",
  away: "nobody was in front of the camera",
  camera_off: "the camera was turned off or couldn't be opened",
  camera_covered: "the camera picture went dark, as if covered",
  camera_frozen: "the camera picture stopped changing, as if replaced by a still image",
};

// Risk reasons in the reviewer's words, for the end-of-test notice. Codes
// without a label here are rare and show as they are.
const REASON_LABEL: Record<string, string> = {
  tab_hidden: "left the test tab",
  window_blur: "test window lost focus",
  fullscreen_exit: "left full screen",
  paste_blocked: "tried to paste",
  print_screen: "pressed a screenshot key",
  multi_monitor: "a second screen was connected",
  second_tab: "test open in two tabs",
  typing_burst: "text appeared without typing",
  camera_off: "camera turned off",
  camera_covered: "camera covered",
  camera_frozen: "camera picture froze",
  noisy_answer: "noisy spoken answers",
  test_hold: "test paused for a problem in the room",
  hold_warning: "warned about a problem in the room",
  test_paused: "paused the practice test",
  test_resumed: "continued the practice test",
  away_from_camera: "no face in many snapshots",
  multiple_faces: "more than one face on camera",
  extra_person: "another person on camera",
  face_mismatch: "face didn't match",
  phone_in_view: "phone on camera",
  face_check_flagged: "face checks flagged",
  face_check_uncertain: "face couldn't be confirmed",
  face_unconfirmed: "face couldn't be confirmed",
  face_missing: "no face at face checks",
  extra_face: "more than one face at face checks",
  looking_away: "often looking away",
  voice_mismatch: "a different voice answered",
  background_speech: "talking heard between answers",
  typing_inconsistent: "typing rhythm changed",
  id_rejected: "ID check rejected",
  id_missing: "no ID check",
  id_pending: "ID check waiting for review",
  manual_identity_check: "chose a manual identity check",
  terminated: "ended by the proctor",
};

const REVIEW_PATH: Record<string, string> = {
  org_admin: "/orgadmin/integrity",
  recruiter: "/recruiter/integrity",
  admin: "/admin/integrity",
  super_admin: "/superadmin/integrity",
};

interface Recipient {
  id: string;
  role: string;
}

// Who reviews this learner's tests. An organization's learner: its Org
// Admins, the Edstellar Admins who manage it with Score review, the Super
// Admins, and for a candidate the recruiter who sent the invitation. An
// individual learner: the Super Admins and every Admin with Score review.
export async function integrityRecipients(userId: string): Promise<Recipient[]> {
  const u = (
    await pool.query(
      `SELECT u.role, u.tenant_id, t.type, t.managed_by, t.account_manager_id FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId],
    )
  ).rows[0];
  if (!u) return [];
  const ids = new Set<string>();
  if (u.tenant_id && u.type === "cohort") {
    for (const id of await orgAdminIds(u.tenant_id)) ids.add(id);
    const managers = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1) AND role = 'admin' AND deleted_at IS NULL AND (permissions->>'scoreReview')::boolean IS TRUE`,
      [[u.managed_by, u.account_manager_id].filter(Boolean)],
    );
    for (const r of managers.rows) ids.add(r.id);
    const supers = await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`);
    for (const r of supers.rows) ids.add(r.id);
    if (u.role === "candidate") {
      const inviter = (
        await pool.query(
          `SELECT a.invited_by FROM recruitment_assessments a JOIN users r ON r.id = a.invited_by
           WHERE a.candidate_id = $1 AND r.role = 'recruiter' AND r.deleted_at IS NULL ORDER BY a.invited_at DESC LIMIT 1`,
          [userId],
        )
      ).rows[0];
      if (inviter) ids.add(inviter.invited_by);
    }
  } else {
    const staff = await pool.query(
      `SELECT id FROM users WHERE deleted_at IS NULL AND (role = 'super_admin' OR (role = 'admin' AND (permissions->>'scoreReview')::boolean IS TRUE))`,
    );
    for (const r of staff.rows) ids.add(r.id);
  }
  if (ids.size === 0) return [];
  const rows = await pool.query(`SELECT id, role FROM users WHERE id = ANY($1) AND deleted_at IS NULL`, [[...ids]]);
  return rows.rows.filter((r) => REVIEW_PATH[r.role]);
}

// A Super Admin hears about every organization, so their emails default to
// one daily summary; everyone else gets each alert as it happens.
export function defaultAlertEmail(role: string): "instant" | "daily" {
  return role === "super_admin" ? "daily" : "instant";
}

async function emailsInstantly(r: Recipient): Promise<boolean> {
  const pref = (await pool.query(`SELECT integrity_alerts FROM user_notification_prefs WHERE user_id = $1`, [r.id])).rows[0];
  return (pref?.integrity_alerts ?? defaultAlertEmail(r.role)) === "instant";
}

async function sessionLabel(sessionId: string): Promise<{ userId: string; who: string; completed: boolean } | null> {
  const s = (
    await pool.query(
      `SELECT s.user_id, s.test_code, s.completed_at, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!s) return null;
  return { userId: s.user_id, who: `${s.name}'s test${s.test_code ? ` (Attempt ID ${s.test_code})` : ""}`, completed: !!s.completed_at };
}

// One alert per kind per session for each reviewer, while the test runs.
// In-app only, never emailed: a moment away from the camera isn't worth an
// email; the finished test's review (and its flag, if any) is.
export async function sendLiveAlert(sessionId: string, kind: LiveAlertKind): Promise<void> {
  const s = await sessionLabel(sessionId);
  if (!s || s.completed) return;
  const title = `Live test alert: ${ALERT_TITLE[kind]}`;
  const body = `${s.who}: ${ALERT_TEXT[kind]}. The test is still running.`;
  for (const r of await integrityRecipients(s.userId)) {
    await notify({
      userId: r.id,
      kind: "integrity_alert",
      title,
      body,
      link: `${REVIEW_PATH[r.role]}?session=${sessionId}`,
      dedupeKey: `integrity-live:${sessionId}:${kind}:${r.id}`,
    }).catch((err) => console.error("integrity alert failed:", err));
  }
}

// Fire and forget: an alert must never slow down or fail the learner's request.
export function liveAlert(sessionId: string, kind: LiveAlertKind) {
  sendLiveAlert(sessionId, kind).catch((err) => console.error("integrity alert failed:", err));
}

// Once, when a finished test is flagged for review, with its main reasons.
export async function notifyFlagged(sessionId: string, riskLevel: string, reasons: { code: string; count: number; points: number }[]): Promise<void> {
  const s = await sessionLabel(sessionId);
  if (!s) return;
  const top = [...reasons]
    .filter((r) => r.points > 0 || r.code === "id_pending" || r.code === "manual_identity_check")
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((r) => `${REASON_LABEL[r.code] ?? r.code.replace(/_/g, " ")}${r.count > 1 ? ` (×${r.count})` : ""}`);
  const title = `Test flagged for review: ${riskLevel} risk`;
  const body = `${s.who} needs an integrity review${top.length ? `: ${top.join(", ")}` : ""}.`;
  for (const r of await integrityRecipients(s.userId)) {
    await notify({
      userId: r.id,
      kind: "integrity_flag",
      title,
      body,
      link: `${REVIEW_PATH[r.role]}?session=${sessionId}`,
      dedupeKey: `integrity:${sessionId}:${r.id}`,
      email: await emailsInstantly(r),
      emailSubject: title,
    }).catch((err) => console.error("integrity notification failed:", err));
  }
}

// Hourly: reviewers who chose a daily summary get one email covering the
// alerts and flagged tests since their last summary.
export async function sendIntegrityDigests(): Promise<number> {
  const due = await pool.query(
    `SELECT u.id AS user_id, u.role,
       (SELECT max(created_at) FROM notifications d WHERE d.user_id = u.id AND d.kind = 'integrity_digest') AS last_digest
     FROM users u LEFT JOIN user_notification_prefs p ON p.user_id = u.id
     WHERE u.deleted_at IS NULL AND (p.integrity_alerts = 'daily' OR (p.integrity_alerts IS NULL AND u.role = 'super_admin'))`,
  );
  let sent = 0;
  for (const row of due.rows) {
    if (!REVIEW_PATH[row.role]) continue;
    if (row.last_digest && Date.now() - new Date(row.last_digest).getTime() < 23 * 3600_000) continue;
    const since = row.last_digest ?? new Date(Date.now() - 24 * 3600_000);
    const items = (
      await pool.query(
        `SELECT kind, title, body FROM notifications WHERE user_id = $1 AND kind IN ('integrity_alert', 'integrity_flag') AND created_at > $2 ORDER BY created_at`,
        [row.user_id, since],
      )
    ).rows;
    if (items.length === 0) continue;
    const flagged = items.filter((i) => i.kind === "integrity_flag").length;
    const alerts = items.length - flagged;
    const title = `Daily test integrity summary: ${flagged} flagged, ${alerts} live ${alerts === 1 ? "alert" : "alerts"}`;
    const result = await notify({
      userId: row.user_id,
      kind: "integrity_digest",
      title,
      body: `Since your last summary: ${flagged} ${flagged === 1 ? "test was" : "tests were"} flagged for review and ${alerts} live ${alerts === 1 ? "alert was" : "alerts were"} raised.`,
      link: REVIEW_PATH[row.role],
      dedupeKey: `integrity-digest:${row.user_id}:${new Date().toISOString().slice(0, 13)}`,
      email: true,
      emailSubject: title,
      emailText: items.map((i) => `• ${i.title}\n  ${i.body}`).join("\n\n"),
    }).catch(() => null);
    if (result) sent++;
  }
  return sent;
}

// The face check during a test (random moments, about once a minute): puts
// what it saw on the session's timeline and raises a live alert when it
// matters. Ignored unless the session is the learner's own running test.
export async function faceCheckSignal(userId: string, sessionId: string, decision: string): Promise<void> {
  const s = (
    await pool.query(`SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = ANY($3) AND completed_at IS NULL`, [
      sessionId,
      userId,
      PROCTORED_SESSION_TYPES,
    ])
  ).rows[0];
  if (!s) return;
  const EVENTS: Record<string, { type: string; severity: string }> = {
    no_face: { type: "face_missing", severity: "high" },
    multiple_faces: { type: "extra_face", severity: "high" },
    mismatch: { type: "face_different", severity: "high" },
    uncertain: { type: "face_unconfirmed", severity: "warn" },
    spoof: { type: "face_spoof", severity: "high" },
  };
  const event = EVENTS[decision] ?? null;
  if (event) {
    await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity, detail) VALUES ($1, $2, $3, $4, $5)`, [
      sessionId,
      userId,
      event.type,
      event.severity,
      JSON.stringify({ reason: "Face check during the test" }),
    ]);
  }
  if (decision === "multiple_faces") liveAlert(sessionId, "multiple_people");
  else if (decision === "mismatch") liveAlert(sessionId, "face_mismatch");
  else if (decision === "uncertain") liveAlert(sessionId, "face_unconfirmed");
  else if (decision === "spoof") liveAlert(sessionId, "spoof");
  else if (decision === "no_face") liveAlert(sessionId, "away");
}
