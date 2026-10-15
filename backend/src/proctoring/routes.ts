// Proctoring API: the organization's policy, the learner side of a proctored
// session (consent, snapshots, events, room scan, voice sample, ID check),
// and the reviewer side (review queue, live monitoring, ID decisions).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Router, type Response } from "express";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { isSuperAdmin, requirePermission, staffCanSeeUser, staffOwnsTenant, staffPermissions } from "../admin/staff.js";
import { assertFeature } from "../plans/service.js";
import { recordAudit } from "../audit/service.js";
import { detectFaces } from "../face/detect.js";
import { embedFace, cosineSimilarity, bufferToEmbedding, MATCH_THRESHOLD, UNCERTAIN_FLOOR } from "../face/embed.js";
import { detectObjects } from "./objects.js";
import { mediaPath, removeMedia, saveMedia } from "./storage.js";
import { analyzeSession } from "./analyze.js";
import { BASELINE_MIN_SECONDS, speechSeconds } from "./voiceCheck.js";
import {
  PROCTORED_SESSION_TYPES,
  PROCTORING_MODES,
  PROCTORING_REGIONS,
  consentVersion,
  learnerPolicy,
  needsConsent,
  needsSecureProctoringPlan,
  policySchema,
  presetPolicy,
  saveTenantPolicy,
  tenantPolicy,
  usesBiometrics,
  type ProctoringPolicy,
} from "./policy.js";

export const proctoringRouter = Router();

const FACE_EMBEDDING_BYTES = 512 * Float32Array.BYTES_PER_ELEMENT;
const MAX_EVENTS_PER_SESSION = 3000;
const LIVE_WINDOW_MINUTES = 3;

// Severity is decided here, never by the client.
const EVENT_SEVERITY: Record<string, "info" | "warn" | "high"> = {
  tab_hidden: "warn",
  window_blur: "info",
  fullscreen_exit: "warn",
  fullscreen_denied: "info",
  copy_blocked: "info",
  cut_blocked: "info",
  paste_blocked: "warn",
  context_menu: "info",
  print_screen: "warn",
  multi_monitor: "high",
  second_tab: "high",
  typing_burst: "warn",
  camera_off: "high",
  mic_off: "warn",
  offline: "info",
  devtools: "warn",
  message_seen: "info",
};

function decode(base64: string): Buffer {
  return Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
}

// ---------- Policy ----------

function requireOrgAdmin(req: AuthedRequest, res: Response): string | null {
  if (req.user?.role !== "org_admin" || !req.user.tenantId) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return req.user.tenantId;
}

async function savePolicy(req: AuthedRequest, tenantId: string, policy: ProctoringPolicy) {
  if (needsSecureProctoringPlan(policy)) await assertFeature(tenantId, "secure_proctoring");
  const before = await tenantPolicy(tenantId);
  await saveTenantPolicy(tenantId, policy);
  const changed = (Object.keys(policy) as (keyof ProctoringPolicy)[]).filter((k) => JSON.stringify(policy[k]) !== JSON.stringify(before[k]));
  await recordAudit({
    tenantId,
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: "proctoring.policy_updated",
    targetType: "organization",
    targetId: tenantId,
    details: { changed, mode: policy.mode, region: policy.region },
    ip: req.ip,
  });
}

proctoringRouter.get("/presets", requireAuth, (req: AuthedRequest, res) => {
  const mode = PROCTORING_MODES.find((m) => m === req.query.mode) ?? "standard";
  const region = PROCTORING_REGIONS.find((r) => r === req.query.region) ?? "global";
  res.json({ policy: presetPolicy(mode, region) });
});

