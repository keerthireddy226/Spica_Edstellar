import { pool } from "../db.js";
import { learnerEngagement, type LearnerEngagement } from "../notifications/engagement.js";

// Gender and age are only ever shown in groups this size or larger.
export const MIN_GROUP_SIZE = 5;

export interface Scope {
  // null = every organization (Super Admin); otherwise only these tenants.
  tenantIds: string[] | null;
  includeIndividuals: boolean;
  batchIds?: string[];
  label: string;
}

// SQL filter over a learner row aliased `u` joined to tenants `t`.
function scopeFilter(scope: Scope, params: unknown[]): string {
  const parts: string[] = [];
  if (scope.tenantIds) {
    params.push(scope.tenantIds);
    parts.push(`u.tenant_id = ANY($${params.length}::uuid[])`);
  }
  if (!scope.includeIndividuals) parts.push(`t.type = 'cohort'`);
  if (scope.batchIds) {
    params.push(scope.batchIds);
    parts.push(`u.batch_id = ANY($${params.length}::uuid[])`);
  }
  return parts.length ? `AND ${parts.join(" AND ")}` : "";
}

const GENUINE = `s.completed_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)`;

function learnersCte(scope: Scope, params: unknown[]): string {
  return `WITH learners AS (
    SELECT u.id, u.tenant_id, u.batch_id, u.preferred_language, u.created_at, u.department, t.type AS tenant_type, t.category, t.name AS tenant_name
    FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE u.role = 'learner' AND u.deleted_at IS NULL ${scopeFilter(scope, params)}
  )`;
}

export interface Bucket {
  key: string;
  count: number | null; // null = suppressed (fewer than MIN_GROUP_SIZE)
}

