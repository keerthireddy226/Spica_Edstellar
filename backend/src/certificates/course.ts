// Course certificates: a learner who finished the course (every practice test
// set and a mock exam, or access ended after taking tests) asks for one; an
// org learner's request goes to their org admins, an individual's to Spica
// staff, who check it and issue. A real Versant result the learner uploaded
// goes on the certificate only when the person issuing it ticks that they
// checked the score report.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { learnerAccess, learnerKind } from "../licenses/service.js";
import { practiceSetProgress } from "../learner/keepGoing.js";
import { LEVELS, overallFromSkills, pathSummary } from "../learner/path.js";
import { dateOnly } from "../lib/dateOnly.js";
import { issueCertificate } from "./service.js";

export const COURSE_NAME = "Versant English 4 Skills preparation";
export const VERSANT_PROOF_DIR = path.resolve("private", "versant");
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

export class CourseCertificateError extends Error {
  constructor(public code: "not_eligible" | "already_pending" | "request_not_found" | "not_pending" | "bad_proof" | "proof_too_large") {
    super(code);
  }
}

type SkillResult = { level?: string; score?: number };

export interface VersantResult {
  id: string;
  takenOn: string;
  overallLevel: string;
  overallScore: number | null;
  skills: Record<string, SkillResult>;
  hasProof: boolean;
  proofType: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

const toResult = (r: Record<string, any>): VersantResult => ({
  id: r.id,
  takenOn: dateOnly(r.taken_on),
  overallLevel: r.overall_level,
  overallScore: r.overall_score,
  skills: r.skill_levels ?? {},
  hasProof: !!r.proof_path,
  proofType: r.proof_type,
  verifiedAt: r.verified_at,
  createdAt: r.created_at,
});

export async function latestVersantResult(userId: string): Promise<VersantResult | null> {
  const r = await pool.query(`SELECT * FROM versant_results WHERE user_id = $1 ORDER BY taken_on DESC, created_at DESC LIMIT 1`, [userId]);
  return r.rows[0] ? toResult(r.rows[0]) : null;
}

// The score report: an image (re-encoded, which strips anything that isn't
// one) or a PDF, kept outside the public uploads folder.
async function saveProof(id: string, base64: string): Promise<{ file: string; type: string }> {
  const m = /^data:([a-z/+.-]+);base64,/.exec(base64);
  const data = Buffer.from(base64.replace(/^data:[a-z/+.-]+;base64,/, ""), "base64");
  if (data.length > MAX_PROOF_BYTES) throw new CourseCertificateError("proof_too_large");
  await mkdir(VERSANT_PROOF_DIR, { recursive: true });
  if (data.subarray(0, 5).toString() === "%PDF-") {
    await writeFile(path.join(VERSANT_PROOF_DIR, `${id}.pdf`), data);
    return { file: `${id}.pdf`, type: "application/pdf" };
  }
  if (m && !m[1].startsWith("image/")) throw new CourseCertificateError("bad_proof");
  const png = await sharp(data)
    .resize(2000, 2000, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer()
    .catch(() => {
      throw new CourseCertificateError("bad_proof");
    });
  await writeFile(path.join(VERSANT_PROOF_DIR, `${id}.png`), png);
  return { file: `${id}.png`, type: "image/png" };
}

export async function saveVersantResult(
  userId: string,
  body: { takenOn: string; overallLevel: string; overallScore?: number | null; skills?: Record<string, SkillResult>; proofBase64?: string | null },
): Promise<VersantResult> {
  const id = randomUUID();
  const proof = body.proofBase64 ? await saveProof(id, body.proofBase64) : null;
  const r = await pool.query(
    `INSERT INTO versant_results (id, user_id, taken_on, overall_level, overall_score, skill_levels, proof_path, proof_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, userId, body.takenOn, body.overallLevel, body.overallScore ?? null, JSON.stringify(body.skills ?? {}), proof?.file ?? null, proof?.type ?? null],
  );
  return toResult(r.rows[0]);
}

// Who may open a result's score report: the learner, their org admins, staff.
export async function proofFor(resultId: string, viewer: { id: string; role: string; tenantId: string | null }) {
  const r = (
    await pool.query(`SELECT v.proof_path, v.proof_type, v.user_id, u.tenant_id FROM versant_results v JOIN users u ON u.id = v.user_id WHERE v.id = $1`, [resultId])
  ).rows[0];
  if (!r?.proof_path) return null;
  const allowed =
    r.user_id === viewer.id || ["admin", "super_admin"].includes(viewer.role) || (viewer.role === "org_admin" && viewer.tenantId === r.tenant_id);
  return allowed ? { file: path.join(VERSANT_PROOF_DIR, r.proof_path), type: r.proof_type as string } : null;
}

// What the learner has done, and whether they can ask for a certificate:
// every practice test set and at least one mock, or access ended after
// taking at least one test.
export async function certificateStatus(userId: string) {
  const kind = await learnerKind(userId);
  const access = await learnerAccess(userId);
  const sets = await practiceSetProgress(userId);
  const tests = (
    await pool.query(
      `SELECT count(*) FILTER (WHERE delivery_mode = 'mock')::int AS mocks, count(*)::int AS tests
       FROM sessions WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NOT NULL
         AND coalesce(composition->>'abandoned', 'false') <> 'true'`,
      [userId],
    )
  ).rows[0];
  const profile = (await pool.query(`SELECT goal_level FROM participant_profiles WHERE user_id = $1`, [userId])).rows[0] ?? {};
  const goal: string | null = profile.goal_level && profile.goal_level !== "unsure" ? profile.goal_level : null;
  const level = overallFromSkills(await pathSummary(userId));
  const started = (
    await pool.query(
      `SELECT least(
         (SELECT min(starts_at) FROM license_assignments WHERE user_id = $1 AND reclaimed_at IS NULL),
         (SELECT min(taken_at) FROM placements WHERE user_id = $1),
         (SELECT min(started_at) FROM sessions WHERE user_id = $1)
       ) AS at, (SELECT created_at FROM users WHERE id = $1) AS created`,
      [userId],
    )
  ).rows[0];
  const today = dateOnly(new Date());
  const ends = access.accessEndsAt ? dateOnly(access.accessEndsAt) : null;
  const accessEnded = access.status === "expired" || access.status === "grace";
  const allPracticeDone = sets.total > 0 && sets.done >= sets.total;
  const eligible = (allPracticeDone && tests.mocks > 0) || (accessEnded && tests.tests > 0);

  const request = (await pool.query(`SELECT id, status, decision_note, decided_at, created_at FROM certificate_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]))
    .rows[0];
  const certificate = (
    await pool.query(`SELECT code, issued_at FROM certificates WHERE user_id = $1 AND revoked_at IS NULL AND course_name IS NOT NULL ORDER BY issued_at DESC LIMIT 1`, [userId])
  ).rows[0];
  const versant = await latestVersantResult(userId);
  return {
    reviewer: kind === "org" ? ("org" as const) : ("staff" as const),
    eligible,
    practice: sets,
    mocks: tests.mocks as number,
    tests: tests.tests as number,
    access: { status: access.status, endsAt: ends, ended: accessEnded },
    period: { from: dateOnly(started.at ?? started.created), to: ends && ends < today ? ends : today },
    goal,
    level,
    goalReached: !!goal && !!level && LEVELS.indexOf(level as never) >= LEVELS.indexOf(goal as never),
    versant,
    versantGoalReached: !!goal && !!versant && LEVELS.indexOf(versant.overallLevel as never) >= LEVELS.indexOf(goal as never),
    request: request
      ? { id: request.id, status: request.status as "pending" | "issued" | "declined", note: request.decision_note, decidedAt: request.decided_at, createdAt: request.created_at }
      : null,
    certificate: certificate ? { code: certificate.code as string, issuedAt: certificate.issued_at } : null,
  };
}

