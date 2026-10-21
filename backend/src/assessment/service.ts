// The real assessment attempt. A learner who owns an attempt (Preparation +
// Assessment, or Assessment only) takes the test once, strictly proctored, and
// gets a score report and a result certificate valid for a year.
//
// When it opens: preparation buyers after their first mock test, or in the
// last 7 days of their access; assessment-only buyers after the free sample
// (a short version of the same test). The attempt is used up when it starts.
//
// Full access (Plus, an organization's licence, the full_access product)
// includes one final assessment: the learner chooses the test, and it opens
// like preparation's, after a mock test of that test or in the last 7 days of
// their access. It stays valid FINAL_GRACE_DAYS after access ends.
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { accessCache } from "../licenses/accessCache.js";
import { notify } from "../notifications/service.js";
import { APP_URL, sendNotificationEmail } from "../auth/mailer.js";
import { BANDS, levelOfScore, scoreReport, spicaScore } from "../reports/scoreReport.js";
import { LEVEL_RETAKE_DAYS } from "../practiceTests/modes.js";
import { qualitySettings } from "../quality/settings.js";
import { randomBytes } from "node:crypto";

const DAY = 86_400_000;
export const UNLOCK_DAYS_BEFORE_END = 7;
// A level test runs on the 4 Skills test's runner (device checks, proctoring).
export const LEVEL_ENGINE_TEST = "fourSkills";
// Questions per part in the free sample.
export const SAMPLE_PER_PART = 2;
// A result certificate is valid this long.
export const VALID_MONTHS = 12;
// Time after finishing for the slower checks (voice) before a certificate is issued.
const SETTLE_MINUTES = 10;
// The final assessment included with Full access stays valid this long after access ends.
export const FINAL_GRACE_DAYS = 14;
export const FINAL_PRODUCT = "final_assessment";

export type AttemptKind = "prep" | "assessment" | "level" | "final";
export type Unlock =
  | { state: "open" }
  | { state: "mock_needed"; opensOn: string }
  | { state: "sample_needed" }
  | { state: "retake_wait"; opensOn: string }
  | { state: "used" }
  | { state: "expired" };

// Pure: whether an owned attempt can be started now. A level test opens at
// once, except within LEVEL_RETAKE_DAYS of a level test at that level that wasn't passed.
export function unlockOf(
  e: { kind: AttemptKind; attemptsLeft: number; endsAt: string | Date },
  done: { mocks: number; samples: number; lastLevelFail?: Date | string | null; retakeDays?: number },
  now = new Date(),
): Unlock {
  const ends = new Date(e.endsAt).getTime();
  if (ends <= now.getTime()) return { state: "expired" };
  if (e.attemptsLeft <= 0) return { state: "used" };
  if (e.kind === "level") {
    const opens = done.lastLevelFail ? new Date(done.lastLevelFail).getTime() + (done.retakeDays ?? LEVEL_RETAKE_DAYS) * DAY : 0;
    return now.getTime() >= opens ? { state: "open" } : { state: "retake_wait", opensOn: new Date(opens).toISOString() };
  }
  if (e.kind === "assessment") return done.samples > 0 ? { state: "open" } : { state: "sample_needed" };
  const opens = ends - (UNLOCK_DAYS_BEFORE_END + (e.kind === "final" ? FINAL_GRACE_DAYS : 0)) * DAY;
  if (done.mocks > 0 || now.getTime() >= opens) return { state: "open" };
  return { state: "mock_needed", opensOn: new Date(opens).toISOString() };
}

export type AttemptStatus = "in_progress" | "scoring" | "under_review" | "certified" | "passed" | "not_passed" | "void";

interface OwnedAttemptRow {
  id: string;
  product_id: string;
  kind: AttemptKind;
  name: string;
  test_type_id: string;
  // A final assessment's test, empty until the learner chooses it.
  chosen_test: string | null;
  test_name: string | null;
  level: string | null;
  tenant_id: string | null;
  attempts_total: number;
  attempts_used: number;
  starts_at: Date;
  ends_at: Date;
}

