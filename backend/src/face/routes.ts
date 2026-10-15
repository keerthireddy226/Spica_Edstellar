// Enroll once, verify before every session. An emailed one-time code is the
// only path past a failed check.
import { randomUUID, randomInt } from "node:crypto";
import { learnerOrgPolicy } from "../orgAdmin/settings.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { hashToken } from "../auth/tokens.js";
import { sendFaceFallbackOtpEmail } from "../auth/mailer.js";
import { detectFaces, cropFace } from "./detect.js";
import { assessQuality } from "./quality.js";
import { scoreLiveness } from "./liveness.js";
import { embedFace, cosineSimilarity, embeddingToBuffer, bufferToEmbedding, MATCH_THRESHOLD, UNCERTAIN_FLOOR } from "./embed.js";
import { faceCheckSignal } from "../proctoring/alerts.js";

export const faceRouter = Router();

const ENROLLMENT_UPLOADS_DIR = path.join(process.cwd(), "uploads", "face-enrollment");
const CHECK_UPLOADS_DIR = path.join(process.cwd(), "uploads", "face-check");

// Skipped outside production so local QA never gets locked out.
const faceCheckLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // The in-test check runs about once a minute, on top of the start checks.
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
  handler: (_req, res) => {
    res.status(429).json({ error: "too_many_attempts" });
  },
});

// Only mismatch/uncertain burn a retry — retakes and spoofs don't.
const RETRY_LIMIT = 2;
// Separate, more lenient limit for no_face/multiple_faces/error — usually just lighting/camera,
// not an identity signal, but still needs an escape hatch instead of an infinite retry loop.
const ENVIRONMENTAL_RETRY_LIMIT = 3;
export const FALLBACK_ELIGIBLE_DECISIONS = ["mismatch", "uncertain", "no_face", "multiple_faces", "error"];

const OTP_TTL_MS = 10 * 60 * 1000;
// Shared by request and verify — a code is only 6 digits, so the verify side
// especially needs this to make brute-forcing impractical.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
  handler: (_req, res) => {
    res.status(429).json({ error: "too_many_attempts" });
  },
});

// Guards against comparing an embedding from a since-replaced model.
const EMBEDDING_BYTES = 512 * Float32Array.BYTES_PER_ELEMENT;
function isCompatibleEmbedding(embedding: Buffer): boolean {
  return embedding.byteLength === EMBEDDING_BYTES;
}

function decodeImage(base64: string): Buffer {
  return Buffer.from(base64, "base64");
}

const enrollmentSchema = z.object({
  consentGiven: z.literal(true),
  imageBase64: z.string(),
});