proctoringRouter.get("/policy", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = requireOrgAdmin(req, res);
  if (!tenantId) return;
  try {
    res.json({ policy: await tenantPolicy(tenantId) });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.put("/policy", requireAuth, async (req: AuthedRequest, res, next) => {
  const tenantId = requireOrgAdmin(req, res);
  if (!tenantId) return;
  try {
    const policy = policySchema.parse(req.body);
    await savePolicy(req, tenantId, policy);
    res.json({ policy });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.get("/tenants/:tenantId/policy", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    if (!(await staffOwnsTenant(req, req.params.tenantId as string))) return res.status(404).json({ error: "not_found" });
    res.json({ policy: await tenantPolicy(req.params.tenantId as string) });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.put("/tenants/:tenantId/policy", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "manageOrganizations"))) return;
  try {
    if (!(await staffOwnsTenant(req, req.params.tenantId as string))) return res.status(404).json({ error: "not_found" });
    const policy = policySchema.parse(req.body);
    await savePolicy(req, req.params.tenantId as string, policy);
    res.json({ policy });
  } catch (err) {
    next(err);
  }
});

// ---------- Learner: a proctored session ----------

interface IntegrityRow {
  session_id: string;
  user_id: string;
  tenant_id: string | null;
  session_type: string;
  policy: ProctoringPolicy;
  consent_record_id: string | null;
  biometric_opt_out: boolean;
  secure_browser: boolean | null;
  terminated_at: string | null;
  terminate_reason: string | null;
  live_message: string | null;
  live_message_at: string | null;
  live_message_seen_at: string | null;
}

// The learner's own placement or mock-exam session, with its integrity row
// (created on first use with the policy as it is right now).
async function ownSession(req: AuthedRequest, res: Response): Promise<{ session: { id: string; completed_at: string | null }; si: IntegrityRow } | null> {
  const id = String(req.params.sessionId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).json({ error: "session_not_found" });
    return null;
  }
  const s = (
    await pool.query(`SELECT id, session_type, completed_at FROM sessions WHERE id = $1 AND user_id = $2 AND session_type = ANY($3)`, [
      id,
      req.user!.id,
      PROCTORED_SESSION_TYPES,
    ])
  ).rows[0];
  if (!s) {
    res.status(404).json({ error: "session_not_found" });
    return null;
  }
  const { policy, tenantId } = await learnerPolicy(req.user!.id);
  await pool.query(
    `INSERT INTO session_integrity (session_id, user_id, tenant_id, session_type, policy) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id) DO NOTHING`,
    [s.id, req.user!.id, tenantId, s.session_type, JSON.stringify(policy)],
  );
  const si = (await pool.query(`SELECT * FROM session_integrity WHERE session_id = $1`, [s.id])).rows[0];
  return { session: s, si };
}

function consentMissing(si: IntegrityRow): boolean {
  return needsConsent(si.policy) && !si.consent_record_id;
}

// Safe Exam Browser sends, per page, SHA-256(page URL + config key). A match
// against one of the organization's keys proves the page runs inside SEB
// with that configuration.
function secureBrowserOk(policy: ProctoringPolicy, req: AuthedRequest): boolean {
  const hash = String(req.header("x-seb-config-key-hash") ?? "").toLowerCase();
  const pageUrl = String(req.header("x-seb-page-url") ?? "").split("#")[0];
  if (!hash || !pageUrl) return false;
  return policy.sebConfigKeys.some((key) => createHash("sha256").update(pageUrl + key.toLowerCase()).digest("hex") === hash);
}

async function latestIdentity(userId: string) {
  return (await pool.query(`SELECT id, status, created_at, review_note FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId])).rows[0] ?? null;
}

proctoringRouter.get("/sessions/:sessionId/setup", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    const { si } = own;
    const p = si.policy;
    let secureBrowser: boolean | null = null;
    if (p.secureBrowser) {
      secureBrowser = secureBrowserOk(p, req);
      if (secureBrowser && si.secure_browser !== true) await pool.query(`UPDATE session_integrity SET secure_browser = true WHERE session_id = $1`, [si.session_id]);
      if (!secureBrowser && si.secure_browser === null) await pool.query(`UPDATE session_integrity SET secure_browser = false WHERE session_id = $1`, [si.session_id]);
    }
    const media = await pool.query(`SELECT kind FROM proctoring_media WHERE session_id = $1 AND kind IN ('room_scan', 'voice_baseline') GROUP BY kind`, [si.session_id]);
    const kinds = new Set(media.rows.map((r) => r.kind));
    const face = (await pool.query(`SELECT status, embedding FROM face_enrollments WHERE user_id = $1`, [req.user!.id])).rows[0];
    const { sebConfigKeys: _keys, ...visible } = p;
    res.json({
      proctored: p.mode !== "off",
      policy: visible,
      consentNeeded: consentMissing(si),
      consentVersion: consentVersion(p),
      biometric: usesBiometrics(p),
      biometricOptOut: si.biometric_opt_out,
      identity: p.idVerification ? await latestIdentity(req.user!.id) : null,
      roomScanDone: kinds.has("room_scan"),
      voiceBaselineDone: kinds.has("voice_baseline"),
      voiceBaselineMinSeconds: BASELINE_MIN_SECONDS,
      secureBrowser,
      faceEnrolled: face?.status === "enrolled" && face.embedding?.byteLength === FACE_EMBEDDING_BYTES,
      terminated: !!si.terminated_at,
    });
  } catch (err) {
    next(err);
  }
});

const consentSchema = z.object({ accept: z.literal(true), biometric: z.boolean() });

proctoringRouter.post("/sessions/:sessionId/consent", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    const body = consentSchema.parse(req.body);
    const { si } = own;
    const version = consentVersion(si.policy);
    const consent = await pool.query(
      `INSERT INTO consent_records (user_id, consent_version, consent_type, ip_address) VALUES ($1, $2, 'proctoring', $3) RETURNING id`,
      [req.user!.id, version, req.ip],
    );
    const biometric = usesBiometrics(si.policy) && body.biometric;
    if (biometric) {
      await pool.query(`INSERT INTO consent_records (user_id, consent_version, consent_type, ip_address) VALUES ($1, $2, 'proctoring_biometric', $3)`, [
        req.user!.id,
        version,
        req.ip,
      ]);
    }
    await pool.query(`UPDATE session_integrity SET consent_record_id = $2, biometric_opt_out = $3, updated_at = now() WHERE session_id = $1`, [
      si.session_id,
      consent.rows[0].id,
      usesBiometrics(si.policy) && !body.biometric,
    ]);
    res.status(201).json({ ok: true, biometricOptOut: usesBiometrics(si.policy) && !body.biometric });
  } catch (err) {
    next(err);
  }
});

const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.string().max(40),
        at: z.string().datetime().optional(),
        detail: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional(),
      }),
    )
    .max(50),
});

proctoringRouter.post("/sessions/:sessionId/events", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    const body = eventsSchema.parse(req.body);
    const count = (await pool.query(`SELECT count(*)::int AS n FROM proctoring_events WHERE session_id = $1`, [own.si.session_id])).rows[0].n;
    const room = Math.max(0, MAX_EVENTS_PER_SESSION - count);
    const accepted = body.events.filter((e) => EVENT_SEVERITY[e.type]).slice(0, room);
    for (const e of accepted) {
      // A client clock far off is ignored rather than trusted.
      const at = e.at && Math.abs(Date.parse(e.at) - Date.now()) < 6 * 3600_000 ? e.at : null;
      await pool.query(
        `INSERT INTO proctoring_events (session_id, user_id, type, severity, detail, client_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [own.si.session_id, req.user!.id, e.type, EVENT_SEVERITY[e.type], e.detail ? JSON.stringify(e.detail) : null, at],
      );
    }
    await pool.query(`UPDATE session_integrity SET last_seen_at = now() WHERE session_id = $1`, [own.si.session_id]);
    res.status(201).json({ accepted: accepted.length });
  } catch (err) {
    next(err);
  }
});