async function ownedAttempts(userId: string, entitlementId?: string): Promise<OwnedAttemptRow[]> {
  return (
    await pool.query(
      `SELECT e.id, e.product_id, p.kind, p.name, coalesce(e.test_type_id, $3) AS test_type_id, e.test_type_id AS chosen_test, tt.name AS test_name, e.level,
         e.tenant_id, e.attempts_total, e.attempts_used, e.starts_at, e.ends_at
       FROM entitlements e JOIN products p ON p.id = e.product_id LEFT JOIN test_types tt ON tt.id = e.test_type_id
       WHERE e.user_id = $1 AND e.revoked_at IS NULL
         AND ((p.kind IN ('prep', 'assessment') AND e.test_type_id IS NOT NULL) OR (p.kind = 'level' AND e.level IS NOT NULL) OR p.kind = 'final')
         AND e.attempts_total > 0 AND e.starts_at <= now() AND ($2::uuid IS NULL OR e.id = $2)
       ORDER BY e.ends_at DESC`,
      [userId, entitlementId ?? null, LEVEL_ENGINE_TEST],
    )
  ).rows;
}

// Mock tests of the test since the purchase began (any test while a final
// assessment's test isn't chosen), and samples taken for it.
async function doneFor(userId: string, e: OwnedAttemptRow): Promise<{ mocks: number; samples: number; lastLevelFail?: Date | null; retakeDays?: number }> {
  if (e.kind === "level") {
    // The latest level test at this level that wasn't passed.
    const f = await pool.query(
      `SELECT max(completed_at) AS at FROM sessions WHERE user_id = $1 AND delivery_mode = 'certified' AND completed_at IS NOT NULL
         AND composition->>'levelTest' = $2 AND result->'levelTest'->>'passed' = 'false'`,
      [userId, e.level],
    );
    return { mocks: 0, samples: 0, lastLevelFail: f.rows[0]?.at ?? null, retakeDays: (await qualitySettings()).levelRetakeDays };
  }
  const r = (
    await pool.query(
      `SELECT count(*) FILTER (WHERE s.delivery_mode = 'mock')::int AS mocks, count(*) FILTER (WHERE s.delivery_mode = 'sample')::int AS samples
       FROM sessions s LEFT JOIN exams x ON x.id::text = s.composition->>'examId'
       WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL AND s.completed_at >= $3
         AND s.delivery_mode IN ('mock', 'sample') AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND ($2::text IS NULL OR coalesce(s.composition->>'testTypeId', x.test_type_id) = $2)`,
      [userId, e.kind === "final" ? e.chosen_test : e.test_type_id, e.starts_at],
    )
  ).rows[0];
  return { mocks: r.mocks, samples: r.samples };
}