faceRouter.post("/enrollment", requireAuth, faceCheckLimiter, async (req: AuthedRequest, res, next) => {
  const client = await pool.connect();
  try {
    const body = enrollmentSchema.parse(req.body);
    const image = decodeImage(body.imageBase64);

    await client.query("BEGIN");

    // Distinct consent type — face biometric data has its own disclosure obligations.
    const consentResult = await client.query(
      `INSERT INTO consent_records (user_id, consent_version, consent_type, ip_address)
       VALUES ($1, $2, 'face_identity', $3) RETURNING id`,
      [req.user!.id, "v1", req.ip],
    );
    const consentRecordId = consentResult.rows[0].id;

    const [box] = await detectFaces(image);
    const quality = box ? await assessQuality(image, box) : await assessQuality(image, null);

    if (!box || !quality.ok) {
      // Fails open: consent stands, learner just retries enrollment.
      await client.query(
        `INSERT INTO face_enrollments (user_id, embedding, status, consent_record_id)
         VALUES ($1, $2, 'failed', $3)
         ON CONFLICT (user_id) DO UPDATE SET status = 'failed', consent_record_id = EXCLUDED.consent_record_id, updated_at = now()`,
        [req.user!.id, Buffer.alloc(0), consentRecordId],
      );
      await client.query("COMMIT");
      return res.status(200).json({
        status: "failed",
        reasons: box ? quality.reasons : ["No face detected. Sit in front of the camera and look straight at it."],
      });
    }

    const embedding = await embedFace(image, box);
    if (!embedding) {
      await client.query(
        `INSERT INTO face_enrollments (user_id, embedding, status, consent_record_id)
         VALUES ($1, $2, 'failed', $3)
         ON CONFLICT (user_id) DO UPDATE SET status = 'failed', consent_record_id = EXCLUDED.consent_record_id, updated_at = now()`,
        [req.user!.id, Buffer.alloc(0), consentRecordId],
      );
      await client.query("COMMIT");
      return res.status(200).json({ status: "failed", reasons: ["Could not read facial geometry — face the camera squarely."] });
    }

    await mkdir(ENROLLMENT_UPLOADS_DIR, { recursive: true });
    const fileName = `${req.user!.id}.jpg`;
    const sampleUri = `/uploads/face-enrollment/${fileName}`;
    await writeFile(path.join(ENROLLMENT_UPLOADS_DIR, fileName), image);

    await client.query(
      `INSERT INTO face_enrollments (user_id, embedding, status, sample_uri, consent_record_id)
       VALUES ($1, $2, 'enrolled', $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         embedding = EXCLUDED.embedding, status = 'enrolled', sample_uri = EXCLUDED.sample_uri,
         consent_record_id = EXCLUDED.consent_record_id, updated_at = now()`,
      [req.user!.id, embeddingToBuffer(embedding), sampleUri, consentRecordId],
    );

    await client.query("COMMIT");
    res.status(201).json({ status: "enrolled" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

faceRouter.get("/enrollment/status", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(`SELECT status, embedding FROM face_enrollments WHERE user_id = $1`, [req.user!.id]);
    const row = result.rows[0];
    const enrolled = row?.status === "enrolled" && isCompatibleEmbedding(row.embedding);
    // An organization can turn face checks off for its learners.
    const { faceCheckRequired } = await learnerOrgPolicy(req.user!.id);
    res.json({ enrolled: enrolled || !faceCheckRequired, required: faceCheckRequired });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({
  purpose: z.enum(["placement", "practice", "practice_test"]),
  imageBase64: z.string(),
  sessionId: z.string().uuid().optional(),
});

faceRouter.post("/verify", requireAuth, faceCheckLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = verifySchema.parse(req.body);
    const image = decodeImage(body.imageBase64);

    const enrollmentResult = await pool.query(`SELECT embedding, status FROM face_enrollments WHERE user_id = $1`, [req.user!.id]);
    const enrollment = enrollmentResult.rows[0];

    await mkdir(CHECK_UPLOADS_DIR, { recursive: true });
    const fileName = `${randomUUID()}.jpg`;
    const sampleUri = `/uploads/face-check/${fileName}`;
    await writeFile(path.join(CHECK_UPLOADS_DIR, fileName), image);

    // No usable enrollment — a setup gap, not fixable by retrying here.
    if (!enrollment || enrollment.status !== "enrolled" || !isCompatibleEmbedding(enrollment.embedding)) {
      const result = await pool.query(
        `INSERT INTO face_check_results (user_id, session_id, purpose, decision, sample_uri, flagged_for_review)
         VALUES ($1, $2, $3, 'error', $4, true) RETURNING id`,
        [req.user!.id, body.sessionId ?? null, body.purpose, sampleUri],
      );
      return res.status(201).json({ faceCheckId: result.rows[0].id, allowed: true, decision: "error" });
    }

    const faces = await detectFaces(image);

    // Not an identity failure, doesn't burn a RETRY_LIMIT retry — but still needs its own escape
    // hatch, since bad lighting/camera angle can otherwise never detect a face at all.
    if (faces.length !== 1) {
      const decision = faces.length === 0 ? "no_face" : "multiple_faces";
      const result = await pool.query(
        `INSERT INTO face_check_results (user_id, session_id, purpose, decision, face_count, sample_uri)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.user!.id, body.sessionId ?? null, body.purpose, decision, faces.length, sampleUri],
      );
      if (body.sessionId) await faceCheckSignal(req.user!.id, body.sessionId, decision).catch((err) => console.error("face check signal failed:", err));
      const envRetries = await countRecentFailures(req.user!.id, body.purpose, ["no_face", "multiple_faces", "error"]);
      return res.status(201).json({
        faceCheckId: result.rows[0].id,
        allowed: false,
        decision,
        retake: true,
        fallbackEligible: envRetries >= ENVIRONMENTAL_RETRY_LIMIT,
        reason: faces.length === 0 ? "No face detected. Sit in front of the camera and look straight at it." : "More than one face is in frame. Only you should be visible.",
      });
    }

    const [box] = faces;
    const quality = await assessQuality(image, box);
    if (!quality.ok) {
      const result = await pool.query(
        `INSERT INTO face_check_results (user_id, session_id, purpose, decision, face_count, sample_uri)
         VALUES ($1, $2, $3, 'error', 1, $4) RETURNING id`,
        [req.user!.id, body.sessionId ?? null, body.purpose, sampleUri],
      );
      const envRetries = await countRecentFailures(req.user!.id, body.purpose, ["no_face", "multiple_faces", "error"]);
      return res.status(201).json({
        faceCheckId: result.rows[0].id,
        allowed: false,
        decision: "error",
        retake: true,
        fallbackEligible: envRetries >= ENVIRONMENTAL_RETRY_LIMIT,
        reason: quality.reasons[0],
      });
    }

    const liveness = await scoreLiveness(await cropFace(image, box));
    if (!liveness.isLive) {
      // Attack attempt — never reaches fallback, always flagged.
      const result = await pool.query(
        `INSERT INTO face_check_results (user_id, session_id, purpose, decision, liveness_score, spoof_detected, face_count, sample_uri, flagged_for_review)
         VALUES ($1, $2, $3, 'spoof', $4, true, 1, $5, true) RETURNING id`,
        [req.user!.id, body.sessionId ?? null, body.purpose, liveness.live, sampleUri],
      );
      if (body.sessionId) await faceCheckSignal(req.user!.id, body.sessionId, "spoof").catch((err) => console.error("face check signal failed:", err));
      return res.status(201).json({
        faceCheckId: result.rows[0].id,
        allowed: false,
        decision: "spoof",
        retake: false,
        fallbackEligible: false,
        reason: "Not a live face — looks like a photo or screen.",
      });
    }

    const probeEmbedding = await embedFace(image, box);
    if (!probeEmbedding) {
      const result = await pool.query(
        `INSERT INTO face_check_results (user_id, session_id, purpose, decision, liveness_score, face_count, sample_uri)
         VALUES ($1, $2, $3, 'error', $4, 1, $5) RETURNING id`,
        [req.user!.id, body.sessionId ?? null, body.purpose, liveness.live, sampleUri],
      );
      return res.status(201).json({
        faceCheckId: result.rows[0].id,
        allowed: false,
        decision: "error",
        retake: true,
        reason: "Could not read facial geometry — face the camera squarely.",
      });
    }

    const similarity = cosineSimilarity(bufferToEmbedding(enrollment.embedding), probeEmbedding);
    const decision = similarity >= MATCH_THRESHOLD ? "match" : similarity >= UNCERTAIN_FLOOR ? "uncertain" : "mismatch";

    const result = await pool.query(
      `INSERT INTO face_check_results (user_id, session_id, purpose, decision, similarity_score, liveness_score, face_count, sample_uri, flagged_for_review)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8) RETURNING id`,
      [req.user!.id, body.sessionId ?? null, body.purpose, decision, similarity, liveness.live, sampleUri, decision !== "match"],
    );

    if (body.sessionId) await faceCheckSignal(req.user!.id, body.sessionId, decision).catch((err) => console.error("face check signal failed:", err));

    // uncertain/mismatch both count toward RETRY_LIMIT and look the same to the learner.
    const retriesUsed = await countRecentFailures(req.user!.id, body.purpose, ["mismatch", "uncertain"]);

    res.status(201).json({
      faceCheckId: result.rows[0].id,
      allowed: decision === "match",
      decision,
      retake: false,
      fallbackEligible: decision !== "match" && retriesUsed >= RETRY_LIMIT,
      retriesRemaining: Math.max(0, RETRY_LIMIT - retriesUsed),
      reason: decision === "match" ? undefined : "Face didn't match your enrolled photo. Please try again.",
    });
  } catch (err) {
    next(err);
  }
});

const otpRequestSchema = z.object({ faceCheckId: z.string().uuid() });

faceRouter.post("/otp/request", requireAuth, otpLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = otpRequestSchema.parse(req.body);
    const checkResult = await pool.query(`SELECT decision FROM face_check_results WHERE id = $1 AND user_id = $2`, [
      body.faceCheckId,
      req.user!.id,
    ]);
    const check = checkResult.rows[0];
    if (!check || !FALLBACK_ELIGIBLE_DECISIONS.includes(check.decision)) {
      return res.status(403).json({ error: "not_fallback_eligible" });
    }

    const userResult = await pool.query(`SELECT email FROM users WHERE id = $1`, [req.user!.id]);
    const email = userResult.rows[0]?.email;
    if (!email) return res.status(404).json({ error: "user_not_found" });

    const code = randomInt(100000, 1000000).toString();
    await pool.query(
      `INSERT INTO face_fallback_otp_codes (user_id, face_check_id, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [req.user!.id, body.faceCheckId, hashToken(code), new Date(Date.now() + OTP_TTL_MS)],
    );
    sendFaceFallbackOtpEmail(email, code).catch((err) => console.error("failed to send face fallback OTP email:", err));
    res.status(201).json({ sent: true });
  } catch (err) {
    next(err);
  }
});

const otpVerifySchema = z.object({ faceCheckId: z.string().uuid(), code: z.string() });

faceRouter.post("/otp/verify", requireAuth, otpLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const body = otpVerifySchema.parse(req.body);
    const result = await pool.query(
      `SELECT id FROM face_fallback_otp_codes
       WHERE user_id = $1 AND face_check_id = $2 AND code_hash = $3 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [req.user!.id, body.faceCheckId, hashToken(body.code)],
    );
    const row = result.rows[0];
    if (!row) return res.status(400).json({ error: "invalid_or_expired_code" });

    await pool.query(`UPDATE face_fallback_otp_codes SET used_at = now() WHERE id = $1`, [row.id]);
    res.json({ allowed: true, faceCheckId: body.faceCheckId });
  } catch (err) {
    next(err);
  }
});

// Counts the given decisions since the user's last match for this purpose.
async function countRecentFailures(userId: string, purpose: string, decisions: string[]): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM face_check_results
     WHERE user_id = $1 AND purpose = $2 AND decision = ANY($3)
       AND created_at > COALESCE(
         (SELECT max(created_at) FROM face_check_results WHERE user_id = $1 AND purpose = $2 AND decision = 'match'),
         '1970-01-01'::timestamptz
       )`,
    [userId, purpose, decisions],
  );
  return result.rows[0].n;
}