const snapshotSchema = z.object({ imageBase64: z.string().min(100).max(3_000_000) });

proctoringRouter.post("/sessions/:sessionId/snapshot", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    const { si } = own;
    if (consentMissing(si)) return res.status(409).json({ error: "consent_required" });
    if (!si.policy.webcamMonitoring && !si.policy.faceMatch && !si.policy.liveMonitoring) return res.status(400).json({ error: "not_enabled" });
    const image = decode(snapshotSchema.parse(req.body).imageBase64);

    const faces = await detectFaces(image).catch(() => []);
    let faceDecision: string | null = null;
    let similarity: number | null = null;
    if (faces.length === 1 && si.policy.faceMatch && !si.biometric_opt_out) {
      const enrolled = (await pool.query(`SELECT embedding, status FROM face_enrollments WHERE user_id = $1`, [req.user!.id])).rows[0];
      if (enrolled?.status === "enrolled" && enrolled.embedding?.byteLength === FACE_EMBEDDING_BYTES) {
        const probe = await embedFace(image, faces[0]).catch(() => null);
        if (probe) {
          similarity = Math.round(cosineSimilarity(bufferToEmbedding(enrolled.embedding), probe) * 1000) / 1000;
          faceDecision = similarity >= MATCH_THRESHOLD ? "match" : similarity >= UNCERTAIN_FLOOR ? "uncertain" : "mismatch";
        }
      }
    }
    const objects = (await detectObjects(image).catch(() => null)) ?? [];
    const watched = objects.filter((o) => o.label === "cell_phone" || o.label === "book" || o.label === "person");

    const small = await sharp(image).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    const uri = await saveMedia("snapshot", "jpg", small);
    await pool.query(
      `INSERT INTO proctoring_media (session_id, user_id, kind, uri, face_count, face_decision, face_similarity, objects)
       VALUES ($1, $2, 'snapshot', $3, $4, $5, $6, $7)`,
      [si.session_id, req.user!.id, uri, faces.length, faceDecision, similarity, JSON.stringify(watched)],
    );
    await pool.query(`UPDATE session_integrity SET last_seen_at = now() WHERE session_id = $1`, [si.session_id]);

    // Tell the learner right away, so an honest mistake can be fixed.
    const persons = watched.filter((o) => o.label === "person").length;
    let warning: string | null = null;
    if (faces.length === 0) warning = "no_face";
    else if (faces.length > 1 || persons > 1) warning = "multiple_people";
    else if (watched.some((o) => o.label === "cell_phone")) warning = "phone";
    res.status(201).json({ faces: faces.length, warning });
  } catch (err) {
    next(err);
  }
});