// What My tests shows: each owned attempt, whether it can start, and the attempts taken.
export async function myTests(userId: string) {
  const owned = await ownedAttempts(userId);
  const { appealDays } = await qualitySettings();
  const choices = owned.some((e) => e.kind === "final" && !e.chosen_test) ? await finalChoices(owned.find((e) => e.kind === "final")!.tenant_id) : [];
  const sessions = owned.length
    ? (
        await pool.query(
          `SELECT s.id, s.entitlement_id, s.started_at, s.completed_at, s.result, s.composition->>'abandoned' AS abandoned,
             si.status AS integrity, c.code AS certificate_code, c.revoked_at AS certificate_revoked, c.spica_score, c.cefr_level AS certificate_level, c.valid_until,
             (SELECT row_to_json(x) FROM (SELECT status, decision_note AS note FROM result_appeals ra WHERE ra.session_id = s.id) x) AS appeal,
             EXISTS (SELECT 1 FROM attempts a LEFT JOIN scores sc ON sc.attempt_id = a.id
                     WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL) AND coalesce(sc.status, 'pending') = 'pending') AS grading
           FROM sessions s LEFT JOIN session_integrity si ON si.session_id = s.id LEFT JOIN certificates c ON c.session_id = s.id AND c.kind = 'result'
           WHERE s.user_id = $1 AND s.delivery_mode = 'certified' AND s.entitlement_id = ANY($2::uuid[])
           ORDER BY s.started_at DESC`,
          [userId, owned.map((o) => o.id)],
        )
      ).rows
    : [];
  return Promise.all(
    owned.map(async (e) => {
      const done = await doneFor(userId, e);
      const attemptsLeft = Math.max(0, e.attempts_total - e.attempts_used);
      return {
        id: e.id,
        productId: e.product_id,
        kind: e.kind,
        name: e.name,
        testTypeId: e.kind === "final" ? e.chosen_test : e.test_type_id,
        testName: e.kind === "level" ? `Level ${e.level} test` : e.kind === "final" && !e.chosen_test ? null : e.test_name,
        // A final assessment whose test the learner still chooses, and the tests to choose from.
        chooseTest: e.kind === "final" && !e.chosen_test,
        choices: e.kind === "final" && !e.chosen_test ? choices : [],
        level: e.level,
        attemptsLeft,
        endsAt: new Date(e.ends_at).toISOString(),
        unlock: unlockOf({ kind: e.kind, attemptsLeft, endsAt: e.ends_at }, done),
        mocksDone: done.mocks,
        samplesDone: done.samples,
        attempts: sessions
          .filter((s) => s.entitlement_id === e.id)
          .map((s) => ({
            sessionId: s.id as string,
            startedAt: new Date(s.started_at).toISOString(),
            completedAt: s.completed_at ? new Date(s.completed_at).toISOString() : null,
            status: attemptStatus(s),
            certificateCode: s.certificate_code && !s.certificate_revoked ? (s.certificate_code as string) : null,
            spicaScore: s.certificate_code && !s.certificate_revoked ? (s.spica_score as number | null) : null,
            level: s.certificate_code && !s.certificate_revoked ? (s.certificate_level as string | null) : null,
            validUntil: s.valid_until && !s.certificate_revoked ? new Date(s.valid_until).toISOString().slice(0, 10) : null,
            // A level test's result: passed or not, overall and each skill's share right.
            levelResult: s.result?.levelTest ?? null,
            appeal: (s.appeal as { status: string; note: string | null } | null) ?? null,
            // Appeals are open this many days after the test.
            canAppeal: !!s.completed_at && !s.appeal && Date.now() - new Date(s.completed_at).getTime() < appealDays * 86_400_000,
          })),
      };
    }),
  );
}

function attemptStatus(s: Record<string, any>): AttemptStatus {
  if (!s.completed_at) return "in_progress";
  if (s.integrity === "violation") return "void";
  if (s.result?.levelTest && s.result.levelTest.passed === false) return "not_passed";
  // A level test is a check of where the learner is, with no certificate.
  if (s.result?.levelTest && s.result.levelTest.passed === true) return s.integrity === "flagged" ? "under_review" : "passed";
  if (s.certificate_code && !s.certificate_revoked) return "certified";
  if (s.integrity === "flagged") return "under_review";
  return "scoring";
}

export class AttemptError extends Error {
  constructor(public code: string, public detail: Record<string, unknown> = {}) {
    super(code);
  }
}

// Checks a certified attempt (or a sample) can start for this purchase.
export async function checkStart(userId: string, entitlementId: string, mode: "certified" | "sample"): Promise<{ testTypeId: string; level: string | null }> {
  const [e] = await ownedAttempts(userId, entitlementId);
  if (!e) throw new AttemptError("attempt_not_found");
  if (new Date(e.ends_at).getTime() <= Date.now()) throw new AttemptError("attempt_expired");
  if (e.kind === "final" && !e.chosen_test) throw new AttemptError("test_not_chosen");
  const level = e.kind === "level" ? e.level : null;
  if (mode === "sample") return { testTypeId: e.test_type_id, level };
  // The attempt already started (and used up): resuming it is fine.
  const open = await pool.query(`SELECT 1 FROM sessions WHERE user_id = $1 AND entitlement_id = $2 AND delivery_mode = 'certified' AND completed_at IS NULL`, [userId, e.id]);
  if (open.rowCount) return { testTypeId: e.test_type_id, level };
  const attemptsLeft = Math.max(0, e.attempts_total - e.attempts_used);
  const unlock = unlockOf({ kind: e.kind, attemptsLeft, endsAt: e.ends_at }, await doneFor(userId, e));
  if (unlock.state !== "open") throw new AttemptError(`attempt_${unlock.state}`, "opensOn" in unlock ? { opensOn: unlock.opensOn } : {});
  return { testTypeId: e.test_type_id, level };
}

