// An organization gives its learners tests with credits (the same balance as
// recruitment invitations): a real test (Assessment) for staff, a level test
// at a chosen level, or preparation for one test for a number of 30-day
// periods. Full access stays on licence-months. A real test or level test
// that expires unused gives its credits back.
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { accessCache } from "../licenses/accessCache.js";
import { notify } from "../notifications/service.js";
import { addCredits } from "../recruitment/service.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
// Kinds that are one test: unused ones can be withdrawn or expire for a refund.
const TEST_KINDS = ["assessment", "level"];

// The organization's credit lock, held until the transaction ends. Every
// spend of the balance (tests given here, recruitment invitations) takes it
// before checking the balance, so concurrent spends queue up instead of
// both passing the check.
export async function lockCredits(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`credits:${tenantId}`]);
}

export class OrgTestError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

// The products an organization can give, with their credit prices.
export async function givableProducts() {
  const r = await pool.query(
    `SELECT p.id, p.kind, p.name, p.test_type_id, tt.name AS test_name, p.credits, p.duration_days, p.attempts
     FROM products p LEFT JOIN test_types tt ON tt.id = p.test_type_id
     WHERE p.active AND p.kind IN ('prep', 'assessment', 'level', 'pack') AND p.credits IS NOT NULL ORDER BY p.sort_order`,
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    kind: x.kind as "prep" | "assessment" | "level" | "pack",
    name: x.name as string,
    testTypeId: x.test_type_id as string,
    testName: x.test_name as string | null,
    credits: x.credits as number,
    durationDays: x.duration_days as number,
    attempts: x.attempts as number,
  }));
}