const mediaUploadSchema = z.object({ dataBase64: z.string().min(100).max(6_500_000), mimeType: z.string().max(80) });

function extFor(mime: string, kind: "video" | "audio"): string | null {
  if (mime.startsWith(`${kind}/webm`)) return "webm";
  if (mime.startsWith(`${kind}/mp4`)) return "mp4";
  if (kind === "audio" && mime.startsWith("audio/ogg")) return "ogg";
  return null;
}

proctoringRouter.post("/sessions/:sessionId/room-scan", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    if (consentMissing(own.si)) return res.status(409).json({ error: "consent_required" });
    if (!own.si.policy.roomScan) return res.status(400).json({ error: "not_enabled" });
    const body = mediaUploadSchema.parse(req.body);
    const ext = extFor(body.mimeType, "video");
    if (!ext) return res.status(400).json({ error: "unsupported_format" });
    const uri = await saveMedia("room_scan", ext, decode(body.dataBase64));
    await pool.query(`INSERT INTO proctoring_media (session_id, user_id, kind, uri) VALUES ($1, $2, 'room_scan', $3)`, [own.si.session_id, req.user!.id, uri]);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.post("/sessions/:sessionId/voice-baseline", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    if (consentMissing(own.si)) return res.status(409).json({ error: "consent_required" });
    if (!own.si.policy.voiceMatch || own.si.biometric_opt_out) return res.status(400).json({ error: "not_enabled" });
    const body = mediaUploadSchema.parse(req.body);
    const ext = extFor(body.mimeType, "audio");
    if (!ext) return res.status(400).json({ error: "unsupported_format" });
    const uri = await saveMedia("voice_baseline", ext, decode(body.dataBase64));
    const seconds = await speechSeconds(mediaPath(uri)!).catch(() => 0);
    // Too little speech can't be used; ask again instead of storing it.
    if (seconds < BASELINE_MIN_SECONDS) {
      await removeMedia(uri);
      return res.status(200).json({ ok: false, speechSeconds: Math.round(seconds), minSeconds: BASELINE_MIN_SECONDS });
    }
    await pool.query(`DELETE FROM proctoring_media WHERE session_id = $1 AND kind = 'voice_baseline' RETURNING uri`, [own.si.session_id]).then(async (r) => {
      for (const row of r.rows) await removeMedia(row.uri);
    });
    await pool.query(`INSERT INTO proctoring_media (session_id, user_id, kind, uri) VALUES ($1, $2, 'voice_baseline', $3)`, [own.si.session_id, req.user!.id, uri]);
    res.status(201).json({ ok: true, speechSeconds: Math.round(seconds) });
  } catch (err) {
    next(err);
  }
});

