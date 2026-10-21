import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { emitEvent } from "../webhooks/service.js";
import { dateOnly } from "../lib/dateOnly.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

function newCode(): string {
  const bytes = randomBytes(12);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `SPC-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export interface Certificate {
  id: string;
  code: string;
  learnerName: string;
  participantId: string | null;
  organizationName: string | null;
  batchName: string | null;
  cefrLevel: string | null;
  issuedAt: string;
  revokedAt: string | null;
  courseName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  goalLevel: string | null;
  versantLevel: string | null;
  versantScore: number | null;
  versantTakenOn: string | null;
  hasOrgLogo: boolean;
  // A result certificate: one real assessment attempt.
  kind: "completion" | "result";
  testName: string | null;
  spicaScore: number | null;
  skillScores: Record<string, { level: string; score: number }> | null;
  validUntil: string | null;
}

// A course certificate's details: the course, its period, the goal, the
// level reached in Spica and (once checked) the real Versant result.
export interface CourseDetails {
  name: string;
  periodFrom: string;
  periodTo: string;
  goal: string | null;
  level: string | null;
  versant: { level: string; score: number | null; takenOn: string } | null;
}

function toCert(r: Record<string, any>): Certificate {
  return {
    id: r.id,
    code: r.code,
    learnerName: r.learner_name,
    participantId: r.participant_id,
    organizationName: r.organization_name,
    batchName: r.batch_name,
    cefrLevel: r.cefr_level,
    issuedAt: r.issued_at,
    revokedAt: r.revoked_at,
    courseName: r.course_name ?? null,
    periodFrom: r.period_from ? dateOnly(r.period_from) : null,
    periodTo: r.period_to ? dateOnly(r.period_to) : null,
    goalLevel: r.goal_level ?? null,
    versantLevel: r.versant_level ?? null,
    versantScore: r.versant_score ?? null,
    versantTakenOn: r.versant_taken_on ? dateOnly(r.versant_taken_on) : null,
    hasOrgLogo: !!r.org_logo,
    kind: r.kind ?? "completion",
    testName: r.test_name ?? null,
    spicaScore: r.spica_score ?? null,
    skillScores: r.skill_scores ?? null,
    validUntil: r.valid_until ? dateOnly(r.valid_until) : null,
  };
}

// Certificates now come only from the final assessment (a real, proctored
// test). Completion certificates are no longer issued; those already issued
// stay valid and can still be checked.
export const COMPLETION_CERTIFICATES = false;

// One completion certificate per learner per batch (or one general one with no batch).
// Names and the level reached are copied in, so it stays accurate later.
export async function issueCertificate(args: { userId: string; batchId: string | null; issuedBy: string | null; course?: CourseDetails }): Promise<Certificate | null> {
  if (!COMPLETION_CERTIFICATES) return null;
  const u = (
    await pool.query(
      `SELECT u.id, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.participant_id, u.tenant_id,
         t.name AS org, t.type, b.name AS batch,
         (SELECT cefr_level FROM placements pl WHERE pl.user_id = u.id ORDER BY taken_at DESC LIMIT 1) AS cefr
       FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN batches b ON b.id = $2
       WHERE u.id = $1 AND u.role = 'learner'`,
      [args.userId, args.batchId],
    )
  ).rows[0];
  if (!u) return null;
  const c = args.course;
  // A course certificate carries the level reached in Spica; a batch one the level test's.
  const level = c ? (c.level ?? u.cefr) : u.cefr;
  const courseValues = [c?.name ?? null, c?.periodFrom ?? null, c?.periodTo ?? null, c?.goal ?? null, c?.versant?.level ?? null, c?.versant?.score ?? null, c?.versant?.takenOn ?? null];
  // NULL batch ids never conflict in a unique index, so a general
  // certificate is matched by hand.
  if (args.batchId === null) {
    const existing = await pool.query(
      c
        ? `UPDATE certificates SET revoked_at = NULL, issued_at = now(), issued_by = $2, cefr_level = $3, learner_name = $4, organization_name = $5,
             course_name = $6, period_from = $7, period_to = $8, goal_level = $9, versant_level = $10, versant_score = $11, versant_taken_on = $12
           WHERE user_id = $1 AND batch_id IS NULL AND kind = 'completion' RETURNING *`
        : `UPDATE certificates SET revoked_at = NULL WHERE user_id = $1 AND batch_id IS NULL AND kind = 'completion' RETURNING *`,
      c ? [u.id, args.issuedBy, level, u.name, u.type === "cohort" ? u.org : null, ...courseValues] : [u.id],
    );
    if (existing.rows[0]) return toCert(existing.rows[0]);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await pool.query(
        `INSERT INTO certificates (code, user_id, tenant_id, batch_id, learner_name, participant_id, organization_name, batch_name, cefr_level, issued_by,
           course_name, period_from, period_to, goal_level, versant_level, versant_score, versant_taken_on)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (user_id, batch_id) WHERE kind = 'completion' DO UPDATE SET revoked_at = NULL${
           c
             ? `, issued_at = now(), issued_by = EXCLUDED.issued_by, cefr_level = EXCLUDED.cefr_level, course_name = EXCLUDED.course_name,
                period_from = EXCLUDED.period_from, period_to = EXCLUDED.period_to, goal_level = EXCLUDED.goal_level,
                versant_level = EXCLUDED.versant_level, versant_score = EXCLUDED.versant_score, versant_taken_on = EXCLUDED.versant_taken_on`
             : ""
         }
         RETURNING *`,
        [newCode(), u.id, u.tenant_id, args.batchId, u.name, u.participant_id, u.type === "cohort" ? u.org : null, u.batch, level, args.issuedBy, ...courseValues],
      );
      const cert = toCert(r.rows[0]);
      await emitEvent(u.tenant_id, "certificate.issued", {
        certificateId: cert.id,
        code: cert.code,
        learnerId: u.id,
        participantId: cert.participantId,
        batchName: cert.batchName,
        cefrLevel: cert.cefrLevel,
      });
      return cert;
    } catch (err) {
      // A code collision is astronomically unlikely; just try another.
      if (!(err && typeof err === "object" && "constraint" in err && err.constraint === "certificates_code_key")) throw err;
    }
  }
  return null;
}

// When a batch completes: everyone who actually practised gets one.
export async function issueForBatch(batchId: string, issuedBy: string | null): Promise<number> {
  const learners = await pool.query(
    `SELECT u.id FROM users u WHERE u.batch_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0)`,
    [batchId],
  );
  let n = 0;
  for (const l of learners.rows) if (await issueCertificate({ userId: l.id, batchId, issuedBy })) n++;
  return n;
}

export async function listForLearner(userId: string): Promise<Certificate[]> {
  const r = await pool.query(`SELECT * FROM certificates WHERE user_id = $1 AND revoked_at IS NULL ORDER BY issued_at DESC`, [userId]);
  return r.rows.map(toCert);
}

export async function listForTenant(tenantId: string, batchId?: string | null): Promise<(Certificate & { userId: string | null })[]> {
  const r = await pool.query(
    `SELECT * FROM certificates WHERE tenant_id = $1 AND ($2::uuid IS NULL OR batch_id = $2) ORDER BY issued_at DESC LIMIT 500`,
    [tenantId, batchId ?? null],
  );
  return r.rows.map((x) => ({ ...toCert(x), userId: x.user_id }));
}

export async function revokeCertificate(tenantId: string, id: string): Promise<boolean> {
  const r = await pool.query(`UPDATE certificates SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`, [id, tenantId]);
  return (r.rowCount ?? 0) > 0;
}

// Anyone with the code (an employer, a university) can check it's real.
export async function verifyCertificate(code: string): Promise<(Certificate & { tenantId: string | null }) | null> {
  const r = await pool.query(
    `SELECT c.*, CASE WHEN t.type = 'cohort' THEN t.logo_path END AS org_logo FROM certificates c LEFT JOIN tenants t ON t.id = c.tenant_id WHERE c.code = $1`,
    [code.trim().toUpperCase()],
  );
  return r.rows[0] ? { ...toCert(r.rows[0]), tenantId: r.rows[0].tenant_id } : null;
}