function buckets(rows: { k: string | null; n: number }[], suppress = false): Bucket[] {
  return rows
    .map((r) => ({ key: r.k ?? "unknown", count: suppress && r.k !== null && r.n < MIN_GROUP_SIZE ? null : r.n }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

async function breakdown(scope: Scope, expr: string, joins = "", suppress = false, limit?: number): Promise<Bucket[]> {
  const params: unknown[] = [];
  const cte = learnersCte(scope, params);
  const r = await pool.query(
    `${cte} SELECT ${expr} AS k, count(*)::int AS n FROM learners l ${joins} GROUP BY 1 ORDER BY 2 DESC ${limit ? `LIMIT ${limit}` : ""}`,
    params,
  );
  return buckets(r.rows, suppress);
}

export async function overview(scope: Scope, opts: { withCompanies: boolean; withRevenue: boolean }) {
  const p = (): unknown[] => [];
  const profileJoin = "LEFT JOIN participant_profiles pp ON pp.user_id = l.id";
  const latestPlacement = `LEFT JOIN LATERAL (SELECT cefr_level FROM placements pl WHERE pl.user_id = l.id ORDER BY taken_at DESC LIMIT 1) pl ON true`;

  const [country, jobRole, ageBand, gender, language, cefr, orgType, companies, department] = await Promise.all([
    breakdown(scope, "pp.country", profileJoin),
    breakdown(scope, "pp.job_role", profileJoin),
    breakdown(scope, "pp.age_band", profileJoin, true),
    breakdown(scope, "pp.gender", profileJoin, true),
    breakdown(scope, "l.preferred_language"),
    breakdown(scope, "pl.cefr_level", latestPlacement),
    breakdown(scope, `CASE WHEN l.tenant_type <> 'cohort' THEN 'individual' WHEN l.category = 'university' THEN 'university' ELSE 'organization' END`),
    opts.withCompanies ? breakdown(scope, `CASE WHEN l.tenant_type <> 'cohort' THEN 'Individual learners' ELSE l.tenant_name END`, "", false, 15) : Promise.resolve([]),
    // Employee departments the organization recorded; top 15.
    breakdown(scope, "nullif(trim(l.department), '')", "", false, 15),
  ]);

  const params = p();
  const cte = learnersCte(scope, params);
  const totals = (
    await pool.query(
      `${cte}
       SELECT
         (SELECT count(*)::int FROM learners) AS learners,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 7 AND d.sessions > 0) AS active7,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 28 AND d.sessions > 0) AS active28,
         (SELECT coalesce(sum(d.sessions), 0)::int FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 30) AS sessions30,
         (SELECT coalesce(sum(d.active_ms), 0)::bigint FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 28) AS active_ms28,
         (SELECT count(*)::int FROM learners l WHERE l.created_at > now() - interval '30 days') AS new30,
         (SELECT count(*)::int FROM learners l JOIN reminder_preferences rp ON rp.user_id = l.id AND rp.enabled) AS reminders_on,
         (SELECT count(*)::int FROM learners l WHERE EXISTS (SELECT 1 FROM placements pl WHERE pl.user_id = l.id)) AS placed`,
      params,
    )
  ).rows[0];

  const trendParams = p();
  const trendCte = learnersCte(scope, trendParams);
  const trend = (
    await pool.query(
      `${trendCte}, weeks AS (
         SELECT generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS wk
       )
       SELECT to_char(w.wk, 'YYYY-MM-DD') AS week,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id
            WHERE d.day >= w.wk::date AND d.day < (w.wk + interval '1 week')::date AND d.sessions > 0) AS active,
         (SELECT count(*)::int FROM learners l WHERE l.created_at >= w.wk AND l.created_at < w.wk + interval '1 week') AS signups,
         (SELECT coalesce(sum(d.sessions), 0)::int FROM learner_activity_daily d JOIN learners l ON l.id = d.user_id
            WHERE d.day >= w.wk::date AND d.day < (w.wk + interval '1 week')::date) AS sessions
       FROM weeks w ORDER BY w.wk`,
      trendParams,
    )
  ).rows;

  const remParams = p();
  const remCte = learnersCte(scope, remParams);
  const reminders = (
    await pool.query(
      `${remCte}
       SELECT count(*)::int AS sent,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM sessions s WHERE s.user_id = n.user_id AND s.completed_at > n.created_at AND s.completed_at < n.created_at + interval '7 days'
             AND ${GENUINE}))::int AS returned
       FROM notifications n JOIN learners l ON l.id = n.user_id
       WHERE n.kind IN ('manager_reminder', 'auto_reminder', 'daily_reminder') AND n.created_at > now() - interval '30 days'
         AND n.created_at < now() - interval '1 day'`,
      remParams,
    )
  ).rows[0];

  let licenses = null;
  if (opts.withRevenue) {
    const lp: unknown[] = [];
    let tenantFilter = "";
    if (scope.tenantIds) {
      lp.push(scope.tenantIds);
      tenantFilter = `WHERE p.tenant_id = ANY($1::uuid[])`;
    } else if (!scope.includeIndividuals) {
      tenantFilter = `WHERE p.tenant_id IN (SELECT id FROM tenants WHERE type = 'cohort')`;
    }
    const lic = await pool.query(
      `SELECT p.currency,
         sum(p.quantity)::int AS purchased,
         sum(p.quantity) FILTER (WHERE p.source = 'purchase')::int AS paid,
         sum(p.unit_price_cents::bigint * p.quantity) FILTER (WHERE p.source = 'purchase')::bigint AS revenue,
         sum(p.unit_price_cents::bigint * p.quantity) FILTER (WHERE p.source = 'purchase' AND p.purchased_at > now() - interval '30 days')::bigint AS revenue30,
         sum((SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p.id AND a.reclaimed_at IS NULL))::int AS assigned
       FROM license_purchases p ${tenantFilter}
       GROUP BY p.currency`,
      lp,
    );
    licenses = lic.rows.map((r) => ({
      currency: r.currency,
      purchased: r.purchased ?? 0,
      paid: r.paid ?? 0,
      assigned: r.assigned ?? 0,
      revenueMinor: Number(r.revenue ?? 0),
      revenue30Minor: Number(r.revenue30 ?? 0),
    }));
  }

  const learnerCount = totals.learners as number;
  return {
    scope: scope.label,
    minGroupSize: MIN_GROUP_SIZE,
    totals: {
      learners: learnerCount,
      activeLast7Days: totals.active7,
      activeLast28Days: totals.active28,
      sessionsLast30Days: totals.sessions30,
      newLast30Days: totals.new30,
      placementTaken: totals.placed,
      avgMinutesPerActiveLearnerPerWeek: totals.active28 ? Math.round(Number(totals.active_ms28) / 60000 / 4 / totals.active28) : 0,
      dailyReminderAdoption: learnerCount ? Math.round((totals.reminders_on / learnerCount) * 100) : 0,
    },
    breakdowns: { country, jobRole, ageBand, gender, language, cefr, orgType, companies, department },
    trend: trend.map((t) => ({ week: t.week, activeLearners: t.active, signups: t.signups, sessions: t.sessions })),
    reminders: {
      sentLast30Days: reminders.sent,
      returnedWithin7Days: reminders.returned,
      returnRate: reminders.sent ? Math.round((reminders.returned / reminders.sent) * 100) : null,
    },
    licenses,
  };
}

// ---- Batch analytics ----

const RISK_WEIGHT: Record<LearnerEngagement["status"], number> = { not_started: 3, inactive: 3, slow: 2, on_track: 0, achieved: -1 };

function riskScore(l: LearnerEngagement): number {
  let score = RISK_WEIGHT[l.status] * 10;
  if (l.license.accessEndsAt) {
    const days = (new Date(l.license.accessEndsAt).getTime() - Date.now()) / 86400000;
    if (days < 14) score += 14 - Math.max(0, days);
  }
  if (l.progress !== null && l.expectedProgress !== null) score += Math.max(0, (l.expectedProgress - l.progress) * 20);
  if (l.needsAttention) score += 15;
  return Math.round(score);
}

export async function batchAnalytics(tenantId: string, batchId: string) {
  const b = (
    await pool.query(
      `SELECT b.*, coalesce(b.start_date, b.created_at::date) AS begins_on,
         (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS fixed_used
       FROM batches b WHERE b.id = $1 AND b.tenant_id = $2`,
      [batchId, tenantId],
    )
  ).rows[0];
  if (!b) return null;

  const [learners, orgLearners, weekly, skills, minutes, managers] = await Promise.all([
    learnerEngagement({ tenantId, batchIds: [batchId] }),
    learnerEngagement({ tenantId }),
    pool.query(
      `WITH weeks AS (SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS wk)
       SELECT to_char(w.wk, 'YYYY-MM-DD') AS week,
         (SELECT count(DISTINCT d.user_id)::int FROM learner_activity_daily d JOIN users u ON u.id = d.user_id
            WHERE u.batch_id = $1 AND d.day >= w.wk::date AND d.day < (w.wk + interval '1 week')::date AND d.sessions > 0) AS active
       FROM weeks w ORDER BY w.wk`,
      [batchId],
    ),
    pool.query(
      `SELECT ss.skill, sum(ss.accuracy_correct)::int AS correct, sum(ss.accuracy_graded)::int AS graded, round(avg(ss.minutes))::int AS minutes
       FROM skill_stats ss JOIN users u ON u.id = ss.user_id
       WHERE u.batch_id = $1 AND u.deleted_at IS NULL GROUP BY ss.skill ORDER BY ss.skill`,
      [batchId],
    ),
    pool.query(
      `SELECT
         (SELECT coalesce(sum(d.active_ms), 0)::bigint FROM learner_activity_daily d JOIN users u ON u.id = d.user_id
            WHERE u.batch_id = $1 AND d.day > (now() AT TIME ZONE 'UTC')::date - 28) AS batch_ms,
         (SELECT coalesce(sum(d.active_ms), 0)::bigint FROM learner_activity_daily d JOIN users u ON u.id = d.user_id
            WHERE d.tenant_id = $2 AND u.role = 'learner' AND d.day > (now() AT TIME ZONE 'UTC')::date - 28) AS org_ms`,
      [batchId, tenantId],
    ),
    pool.query(
      `SELECT coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name FROM batch_managers bm JOIN users u ON u.id = bm.user_id WHERE bm.batch_id = $1`,
      [batchId],
    ),
  ]);

  const countBy = (rows: LearnerEngagement[]) => {
    const c = { not_started: 0, inactive: 0, slow: 0, on_track: 0, achieved: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  };
  const statusCounts = countBy(learners);
  const orgCounts = countBy(orgLearners);
  const pct = (good: number, total: number) => (total ? Math.round((good / total) * 100) : 0);

  const ends = b.duration_months ? new Date(new Date(b.begins_on).getTime() + b.duration_months * 30.44 * 86400000) : null;
  const daysLeft = ends ? Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86400000)) : null;

  const cefrCurrent: Record<string, number> = {};
  for (const l of learners) {
    const k = l.currentCefr ?? "Not placed";
    cefrCurrent[k] = (cefrCurrent[k] ?? 0) + 1;
  }

  const live = learners.filter((l) => l.license.status === "active" || l.license.status === "grace").length;
  const endingSoon = learners.filter(
    (l) => l.license.status === "active" && l.license.accessEndsAt && new Date(l.license.accessEndsAt).getTime() - Date.now() < 7 * 86400000,
  ).length;

  const avgMin = (ms: number, n: number) => (n ? Math.round(ms / 60000 / 4 / n) : 0);
  const reminded = learners.filter((l) => l.remindersSent > 0);

  return {
    batch: {
      id: b.id,
      name: b.name,
      batchCode: b.batch_code,
      startCefr: b.start_cefr,
      targetCefr: b.target_cefr,
      beginsOn: b.begins_on,
      endsOn: ends ? ends.toISOString() : null,
      daysLeft,
      managers: managers.rows.map((m) => m.name),
    },
    summary: {
      learners: learners.length,
      statusCounts,
      onTrackPercent: pct(statusCounts.on_track + statusCounts.achieved, learners.length),
      orgOnTrackPercent: pct(orgCounts.on_track + orgCounts.achieved, orgLearners.length),
      avgMinutesPerLearnerPerWeek: avgMin(Number(minutes.rows[0].batch_ms), learners.length),
      orgAvgMinutesPerLearnerPerWeek: avgMin(Number(minutes.rows[0].org_ms), orgLearners.length),
      licensedLearners: live,
      endingWithin7Days: endingSoon,
      fixedLicenses: b.license_budget,
      fixedLicensesUsed: b.fixed_used,
      remindedLearners: reminded.length,
      needsAttention: learners.filter((l) => l.needsAttention).length,
    },
    cefr: { start: b.start_cefr, target: b.target_cefr, current: cefrCurrent },
    weeklyActive: weekly.rows.map((w) => ({ week: w.week, activeLearners: w.active })),
    skills: skills.rows.map((s) => ({
      skill: s.skill,
      accuracy: s.graded ? Math.round((s.correct / s.graded) * 100) : null,
      avgMinutes: s.minutes,
    })),
    learners: learners
      .map((l) => ({ ...l, riskScore: riskScore(l) }))
      .sort((a, z) => z.riskScore - a.riskScore),
  };
}

export async function batchesInScope(tenantId: string, batchIds?: string[]) {
  const params: unknown[] = [tenantId];
  let filter = "";
  if (batchIds) {
    params.push(batchIds);
    filter = "AND b.id = ANY($2::uuid[])";
  }
  const r = await pool.query(
    `SELECT b.id, b.name, b.batch_code, (SELECT count(*)::int FROM users u WHERE u.batch_id = b.id AND u.role = 'learner' AND u.deleted_at IS NULL) AS learners
     FROM batches b WHERE b.tenant_id = $1 ${filter} ORDER BY b.created_at DESC`,
    params,
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, batchCode: x.batch_code, learners: x.learners }));
}