// Polled during the test: a proctor's message, or the session being ended.
proctoringRouter.get("/sessions/:sessionId/status", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    const { si } = own;
    await pool.query(`UPDATE session_integrity SET last_seen_at = now() WHERE session_id = $1`, [si.session_id]);
    const unseen = si.live_message && (!si.live_message_seen_at || si.live_message_seen_at < (si.live_message_at ?? ""));
    res.json({ terminated: !!si.terminated_at, terminateReason: si.terminate_reason, message: unseen ? si.live_message : null });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.post("/sessions/:sessionId/status/ack", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const own = await ownSession(req, res);
    if (!own) return;
    await pool.query(`UPDATE session_integrity SET live_message_seen_at = now() WHERE session_id = $1`, [own.si.session_id]);
    await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity) VALUES ($1, $2, 'message_seen', 'info')`, [own.si.session_id, req.user!.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Learner: identity document ----------

proctoringRouter.get("/identity", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    res.json({ identity: await latestIdentity(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

const identitySchema = z.object({
  documentType: z.enum(["passport", "national_id", "driving_licence", "other"]),
  documentBase64: z.string().min(100).max(4_000_000),
  selfieBase64: z.string().min(100).max(3_000_000),
  sessionId: z.string().uuid().optional(),
});

proctoringRouter.post("/identity", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = identitySchema.parse(req.body);
    const { policy, tenantId } = await learnerPolicy(req.user!.id);
    if (!policy.idVerification) return res.status(400).json({ error: "not_enabled" });
    const doc = decode(body.documentBase64);
    const selfie = decode(body.selfieBase64);

    // The largest face on the document against the selfie: a hint for the
    // reviewer, who makes the decision.
    let similarity: number | null = null;
    let auto = "no_face_on_document";
    const docFaces = (await detectFaces(doc, 0.5).catch(() => [])).sort((a, b) => b.w * b.h - a.w * a.h);
    const selfieFaces = await detectFaces(selfie).catch(() => []);
    if (selfieFaces.length !== 1) auto = "no_single_face_in_selfie";
    else if (docFaces[0]) {
      const [a, b] = await Promise.all([embedFace(doc, docFaces[0]).catch(() => null), embedFace(selfie, selfieFaces[0]).catch(() => null)]);
      if (a && b) {
        similarity = Math.round(cosineSimilarity(a, b) * 1000) / 1000;
        auto = similarity >= UNCERTAIN_FLOOR ? "likely_same_person" : "faces_differ";
      }
    }
    const store = async (kind: "id_document" | "id_selfie", data: Buffer) => {
      const jpg = await sharp(data).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      const uri = await saveMedia(kind, "jpg", jpg);
      return (
        await pool.query(`INSERT INTO proctoring_media (session_id, user_id, kind, uri) VALUES ($1, $2, $3, $4) RETURNING id`, [
          body.sessionId ?? null,
          req.user!.id,
          kind,
          uri,
        ])
      ).rows[0].id as string;
    };
    if (body.sessionId) {
      const s = await pool.query(`SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2`, [body.sessionId, req.user!.id]);
      if (!s.rowCount) body.sessionId = undefined;
    }
    const [docId, selfieId] = [await store("id_document", doc), await store("id_selfie", selfie)];
    const consent = await pool.query(
      `INSERT INTO consent_records (user_id, consent_version, consent_type, ip_address) VALUES ($1, $2, 'proctoring_biometric', $3) RETURNING id`,
      [req.user!.id, consentVersion(policy), req.ip],
    );
    const r = await pool.query(
      `INSERT INTO identity_verifications (user_id, tenant_id, document_type, document_media_id, selfie_media_id, face_similarity, auto_decision, consent_record_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at`,
      [req.user!.id, tenantId, body.documentType, docId, selfieId, similarity, auto, consent.rows[0].id],
    );
    res.status(201).json({ identity: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ---------- Reviewers ----------

interface Scope {
  sql: string;
  params: unknown[];
}

// Org Admins review their own organization; Edstellar staff with Score
// review see their organizations and individual learners. The scope's
// single parameter is always $1, and it filters a "u" users / "t" tenants join.
async function reviewerScope(req: AuthedRequest, res: Response): Promise<Scope | null> {
  if (req.user?.role === "org_admin" && req.user.tenantId) return { sql: `u.tenant_id = $1`, params: [req.user.tenantId] };
  if (!(await requirePermission(req, res, "scoreReview"))) return null;
  if (isSuperAdmin(req)) return { sql: `$1::text IS NOT NULL`, params: ["all"] };
  return { sql: `(t.type <> 'cohort' OR t.managed_by = $1 OR t.account_manager_id = $1)`, params: [req.user!.id] };
}

async function canReviewUser(req: AuthedRequest, userId: string): Promise<boolean> {
  if (req.user?.role === "org_admin") {
    const r = await pool.query(`SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2`, [userId, req.user.tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
  if (!req.user || !["admin", "super_admin"].includes(req.user.role)) return false;
  if (!isSuperAdmin(req) && !(await staffPermissions(req)).scoreReview) return false;
  return staffCanSeeUser(req, userId);
}

const REVIEW_STATUSES = ["flagged", "clear", "cleared", "violation", "in_progress", "all"] as const;

proctoringRouter.get("/reviews", requireAuth, async (req: AuthedRequest, res, next) => {
  const scope = await reviewerScope(req, res);
  if (!scope) return;
  try {
    const status = REVIEW_STATUSES.find((s) => s === req.query.status) ?? "flagged";
    const rows = await pool.query(
      `SELECT si.session_id, si.session_type, si.status, si.risk_score, si.risk_level, si.reasons, si.biometric_opt_out,
         si.terminated_at, si.reviewed_at, si.review_note, s.started_at, s.completed_at,
         u.id AS user_id, u.email, concat_ws(' ', u.first_name, u.last_name) AS name,
         CASE WHEN t.type = 'cohort' THEN t.name END AS org_name,
         e.name AS exam_name, concat_ws(' ', r.first_name, r.last_name) AS reviewer
       FROM session_integrity si
       JOIN sessions s ON s.id = si.session_id
       JOIN users u ON u.id = si.user_id
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       LEFT JOIN users r ON r.id = si.reviewed_by
       WHERE ${scope.sql} AND ($2 = 'all' OR si.status = $2) AND (si.status <> 'in_progress' OR $2 = 'in_progress')
       ORDER BY si.risk_score DESC, s.started_at DESC
       LIMIT 200`,
      [...scope.params, status],
    );
    const stats = (
      await pool.query(
        `SELECT count(*) FILTER (WHERE si.status = 'flagged')::int AS flagged,
           count(*) FILTER (WHERE si.status = 'violation')::int AS violations,
           count(*) FILTER (WHERE si.status = 'cleared')::int AS cleared,
           count(*) FILTER (WHERE si.status = 'clear')::int AS clear,
           count(*) FILTER (WHERE si.status = 'in_progress' AND si.last_seen_at > now() - make_interval(mins => ${LIVE_WINDOW_MINUTES}))::int AS live
         FROM session_integrity si JOIN users u ON u.id = si.user_id JOIN tenants t ON t.id = u.tenant_id
         WHERE ${scope.sql}`,
        scope.params,
      )
    ).rows[0];
    const pendingIds = (
      await pool.query(
        `SELECT count(*)::int AS n FROM identity_verifications iv JOIN users u ON u.id = iv.user_id JOIN tenants t ON t.id = u.tenant_id
         WHERE iv.status = 'pending' AND ${scope.sql}`,
        scope.params,
      )
    ).rows[0].n;
    res.json({ sessions: rows.rows, stats: { ...stats, pendingIds } });
  } catch (err) {
    next(err);
  }
});

proctoringRouter.get("/reviews/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const si = (await pool.query(`SELECT * FROM session_integrity WHERE session_id = $1`, [req.params.sessionId])).rows[0];
    if (!si || !(await canReviewUser(req, si.user_id))) return res.status(404).json({ error: "not_found" });
    const [session, events, media, faceChecks, voice, identity, placement] = await Promise.all([
      pool.query(
        `SELECT s.started_at, s.completed_at, s.session_type, u.email, concat_ws(' ', u.first_name, u.last_name) AS name,
           CASE WHEN t.type = 'cohort' THEN t.name END AS org_name, e.name AS exam_name,
           (SELECT count(*)::int FROM attempts a WHERE a.session_id = s.id) AS answers
         FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
         WHERE s.id = $1`,
        [si.session_id],
      ),
      pool.query(`SELECT type, severity, detail, coalesce(client_at, created_at) AS at FROM proctoring_events WHERE session_id = $1 ORDER BY at LIMIT 1000`, [si.session_id]),
      pool.query(
        `SELECT id, kind, face_count, face_decision, face_similarity, objects, created_at FROM proctoring_media WHERE session_id = $1 AND uri IS NOT NULL ORDER BY created_at`,
        [si.session_id],
      ),
      pool.query(`SELECT decision, similarity_score, liveness_score, face_count, created_at FROM face_check_results WHERE session_id = $1 ORDER BY created_at`, [si.session_id]),
      pool.query(`SELECT decision, similarity_score, detail, created_at FROM voice_check_results WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`, [si.session_id]),
      pool.query(
        `SELECT id, status, document_type, document_media_id, selfie_media_id, face_similarity, auto_decision, review_note, reviewed_at, created_at
         FROM identity_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [si.user_id],
      ),
      pool.query(`SELECT id, status, cefr_level, overall_percent FROM placements WHERE session_id = $1`, [si.session_id]),
    ]);
    const { sebConfigKeys: _keys, ...policy } = si.policy ?? {};
    res.json({
      integrity: { ...si, policy },
      session: session.rows[0],
      events: events.rows,
      media: media.rows,
      faceChecks: faceChecks.rows,
      voice: voice.rows[0] ?? null,
      identity: identity.rows[0] ?? null,
      placement: placement.rows[0] ?? null,
    });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({ verdict: z.enum(["cleared", "violation"]), note: z.string().trim().max(1000).optional() });