// Spica staff, each with the link to the requests page in their own console.
async function staffReviewers(): Promise<{ id: string; link: string }[]> {
  return (await pool.query(`SELECT id, role FROM users WHERE role IN ('admin', 'super_admin') AND deleted_at IS NULL`)).rows.map((r) => ({
    id: r.id,
    link: r.role === "super_admin" ? "/superadmin/certificates" : "/admin/certificates",
  }));
}

export async function requestCertificate(userId: string): Promise<string> {
  const status = await certificateStatus(userId);
  if (!status.eligible) throw new CourseCertificateError("not_eligible");
  if (status.request?.status === "pending") throw new CourseCertificateError("already_pending");
  const u = (
    await pool.query(`SELECT tenant_id, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS name, participant_id FROM users WHERE id = $1`, [userId])
  ).rows[0];
  const { versant, request: _r, certificate: _c, ...snapshot } = status;
  const id = (
    await pool.query(
      `INSERT INTO certificate_requests (user_id, tenant_id, reviewer, snapshot, versant_result_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, u.tenant_id, status.reviewer, JSON.stringify(snapshot), versant?.id ?? null],
    )
  ).rows[0].id;
  const to = status.reviewer === "org" ? (await orgAdminIds(u.tenant_id)).map((id) => ({ id, link: "/orgadmin/certificates" })) : await staffReviewers();
  const who = u.participant_id ? `${u.name} (${u.participant_id})` : u.name;
  for (const admin of to) {
    await notify({
      userId: admin.id,
      kind: "certificate_request",
      title: `${who} asks for a course certificate`,
      body: `Level ${status.level ?? "—"}${status.goal ? `, goal ${status.goal}` : ""}. ${status.practice.done} of ${status.practice.total} practice tests and ${status.mocks} mock exam${status.mocks === 1 ? "" : "s"} done.${versant ? ` Versant result uploaded: ${versant.overallLevel}.` : ""}`,
      link: admin.link,
      email: true,
      sentBy: userId,
      meta: { requestId: id },
    });
  }
  return id;
}

export async function listRequests(scope: { reviewer: "org"; tenantId: string } | { reviewer: "staff" }, status: "pending" | "all") {
  const r = await pool.query(
    `SELECT cr.id, cr.status, cr.snapshot, cr.created_at, cr.decided_at, cr.decision_note, cr.user_id,
       coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.email, u.participant_id,
       t.name AS org, t.type AS tenant_type, b.name AS batch, c.code,
       v.id AS v_id, v.taken_on, v.overall_level, v.overall_score, v.skill_levels, v.proof_path, v.proof_type, v.verified_at, v.created_at AS v_created
     FROM certificate_requests cr JOIN users u ON u.id = cr.user_id
     LEFT JOIN tenants t ON t.id = cr.tenant_id LEFT JOIN batches b ON b.id = u.batch_id
     LEFT JOIN certificates c ON c.id = cr.certificate_id
     LEFT JOIN LATERAL (SELECT * FROM versant_results v WHERE v.user_id = cr.user_id ORDER BY taken_on DESC, created_at DESC LIMIT 1) v ON true
     WHERE cr.reviewer = $1 AND ($2::uuid IS NULL OR cr.tenant_id = $2) AND ($3 = 'all' OR cr.status = 'pending')
     ORDER BY (cr.status = 'pending') DESC, cr.created_at DESC LIMIT 200`,
    [scope.reviewer, scope.reviewer === "org" ? scope.tenantId : null, status],
  );
  return r.rows.map((x) => ({
    id: x.id,
    status: x.status,
    createdAt: x.created_at,
    decidedAt: x.decided_at,
    note: x.decision_note,
    learner: { id: x.user_id, name: x.name, email: x.email, learnerId: x.participant_id, org: x.tenant_type === "cohort" ? x.org : null, batch: x.batch },
    snapshot: x.snapshot,
    certificateCode: x.code,
    versant: x.v_id
      ? toResult({
          id: x.v_id,
          taken_on: x.taken_on,
          overall_level: x.overall_level,
          overall_score: x.overall_score,
          skill_levels: x.skill_levels,
          proof_path: x.proof_path,
          proof_type: x.proof_type,
          verified_at: x.verified_at,
          created_at: x.v_created,
        })
      : null,
  }));
}

// Issue (optionally with the checked Versant result) or decline with a reason.
export async function decideRequest(
  requestId: string,
  scope: { reviewer: "org"; tenantId: string } | { reviewer: "staff" },
  decidedBy: string,
  decision: { issue: true; includeVersant: boolean } | { issue: false; note: string },
) {
  const req = (
    await pool.query(`SELECT * FROM certificate_requests WHERE id = $1 AND reviewer = $2 AND ($3::uuid IS NULL OR tenant_id = $3)`, [
      requestId,
      scope.reviewer,
      scope.reviewer === "org" ? scope.tenantId : null,
    ])
  ).rows[0];
  if (!req) throw new CourseCertificateError("request_not_found");
  if (req.status !== "pending") throw new CourseCertificateError("not_pending");

  if (!decision.issue) {
    await pool.query(`UPDATE certificate_requests SET status = 'declined', decision_note = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [
      requestId,
      decision.note,
      decidedBy,
    ]);
    await notify({
      userId: req.user_id,
      kind: "certificate_decided",
      title: "Your certificate request was declined",
      body: decision.note,
      link: "/roadmap",
      email: true,
      sentBy: decidedBy,
    });
    return { issued: false as const };
  }

  // Fresh numbers at the moment of issue (the learner may have done more).
  const status = await certificateStatus(req.user_id);
  const versant = decision.includeVersant ? status.versant : null;
  if (versant) await pool.query(`UPDATE versant_results SET verified_at = now(), verified_by = $2 WHERE id = $1`, [versant.id, decidedBy]);
  const user = (await pool.query(`SELECT batch_id FROM users WHERE id = $1`, [req.user_id])).rows[0];
  const cert = await issueCertificate({
    userId: req.user_id,
    batchId: status.reviewer === "org" ? (user?.batch_id ?? null) : null,
    issuedBy: decidedBy,
    course: {
      name: COURSE_NAME,
      periodFrom: status.period.from,
      periodTo: status.period.to,
      goal: status.goal,
      level: status.level,
      versant: versant ? { level: versant.overallLevel, score: versant.overallScore, takenOn: versant.takenOn } : null,
    },
  });
  if (!cert) throw new CourseCertificateError("request_not_found");
  await pool.query(`UPDATE certificate_requests SET status = 'issued', certificate_id = $2, decided_by = $3, decided_at = now() WHERE id = $1`, [requestId, cert.id, decidedBy]);
  await notify({
    userId: req.user_id,
    kind: "certificate_decided",
    title: "Your certificate is ready",
    body: `Your certificate of completion has been issued (ID ${cert.code}). Open it to download or share it.`,
    link: `/certificate/${cert.code}`,
    email: true,
    sentBy: decidedBy,
  });
  return { issued: true as const, code: cert.code };
}