// Gives each learner the product: a real test, a level test at `level`, or
// preparation for `periods` x 30 days. A program's final assessment passes its `programId`.
export async function giveTests(args: { tenantId: string; actorId: string; userIds: string[]; productId: string; periods?: number; level?: string; programId?: string }) {
  const p = (await pool.query(`SELECT * FROM products WHERE id = $1 AND active AND kind IN ('prep', 'assessment', 'level', 'pack') AND credits IS NOT NULL`, [args.productId])).rows[0];
  if (!p) throw new OrgTestError("product_not_found", 404);
  if (p.kind === "level" && !LEVELS.includes(args.level ?? "")) throw new OrgTestError("level_required");
  // A practice pack may aim at a level; it becomes the learner's goal.
  const level = p.kind === "level" || (p.kind === "pack" && LEVELS.includes(args.level ?? "")) ? args.level! : null;
  const periods = p.kind === "prep" || p.kind === "pack" ? Math.max(1, Math.min(12, args.periods ?? 1)) : 1;
  const learners = (
    await pool.query(
      `SELECT id, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS name FROM users
       WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND role = 'learner' AND deleted_at IS NULL`,
      [args.userIds, args.tenantId],
    )
  ).rows;
  if (!learners.length) throw new OrgTestError("no_learners");
  const each = p.credits * periods;
  const org = (await pool.query(`SELECT name FROM tenants WHERE id = $1`, [args.tenantId])).rows[0]?.name ?? "";
  const program = args.programId ? (await pool.query(`SELECT name FROM programs WHERE id = $1`, [args.programId])).rows[0]?.name : null;
  const days = p.kind === "prep" || p.kind === "pack" ? periods * 30 : p.duration_days;
  // The balance check and the debits happen under the organization's credit
  // lock in one transaction, so two gives (or a give and a recruitment
  // invitation) at the same moment can't both spend the same credits.
  const client = await pool.connect();
  let balance: number;
  try {
    await client.query("BEGIN");
    await lockCredits(client, args.tenantId);
    balance = (await client.query(`SELECT coalesce(sum(delta), 0)::int AS n FROM recruitment_credit_events WHERE tenant_id = $1`, [args.tenantId])).rows[0].n;
    if (each * learners.length > balance)
      throw new OrgTestError("not_enough_credits", 402, {
        needed: each * learners.length,
        balance,
      });
    for (const l of learners) {
      const e = await client.query(
        `INSERT INTO entitlements (user_id, product_id, test_type_id, level, attempts_total, ends_at, source, tenant_id, granted_by, credits_spent, program_id)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6), 'credit', $7, $8, $9, $10) RETURNING id`,
        [l.id, p.id, p.test_type_id, level, p.attempts, days, args.tenantId, args.actorId, each, args.programId ?? null],
      );
      const name = p.kind === "level" ? `Level ${level} test` : p.name;
      await client.query(`INSERT INTO recruitment_credit_events (tenant_id, delta, reason, actor_id, entitlement_id, note) VALUES ($1, $2, $3, $4, $5, $6)`, [
        args.tenantId,
        -each,
        TEST_KINDS.includes(p.kind) ? "assessment" : "access",
        args.actorId,
        e.rows[0].id,
        `${args.programId ? "Final assessment: " : ""}${name} for ${l.name}`,
      ]);
      if (p.kind === "pack" && level) {
        await client.query(`INSERT INTO participant_profiles (user_id, goal_level) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET goal_level = EXCLUDED.goal_level, updated_at = now()`, [
          l.id,
          level,
        ]);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  // Told only once the tests are really theirs.
  for (const l of learners) {
    accessCache.delete(l.id);
    await notify({
      userId: l.id,
      kind: "test_given",
      title:
        p.kind === "assessment"
          ? args.programId
            ? "Your final assessment is ready"
            : "You have a real test to take"
          : p.kind === "level"
            ? "You have a level test to take"
            : p.kind === "pack"
              ? "You have a practice pack"
              : "You can prepare for a test",
      body:
        p.kind === "prep"
          ? `${org} gave you ${p.name}: practice for ${days} days, then one real test.`
          : p.kind === "pack"
            ? `${org} gave you ${p.name}: Practice Modules for ${days} days.`
            : program
              ? `${org} gave you the final assessment for ${program}: ${p.name}. Take it within ${days} days.`
              : p.kind === "level"
                ? `${org} gave you a level ${level} test. Take it within ${days} days.`
                : `${org} gave you ${p.name}. Take it within ${days} days.`,
      link: p.kind === "prep" ? "/practice-tests" : p.kind === "pack" ? "/modules" : "/assessment",
      email: true,
      sentBy: args.actorId,
    }).catch((err) => console.error("test notification failed:", err));
  }
  return {
    given: learners.length,
    creditsUsed: each * learners.length,
    balance: balance - each * learners.length,
  };
}

// The tests an organization gave, newest first, with where each one is.
export async function givenTests(tenantId: string) {
  const r = await pool.query(
    `SELECT e.id, e.product_id, p.kind, p.name, e.level AS test_level, e.program_id, pr.name AS program_name, e.starts_at, e.ends_at, e.attempts_total, e.attempts_used, e.credits_spent, e.credits_refunded, e.revoked_at,
       u.id AS user_id, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS learner, u.participant_id,
       (SELECT c.code FROM certificates c JOIN sessions s ON s.id = c.session_id WHERE s.entitlement_id = e.id AND c.kind = 'result' AND c.revoked_at IS NULL LIMIT 1) AS certificate,
       (SELECT c.spica_score FROM certificates c JOIN sessions s ON s.id = c.session_id WHERE s.entitlement_id = e.id AND c.kind = 'result' AND c.revoked_at IS NULL LIMIT 1) AS score,
       (SELECT c.cefr_level FROM certificates c JOIN sessions s ON s.id = c.session_id WHERE s.entitlement_id = e.id AND c.kind = 'result' AND c.revoked_at IS NULL LIMIT 1) AS level,
       EXISTS (SELECT 1 FROM sessions s WHERE s.entitlement_id = e.id AND s.delivery_mode = 'certified' AND s.completed_at IS NULL) AS in_progress,
       EXISTS (SELECT 1 FROM sessions s WHERE s.entitlement_id = e.id AND s.delivery_mode = 'certified' AND s.result->'levelTest'->>'passed' = 'false') AS not_passed,
       EXISTS (SELECT 1 FROM sessions s WHERE s.entitlement_id = e.id AND s.delivery_mode = 'certified' AND s.result->'levelTest'->>'passed' = 'true') AS passed
     FROM entitlements e JOIN products p ON p.id = e.product_id JOIN users u ON u.id = e.user_id LEFT JOIN programs pr ON pr.id = e.program_id
     WHERE e.tenant_id = $1 AND e.source = 'credit' ORDER BY e.starts_at DESC LIMIT 500`,
    [tenantId],
  );
  const now = Date.now();
  return r.rows.map((x) => ({
    id: x.id as string,
    productId: x.product_id as string,
    kind: x.kind as string,
    name: x.kind === "level" ? `Level ${x.test_level} test` : (x.name as string),
    testLevel: x.test_level as string | null,
    programId: x.program_id as string | null,
    programName: x.program_name as string | null,
    learnerId: x.user_id as string,
    learner: x.learner as string,
    participantId: x.participant_id as string | null,
    givenAt: new Date(x.starts_at).toISOString(),
    endsAt: new Date(x.ends_at).toISOString(),
    credits: x.credits_spent as number,
    status: x.revoked_at
      ? ("withdrawn" as const)
      : x.certificate
        ? ("certified" as const)
        : x.in_progress
          ? ("in_progress" as const)
          : x.not_passed
            ? ("not_passed" as const)
            : x.passed
              ? ("passed" as const)
              : x.attempts_used > 0
                ? ("taken" as const)
                : new Date(x.ends_at).getTime() < now
                  ? x.credits_refunded
                    ? ("expired_refunded" as const)
                    : ("expired" as const)
                  : ("waiting" as const),
    certificate: x.certificate as string | null,
    score: x.score as number | null,
    level: x.level as string | null,
  }));
}

// Takes back a real test nobody started (or preparation, its unused days are not refunded), giving the credits back for a real test.
export async function withdrawTest(tenantId: string, entitlementId: string, actorId: string) {
  const e = (
    await pool.query(`SELECT e.*, p.kind FROM entitlements e JOIN products p ON p.id = e.product_id WHERE e.id = $1 AND e.tenant_id = $2 AND e.source = 'credit' AND e.revoked_at IS NULL`, [
      entitlementId,
      tenantId,
    ])
  ).rows[0];
  if (!e) throw new OrgTestError("not_found", 404);
  const test = TEST_KINDS.includes(e.kind);
  if (test && e.attempts_used > 0) throw new OrgTestError("already_started");
  await pool.query(`UPDATE entitlements SET revoked_at = now(), credits_refunded = $2 WHERE id = $1`, [entitlementId, test]);
  if (test && !e.credits_refunded) {
    await addCredits({
      tenantId,
      delta: e.credits_spent,
      reason: "refund",
      actorId,
      note: e.kind === "level" ? "Level test withdrawn before it was started" : "Real test withdrawn before it was started",
    });
  }
  accessCache.delete(e.user_id);
}

// Hourly: real tests and level tests given with credits that expired unused give them back.
export async function refundExpiredTests(): Promise<number> {
  const r = await pool.query(
    `UPDATE entitlements e SET credits_refunded = true FROM products p
     WHERE p.id = e.product_id AND p.kind IN ('assessment', 'level') AND e.source = 'credit' AND e.attempts_used = 0 AND e.revoked_at IS NULL
       AND e.ends_at < now() AND NOT e.credits_refunded AND e.credits_spent > 0
     RETURNING e.id, e.tenant_id, e.credits_spent`,
  );
  for (const x of r.rows)
    await addCredits({
      tenantId: x.tenant_id,
      delta: x.credits_spent,
      reason: "refund",
      note: "Test expired without being started",
    });
  return r.rows.length;
}