proctoringRouter.post("/reviews/:sessionId/decision", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = decisionSchema.parse(req.body);
    const si = (await pool.query(`SELECT session_id, user_id, tenant_id, session_type FROM session_integrity WHERE session_id = $1`, [req.params.sessionId])).rows[0];
    if (!si || !(await canReviewUser(req, si.user_id))) return res.status(404).json({ error: "not_found" });
    await pool.query(
      `UPDATE session_integrity SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now() WHERE session_id = $1`,
      [si.session_id, body.verdict, req.user!.id, body.note ?? null],
    );
    // Keeps a placement's certification in step with the integrity verdict.
    if (si.session_type === "placement") {
      await pool.query(
        `UPDATE placements SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = coalesce($4, review_note)
         WHERE session_id = $1 AND status IN ('pending_review', 'certified', 'fraud_confirmed')`,
        [si.session_id, body.verdict === "violation" ? "fraud_confirmed" : "certified", req.user!.id, body.note ?? null],
      );
    }
    await recordAudit({
      tenantId: si.tenant_id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "integrity.reviewed",
      targetType: "learner",
      targetId: si.user_id,
      details: { sessionId: si.session_id, verdict: body.verdict },
      ip: req.ip,
    });
    res.json({ status: body.verdict });
  } catch (err) {
    next(err);
  }
});

