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
import { batchManagerIds, notify, orgAdminIds } from "../notifications/service.js";
import { APP_URL, sendNotificationEmail } from "../auth/mailer.js";
import { BANDS, levelOfScore, scoreReport } from "../reports/scoreReport.js";
import { snapshot } from "../reports/batchReport.js";
import { LEVEL_RETAKE_DAYS } from "../practiceTests/modes.js";
import { qualitySettings } from "../quality/settings.js";
import { PAYMENT_CONFIG } from "../payments/providers.js";
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
// After a real test that scored below the learner's goal, the next one opens
// this many days later: time to practise first (owner decision 2026-10-22).
export const FINAL_RETAKE_DAYS = 30;
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];

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
  done: { mocks: number; samples: number; lastLevelFail?: Date | string | null; retakeDays?: number; lastBelowGoal?: Date | string | null },
  now = new Date(),
): Unlock {
  const ends = new Date(e.endsAt).getTime();
  if (ends <= now.getTime()) return { state: "expired" };
  if (e.attemptsLeft <= 0) return { state: "used" };
  // A real test below the goal: the next one waits FINAL_RETAKE_DAYS.
  if (e.kind !== "level" && done.lastBelowGoal) {
    const opens = new Date(done.lastBelowGoal).getTime() + FINAL_RETAKE_DAYS * DAY;
    if (now.getTime() < opens) return { state: "retake_wait", opensOn: new Date(opens).toISOString() };
  }
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
async function doneFor(
  userId: string,
  e: OwnedAttemptRow,
): Promise<{ mocks: number; samples: number; lastLevelFail?: Date | null; retakeDays?: number; lastBelowGoal?: Date | null }> {
  if (e.kind === "level") {
    // The latest level test at this level that wasn't passed.
    const f = await pool.query(
      `SELECT max(completed_at) AS at FROM sessions WHERE user_id = $1 AND delivery_mode = 'certified' AND completed_at IS NOT NULL
         AND composition->>'levelTest' = $2 AND result->'levelTest'->>'passed' = 'false'
         -- An appeal that granted a new attempt lifts the wait.
         AND NOT EXISTS (SELECT 1 FROM result_appeals ra WHERE ra.session_id = sessions.id AND ra.status = 'new_attempt')`,
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
  return { mocks: r.mocks, samples: r.samples, lastBelowGoal: await lastRealTestBelowGoal(userId) };
}

// When the learner's latest real test (final assessment, not a level test)
// finished, if its level was below their goal; null otherwise. Its level is the
// certificate's, else the result's once every answer is scored. A void attempt,
// or one an appeal granted a new attempt for, doesn't count.
async function lastRealTestBelowGoal(userId: string): Promise<Date | null> {
  const r = (
    await pool.query(
      `SELECT s.completed_at, coalesce(c.cefr_level, CASE WHEN s.result ? 'unscored' THEN NULL ELSE s.result->>'cefrLevel' END) AS level,
         (SELECT goal_level FROM participant_profiles WHERE user_id = $1) AS goal
       FROM sessions s
       LEFT JOIN certificates c ON c.session_id = s.id AND c.kind = 'result' AND c.revoked_at IS NULL
       LEFT JOIN session_integrity si ON si.session_id = s.id
       WHERE s.user_id = $1 AND s.delivery_mode = 'certified' AND s.completed_at IS NOT NULL AND s.composition->>'levelTest' IS NULL
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false) AND coalesce(si.status, '') <> 'violation'
         AND NOT EXISTS (SELECT 1 FROM result_appeals ra WHERE ra.session_id = s.id AND ra.status = 'new_attempt')
       ORDER BY s.completed_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (!r?.level || !CEFR.includes(r.goal)) return null;
  return CEFR.indexOf(r.level) < CEFR.indexOf(r.goal) ? r.completed_at : null;
}

// What Assessment shows: each owned attempt, whether it can start, and the attempts taken.
export async function myTests(userId: string) {
  const owned = await ownedAttempts(userId);
  const { appealDays } = await qualitySettings();
  const choices = owned.some((e) => e.kind === "final" && !e.chosen_test) ? await finalChoices(owned.find((e) => e.kind === "final")!.tenant_id) : [];
  const sessions = owned.length
    ? (
        await pool.query(
          `SELECT s.id, s.entitlement_id, s.started_at, s.completed_at, s.result, s.composition->>'abandoned' AS abandoned,
             si.status AS integrity, c.id AS certificate_id, c.code AS certificate_code, c.revoked_at AS certificate_revoked, c.spica_score, c.cefr_level AS certificate_level, c.valid_until,
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
            certificateId: s.certificate_code && !s.certificate_revoked ? (s.certificate_id as string) : null,
            spicaScore: s.certificate_code && !s.certificate_revoked ? (s.spica_score as number | null) : null,
            level: s.certificate_code && !s.certificate_revoked ? (s.certificate_level as string | null) : null,
            validUntil: s.valid_until && !s.certificate_revoked ? new Date(s.valid_until).toISOString().slice(0, 10) : null,
            // A certificate with no end date is valid for life.
            lifetime: !!s.certificate_code && !s.certificate_revoked && !s.valid_until,
            issuedAt: s.certificate_code ? (s.completed_at ? new Date(s.completed_at).toISOString() : null) : null,
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

// Preparation for one test can be switched to another test once, in its first
// SWITCH_DAYS. To a test that costs the same or less it's free (nothing is
// refunded); to a dearer one the learner pays the difference (owner decision 2026-10-22).
export const SWITCH_DAYS = 7;

type SwitchRow = {
  kind: string;
  attempts_used: number;
  switched_at: Date | string | null;
  revoked_at: Date | string | null;
  starts_at: Date | string;
  ends_at: Date | string;
};

// Pure: preparation not started, switched or revoked, still running and in its first SWITCH_DAYS.
export function switchOpen(e: SwitchRow, now = new Date()): boolean {
  return (
    e.kind === "prep" &&
    e.attempts_used === 0 &&
    !e.switched_at &&
    !e.revoked_at &&
    new Date(e.ends_at).getTime() > now.getTime() &&
    new Date(e.starts_at).getTime() + SWITCH_DAYS * DAY > now.getTime()
  );
}

// Pure: whether a paid switch still goes ahead when its payment lands. The
// SWITCH_DAYS may have passed meanwhile: they paid, so it does, unless its
// real test was used, or it was switched or revoked meanwhile (then staff sort it out).
export function paidSwitchGoesAhead(e: Pick<SwitchRow, "attempts_used" | "switched_at" | "revoked_at"> | undefined): boolean {
  return !!e && e.attempts_used === 0 && !e.switched_at && !e.revoked_at;
}

export type SwitchCharge = { outcome: "free" } | { outcome: "pay"; amount: number; currency: string } | { outcome: "org" };

// Pure: what switching costs, from the two preparations' prices by currency.
// In the currency of the learner's order; when either has no price in it, both
// in USD (and with no USD price either, it can't be priced, so it's free). Only
// the learner's own purchase pays the difference: staff grants and Full access
// stay free, and a preparation an organization gave with credits doesn't move
// to a dearer test without its admin.
export function switchChargeOf(source: string, currency: string, from: Record<string, number>, to: Record<string, number>): SwitchCharge {
  const cur = from[currency] !== undefined && to[currency] !== undefined ? currency : "USD";
  if (from[cur] === undefined || to[cur] === undefined) return { outcome: "free" };
  const diff = to[cur] - from[cur];
  if (diff <= 0) return { outcome: "free" };
  if (source === "credit") return { outcome: "org" };
  if (source !== "purchase") return { outcome: "free" };
  return { outcome: "pay", amount: diff, currency: cur };
}

// The learner's preparation, the preparation product of the test they pick,
// and what moving to it costs.
async function switchPlan(userId: string, entitlementId: string, testTypeId: string) {
  const e = (
    await pool.query(
      `SELECT e.id, e.product_id, e.test_type_id, e.source, e.attempts_used, e.switched_at, e.revoked_at, e.starts_at, e.ends_at, p.kind,
         o.currency, pp.country
       FROM entitlements e JOIN products p ON p.id = e.product_id
       LEFT JOIN payment_orders o ON o.id = e.order_id
       LEFT JOIN participant_profiles pp ON pp.user_id = e.user_id
       WHERE e.id = $1 AND e.user_id = $2`,
      [entitlementId, userId],
    )
  ).rows[0];
  if (!e || !switchOpen(e)) throw new AttemptError("switch_not_allowed");
  if (e.test_type_id === testTypeId) throw new AttemptError("same_test");
  const p = (await pool.query(`SELECT id FROM products WHERE kind = 'prep' AND active AND test_type_id = $1 ORDER BY sort_order LIMIT 1`, [testTypeId])).rows[0];
  if (!p) throw new AttemptError("unknown_test_type");
  const prices = (await pool.query(`SELECT product_id, currency, amount FROM product_prices WHERE product_id = ANY($1)`, [[e.product_id, p.id]])).rows;
  const of = (id: string) => Object.fromEntries(prices.filter((r) => r.product_id === id).map((r) => [r.currency as string, Number(r.amount)]));
  return {
    productId: p.id as string,
    charge: switchChargeOf(e.source, e.currency ?? "USD", of(e.product_id), of(p.id)),
    billingCountry: (e.country as string | null) ?? null,
  };
}

export type SwitchQuote =
  | { free: true }
  | { free: false; productId: string; amount: number; currency: string; taxLabel: string | null; taxRate: number; taxAmount: number; total: number };

// What switching this preparation to that test costs. GST is added for sales
// billed in India in INR, as for any product.
export async function switchQuote(userId: string, entitlementId: string, testTypeId: string): Promise<SwitchQuote> {
  const s = await switchPlan(userId, entitlementId, testTypeId);
  if (s.charge.outcome === "org") throw new AttemptError("switch_needs_org");
  if (s.charge.outcome === "free") return { free: true };
  const taxRate = s.billingCountry === "IN" && s.charge.currency === "INR" ? PAYMENT_CONFIG.gstRate : 0;
  const taxAmount = Math.round((s.charge.amount * taxRate) / 100);
  return {
    free: false,
    productId: s.productId,
    amount: s.charge.amount,
    currency: s.charge.currency,
    taxLabel: taxRate > 0 ? `GST ${taxRate}%` : null,
    taxRate,
    taxAmount,
    total: s.charge.amount + taxAmount,
  };
}

// Moves the preparation to the other test (a free switch now, or a paid one once its payment lands).
export async function applySwitch(executor: Pick<PoolClient, "query">, entitlementId: string, productId: string, testTypeId: string): Promise<void> {
  await executor.query(`UPDATE entitlements SET product_id = $2, test_type_id = $3, switched_from = test_type_id, switched_at = now() WHERE id = $1`, [
    entitlementId,
    productId,
    testTypeId,
  ]);
}

// A free switch. A dearer test is paid for first (POST /payments/switch-orders).
export async function switchPrepTest(userId: string, entitlementId: string, testTypeId: string): Promise<void> {
  const s = await switchPlan(userId, entitlementId, testTypeId);
  if (s.charge.outcome === "org") throw new AttemptError("switch_needs_org");
  if (s.charge.outcome === "pay") throw new AttemptError("payment_required", { quote: await switchQuote(userId, entitlementId, testTypeId) });
  await applySwitch(pool, entitlementId, s.productId, testTypeId);
  accessCache.delete(userId);
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
    body: "Choose your test on the Assessment page. It opens after a mock test of that test, or in the last 7 days of your access, and ends with a certificate.",
    link: "/assessment",
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
      `SELECT result->>'cefrLevel' AS level, (result->>'overallPercent')::numeric AS percent, result->'skillLevels' AS skill_levels, result->'skillPercents' AS skill_percents, completed_at FROM sessions
       WHERE user_id = $1 AND delivery_mode = 'mock' AND completed_at IS NOT NULL AND result->>'cefrLevel' IS NOT NULL
         AND NOT coalesce((composition->>'abandoned')::boolean, false)
         -- A mock left mostly blank predicts nothing: at least half answered (and 5 answers).
         AND (SELECT count(*) FROM attempts a WHERE a.session_id = sessions.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
             >= greatest(5, 0.5 * (SELECT count(*) FROM attempts a WHERE a.session_id = sessions.id))
       ORDER BY completed_at DESC LIMIT $2`,
      [userId, READINESS_MOCKS],
    )
  ).rows;
  // Each mock's Spica score as its score report and the batch report work it
  // out (the mean of the skills' scores), so the three never disagree.
  const scores = mocks
    .map((m) => snapshot(m.skill_levels ?? {}, m.skill_percents ?? null, m.percent === null ? null : Number(m.percent), m.level).score)
    .filter((x): x is number => x !== null);
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

// Daily: a final assessment certificate ending in RECERTIFY_DAYS: a reminder
// to keep it valid longer or take a new final assessment (once per certificate).
export const RECERTIFY_DAYS = 30;
export async function sendRecertifyReminders(): Promise<number> {
  const due = (
    await pool.query(
      `SELECT c.id, c.user_id, c.code, to_char(c.valid_until, 'YYYY-MM-DD') AS until FROM certificates c JOIN users u ON u.id = c.user_id
       WHERE c.kind = 'result' AND c.revoked_at IS NULL AND u.role = 'learner' AND u.deleted_at IS NULL
         AND c.valid_until BETWEEN current_date AND current_date + $1::int`,
      [RECERTIFY_DAYS],
    )
  ).rows;
  for (const c of due) {
    await notify({
      userId: c.user_id,
      kind: "result_certificate",
      title: "Your certificate ends soon",
      body: `Your certificate ${c.code} is valid until ${c.until}. Keep it valid 12 more months, or take a new final assessment to show your level now.`,
      link: "/assessment",
      email: true,
      dedupeKey: `recertify:${c.id}`,
    }).catch((err) => console.error("recertify reminder failed:", err));
  }
  return due.length;
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
           WHERE ra.session_id = s.id AND ra.status = 'completed' AND j.show_result_to_candidate)
           -- A candidate's certificate only for a test of all four skills, not the shorter ones.
           AND tt.skills @> '{speaking,listening,reading,writing}'))`,
      [sessionId],
    )
  ).rows[0];
  if (!s) return null;
  // Only the final assessment gives a certificate: a level test is a check, with none.
  if (s.composition?.levelTest) return null;
  // Every answer given must be scored first: an answer whose AI scoring failed
  // or is still waiting would otherwise drop out of the score (a reviewer
  // clearing the proctoring record calls this directly, not via the sweep).
  const unscored = await pool.query(
    `SELECT 1 FROM attempts a LEFT JOIN scores sc ON sc.attempt_id = a.id
     WHERE a.session_id = $1 AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL) AND coalesce(sc.status, 'pending') IN ('pending', 'failed') LIMIT 1`,
    [sessionId],
  );
  if (unscored.rowCount) return null;
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
          link: "/assessment",
          email: true,
          dedupeKey: `result_certificate:${sessionId}`,
        }).catch((err) => console.error("certificate notification failed:", err));
        // The learner's organization hears too: its Org Admins and the batch's Managers.
        if (s.org_type === "cohort") {
          const to = new Set([...(await orgAdminIds(s.tenant_id)), ...(s.batch_id ? await batchManagerIds(s.batch_id) : [])]);
          for (const id of to) {
            await notify({
              userId: id,
              kind: "result_certificate",
              title: `${s.name} is certified ${level}`,
              body: spica !== null ? `${testName ?? "Final assessment"}: Spica score ${spica}, level ${level}.` : `${testName}: level ${level}.`,
              link: `/certificate/${code}`,
              dedupeKey: `result_certificate_org:${sessionId}:${id}`,
            }).catch((err) => console.error("certificate notification failed:", err));
          }
        }
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
  const r = await pool.query(`UPDATE certificates SET revoked_at = now() WHERE session_id = $1 AND kind = 'result' AND revoked_at IS NULL RETURNING user_id, code`, [sessionId]);
  for (const c of r.rows) {
    await notify({
      userId: c.user_id,
      kind: "result_certificate",
      title: "Your certificate is on hold",
      body: `A reviewer is checking the proctoring record of your test, so certificate ${c.code} is on hold. We'll email you when it's done.`,
      link: "/assessment",
      email: true,
    }).catch((err) => console.error("certificate hold notification failed:", err));
  }
}

// Periodic: certified attempts that finished a while ago, with every answer
// scored and proctoring clear (or cleared by a reviewer), get their certificate.
export async function issueDueResultCertificates(): Promise<number> {
  const due = (
    await pool.query(
      `SELECT s.id FROM sessions s JOIN session_integrity si ON si.session_id = s.id
       WHERE (s.delivery_mode = 'certified' OR (EXISTS (
               SELECT 1 FROM recruitment_assessments ra JOIN recruitment_jobs j ON j.id = ra.job_id
               WHERE ra.session_id = s.id AND ra.status = 'completed' AND j.show_result_to_candidate)
             -- A candidate's certificate only for a test of all four skills.
             AND (SELECT tt.skills FROM test_types tt
                  WHERE tt.id = coalesce(s.composition->>'testTypeId', (SELECT x.test_type_id FROM exams x WHERE x.id::text = s.composition->>'examId')))
                 @> '{speaking,listening,reading,writing}'))
         AND s.completed_at IS NOT NULL AND s.completed_at < now() - make_interval(mins => $1)
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND si.status IN ('clear', 'cleared')
         -- Only the final assessment gives a certificate: level tests have none.
         AND s.composition->>'levelTest' IS NULL
         AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.session_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM attempts a LEFT JOIN scores sc ON sc.attempt_id = a.id
                         WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL) AND coalesce(sc.status, 'pending') IN ('pending', 'failed'))
         -- Nothing scored at all (every question left blank): no score, so no certificate.
         AND EXISTS (SELECT 1 FROM attempts a JOIN scores sc ON sc.attempt_id = a.id WHERE a.session_id = s.id AND sc.status = 'scored')
       ORDER BY s.completed_at LIMIT 50`,
      [SETTLE_MINUTES],
    )
  ).rows;
  let n = 0;
  for (const r of due) if (await issueResultCertificate(r.id).catch((err) => (console.error("result certificate failed:", err), null))) n++;
  return n;
}
