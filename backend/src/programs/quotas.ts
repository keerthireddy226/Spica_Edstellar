// Monthly limits on practice tests and mock tests (ASSESSMENT_ENGINE.md
// section 8), read from plan_quotas. A month is the learner's current license
// month, or the calendar month (UTC) without one (see quotaWindow).
import { pool } from "../db.js";
import { accessOf, type Access } from "../access/entitlements.js";
import type { DeliveryMode } from "../practiceTests/modes.js";

export type Segment = "individual" | "company" | "university";

export interface Quota {
  segment: Segment;
  tier: string;
  // null = unlimited.
  practicePerMonth: number | null;
  mocksPerMonth: number | null;
  reportLevel: "summary" | "full";
  // Campus: at least this many days between two mocks.
  mockEveryDays: number | null;
  // Plus (Full access): the mock limit is for each test type, not in total.
  mocksPerTestType: boolean;
}

export interface QuotaUsage extends Quota {
  practiceUsed: number;
  mocksUsed: number;
  // Mocks started this month in each test type.
  mocksUsedByTest: Record<string, number>;
  // The first day of next month (UTC), when the counts start again.
  resetsOn: string;
}

export class QuotaError extends Error {
  constructor(public detail: { kind: DeliveryMode; limit: number; used: number; resetsOn: string }) {
    super("quota_reached");
  }
}

// Pure: an individual's row of plan_quotas. Plus with Full access (a live
// licence or plan, or Full access as a product, bought or given by Spica
// staff) and with a preparation: its practice tests and mock tests are the
// only ones it can start (practiceTests/routes.ts), so Plus limits on them
// are Plus for that test. Free otherwise.
export function individualTier(a: Pick<Access, "full" | "prepTests">): "plus" | "free" {
  return a.full || a.prepTests.length > 0 ? "plus" : "free";
}