// ---------- Live monitoring ----------

proctoringRouter.get("/live", requireAuth, async (req: AuthedRequest, res, next) => {
  const scope = await reviewerScope(req, res);
  if (!scope) return;
  try {
    const rows = await pool.query(
      `SELECT si.session_id, si.session_type, si.last_seen_at, si.live_message, si.live_message_at, si.live_message_seen_at,
         s.started_at, u.id AS user_id, u.email, concat_ws(' ', u.first_name, u.last_name) AS name,
         CASE WHEN t.type = 'cohort' THEN t.name END AS org_name, e.name AS exam_name,
         (SELECT count(*)::int FROM attempts a WHERE a.session_id = s.id) AS answers,
         (SELECT count(*)::int FROM proctoring_events pe WHERE pe.session_id = s.id AND pe.severity <> 'info') AS alerts,
         (SELECT pe.type FROM proctoring_events pe WHERE pe.session_id = s.id AND pe.severity <> 'info' ORDER BY pe.created_at DESC LIMIT 1) AS last_alert,
         (SELECT row_to_json(m) FROM (SELECT pm.id, pm.face_count, pm.objects, pm.created_at FROM proctoring_media pm
            WHERE pm.session_id = s.id AND pm.kind = 'snapshot' AND pm.uri IS NOT NULL ORDER BY pm.created_at DESC LIMIT 1) m) AS snapshot
       FROM session_integrity si
       JOIN sessions s ON s.id = si.session_id
       JOIN users u ON u.id = si.user_id
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       WHERE ${scope.sql} AND si.status = 'in_progress' AND si.terminated_at IS NULL AND s.completed_at IS NULL
         AND si.last_seen_at > now() - make_interval(mins => ${LIVE_WINDOW_MINUTES})
       ORDER BY alerts DESC, s.started_at`,
      scope.params,
    );
    res.json({ sessions: rows.rows });
  } catch (err) {
    next(err);
  }
});

const liveMessageSchema = z.object({ message: z.string().trim().min(1).max(300) });

