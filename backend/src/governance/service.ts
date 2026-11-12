import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { releaseQueuedMonths } from "../licenses/service.js";
import { recordAudit } from "../audit/service.js";
import { notify } from "../notifications/service.js";
import { removeMedia } from "../proctoring/storage.js";
import { sendInactiveAccountWarningEmail } from "../auth/mailer.js";

export const EXPORT_DIR = path.resolve("uploads", "exports");
const EXPORT_TTL_DAYS = 7;
export const DPA_VERSION = "2026-10-29";

// Stored URIs look like "/uploads/attempts/x.webm"; only ever delete inside uploads/.
async function removeUpload(uri: string | null) {
  if (!uri || !uri.startsWith("/uploads/")) return;
  const file = path.resolve(uri.slice(1));
  if (!file.startsWith(path.resolve("uploads") + path.sep)) return;
  await unlink(file).catch(() => {});
}

// ---- Withdrawing face and voice consent ----

// Deletes the enrolled face photo and voice samples and marks the face and
// voice agreements withdrawn. A later test that needs a face or voice check
// asks to enrol (and agree) again.
export async function withdrawBiometrics(userId: string): Promise<{ face: boolean; voice: boolean }> {
  const client = await pool.connect();
  const files: string[] = [];
  let face = false;
  let voice = false;
  let tenantId: string | null = null;
  try {
    await client.query("BEGIN");
    tenantId = (await client.query(`SELECT tenant_id FROM users WHERE id = $1`, [userId])).rows[0]?.tenant_id ?? null;
    const f = await client.query(`DELETE FROM face_enrollments WHERE user_id = $1 RETURNING sample_uri`, [userId]);
    const v = await client.query(`DELETE FROM voice_enrollments WHERE user_id = $1 RETURNING sample_uri, sample_uri_2`, [userId]);
    face = (f.rowCount ?? 0) > 0;
    voice = (v.rowCount ?? 0) > 0;
    for (const r of [...f.rows, ...v.rows]) files.push(...Object.values(r).filter((x): x is string => typeof x === "string"));
    await client.query(
      `UPDATE consent_records SET revoked_at = now()
       WHERE user_id = $1 AND consent_type IN ('face_identity', 'voice_identity', 'proctoring_biometric') AND revoked_at IS NULL`,
      [userId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  for (const uri of files) await removeUpload(uri);
  await recordAudit({
    tenantId,
    actorId: userId,
    actorRole: "learner",
    action: "biometrics.withdrawn",
    targetType: "learner",
    targetId: userId,
    details: { face, voice },
  });
  return { face, voice };
}

// ---- Erasure (right to be forgotten) ----

// Removes everything that identifies a learner — name, email, phone,
// demographics, recordings, face and voice data, typed answers, IP addresses —
// while keeping anonymous learning statistics and license accounting intact.
export async function eraseLearner(args: { userId: string; actorId: string | null; actorRole: string; reason: string }): Promise<boolean> {
  const u = (await pool.query(`SELECT id, tenant_id, role, erased_at FROM users WHERE id = $1`, [args.userId])).rows[0];
  if (!u || !["learner", "candidate"].includes(u.role) || u.erased_at) return false;
  if (u.tenant_id && u.role === "learner") await releaseQueuedMonths({ tenantId: u.tenant_id, userId: u.id, actorId: args.actorId ?? u.id, reason: "Learner erased" });

  const files: string[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const collect = async (sql: string) => {
      for (const r of (await client.query(sql, [u.id])).rows) files.push(...Object.values(r).filter((v): v is string => typeof v === "string"));
    };
    await collect(`SELECT a.response_uri FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = $1 AND a.response_uri IS NOT NULL`);
    await collect(`SELECT t.audio_uri FROM coach_turns t JOIN sessions s ON s.id = t.session_id WHERE s.user_id = $1 AND t.audio_uri IS NOT NULL`);
    await collect(`SELECT sample_uri FROM face_enrollments WHERE user_id = $1`);
    await collect(`SELECT sample_uri FROM face_check_results WHERE user_id = $1 AND sample_uri IS NOT NULL`);
    await collect(`SELECT sample_uri, sample_uri_2 FROM voice_enrollments WHERE user_id = $1`);
    await collect(`SELECT sample_uri FROM voice_check_results WHERE user_id = $1 AND sample_uri IS NOT NULL`);
    const proctoringFiles = (await client.query(`SELECT uri FROM proctoring_media WHERE user_id = $1 AND uri IS NOT NULL`, [u.id])).rows.map((r) => r.uri as string);

    await client.query(
      `UPDATE attempts SET response_uri = NULL, response_text = CASE WHEN response_text IS NULL THEN NULL ELSE '' END
       WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`,
      [u.id],
    );
    await client.query(`UPDATE coach_turns SET audio_uri = NULL, transcript = NULL WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)`, [u.id]);
    for (const t of ["face_enrollments", "voice_enrollments", "webauthn_credentials", "webauthn_challenges", "reminder_preferences", "report_subscriptions",
      "notifications", "password_reset_tokens", "email_verification_tokens", "placement_reminder_tokens", "mfa_challenges", "face_fallback_otp_codes", "face_check_fallback_requests",
      "identity_verifications", "proctoring_media"]) {
      await client.query(`DELETE FROM ${t} WHERE user_id = $1`, [u.id]);
    }
    await client.query(`UPDATE face_check_results SET sample_uri = NULL WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE voice_check_results SET sample_uri = NULL, detail = NULL WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE proctoring_events SET detail = NULL WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE session_integrity SET live_message = NULL, review_note = NULL, terminate_reason = NULL WHERE user_id = $1`, [u.id]);
    files.push(...proctoringFiles.map((f) => `proctoring:${f}`));
    await client.query(`UPDATE login_events SET ip_address = NULL, user_agent = NULL WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE consent_records SET ip_address = NULL WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [u.id]);
    await client.query(
      `UPDATE participant_profiles SET city = NULL, country = NULL, gender = NULL, age_band = NULL, job_role = NULL, prev_score = NULL, prev_date = NULL
       WHERE user_id = $1`,
      [u.id],
    );
    await client.query(`UPDATE certificates SET learner_name = 'Erased learner', participant_id = NULL, revoked_at = coalesce(revoked_at, now()) WHERE user_id = $1`, [u.id]);
    await client.query(`UPDATE license_events SET user_email = NULL WHERE user_id = $1`, [u.id]);
    // A candidate's results stay as anonymous numbers for the job's statistics.
    await client.query(
      `UPDATE recruitment_assessments SET email = 'erased', first_name = NULL, last_name = NULL, decision_note = NULL WHERE candidate_id = $1`,
      [u.id],
    );
    await client.query(
      `UPDATE users SET email = $2, first_name = NULL, last_name = NULL, phone = NULL, job_title = NULL, participant_id = NULL,
         password_hash = $3, mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_hashes = NULL,
         deleted_at = coalesce(deleted_at, now()), erased_at = now(), updated_at = now()
       WHERE id = $1`,
      [u.id, `erased-${u.id}@erased.invalid`, await bcrypt.hash(randomUUID(), 4)],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  for (const f of files) {
    if (f.startsWith("proctoring:")) await removeMedia(f.slice("proctoring:".length));
    else await removeUpload(f);
  }
  await recordAudit({
    tenantId: u.tenant_id,
    actorId: args.actorId,
    actorRole: args.actorRole,
    actorLabel: args.actorRole === "system" ? "Retention policy" : null,
    action: "learner.erased",
    targetType: "learner",
    targetId: u.id,
    targetLabel: "Erased learner",
    details: { reason: args.reason },
  });
  return true;
}

// ---- Organization data export ----

export async function requestExport(tenantId: string, userId: string): Promise<string> {
  const r = await pool.query(`INSERT INTO data_exports (tenant_id, requested_by) VALUES ($1, $2) RETURNING id`, [tenantId, userId]);
  return r.rows[0].id;
}

// Everything the organization has in Spica, as one JSON document.
export async function buildExport(exportId: string): Promise<void> {
  const e = (await pool.query(`SELECT id, tenant_id, requested_by FROM data_exports WHERE id = $1 AND status = 'queued'`, [exportId])).rows[0];
  if (!e) return;
  const t = e.tenant_id;
  const q = async (sql: string) => (await pool.query(sql, [t])).rows;
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      format: "spica-organization-export/1",
      organization: (await q(`SELECT id, name, legal_name, category, industry, country, website, phone, address_line, city, state, postal_code,
          billing_contact_name, billing_contact_email, tax_id, plan_tier, created_at FROM tenants WHERE id = $1`))[0],
      people: await q(`SELECT id, role, email, first_name, last_name, participant_id, job_title, batch_id, created_at, deleted_at, erased_at
          FROM users WHERE tenant_id = $1 ORDER BY role, created_at`),
      batches: await q(`SELECT id, batch_code, name, status, start_date, duration_months, start_cefr, target_cefr, created_at, completed_at, archived_at
          FROM batches WHERE tenant_id = $1 ORDER BY created_at`),
      batchManagers: await q(`SELECT bm.batch_id, bm.user_id FROM batch_managers bm JOIN batches b ON b.id = bm.batch_id WHERE b.tenant_id = $1`),
      learnerProfiles: await q(`SELECT p.user_id, p.country, p.city, p.job_role, p.exam_preference, p.goal_level, p.daily_minutes_preference
          FROM participant_profiles p JOIN users u ON u.id = p.user_id WHERE u.tenant_id = $1`),
      placements: await q(`SELECT pl.user_id, pl.cefr_level, pl.taken_at FROM placements pl JOIN users u ON u.id = pl.user_id WHERE u.tenant_id = $1 ORDER BY pl.taken_at`),
      dailyActivity: await q(`SELECT user_id, day, sessions, attempts, active_ms FROM learner_activity_daily WHERE tenant_id = $1 ORDER BY day`),
      licensePurchases: await q(`SELECT id, quantity, source, unit_price_cents, currency, reference, purchased_at, pool_expires_at FROM license_purchases WHERE tenant_id = $1`),
      licenseAssignments: await q(`SELECT id, purchase_id, user_id, batch_id, source, starts_at, ends_at, reclaimed_at FROM license_assignments WHERE tenant_id = $1`),
      licenseEvents: await q(`SELECT kind, quantity, user_id, batch_name, note, created_at FROM license_events WHERE tenant_id = $1 ORDER BY created_at`),
      invoices: await q(`SELECT invoice_number, issued_at, description, quantity, currency, total, tax_amount FROM invoices WHERE tenant_id = $1`),
      // Recruitment: job openings, each candidate's assessment and result (never the link token), and credits.
      recruitmentJobs: await q(`SELECT id, title, department, location, test_kind, min_cefr, invite_valid_days, status, created_at, closed_at FROM recruitment_jobs WHERE tenant_id = $1 ORDER BY created_at`),
      recruitmentAssessments: await q(
        `SELECT a.id, a.job_id, a.email, a.first_name, a.last_name, a.status, s.test_code AS attempt_id, e.test_id, a.result, a.decision, a.decision_note,
           a.decided_at, a.invited_at, a.expires_at, a.started_at, a.completed_at
         FROM recruitment_assessments a LEFT JOIN sessions s ON s.id = a.session_id LEFT JOIN exams e ON e.id = a.exam_id
         WHERE a.tenant_id = $1 ORDER BY a.invited_at`,
      ),
      recruitmentCredits: await q(`SELECT delta, reason, note, assessment_id, created_at FROM recruitment_credit_events WHERE tenant_id = $1 ORDER BY created_at`),
      creditNotes: await q(`SELECT credit_note_number, issued_at, currency, amount, reason FROM credit_notes WHERE tenant_id = $1`),
      certificates: await q(`SELECT code, user_id, learner_name, batch_name, cefr_level, issued_at, revoked_at FROM certificates WHERE tenant_id = $1`),
      auditLog: await q(`SELECT created_at, actor_label, actor_role, action, target_type, target_label, details FROM audit_log
          WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10000`),
    };
    const dir = path.join(EXPORT_DIR, t);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${exportId}.json`);
    await writeFile(file, JSON.stringify(data, null, 2));
    const size = (await stat(file)).size;
    await pool.query(
      `UPDATE data_exports SET status = 'ready', file_path = $2, size_bytes = $3, completed_at = now(), expires_at = now() + make_interval(days => $4) WHERE id = $1`,
      [exportId, file, size, EXPORT_TTL_DAYS],
    );
    if (e.requested_by) {
      await notify({
        userId: e.requested_by,
        kind: "data_export_ready",
        title: "Your data export is ready",
        body: `Download it from Settings → Data within ${EXPORT_TTL_DAYS} days.`,
        link: "/orgadmin/settings",
        email: true,
      });
    }
  } catch (err) {
    await pool.query(`UPDATE data_exports SET status = 'failed', error = $2 WHERE id = $1`, [exportId, String(err).slice(0, 500)]);
    throw err;
  }
}

// ---- Retention (periodic) ----
// A test with nothing flagged keeps its proctoring media this long at most
// (shorter if the organization sets less); a flagged one keeps the
// organization's full period.
export const UNFLAGGED_MEDIA_DAYS = 30;
// A flagged test (or a confirmed violation) keeps its media at most this
// long; one still waiting for a reviewer keeps it up to a year.
export const FLAGGED_MEDIA_DAYS = 60;
// Proctoring event logs (tab switches, warnings and the like).
const EVENT_LOG_DAYS = 90;


// Proctoring snapshots, scans, voice samples and ID images go after the
// organization's proctoring retention period. Evidence for a session still
// waiting on a reviewer, or an ID still pending, is kept up to a year.
async function runProctoringRetention(): Promise<number> {
  const old = await pool.query(
    `SELECT m.id, m.uri FROM proctoring_media m
     JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN session_integrity si ON si.session_id = m.session_id
     WHERE m.uri IS NOT NULL
       AND m.created_at < now() - make_interval(days => CASE WHEN coalesce(si.status, '') IN ('flagged', 'violation')
             THEN least(coalesce((t.proctoring->>'retentionDays')::int, ${FLAGGED_MEDIA_DAYS}), ${FLAGGED_MEDIA_DAYS})
             ELSE least(coalesce((t.proctoring->>'retentionDays')::int, ${FLAGGED_MEDIA_DAYS}), ${UNFLAGGED_MEDIA_DAYS}) END)
       AND (m.created_at < now() - interval '365 days' OR NOT (
         coalesce(si.status, '') = 'flagged'
         OR EXISTS (SELECT 1 FROM identity_verifications iv WHERE iv.status = 'pending' AND m.id IN (iv.document_media_id, iv.selfie_media_id))
       ))
     LIMIT 5000`,
  );
  for (const m of old.rows) await removeMedia(m.uri);
  await pool.query(`UPDATE proctoring_media SET uri = NULL WHERE id = ANY($1::uuid[])`, [old.rows.map((m) => m.id)]);
  await pool.query(`DELETE FROM proctoring_events WHERE created_at < now() - make_interval(days => ${EVENT_LOG_DAYS})`);
  return old.rows.length;
}

// ---- Retention rules (owner decision, launch plan) ----
// Defaults for everyone; an organisation can set its own recording period (at
// most 12 months) and its own period for removed learners.
export const RETENTION = {
  templateMonths: 3, // face and voice templates, after the person's last test
  recordingMonths: 3, // spoken-answer recordings and face-check photos
  recordingMaxMonths: 12, // the longest an organisation may choose
  inactiveIndividualMonths: 12, // individual accounts without any activity
  warningDays: 30, // the warning email comes this long before deletion
  removedLearnerMonths: 12, // learners removed from an organisation
  auditLogMonths: 12,
};

// The new default rules only report what they would delete until this is
// "true" (set it after checking a week of reports). Rules an organisation set
// itself, proctoring media and candidates' retention always apply.
export function retentionEnforced(): boolean {
  return process.env.RETENTION_ENFORCE === "true";
}

// A test whose evidence must be kept: an open appeal or score review, a flag
// or an integrity review still in progress, or an answer waiting in the review queue.
const OPEN_CASE = `(
  EXISTS (SELECT 1 FROM result_appeals ra WHERE ra.session_id = s.id AND ra.status = 'open')
  OR EXISTS (SELECT 1 FROM session_integrity si WHERE si.session_id = s.id AND si.status IN ('flagged', 'in_progress'))
  OR EXISTS (SELECT 1 FROM review_queue rq WHERE rq.attempt_id = a.id AND rq.resolved_at IS NULL)
)`;

export interface RetentionReport {
  enforced: boolean;
  recordings: number;
  faceCheckPhotos: number;
  templates: number;
  warned: number;
  erased: number;
  auditRows: number;
  expiredExports: number;
  proctoringMedia: number;
  wouldDelete: { recordings: number; faceCheckPhotos: number; templates: number; warn: number; erase: number; auditRows: number };
}

export async function runRetention(): Promise<RetentionReport> {
  const enforce = retentionEnforced();
  const report: RetentionReport = {
    enforced: enforce,
    recordings: 0,
    faceCheckPhotos: 0,
    templates: 0,
    warned: 0,
    erased: 0,
    auditRows: 0,
    expiredExports: 0,
    proctoringMedia: 0,
    wouldDelete: { recordings: 0, faceCheckPhotos: 0, templates: 0, warn: 0, erase: 0, auditRows: 0 },
  };

  // 1. Spoken-answer recordings: the organisation's period (capped at 12
  // months), else 3 months; kept while the test has an open case.
  const recordings = await pool.query(
    `SELECT a.id, a.response_uri, (t.retention_recordings_months IS NOT NULL) AS explicit
     FROM attempts a JOIN sessions s ON s.id = a.session_id JOIN users u ON u.id = s.user_id LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE a.response_uri IS NOT NULL
       AND a.created_at < now() - make_interval(months => least(coalesce(t.retention_recordings_months, $1), $2))
       AND NOT ${OPEN_CASE}
     LIMIT 5000`,
    [RETENTION.recordingMonths, RETENTION.recordingMaxMonths],
  );
  const recNow = recordings.rows.filter((r) => enforce || r.explicit);
  report.wouldDelete.recordings = recordings.rows.length;
  for (const r of recNow) await removeUpload(r.response_uri);
  if (recNow.length) await pool.query(`UPDATE attempts SET response_uri = NULL WHERE id = ANY($1::uuid[])`, [recNow.map((r) => r.id)]);
  report.recordings = recNow.length;

  // Face-check photos taken during tests: the same periods.
  const photos = await pool.query(
    `SELECT fc.id, fc.sample_uri, (t.retention_recordings_months IS NOT NULL) AS explicit
     FROM face_check_results fc JOIN users u ON u.id = fc.user_id LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE fc.sample_uri IS NOT NULL
       AND fc.created_at < now() - make_interval(months => least(coalesce(t.retention_recordings_months, $1), $2))
     LIMIT 5000`,
    [RETENTION.recordingMonths, RETENTION.recordingMaxMonths],
  );
  const photosNow = photos.rows.filter((r) => enforce || r.explicit);
  report.wouldDelete.faceCheckPhotos = photos.rows.length;
  for (const f of photosNow) await removeUpload(f.sample_uri);
  if (photosNow.length) await pool.query(`UPDATE face_check_results SET sample_uri = NULL WHERE id = ANY($1::uuid[])`, [photosNow.map((f) => f.id)]);
  report.faceCheckPhotos = photosNow.length;

  // 2. Face and voice templates: 3 months after the person's last test (or
  // their enrolment, if later). The next test asks them to enrol again; their
  // consent stays as it is.
  const idle = `greatest(e.created_at, coalesce((SELECT max(s.started_at) FROM sessions s WHERE s.user_id = e.user_id), e.created_at))
                < now() - make_interval(months => $1)`;
  const face = await pool.query(`SELECT e.id, e.sample_uri FROM face_enrollments e WHERE ${idle} LIMIT 2000`, [RETENTION.templateMonths]);
  const voice = await pool.query(`SELECT e.id, e.sample_uri, e.sample_uri_2 FROM voice_enrollments e WHERE ${idle} LIMIT 2000`, [RETENTION.templateMonths]);
  report.wouldDelete.templates = face.rows.length + voice.rows.length;
  if (enforce) {
    for (const f of face.rows) await removeUpload(f.sample_uri);
    for (const v of voice.rows) {
      await removeUpload(v.sample_uri);
      await removeUpload(v.sample_uri_2);
    }
    if (face.rows.length) await pool.query(`DELETE FROM face_enrollments WHERE id = ANY($1::uuid[])`, [face.rows.map((r) => r.id)]);
    if (voice.rows.length) await pool.query(`DELETE FROM voice_enrollments WHERE id = ANY($1::uuid[])`, [voice.rows.map((r) => r.id)]);
    report.templates = face.rows.length + voice.rows.length;
  }

  // 3. Individual accounts with no activity for 12 months: a warning email 30
  // days before, then deletion. Never while the account holds a valid
  // certificate, or a plan or credits that are not used up or ended.
  const lastActive = `greatest(u.created_at,
      coalesce((SELECT max(l.created_at) FROM login_events l WHERE l.user_id = u.id), u.created_at),
      coalesce((SELECT max(s.started_at) FROM sessions s WHERE s.user_id = u.id), u.created_at))`;
  const keep = `(
    EXISTS (SELECT 1 FROM certificates c WHERE c.user_id = u.id AND c.revoked_at IS NULL AND (c.valid_until IS NULL OR c.valid_until > now()))
    OR EXISTS (SELECT 1 FROM entitlements en WHERE en.user_id = u.id AND en.revoked_at IS NULL AND (en.ends_at IS NULL OR en.ends_at > now())
               AND (en.attempts_total IS NULL OR coalesce(en.attempts_used, 0) < en.attempts_total))
  )`;
  const individual = `u.role = 'learner' AND u.erased_at IS NULL AND u.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = u.tenant_id AND t.type LIKE 'individual%')`;
  // Someone active again after a warning is no longer due.
  if (enforce) await pool.query(`UPDATE users u SET deletion_warned_at = NULL WHERE u.deletion_warned_at IS NOT NULL AND ${lastActive} > u.deletion_warned_at`);
  const toWarn = await pool.query(
    `SELECT u.id, u.email FROM users u
     WHERE ${individual} AND u.deletion_warned_at IS NULL AND NOT ${keep}
       AND ${lastActive} < now() - make_interval(months => $1) + make_interval(days => $2)
     LIMIT 500`,
    [RETENTION.inactiveIndividualMonths, RETENTION.warningDays],
  );
  report.wouldDelete.warn = toWarn.rows.length;
  if (enforce) {
    for (const u of toWarn.rows) {
      try {
        await sendInactiveAccountWarningEmail(u.email, RETENTION.warningDays);
        await pool.query(`UPDATE users SET deletion_warned_at = now() WHERE id = $1`, [u.id]);
        report.warned++;
      } catch (err) {
        console.error("inactive account warning failed:", err);
      }
    }
  }
  const toErase = await pool.query(
    `SELECT u.id FROM users u
     WHERE ${individual} AND u.deletion_warned_at < now() - make_interval(days => $1) AND NOT ${keep}
       AND ${lastActive} < u.deletion_warned_at
     LIMIT 500`,
    [RETENTION.warningDays],
  );
  report.wouldDelete.erase = toErase.rows.length;

  // Learners removed from an organisation: the organisation's period, else 12 months.
  const removed = await pool.query(
    `SELECT u.id, (t.retention_inactive_learner_months IS NOT NULL) AS explicit, coalesce(t.retention_inactive_learner_months, $1) AS months
     FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role = 'learner' AND u.erased_at IS NULL AND u.deleted_at IS NOT NULL AND t.type = 'cohort'
       AND u.deleted_at < now() - make_interval(months => coalesce(t.retention_inactive_learner_months, $1))
     LIMIT 500`,
    [RETENTION.removedLearnerMonths],
  );
  report.wouldDelete.erase += removed.rows.length;
  const eraseNow = [
    ...(enforce ? toErase.rows.map((r) => ({ id: r.id as string, reason: `No activity for ${RETENTION.inactiveIndividualMonths} months` })) : []),
    ...removed.rows.filter((r) => enforce || r.explicit).map((r) => ({ id: r.id as string, reason: `Removed from the organisation over ${r.months} months ago` })),
  ];
  for (const e of eraseNow) {
    if (await eraseLearner({ userId: e.id, actorId: null, actorRole: "system", reason: e.reason })) {
      report.erased++;
      await logPrivacyRequest({ userId: e.id, kind: "deletion", requestedBy: null, details: { by: "retention", reason: e.reason } });
    }
  }

  // 4. Audit log entries older than 12 months.
  const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE created_at < now() - make_interval(months => $1)`, [RETENTION.auditLogMonths]);
  report.wouldDelete.auditRows = audit.rows[0].n;
  if (enforce && audit.rows[0].n) {
    const d = await pool.query(`DELETE FROM audit_log WHERE created_at < now() - make_interval(months => $1)`, [RETENTION.auditLogMonths]);
    report.auditRows = d.rowCount ?? 0;
  }

  // Data exports past their download window, and proctoring media (always on).
  const expired = await pool.query(`UPDATE data_exports SET status = 'expired' WHERE status = 'ready' AND expires_at < now() RETURNING file_path`);
  for (const e of expired.rows) if (e.file_path?.startsWith(EXPORT_DIR)) await unlink(e.file_path).catch(() => {});
  report.expiredExports = expired.rowCount ?? 0;
  report.proctoringMedia = await runProctoringRetention();
  return report;
}

export async function acceptDpa(tenantId: string, userId: string) {
  await pool.query(`UPDATE tenants SET dpa_accepted_at = now(), dpa_accepted_by = $2, dpa_version = $3 WHERE id = $1`, [tenantId, userId, DPA_VERSION]);
}

// Every privacy request (download, deletion, correction, objection, consent
// withdrawal) is logged with its dates, so we can show it was answered within
// the legal time (30 days under GDPR). Never blocks the request itself.
export type PrivacyRequestKind = "export" | "deletion" | "correction" | "objection" | "consent_withdrawal";
export async function logPrivacyRequest(r: {
  userId: string | null;
  tenantId?: string | null;
  kind: PrivacyRequestKind;
  requestedBy?: string | null;
  details?: Record<string, unknown>;
  completed?: boolean;
}): Promise<void> {
  await pool
    .query(
      `INSERT INTO privacy_requests (user_id, tenant_id, kind, status, requested_by, details, completed_at)
       VALUES ($1, coalesce($2, (SELECT tenant_id FROM users WHERE id = $1)), $3, $4, $5, $6, CASE WHEN $4 = 'completed' THEN now() END)`,
      [r.userId, r.tenantId ?? null, r.kind, r.completed === false ? "received" : "completed", r.requestedBy ?? r.userId, r.details ?? null],
    )
    .catch((err) => console.error("privacy request log failed:", err));
}

