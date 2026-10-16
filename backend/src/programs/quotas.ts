// Monthly limits on practice tests and mock exams (ASSESSMENT_ENGINE.md
// section 8), read from plan_quotas. A month is the learner's current license
// month, or the calendar month (UTC) without one (see quotaWindow).
import { pool } from "../db.js";
import { learnerAccess } from "../licenses/service.js";
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
}

export interface QuotaUsage extends Quota {
  practiceUsed: number;
  mocksUsed: number;
  // The first day of next month (UTC), when the counts start again.
  resetsOn: string;
}

export class QuotaError extends Error {
  constructor(public detail: { kind: DeliveryMode; limit: number; used: number; resetsOn: string }) {
    super("quota_reached");
  }
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
  // Individuals: Plus while a paid plan is running, Free otherwise.
  const access = await learnerAccess(userId);
  return { segment: "individual", tier: access && (access.status === "active" || access.status === "grace") ? "plus" : "free" };
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

// Practice tests and mock exams started in the current window.
export async function monthUsage(userId: string, from: Date): Promise<{ practice: number; mock: number }> {
  const r = await pool.query(
    `SELECT count(*) FILTER (WHERE delivery_mode = 'practice')::int AS practice, count(*) FILTER (WHERE delivery_mode = 'mock')::int AS mock
     FROM sessions
     WHERE user_id = $1 AND session_type = 'mocktest' AND started_at >= $2`,
    [userId, from],
  );
  return { practice: r.rows[0].practice, mock: r.rows[0].mock };
}

export async function quotaUsage(userId: string): Promise<QuotaUsage | null> {
  const q = await learnerQuota(userId);
  if (!q) return null;
  const window = await quotaWindow(userId);
  const used = await monthUsage(userId, window.from);
  return { ...q, practiceUsed: used.practice, mocksUsed: used.mock, resetsOn: window.to.toISOString().slice(0, 10) };
}

// Throws QuotaError when starting one more test of this kind would go over.
export async function assertQuota(userId: string, kind: DeliveryMode): Promise<void> {
  const u = await quotaUsage(userId);
  if (!u) return;
  const limit = kind === "mock" ? u.mocksPerMonth : u.practicePerMonth;
  const used = kind === "mock" ? u.mocksUsed : u.practiceUsed;
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