proctoringRouter.post("/live/:sessionId/message", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = liveMessageSchema.parse(req.body);
    const si = (await pool.query(`SELECT session_id, user_id, tenant_id FROM session_integrity WHERE session_id = $1`, [req.params.sessionId])).rows[0];
    if (!si || !(await canReviewUser(req, si.user_id))) return res.status(404).json({ error: "not_found" });
    await pool.query(`UPDATE session_integrity SET live_message = $2, live_message_at = now(), updated_at = now() WHERE session_id = $1`, [si.session_id, body.message]);
    await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity, detail) VALUES ($1, $2, 'proctor_message', 'info', $3)`, [
      si.session_id,
      si.user_id,
      JSON.stringify({ message: body.message }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const terminateSchema = z.object({ reason: z.string().trim().min(3).max(300) });

proctoringRouter.post("/live/:sessionId/terminate", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = terminateSchema.parse(req.body);
    const si = (await pool.query(`SELECT session_id, user_id, tenant_id FROM session_integrity WHERE session_id = $1`, [req.params.sessionId])).rows[0];
    if (!si || !(await canReviewUser(req, si.user_id))) return res.status(404).json({ error: "not_found" });
    await pool.query(
      `UPDATE session_integrity SET terminated_at = coalesce(terminated_at, now()), terminated_by = $2, terminate_reason = $3, updated_at = now() WHERE session_id = $1`,
      [si.session_id, req.user!.id, body.reason],
    );
    await pool.query(`INSERT INTO proctoring_events (session_id, user_id, type, severity, detail) VALUES ($1, $2, 'terminated', 'high', $3)`, [
      si.session_id,
      si.user_id,
      JSON.stringify({ reason: body.reason }),
    ]);
    await analyzeSession(si.session_id);
    await recordAudit({
      tenantId: si.tenant_id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "integrity.session_terminated",
      targetType: "learner",
      targetId: si.user_id,
      details: { sessionId: si.session_id, reason: body.reason },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- Identity review ----------

proctoringRouter.get("/identity-reviews", requireAuth, async (req: AuthedRequest, res, next) => {
  const scope = await reviewerScope(req, res);
  if (!scope) return;
  try {
    const status = ["pending", "verified", "rejected"].includes(String(req.query.status)) ? String(req.query.status) : "pending";
    const rows = await pool.query(
      `SELECT iv.id, iv.status, iv.document_type, iv.document_media_id, iv.selfie_media_id, iv.face_similarity, iv.auto_decision,
         iv.review_note, iv.reviewed_at, iv.created_at, u.id AS user_id, u.email, concat_ws(' ', u.first_name, u.last_name) AS name,
         CASE WHEN t.type = 'cohort' THEN t.name END AS org_name, concat_ws(' ', r.first_name, r.last_name) AS reviewer
       FROM identity_verifications iv
       JOIN users u ON u.id = iv.user_id
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN users r ON r.id = iv.reviewed_by
       WHERE ${scope.sql} AND iv.status = $2
       ORDER BY iv.created_at ${status === "pending" ? "ASC" : "DESC"}
       LIMIT 200`,
      [...scope.params, status],
    );
    res.json({ verifications: rows.rows });
  } catch (err) {
    next(err);
  }
});

const identityDecisionSchema = z.object({ verdict: z.enum(["verified", "rejected"]), note: z.string().trim().max(1000).optional() });

proctoringRouter.post("/identity-reviews/:id/decision", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = identityDecisionSchema.parse(req.body);
    const iv = (await pool.query(`SELECT id, user_id, tenant_id FROM identity_verifications WHERE id = $1`, [req.params.id])).rows[0];
    if (!iv || !(await canReviewUser(req, iv.user_id))) return res.status(404).json({ error: "not_found" });
    await pool.query(`UPDATE identity_verifications SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 WHERE id = $1`, [
      iv.id,
      body.verdict,
      req.user!.id,
      body.note ?? null,
    ]);
    // Sessions waiting on this ID check get re-scored.
    const open = await pool.query(`SELECT session_id FROM session_integrity WHERE user_id = $1 AND reviewed_at IS NULL AND status <> 'in_progress'`, [iv.user_id]);
    for (const s of open.rows) await analyzeSession(s.session_id);
    await recordAudit({
      tenantId: iv.tenant_id,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "identity.reviewed",
      targetType: "learner",
      targetId: iv.user_id,
      details: { verdict: body.verdict },
      ip: req.ip,
    });
    res.json({ status: body.verdict });
  } catch (err) {
    next(err);
  }
});

// ---------- Media ----------

const MEDIA_TYPES: Record<string, string> = { jpg: "image/jpeg", webm: "video/webm", mp4: "video/mp4", ogg: "audio/ogg" };

proctoringRouter.get("/media/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) return res.status(404).end();
    const m = (await pool.query(`SELECT user_id, kind, uri FROM proctoring_media WHERE id = $1`, [req.params.id])).rows[0];
    if (!m?.uri || !(await canReviewUser(req, m.user_id))) return res.status(404).end();
    const file = mediaPath(m.uri);
    if (!file) return res.status(404).end();
    const data = await readFile(file).catch(() => null);
    if (!data) return res.status(404).end();
    const ext = m.uri.split(".").pop() ?? "";
    // A voice sample recorded as webm is audio, not video.
    const type = m.kind === "voice_baseline" && ext === "webm" ? "audio/webm" : (MEDIA_TYPES[ext] ?? "application/octet-stream");
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
  } catch (err) {
    next(err);
  }
});
