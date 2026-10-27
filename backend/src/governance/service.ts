import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { releaseQueuedMonths } from "../licenses/service.js";
import { recordAudit } from "../audit/service.js";
import { notify } from "../notifications/service.js";
import { removeMedia } from "../proctoring/storage.js";

export const EXPORT_DIR = path.resolve("uploads", "exports");
const EXPORT_TTL_DAYS = 7;
export const DPA_VERSION = "2026-10";

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

// Proctoring snapshots, scans, voice samples and ID images go after the
// organization's proctoring retention period. Evidence for a session still
// waiting on a reviewer, or an ID still pending, is kept up to a year.
async function runProctoringRetention(): Promise<number> {
  const old = await pool.query(
    `SELECT m.id, m.uri FROM proctoring_media m
     JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = u.tenant_id
     LEFT JOIN session_integrity si ON si.session_id = m.session_id
     WHERE m.uri IS NOT NULL
       AND m.created_at < now() - make_interval(days => coalesce((t.proctoring->>'retentionDays')::int, 90))
       AND (m.created_at < now() - interval '365 days' OR NOT (
         coalesce(si.status, '') = 'flagged'
         OR EXISTS (SELECT 1 FROM identity_verifications iv WHERE iv.status = 'pending' AND m.id IN (iv.document_media_id, iv.selfie_media_id))
       ))
     LIMIT 5000`,
  );
  for (const m of old.rows) await removeMedia(m.uri);
  await pool.query(`UPDATE proctoring_media SET uri = NULL WHERE id = ANY($1::uuid[])`, [old.rows.map((m) => m.id)]);
  await pool.query(`DELETE FROM proctoring_events WHERE created_at < now() - interval '365 days'`);
  return old.rows.length;
}

export async function runRetention(): Promise<{ recordings: number; erased: number; expiredExports: number; proctoringMedia: number }> {
  let recordings = 0;
  let erased = 0;
  const tenants = await pool.query(
    `SELECT id, retention_recordings_months, retention_inactive_learner_months FROM tenants
     WHERE retention_recordings_months IS NOT NULL OR retention_inactive_learner_months IS NOT NULL`,
  );
  for (const t of tenants.rows) {
    if (t.retention_recordings_months) {
      const months = t.retention_recordings_months;
      const attempts = await pool.query(
        `SELECT a.id, a.response_uri FROM attempts a JOIN sessions s ON s.id = a.session_id JOIN users u ON u.id = s.user_id
         WHERE u.tenant_id = $1 AND a.response_uri IS NOT NULL AND a.created_at < now() - make_interval(months => $2) LIMIT 5000`,
        [t.id, months],
      );
      for (const a of attempts.rows) await removeUpload(a.response_uri);
      await pool.query(`UPDATE attempts SET response_uri = NULL WHERE id = ANY($1::uuid[])`, [attempts.rows.map((a) => a.id)]);
      const files = await pool.query(
        `SELECT fc.id, fc.sample_uri FROM face_check_results fc JOIN users u ON u.id = fc.user_id
         WHERE u.tenant_id = $1 AND fc.sample_uri IS NOT NULL AND fc.created_at < now() - make_interval(months => $2)`,
        [t.id, months],
      );
      for (const f of files.rows) await removeUpload(f.sample_uri);
      await pool.query(`UPDATE face_check_results SET sample_uri = NULL WHERE id = ANY($1::uuid[])`, [files.rows.map((f) => f.id)]);
      recordings += attempts.rows.length + files.rows.length;
    }
    if (t.retention_inactive_learner_months) {
      const gone = await pool.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND role = 'learner' AND erased_at IS NULL AND deleted_at IS NOT NULL
           AND deleted_at < now() - make_interval(months => $2) LIMIT 500`,
        [t.id, t.retention_inactive_learner_months],
      );
      for (const g of gone.rows) {
        if (await eraseLearner({ userId: g.id, actorId: null, actorRole: "system", reason: `Deactivated over ${t.retention_inactive_learner_months} months` })) erased++;
      }
    }
  }
  const expired = await pool.query(`UPDATE data_exports SET status = 'expired' WHERE status = 'ready' AND expires_at < now() RETURNING file_path`);
  for (const e of expired.rows) if (e.file_path?.startsWith(EXPORT_DIR)) await unlink(e.file_path).catch(() => {});
  const proctoringMedia = await runProctoringRetention();
  return { recordings, erased, expiredExports: expired.rowCount ?? 0, proctoringMedia };
}

export async function acceptDpa(tenantId: string, userId: string) {
  await pool.query(`UPDATE tenants SET dpa_accepted_at = now(), dpa_accepted_by = $2, dpa_version = $3 WHERE id = $1`, [tenantId, userId, DPA_VERSION]);
}