// The tests a final assessment can be: each with a real test on sale, within
// the organization's turned-on tests.
async function finalChoices(tenantId: string | null): Promise<{ id: string; name: string }[]> {
  const allowed = tenantId ? ((await pool.query(`SELECT allowed_test_products FROM tenants WHERE id = $1`, [tenantId])).rows[0]?.allowed_test_products as string[] | null) : null;
  const r = await pool.query(
    `SELECT DISTINCT ON (tt.id) tt.id, tt.name, p.sort_order FROM products p JOIN test_types tt ON tt.id = p.test_type_id
     WHERE p.kind = 'assessment' AND p.active ORDER BY tt.id, p.sort_order`,
  );
  return r.rows
    .filter((x) => !allowed || allowed.includes(x.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((x) => ({ id: x.id as string, name: x.name as string }));
}

// The learner chooses their final assessment's test (once, before starting it).
export async function chooseFinalTest(userId: string, entitlementId: string, testTypeId: string): Promise<void> {
  const [e] = await ownedAttempts(userId, entitlementId);
  if (!e || e.kind !== "final") throw new AttemptError("attempt_not_found");
  if (e.chosen_test) throw new AttemptError("test_already_chosen");
  if (!(await finalChoices(e.tenant_id)).some((c) => c.id === testTypeId)) throw new AttemptError("unknown_test_type");
  await pool.query(`UPDATE entitlements SET test_type_id = $3 WHERE id = $1 AND user_id = $2 AND test_type_id IS NULL AND attempts_used = 0`, [entitlementId, userId, testTypeId]);
  accessCache.delete(userId);
}

// Full access includes one final assessment. Called when Full access starts
// or is extended: an unused one still valid lasts until FINAL_GRACE_DAYS after
// the new end; otherwise (none yet, or the last one used or expired) a new one is added.
export async function includeFinalAssessment(userId: string, tenantId: string | null, accessEndsAt: string | Date): Promise<"added" | "extended" | "none"> {
  const u = (await pool.query(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId])).rows[0];
  if (u?.role !== "learner") return "none";
  const ends = new Date(new Date(accessEndsAt).getTime() + FINAL_GRACE_DAYS * DAY);
  const extended = await pool.query(
    `UPDATE entitlements SET ends_at = greatest(ends_at, $3) WHERE user_id = $1 AND product_id = $2 AND revoked_at IS NULL AND attempts_used = 0 AND ends_at > now() RETURNING id`,
    [userId, FINAL_PRODUCT, ends],
  );
  accessCache.delete(userId);
  if (extended.rowCount) return "extended";
  await pool.query(
    `INSERT INTO entitlements (user_id, product_id, attempts_total, ends_at, source, tenant_id) VALUES ($1, $2, 1, $3, 'included', $4)`,
    [userId, FINAL_PRODUCT, ends, tenantId],
  );
  await notify({
    userId,
    kind: "test_given",
    title: "Your plan includes a final assessment",
    body: "Choose your test in My tests. It opens after a mock test of that test, or in the last 7 days of your access, and ends with a certificate.",
    link: "/my-tests",
  }).catch((err) => console.error("final assessment notification failed:", err));
  return "added";
}

// My journey's last step: how close the learner's mock tests put them to their
// goal, and their final assessment. Readiness is advice only: the final
// assessment opens by its own rule.
export const READINESS_MOCKS = 2;
export async function readiness(userId: string) {
  const goalRow = (await pool.query(`SELECT goal_level FROM participant_profiles WHERE user_id = $1`, [userId])).rows[0];
  const goal: string | null = goalRow?.goal_level && goalRow.goal_level !== "unsure" ? goalRow.goal_level : null;
  const mocks = (
    await pool.query(
      `SELECT result->>'cefrLevel' AS level, (result->>'overallPercent')::numeric AS percent, completed_at FROM sessions
       WHERE user_id = $1 AND delivery_mode = 'mock' AND completed_at IS NOT NULL AND result->>'cefrLevel' IS NOT NULL
         AND NOT coalesce((composition->>'abandoned')::boolean, false)
       ORDER BY completed_at DESC LIMIT $2`,
      [userId, READINESS_MOCKS],
    )
  ).rows;
  const scores = mocks.map((m) => spicaScore(m.level, m.percent === null ? null : Number(m.percent))).filter((x): x is number => x !== null);
  const predictedScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const goalScore = goal ? (BANDS.find((b) => b.level === goal)?.min ?? null) : null;
  const tests = await myTests(userId);
  // The final assessment to point at: one still to take, else the latest.
  const pending = tests.find((t) => t.kind !== "level" && t.attemptsLeft > 0 && t.unlock.state !== "expired");
  const cert = (
    await pool.query(
      `SELECT code, cefr_level, spica_score, valid_until FROM certificates
       WHERE user_id = $1 AND kind = 'result' AND revoked_at IS NULL AND (valid_until IS NULL OR valid_until >= current_date)
       ORDER BY issued_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  return {
    goal,
    goalScore,
    mocks: scores.length,
    predicted: predictedScore === null ? null : { score: predictedScore, level: levelOfScore(predictedScore) },
    ready: predictedScore !== null && goalScore !== null && predictedScore >= goalScore,
    final: pending
      ? { id: pending.id, kind: pending.kind, testName: pending.testName, unlock: pending.unlock, chooseTest: pending.chooseTest, endsAt: pending.endsAt }
      : null,
    certificate: cert
      ? { code: cert.code as string, level: cert.cefr_level as string, score: cert.spica_score as number | null, validUntil: cert.valid_until ? new Date(cert.valid_until).toISOString().slice(0, 10) : null }
      : null,
  };
}

// Uses up one attempt, in the transaction that creates the session.
export async function useAttempt(client: PoolClient, userId: string, entitlementId: string): Promise<boolean> {
  const r = await client.query(
    `UPDATE entitlements SET attempts_used = attempts_used + 1
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND ends_at > now() AND attempts_used < attempts_total RETURNING id`,
    [entitlementId, userId],
  );
  accessCache.delete(userId);
  return (r.rowCount ?? 0) > 0;
}

// Keeps only the first questions of each part: the free sample.
export function samplePick<T>(rows: T[], partOf: (r: T) => string | number, perPart = SAMPLE_PER_PART): T[] {
  const seen = new Map<string | number, number>();
  return rows.filter((r) => {
    const n = seen.get(partOf(r)) ?? 0;
    seen.set(partOf(r), n + 1);
    return n < perPart;
  });
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  const bytes = randomBytes(12);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `SPC-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

// The result certificate of one certified attempt: issued (or issued again
// after a reviewer cleared it) once the answers are scored. Returns its code.
export async function issueResultCertificate(sessionId: string): Promise<string | null> {
  const s = (
    await pool.query(
      `SELECT s.id, s.user_id, s.completed_at, s.composition, u.participant_id, u.tenant_id,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, t.name AS org, t.type AS org_type, b.name AS batch, u.batch_id,
         tt.id AS test_type_id, tt.name AS test_name
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = u.tenant_id LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN exams x ON x.id::text = s.composition->>'examId' LEFT JOIN test_types tt ON tt.id = coalesce(s.composition->>'testTypeId', x.test_type_id)
       WHERE s.id = $1 AND s.completed_at IS NOT NULL
         AND (s.delivery_mode = 'certified' OR (u.role = 'candidate' AND EXISTS (
           SELECT 1 FROM recruitment_assessments ra JOIN recruitment_jobs j ON j.id = ra.job_id
           WHERE ra.session_id = s.id AND ra.status = 'completed' AND j.show_result_to_candidate)))`,
      [sessionId],
    )
  ).rows[0];
  if (!s) return null;
  // Only the final assessment gives a certificate: a level test is a check, with none.
  if (s.composition?.levelTest) return null;
  // A candidate: their name and email are on the invitation.
  const cand = (
    await pool.query(
      `SELECT ra.email, ra.first_name, ra.last_name, j.title FROM recruitment_assessments ra JOIN recruitment_jobs j ON j.id = ra.job_id WHERE ra.session_id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (cand) s.name = [cand.first_name, cand.last_name].filter(Boolean).join(" ") || cand.email;
  // A level test (no certificate is issued for one, see above): the level, each skill's share right.
  const levelTest = s.composition?.levelTest as string | undefined;
  let level: string;
  let spica: number | null;
  let skills: Record<string, unknown>;
  let testName: string | null = s.test_name;
  if (levelTest) {
    const r = (await pool.query(`SELECT result->'levelTest' AS lt FROM sessions WHERE id = $1`, [sessionId])).rows[0]?.lt;
    if (!r?.passed) return null;
    level = levelTest;
    spica = null;
    testName = `Level ${levelTest} test`;
    skills = Object.fromEntries(Object.entries((r.skillPercents ?? {}) as Record<string, number | null>).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, { level: levelTest, percent: v }]));
  } else {
    const score = await scoreReport(sessionId, null);
    if (!score?.overall) return null;
    level = score.overall.level;
    spica = score.overall.score;
    skills = Object.fromEntries(score.skills.map((k) => [k.skill, { level: k.level, score: k.score }]));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await pool.query(
        `INSERT INTO certificates (code, kind, user_id, tenant_id, batch_id, learner_name, participant_id, organization_name, batch_name,
           cefr_level, session_id, test_type_id, test_name, spica_score, skill_scores, valid_until)
         VALUES ($1, 'result', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, (now() + make_interval(months => $15))::date)
         ON CONFLICT (session_id) DO UPDATE SET revoked_at = NULL
         RETURNING code, (xmax = 0) AS created`,
        [
          newCode(),
          s.user_id,
          s.tenant_id,
          s.batch_id,
          s.name,
          s.participant_id,
          s.org_type === "cohort" ? s.org : null,
          s.batch,
          level,
          sessionId,
          s.test_type_id,
          testName,
          spica,
          JSON.stringify(skills),
          VALID_MONTHS,
        ],
      );
      const { code, created } = r.rows[0];
      if (created && cand) {
        await sendNotificationEmail({
          to: cand.email,
          subject: `Your English certificate from ${s.org}`,
          text: `Hello ${cand.first_name ?? ""},\n\nYour English test for ${cand.title} is scored. Your certificate (${testName ?? "Spica"}: level ${level}${spica !== null ? `, Spica score ${spica}` : ""}) is here:\n${APP_URL}/certificate/${code}\n\nAnyone can check it with this link or its QR code.`,
        }).catch((err) => console.error("candidate certificate email failed:", err));
      } else if (created) {
        await notify({
          userId: s.user_id,
          kind: "result_certificate",
          title: "Your certificate is ready",
          body: spica !== null ? `${testName ?? "Your test"}: Spica score ${spica}, level ${level}.` : `${testName}: passed.`,
          link: "/my-tests",
          email: true,
          dedupeKey: `result_certificate:${sessionId}`,
        }).catch((err) => console.error("certificate notification failed:", err));
      }
      return code as string;
    } catch (err) {
      if (!(err && typeof err === "object" && "constraint" in err && err.constraint === "certificates_code_key")) throw err;
    }
  }
  return null;
}

// A certificate stops counting while its attempt is flagged again or found to be a violation.
export async function holdResultCertificate(sessionId: string): Promise<void> {
  await pool.query(`UPDATE certificates SET revoked_at = now() WHERE session_id = $1 AND kind = 'result' AND revoked_at IS NULL`, [sessionId]);
}

// Periodic: certified attempts that finished a while ago, with every answer
// scored and proctoring clear (or cleared by a reviewer), get their certificate.
export async function issueDueResultCertificates(): Promise<number> {
  const due = (
    await pool.query(
      `SELECT s.id FROM sessions s JOIN session_integrity si ON si.session_id = s.id
       WHERE (s.delivery_mode = 'certified' OR EXISTS (
               SELECT 1 FROM recruitment_assessments ra JOIN recruitment_jobs j ON j.id = ra.job_id
               WHERE ra.session_id = s.id AND ra.status = 'completed' AND j.show_result_to_candidate))
         AND s.completed_at IS NOT NULL AND s.completed_at < now() - make_interval(mins => $1)
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND si.status IN ('clear', 'cleared')
         -- Only the final assessment gives a certificate: level tests have none.
         AND s.composition->>'levelTest' IS NULL
         AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.session_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM attempts a LEFT JOIN scores sc ON sc.attempt_id = a.id
                         WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL) AND coalesce(sc.status, 'pending') = 'pending')
       ORDER BY s.completed_at LIMIT 50`,
      [SETTLE_MINUTES],
    )
  ).rows;
  let n = 0;
  for (const r of due) if (await issueResultCertificate(r.id).catch((err) => (console.error("result certificate failed:", err), null))) n++;
  return n;
}
