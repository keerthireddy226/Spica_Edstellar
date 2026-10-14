import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { emitEvent } from "../webhooks/service.js";

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
  };
}

// One certificate per learner per batch (or one general one with no batch).
// Names and the level reached are copied in, so it stays accurate later.
export async function issueCertificate(args: { userId: string; batchId: string | null; issuedBy: string | null }): Promise<Certificate | null> {
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
  // NULL batch ids never conflict in a unique index, so a general
  // certificate is matched by hand.
  if (args.batchId === null) {
    const existing = await pool.query(`UPDATE certificates SET revoked_at = NULL WHERE user_id = $1 AND batch_id IS NULL RETURNING *`, [u.id]);
    if (existing.rows[0]) return toCert(existing.rows[0]);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await pool.query(
        `INSERT INTO certificates (code, user_id, tenant_id, batch_id, learner_name, participant_id, organization_name, batch_name, cefr_level, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, batch_id) DO UPDATE SET revoked_at = NULL
         RETURNING *`,
        [newCode(), u.id, u.tenant_id, args.batchId, u.name, u.participant_id, u.type === "cohort" ? u.org : null, u.batch, u.cefr, args.issuedBy],
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
export async function verifyCertificate(code: string): Promise<Certificate | null> {
  const r = await pool.query(`SELECT * FROM certificates WHERE code = $1`, [code.trim().toUpperCase()]);
  return r.rows[0] ? toCert(r.rows[0]) : null;
}