// ---- CSV ----

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

// Learner-level export. Gender and age are deliberately left out — they're
// only ever reported in aggregate.
export async function learnersCsv(scope: Scope): Promise<string> {
  const params: unknown[] = [];
  const cte = learnersCte(scope, params);
  const r = await pool.query(
    `${cte}
     SELECT u.participant_id, u.first_name, u.last_name, u.email, l.tenant_name, b.name AS batch, pp.country, pp.city, pp.job_role,
       l.preferred_language,
       (SELECT cefr_level FROM placements pl WHERE pl.user_id = l.id ORDER BY taken_at DESC LIMIT 1) AS cefr,
       (SELECT count(*) FROM sessions s WHERE s.user_id = l.id AND ${GENUINE}) AS sessions,
       (SELECT max(s.completed_at) FROM sessions s WHERE s.user_id = l.id AND ${GENUINE}) AS last_active,
       (SELECT max(a.ends_at) FROM license_assignments a WHERE a.user_id = l.id AND a.reclaimed_at IS NULL) AS access_ends,
       to_char(l.created_at, 'YYYY-MM-DD') AS joined
     FROM learners l JOIN users u ON u.id = l.id
     LEFT JOIN batches b ON b.id = l.batch_id
     LEFT JOIN participant_profiles pp ON pp.user_id = l.id
     ORDER BY l.tenant_name, b.name, u.first_name`,
    params,
  );
  return toCsv(
    ["Participant ID", "First name", "Last name", "Email", "Organization", "Batch", "Country", "City", "Job role", "Language", "CEFR", "Sessions completed", "Last active", "Access ends", "Joined"],
    r.rows.map((x) => [
      x.participant_id,
      x.first_name,
      x.last_name,
      x.email,
      x.tenant_name,
      x.batch,
      x.country,
      x.city,
      x.job_role,
      x.preferred_language,
      x.cefr,
      x.sessions,
      x.last_active ? new Date(x.last_active).toISOString().slice(0, 10) : "",
      x.access_ends ? new Date(x.access_ends).toISOString().slice(0, 10) : "",
      x.joined,
    ]),
  );
}

export function batchCsv(data: NonNullable<Awaited<ReturnType<typeof batchAnalytics>>>): string {
  return toCsv(
    ["Participant ID", "Name", "Email", "Status", "Current CEFR", "Goal", "Sessions", "Last active", "License", "Access ends", "Reminders sent", "Risk score"],
    data.learners.map((l) => [
      l.participantId,
      [l.firstName, l.lastName].filter(Boolean).join(" "),
      l.email,
      l.status,
      l.currentCefr,
      l.targetCefr,
      l.sessionsCompleted,
      l.lastActiveAt ? new Date(l.lastActiveAt).toISOString().slice(0, 10) : "",
      l.license.status,
      l.license.accessEndsAt ? l.license.accessEndsAt.slice(0, 10) : "",
      l.remindersSent,
      l.riskScore,
    ]),
  );
}