// Which row of plan_quotas applies to a learner. null: no limits (staff,
// candidates, whose assessment is the test itself).
export async function learnerSegment(userId: string): Promise<{ segment: Segment; tier: string } | null> {
  const r = (
    await pool.query(`SELECT u.role, t.type, t.category, t.plan_tier FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [userId])
  ).rows[0];
  if (!r || r.role !== "learner") return null;
  if (r.type === "cohort") {
    // University tiers (Campus, Admissions) come with Phase 7; until then
    // every university is on Campus.
    if (r.category === "university") return { segment: "university", tier: "campus" };
    return { segment: "company", tier: r.plan_tier };
  }
  // Individuals: Plus with Full access or a preparation, Free otherwise.
  return { segment: "individual", tier: individualTier(await accessOf(userId)) };
}

export async function learnerQuota(userId: string): Promise<Quota | null> {
  const seg = await learnerSegment(userId);
  if (!seg) return null;
  const q = (await pool.query(`SELECT * FROM plan_quotas WHERE segment = $1 AND tier = $2`, [seg.segment, seg.tier])).rows[0];
  if (!q) return null;
  return {
    segment: seg.segment,
    tier: seg.tier,
    practicePerMonth: q.practice_per_month,
    mocksPerMonth: q.mocks_per_month,
    reportLevel: q.report_level,
    mockEveryDays: typeof q.extras?.mockEveryDays === "number" ? q.extras.mockEveryDays : null,
    mocksPerTestType: q.extras?.mocksPerTestType === true,
  };
}

export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// The month the limits count over: the learner's current license month
// (a 1-month access from 20 October runs to 20 November), or the calendar
// month (UTC) for someone without a license running now.
export async function quotaWindow(userId: string): Promise<{ from: Date; to: Date; licensed: boolean }> {
  const r = await pool.query(
    `SELECT starts_at, ends_at FROM license_assignments
     WHERE user_id = $1 AND reclaimed_at IS NULL AND starts_at <= now() AND ends_at > now()
     ORDER BY starts_at LIMIT 1`,
    [userId],
  );
  if (r.rows[0]) return { from: new Date(r.rows[0].starts_at), to: new Date(r.rows[0].ends_at), licensed: true };
  const now = new Date();
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: nextMonthStart(now), licensed: false };
}

// Practice tests and mock tests started in the current window, and the mocks
// in each test type.
export async function monthUsage(userId: string, from: Date): Promise<{ practice: number; mock: number; mockByTest: Record<string, number> }> {
  const r = await pool.query(
    `SELECT s.delivery_mode, coalesce(s.composition->>'testTypeId', e.test_type_id) AS test_type_id, count(*)::int AS n
     FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
     WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.started_at >= $2 AND s.delivery_mode IN ('practice', 'mock')
       -- A mock that ran out of time with nothing answered doesn't count.
       AND coalesce(s.composition->>'abandoned', 'false') <> 'true'
     GROUP BY 1, 2`,
    [userId, from],
  );
  const mockByTest: Record<string, number> = {};
  let practice = 0;
  let mock = 0;
  for (const row of r.rows) {
    if (row.delivery_mode === "practice") practice += row.n;
    else {
      mock += row.n;
      if (row.test_type_id) mockByTest[row.test_type_id] = (mockByTest[row.test_type_id] ?? 0) + row.n;
    }
  }
  return { practice, mock, mockByTest };
}

export async function quotaUsage(userId: string): Promise<QuotaUsage | null> {
  const q = await learnerQuota(userId);
  if (!q) return null;
  const window = await quotaWindow(userId);
  const used = await monthUsage(userId, window.from);
  return { ...q, practiceUsed: used.practice, mocksUsed: used.mock, mocksUsedByTest: used.mockByTest, resetsOn: window.to.toISOString().slice(0, 10) };
}

// Pure: mocks used in this test type, or in total when the limit is shared.
export function mocksUsedIn(u: QuotaUsage, testTypeId: string | null | undefined): number {
  return u.mocksPerTestType ? (testTypeId ? (u.mocksUsedByTest[testTypeId] ?? 0) : 0) : u.mocksUsed;
}

// Pure: the mocks a learner's test plan can count on this month. With a limit
// per test type, it's the limit in each test type they're preparing for (the
// ones with a practice or mock test lately; at least one).
export function mockAllowance(u: QuotaUsage | null, preparing: string[] = []): { perMonth: number | null; left: number | null } {
  if (!u || u.mocksPerMonth === null) return { perMonth: u ? null : 2, left: null };
  if (!u.mocksPerTestType) return { perMonth: u.mocksPerMonth, left: Math.max(0, u.mocksPerMonth - u.mocksUsed) };
  const limit = u.mocksPerMonth;
  if (!preparing.length) return { perMonth: limit, left: limit };
  return { perMonth: limit * preparing.length, left: preparing.reduce((n, t) => n + Math.max(0, limit - (u.mocksUsedByTest[t] ?? 0)), 0) };
}

// Test types the learner took a practice or mock test in over the last 60 days
// (not hidden exam families, LanguageCert for now).
export async function testTypesPreparing(userId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT tt.id AS t
     FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
     JOIN test_types tt ON tt.id = coalesce(s.composition->>'testTypeId', e.test_type_id)
     JOIN exam_families f ON f.id = tt.family_id AND f.active
     WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode IN ('practice', 'mock') AND s.started_at > now() - interval '60 days'`,
    [userId],
  );
  return r.rows.map((x) => x.t as string);
}

// Throws QuotaError when starting one more test of this kind would go over.
// testTypeId: the test being started (mocks may be limited per test type).
export async function assertQuota(userId: string, kind: DeliveryMode, testTypeId?: string | null): Promise<void> {
  const u = await quotaUsage(userId);
  if (!u) return;
  const limit = kind === "mock" ? u.mocksPerMonth : u.practicePerMonth;
  const used = kind === "mock" ? mocksUsedIn(u, testTypeId) : u.practiceUsed;
  if (limit !== null && used >= limit) throw new QuotaError({ kind, limit, used, resetsOn: u.resetsOn });
  // Spacing between mocks (Campus: one every two weeks).
  if (kind === "mock" && u.mockEveryDays) {
    const last = (
      await pool.query(`SELECT max(started_at) AS t FROM sessions WHERE user_id = $1 AND session_type = 'mocktest' AND delivery_mode = 'mock'`, [userId])
    ).rows[0]?.t as Date | null;
    const next = last ? new Date(last.getTime() + u.mockEveryDays * 86_400_000) : null;
    if (next && next.getTime() > Date.now()) throw new QuotaError({ kind, limit: limit ?? 0, used, resetsOn: next.toISOString().slice(0, 10) });
  }
}

// ---- Super Admin: editing the limits ----

export async function listQuotas() {
  const r = await pool.query(`SELECT * FROM plan_quotas ORDER BY segment, practice_per_month NULLS LAST, mocks_per_month NULLS LAST`);
  return r.rows.map((q) => ({
    segment: q.segment as Segment,
    tier: q.tier as string,
    practicePerMonth: q.practice_per_month as number | null,
    mocksPerMonth: q.mocks_per_month as number | null,
    reportLevel: q.report_level as "summary" | "full",
    mocksPerTestType: q.extras?.mocksPerTestType === true,
    updatedAt: q.updated_at,
  }));
}

export async function updateQuota(segment: string, tier: string, v: { practicePerMonth: number | null; mocksPerMonth: number | null; reportLevel: "summary" | "full" }) {
  const r = await pool.query(
    `UPDATE plan_quotas SET practice_per_month = $3, mocks_per_month = $4, report_level = $5, updated_at = now() WHERE segment = $1 AND tier = $2 RETURNING segment`,
    [segment, tier, v.practicePerMonth, v.mocksPerMonth, v.reportLevel],
  );
  return (r.rowCount ?? 0) > 0;
}
