// A job opening's public link: posted on job websites or a careers page, so
// applicants can take the test without being invited one by one. They confirm
// their email with a code, then join the job like an invited candidate; the
// test's credits are used at that moment (not when the link is shared).
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { bankExamIds } from "../catalogue/banks.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendApplyCodeEmail } from "../auth/mailer.js";
import { candidateUser, inviteCost, RecruitmentError } from "./service.js";

const CODE_MINUTES = 10;
const MAX_CODE_TRIES = 5;

export interface PublicJob {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  test_kind: string;
  status: string;
  invite_valid_hours: number;
  public_slug: string | null;
  public_link_enabled: boolean;
  public_link_max: number | null;
  public_link_closes_at: Date | null;
  org_name: string;
}

// A short, unguessable slug for the link (lowercase letters and digits).
export function newSlug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return [...randomBytes(12)].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function jobBySlug(slug: string): Promise<PublicJob | null> {
  if (!/^[a-z0-9]{6,40}$/.test(slug)) return null;
  const r = await pool.query(
    `SELECT j.*, t.name AS org_name FROM recruitment_jobs j JOIN tenants t ON t.id = j.tenant_id WHERE j.public_slug = $1`,
    [slug],
  );
  return r.rows[0] ?? null;
}

// How many people have started through the link.
export async function linkUses(jobId: string): Promise<number> {
  return Number((await pool.query(`SELECT count(*) FROM recruitment_assessments WHERE job_id = $1 AND source = 'public_link' AND status <> 'cancelled'`, [jobId])).rows[0].count);
}

// Whether the link takes people now: open, or why not.
export async function linkState(job: PublicJob): Promise<"open" | "closed" | "full"> {
  if (!job.public_link_enabled || job.status !== "open") return "closed";
  if (job.public_link_closes_at && new Date(job.public_link_closes_at) <= new Date()) return "closed";
  if (job.public_link_max !== null && (await linkUses(job.id)) >= job.public_link_max) return "full";
  return "open";
}

// Emails a 6-digit code that confirms the address.
export async function sendApplyCode(job: PublicJob, email: string, firstName: string | null, lastName: string | null): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO recruitment_apply_codes (job_id, email, first_name, last_name, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [job.id, email, firstName, lastName, hashToken(code), CODE_MINUTES],
  );
  await sendApplyCodeEmail({ to: email, code, orgName: job.org_name, jobTitle: job.title, minutes: CODE_MINUTES });
}

// Checks the latest code for this email and job; the name given with it comes back.
export async function checkApplyCode(job: PublicJob, email: string, code: string): Promise<{ firstName: string | null; lastName: string | null } | null> {
  const row = (
    await pool.query(
      `SELECT id, code_hash, attempts, first_name, last_name FROM recruitment_apply_codes
       WHERE job_id = $1 AND lower(email) = lower($2) AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [job.id, email],
    )
  ).rows[0];
  if (!row || row.attempts >= MAX_CODE_TRIES) return null;
  const a = Buffer.from(hashToken(code.trim()));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await pool.query(`UPDATE recruitment_apply_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return null;
  }
  await pool.query(`UPDATE recruitment_apply_codes SET used_at = now() WHERE id = $1`, [row.id]);
  return { firstName: row.first_name, lastName: row.last_name };
}

// Joins the job: the person's existing assessment for it if they have one,
// else a new one paid with the job's credits.
export async function joinByLink(job: PublicJob, email: string, firstName: string | null, lastName: string | null): Promise<{ assessmentId: string; candidateId: string }> {
  const existing = (
    await pool.query(
      `SELECT id, candidate_id, status, expires_at FROM recruitment_assessments
       WHERE job_id = $1 AND lower(email) = lower($2) AND status <> 'cancelled' ORDER BY invited_at DESC LIMIT 1`,
      [job.id, email],
    )
  ).rows[0];
  if (existing) {
    if (existing.status === "completed") throw new RecruitmentError("already_completed", 409);
    if (!["invited", "started"].includes(existing.status) || new Date(existing.expires_at) <= new Date()) throw new RecruitmentError("invite_expired", 410);
    return { assessmentId: existing.id, candidateId: existing.candidate_id };
  }

  const cost = await inviteCost(job.test_kind);
  let examIds: string[] = [];
  if (job.test_kind !== "placement") {
    examIds = await bankExamIds(job.test_kind, "assessment");
    if (examIds.length === 0) throw new RecruitmentError("no_exam_available");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The same credit lock as invitations and tests given by the organization.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`credits:${job.tenant_id}`]);
    // Checked again under the lock: two people can't both take the last place.
    if (job.public_link_max !== null) {
      const used = Number((await client.query(`SELECT count(*) FROM recruitment_assessments WHERE job_id = $1 AND source = 'public_link' AND status <> 'cancelled'`, [job.id])).rows[0].count);
      if (used >= job.public_link_max) throw new RecruitmentError("link_full", 410);
    }
    const balance = (await client.query(`SELECT coalesce(sum(delta), 0)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1`, [job.tenant_id])).rows[0].n;
    if (balance < cost) throw new RecruitmentError("not_taking_applications", 402);
    const candidateId = await candidateUser(job.tenant_id, email, firstName, lastName);
    const examId = examIds.length ? examIds[Math.floor(Math.random() * examIds.length)] : null;
    const r = await client.query(
      `INSERT INTO recruitment_assessments (tenant_id, job_id, candidate_id, email, first_name, last_name, token_hash, exam_id, invited_by, expires_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, now() + make_interval(hours => $9), 'public_link') RETURNING id`,
      [job.tenant_id, job.id, candidateId, email, firstName, lastName, hashToken(generateToken()), examId, job.invite_valid_hours],
    );
    const assessmentId = r.rows[0].id as string;
    await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, assessment_id, actor_id) VALUES ($1, $3, 'invite', $2, NULL)`, [
      job.tenant_id,
      assessmentId,
      -cost,
    ]);
    await client.query("COMMIT");
    return { assessmentId, candidateId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
