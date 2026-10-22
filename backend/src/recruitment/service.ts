// Recruitment: which products an organization has, assessment credits,
// inviting candidates, and recording their results.
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { bankExamIds } from "../catalogue/banks.js";
import type { NextFunction, Request, Response } from "express";
import { generateToken, hashToken, SESSION_COOKIE } from "../auth/tokens.js";
import { checkSession } from "../auth/middleware.js";
import { sendCandidateInviteEmail } from "../auth/mailer.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { emitEvent } from "../webhooks/service.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { levelSummary } from "../placement/levels.js";

export const PRODUCTS = ["skills", "recruitment"] as const;
export type Product = (typeof PRODUCTS)[number];
export const TEST_KINDS = ["placement", "fourSkills", "speakingListening", "writing", "professional"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

// Rate card per candidate assessment, by credits bought at once (USD cents).
export const ASSESSMENT_BANDS = [
  { minQuantity: 1, unitPriceCents: 1500 },
  { minQuantity: 100, unitPriceCents: 1200 },
  { minQuantity: 500, unitPriceCents: 900 },
] as const;
export const LOW_CREDITS = 5;
const CANDIDATE_EMAIL_DOMAIN = "candidate.spica.invalid";

export class RecruitmentError extends Error {
  constructor(public code: string, public status = 400, public detail: Record<string, unknown> = {}) {
    super(code);
  }
}

export async function tenantProducts(tenantId: string | null | undefined): Promise<Product[]> {
  if (!tenantId) return [];
  const r = await pool.query(`SELECT type, products FROM tenants WHERE id = $1`, [tenantId]);
  const t = r.rows[0];
  if (!t) return [];
  // Individuals only ever have the learning product.
  return t.type === "cohort" ? (t.products as Product[]) : ["skills"];
}

export async function assertProduct(tenantId: string | null | undefined, product: Product): Promise<void> {
  if (!(await tenantProducts(tenantId)).includes(product)) throw new RecruitmentError("product_not_enabled", 403, { product });
}

export function unitPriceCents(customCents: number | null, quantity: number): number {
  if (customCents !== null && customCents !== undefined) return customCents;
  let price: number = ASSESSMENT_BANDS[0].unitPriceCents;
  for (const b of ASSESSMENT_BANDS) if (quantity >= b.minQuantity) price = b.unitPriceCents;
  return price;
}

// What one invitation to a test costs: the test's assessment price in credits
// (the products list), else 1 (the placement test).
export async function inviteCost(testKind: string): Promise<number> {
  const r = await pool.query(`SELECT credits FROM products WHERE id = $1`, [`assess_${testKind}`]);
  return Math.max(1, Number(r.rows[0]?.credits ?? 1));
}

// The credits an invitation took, for its refund.
// What the invitation's latest charge was (a resent invitation is charged
// again, so the refund returns that charge, not every charge added up).
async function chargedFor(assessmentId: string): Promise<number> {
  const r = await pool.query(
    `SELECT -delta AS n FROM recruitment_credit_events WHERE assessment_id = $1 AND reason = 'invite' ORDER BY created_at DESC LIMIT 1`,
    [assessmentId],
  );
  return Math.max(1, r.rows[0]?.n ?? 1);
}

export async function creditBalance(tenantId: string): Promise<number> {
  const r = await pool.query(`SELECT coalesce(sum(delta), 0)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1`, [tenantId]);
  return r.rows[0].n;
}

export async function addCredits(args: { tenantId: string; delta: number; reason: "grant" | "purchase" | "refund" | "adjustment"; note?: string | null; actorId?: string | null; assessmentId?: string | null }) {
  await pool.query(
    `INSERT INTO recruitment_credit_events (tenant_id, delta, reason, note, actor_id, assessment_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [args.tenantId, args.delta, args.reason, args.note ?? null, args.actorId ?? null, args.assessmentId ?? null],
  );
}

// One user row per candidate per organization, never a login with a
// password. The real email lives on the assessment; the account email is
// a private placeholder, so a candidate who is also someone's employee or a
// learner elsewhere doesn't clash with that account.
async function candidateUser(tenantId: string, email: string, firstName: string | null, lastName: string | null): Promise<string> {
  const key = createHash("sha256").update(`${tenantId}:${email.toLowerCase()}`).digest("hex").slice(0, 24);
  const placeholder = `cand-${key}@${CANDIDATE_EMAIL_DOMAIN}`;
  const found = await pool.query(`SELECT id FROM users WHERE email = $1`, [placeholder]);
  if (found.rows[0]) {
    await pool.query(`UPDATE users SET first_name = coalesce($2, first_name), last_name = coalesce($3, last_name), deleted_at = NULL WHERE id = $1`, [
      found.rows[0].id,
      firstName,
      lastName,
    ]);
    return found.rows[0].id;
  }
  const hash = await bcrypt.hash(randomUUID(), 4);
  const lang = (await pool.query(`SELECT default_language FROM tenants WHERE id = $1`, [tenantId])).rows[0]?.default_language ?? null;
  const r = await pool.query(
    `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, email_verified, preferred_language)
     VALUES ('candidate', $1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [tenantId, placeholder, hash, firstName, lastName, lang],
  );
  return r.rows[0].id;
}

async function orgLanguage(tenantId: string): Promise<string | undefined> {
  return (await pool.query(`SELECT default_language FROM tenants WHERE id = $1`, [tenantId])).rows[0]?.default_language ?? undefined;
}

export interface InviteInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

// Invites people to one job opening. Each invitation costs the test's
// credits; one live invitation per email per job.
export async function inviteCandidates(args: { tenantId: string; jobId: string; actorId: string; people: InviteInput[] }) {
  const job = (await pool.query(`SELECT * FROM recruitment_jobs WHERE id = $1 AND tenant_id = $2`, [args.jobId, args.tenantId])).rows[0];
  if (!job) throw new RecruitmentError("job_not_found", 404);
  if (job.status !== "open") throw new RecruitmentError("job_closed");
  const org = (await pool.query(`SELECT name FROM tenants WHERE id = $1`, [args.tenantId])).rows[0];
  const lang = await orgLanguage(args.tenantId);

  // De-duplicate within the request, then skip people already invited.
  const seen = new Set<string>();
  const people = args.people.filter((p) => {
    const k = p.email.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const existing = await pool.query(
    `SELECT lower(email) AS email FROM recruitment_assessments WHERE job_id = $1 AND status <> 'cancelled' AND lower(email) = ANY($2::text[])`,
    [args.jobId, people.map((p) => p.email.trim().toLowerCase())],
  );
  const already = new Set(existing.rows.map((r) => r.email));
  const fresh = people.filter((p) => !already.has(p.email.trim().toLowerCase()));

  const cost = await inviteCost(job.test_kind);

  // Practice-test products: each candidate gets one form of the product's
  // real-test bank, never a practice set a learner could have rehearsed
  // (practice sets until that bank is loaded).
  let examIds: string[] = [];
  if (job.test_kind !== "placement") {
    examIds = await bankExamIds(job.test_kind, "assessment");
    if (examIds.length === 0) throw new RecruitmentError("no_exam_available");
  }

  // The balance check and the debits happen in one transaction under the
  // organization's credit lock (the same key as lockCredits in
  // orgTests/service.ts), so invitations and tests given at the same moment
  // can't both spend the same credits. Emails go out after it commits.
  const invited: { id: string; email: string }[] = [];
  const emails: { to: string; token: string; expiresAt: Date }[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`credits:${args.tenantId}`]);
    const balance = (await client.query(`SELECT coalesce(sum(delta), 0)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1`, [args.tenantId])).rows[0].n;
    if (fresh.length * cost > balance) throw new RecruitmentError("not_enough_credits", 402, { needed: fresh.length * cost, balance });
    for (const p of fresh) {
      const email = p.email.trim();
      const candidateId = await candidateUser(args.tenantId, email, p.firstName?.trim() || null, p.lastName?.trim() || null);
      const token = generateToken();
      const expiresAt = new Date(Date.now() + job.invite_valid_days * 86_400_000);
      const examId = examIds.length ? examIds[Math.floor(Math.random() * examIds.length)] : null;
      const r = await client.query(
        `INSERT INTO recruitment_assessments (tenant_id, job_id, candidate_id, email, first_name, last_name, token_hash, exam_id, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [args.tenantId, args.jobId, candidateId, email, p.firstName?.trim() || null, p.lastName?.trim() || null, hashToken(token), examId, args.actorId, expiresAt],
      );
      const id = r.rows[0].id;
      await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, assessment_id, actor_id) VALUES ($1, $4, 'invite', $2, $3)`, [
        args.tenantId,
        id,
        args.actorId,
        -cost,
      ]);
      emails.push({ to: email, token, expiresAt });
      invited.push({ id, email });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  for (const m of emails) {
    sendCandidateInviteEmail({ to: m.to, orgName: org.name, jobTitle: job.title, token: m.token, expiresAt: m.expiresAt, lang }).catch((err) =>
      console.error("failed to send candidate invite:", err),
    );
  }
  if (invited.length) await warnIfLowCredits(args.tenantId);
  return { invited, skipped: people.length - fresh.length };
}

async function warnIfLowCredits(tenantId: string) {
  const balance = await creditBalance(tenantId);
  if (balance > LOW_CREDITS) return;
  for (const id of await orgAdminIds(tenantId)) {
    await notify({
      userId: id,
      kind: "credits_low",
      title: "Assessment credits are running low",
      body: `${balance} assessment credits left. Ask your Edstellar contact for more.`,
      link: "/orgadmin/recruitment",
      // One reminder per level reached.
      dedupeKey: `credits_low:${tenantId}:${balance}`,
    }).catch(() => {});
  }
}

// A new link for an invitation that hasn't been completed. The old link stops working.
export async function resendInvite(tenantId: string, assessmentId: string): Promise<{ emailed: boolean }> {
  const a = (
    await pool.query(
      `SELECT a.*, j.title, j.invite_valid_days, t.name AS org_name FROM recruitment_assessments a
       JOIN recruitment_jobs j ON j.id = a.job_id JOIN tenants t ON t.id = a.tenant_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [assessmentId, tenantId],
    )
  ).rows[0];
  if (!a) throw new RecruitmentError("assessment_not_found", 404);
  if (!["invited", "started", "expired"].includes(a.status)) throw new RecruitmentError("cannot_resend");
  // An expired invitation was refunded; resending charges its price again,
  // under the organization's credit lock like new invitations.
  if (a.status === "expired" && a.credit_refunded) {
    const cost = await chargedFor(assessmentId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`credits:${tenantId}`]);
      const balance = (await client.query(`SELECT coalesce(sum(delta), 0)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1`, [tenantId])).rows[0].n;
      if (balance < cost) throw new RecruitmentError("not_enough_credits", 402, { needed: cost, balance });
      await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, assessment_id) VALUES ($1, $3, 'invite', $2)`, [tenantId, assessmentId, -cost]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  const token = generateToken();
  const expiresAt = new Date(Date.now() + a.invite_valid_days * 86_400_000);
  await pool.query(
    `UPDATE recruitment_assessments SET token_hash = $2, expires_at = $3, reminder_sent_at = NULL, credit_refunded = false,
       status = CASE WHEN status = 'expired' THEN (CASE WHEN started_at IS NULL THEN 'invited' ELSE 'started' END) ELSE status END
     WHERE id = $1`,
    [assessmentId, hashToken(token), expiresAt],
  );
  // The new link is saved either way; the recruiter is told if the email failed.
  return sendCandidateInviteEmail({ to: a.email, orgName: a.org_name, jobTitle: a.title, token, expiresAt, lang: await orgLanguage(tenantId) })
    .then(() => ({ emailed: true }))
    .catch((err) => {
      console.error("candidate invite resend failed:", err);
      return { emailed: false };
    });
}

// Cancelling an invitation nobody started gives the credit back.
export async function cancelInvite(tenantId: string, assessmentId: string, actorId: string): Promise<void> {
  const a = (await pool.query(`SELECT status, started_at, credit_refunded FROM recruitment_assessments WHERE id = $1 AND tenant_id = $2`, [assessmentId, tenantId])).rows[0];
  if (!a) throw new RecruitmentError("assessment_not_found", 404);
  if (!["invited", "started", "expired"].includes(a.status)) throw new RecruitmentError("cannot_cancel");
  await pool.query(`UPDATE recruitment_assessments SET status = 'cancelled' WHERE id = $1`, [assessmentId]);
  if (!a.started_at && !a.credit_refunded) {
    await pool.query(`UPDATE recruitment_assessments SET credit_refunded = true WHERE id = $1`, [assessmentId]);
    await addCredits({ tenantId, delta: await chargedFor(assessmentId), reason: "refund", assessmentId, actorId, note: "Invitation cancelled before it was started" });
  }
  await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL AND user_id = (SELECT candidate_id FROM recruitment_assessments WHERE id = $1)`, [
    assessmentId,
  ]);
}

// The candidate's live assessment: invited or started, not expired.
export async function activeAssessment(candidateId: string) {
  const r = await pool.query(
    `SELECT a.*, j.title AS job_title, j.test_kind, j.show_result_to_candidate, j.min_cefr, t.name AS org_name
     FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id JOIN tenants t ON t.id = a.tenant_id
     WHERE a.candidate_id = $1 AND a.status IN ('invited', 'started') AND a.expires_at > now()
     ORDER BY a.invited_at DESC LIMIT 1`,
    [candidateId],
  );
  return r.rows[0] ?? null;
}

// The most recent assessment, whatever its state (for the finished screen).
export async function latestAssessment(candidateId: string) {
  const r = await pool.query(
    `SELECT a.*, j.title AS job_title, j.test_kind, j.show_result_to_candidate, t.name AS org_name
     FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id JOIN tenants t ON t.id = a.tenant_id
     WHERE a.candidate_id = $1 ORDER BY a.invited_at DESC LIMIT 1`,
    [candidateId],
  );
  return r.rows[0] ?? null;
}

// What the test a candidate may take is, for the access gate.
export async function candidateMayStart(candidateId: string, feature: string): Promise<boolean> {
  const a = await activeAssessment(candidateId);
  if (!a) return false;
  return feature === "placement" ? a.test_kind === "placement" : feature === "mocktest" ? a.test_kind !== "placement" : false;
}

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

// Called when a candidate's placement or mock-exam session completes.
// Stores the result on the assessment, then tells the organization.
export async function recordCandidateResult(userId: string, sessionId: string): Promise<void> {
  const u = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0];
  if (u?.role !== "candidate") return;
  const a = (
    await pool.query(
      `SELECT a.*, j.title, j.min_cefr FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id
       WHERE a.candidate_id = $1 AND a.status IN ('invited', 'started') ORDER BY a.invited_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (!a) return;
  const s = (await pool.query(`SELECT session_type FROM sessions WHERE id = $1`, [sessionId])).rows[0];
  let result: Record<string, unknown> = {};
  if (s?.session_type === "placement") {
    const p = (await pool.query(`SELECT overall_percent, cefr_level, skill_percents, skill_levels, status FROM placements WHERE session_id = $1`, [sessionId])).rows[0];
    result = p
      ? { kind: "placement", overallPercent: p.overall_percent, cefrLevel: p.cefr_level, skillPercents: p.skill_percents, skillLevels: p.skill_levels }
      : { kind: "placement", pending: true };
  } else {
    const rows = (
      await pool.query(
        `SELECT sc.status, sc.content_score, sc.manner_scores, it.input_method, it.skills, i.cefr_level, ep.part_label
         FROM attempts at JOIN scores sc ON sc.attempt_id = at.id JOIN items i ON i.id = at.item_id
         JOIN item_types it ON it.id = i.item_type_id LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id
         WHERE at.session_id = $1`,
        [sessionId],
      )
    ).rows;
    const graded = rows.filter((r) => r.status === "scored");
    const ok = (r: (typeof rows)[number]) => isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
    const labels = [...new Set(rows.map((r) => r.part_label).filter(Boolean))];
    const level = levelSummary(rows);
    result = {
      kind: "exam",
      overallPercent: graded.length ? Math.round((graded.filter(ok).length / graded.length) * 100) : null,
      ...(level ?? {}),
      gradedCount: graded.length,
      pendingCount: rows.filter((r) => r.status === "pending").length,
      partResults: labels.map((label) => {
        const part = graded.filter((r) => r.part_label === label);
        return { label, gradedCount: part.length, correctCount: part.filter(ok).length };
      }),
    };
  }
  const level = typeof result.cefrLevel === "string" ? result.cefrLevel : null;
  result.meetsMinimum = a.min_cefr && level ? CEFR.indexOf(level) >= CEFR.indexOf(a.min_cefr) : null;
  await pool.query(`UPDATE recruitment_assessments SET status = 'completed', completed_at = now(), session_id = $2, result = $3 WHERE id = $1`, [
    a.id,
    sessionId,
    JSON.stringify(result),
  ]);
  await pool.query(`UPDATE auth_sessions SET expires_at = least(expires_at, now() + interval '30 minutes') WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email;
  for (const id of await recruitmentContacts(a.tenant_id, a.invited_by)) {
    await notify({
      userId: id,
      kind: "assessment_completed",
      title: "A candidate finished their assessment",
      body: `${name} finished the assessment for ${a.title}.`,
      link: "/recruitment",
      dedupeKey: `assessment_completed:${a.id}:${id}`,
    }).catch(() => {});
  }
  await emitEvent(a.tenant_id, "assessment.completed", {
    assessmentId: a.id,
    jobId: a.job_id,
    email: a.email,
    firstName: a.first_name,
    lastName: a.last_name,
    result,
  });
}

// Who hears about a candidate: whoever invited them, plus the Org Admin.
async function recruitmentContacts(tenantId: string, invitedBy: string | null): Promise<string[]> {
  const ids = new Set(await orgAdminIds(tenantId));
  if (invitedBy) {
    const r = await pool.query(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND role IN ('recruiter', 'org_admin')`, [invitedBy]);
    if (r.rows[0]) ids.add(r.rows[0].id);
  }
  return [...ids];
}

// Hourly: expire old invitations (refunding unused credits), remind
// candidates two days before the link expires, and erase candidates whose
// retention period has passed.
export async function runRecruitmentLifecycle(eraseCandidate: (userId: string) => Promise<boolean>) {
  const expired = await pool.query(
    `UPDATE recruitment_assessments SET status = 'expired'
     WHERE status IN ('invited', 'started') AND expires_at < now() RETURNING id, tenant_id, started_at, credit_refunded`,
  );
  for (const a of expired.rows) {
    if (!a.started_at && !a.credit_refunded) {
      await pool.query(`UPDATE recruitment_assessments SET credit_refunded = true WHERE id = $1`, [a.id]);
      await addCredits({ tenantId: a.tenant_id, delta: await chargedFor(a.id), reason: "refund", assessmentId: a.id, note: "Invitation expired without being started" });
    }
  }

  const due = await pool.query(
    `SELECT a.id, a.email, a.tenant_id, a.expires_at, j.title, t.name AS org_name, t.default_language
     FROM recruitment_assessments a JOIN recruitment_jobs j ON j.id = a.job_id JOIN tenants t ON t.id = a.tenant_id
     WHERE a.status = 'invited' AND a.reminder_sent_at IS NULL AND a.expires_at < now() + interval '2 days'
       AND a.invited_at < now() - interval '1 day' LIMIT 500`,
  );
  let reminded = 0;
  for (const a of due.rows) {
    // A reminder needs a fresh link: only the token's hash is stored.
    const token = generateToken();
    await pool.query(`UPDATE recruitment_assessments SET token_hash = $2, reminder_sent_at = now() WHERE id = $1`, [a.id, hashToken(token)]);
    await sendCandidateInviteEmail({ to: a.email, orgName: a.org_name, jobTitle: a.title, token, expiresAt: a.expires_at, lang: a.default_language ?? undefined, reminder: true }).catch(
      (err) => console.error("candidate reminder failed:", err),
    );
    reminded++;
  }

  // Candidates with nothing open whose last decision, completion or expiry
  // is older than the organization's retention period.
  const old = await pool.query(
    `SELECT u.id FROM users u JOIN tenants t ON t.id = u.tenant_id
     WHERE u.role = 'candidate' AND u.erased_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM recruitment_assessments a WHERE a.candidate_id = u.id AND a.status IN ('invited', 'started'))
       -- The end of each assessment: its decision, else completion, else expiry.
       AND coalesce((SELECT max(coalesce(greatest(a.decided_at, a.completed_at), a.expires_at)) FROM recruitment_assessments a WHERE a.candidate_id = u.id), u.created_at)
           < now() - make_interval(days => t.candidate_retention_days)
     LIMIT 500`,
  );
  let erased = 0;
  for (const c of old.rows) if (await eraseCandidate(c.id)) erased++;
  return { expired: expired.rowCount ?? 0, reminded, erased };
}

// Changes that belong to the employee skills product (batches, Managers,
// learners, licenses) are refused for an organization that only bought
// recruitment. Reading stays open, so screens show empty lists.
export function requireSkillsProduct(prefixes: string[] | null) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (prefixes && !prefixes.some((p) => req.path.startsWith(p))) return next();
    const check = await checkSession(req.cookies?.[SESSION_COOKIE], req.ip).catch(() => null);
    const tenantId = check?.user?.tenantId;
    if (!tenantId || !["org_admin", "manager"].includes(check!.user!.role)) return next();
    if ((await tenantProducts(tenantId)).includes("skills")) return next();
    res.status(403).json({ error: "product_not_enabled", product: "skills" });
  };
}
