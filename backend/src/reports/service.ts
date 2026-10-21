import { pool } from "../db.js";
import { APP_URL } from "../auth/mailer.js";
import { learnerEngagement } from "../notifications/engagement.js";
import { notify } from "../notifications/service.js";
import { poolSummary } from "../licenses/service.js";
import { tierIncludes, type PlanTier } from "../plans/config.js";

export type ReportFrequency = "weekly" | "monthly" | "off";

export async function getSubscription(userId: string): Promise<{ frequency: ReportFrequency; lastPeriod: string | null }> {
  const r = await pool.query(`SELECT frequency, last_period FROM report_subscriptions WHERE user_id = $1`, [userId]);
  return { frequency: r.rows[0]?.frequency ?? "off", lastPeriod: r.rows[0]?.last_period ?? null };
}

export async function setSubscription(userId: string, tenantId: string, frequency: ReportFrequency) {
  await pool.query(
    `INSERT INTO report_subscriptions (user_id, tenant_id, frequency) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET frequency = EXCLUDED.frequency, updated_at = now()`,
    [userId, tenantId, frequency],
  );
}

// Calendar parts of "now" in the organization's time zone.
function localParts(tz: string, at = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hour12: false });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) % 24, weekday: p.weekday as string };
}

function isoWeek(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// The period a report is due for right now, or null when it isn't time yet:
// weekly from Monday 08:00, monthly from the 1st at 08:00 (local time).
export function duePeriod(frequency: ReportFrequency, tz: string, at = new Date()): string | null {
  const p = localParts(tz, at);
  if (frequency === "weekly") {
    if (p.weekday === "Mon" && p.hour < 8) return null;
    return isoWeek(p.y, p.m, p.d);
  }
  if (frequency === "monthly") {
    if (p.d === 1 && p.hour < 8) return null;
    return `${p.y}-${String(p.m).padStart(2, "0")}`;
  }
  return null;
}

function name(r: { firstName: string | null; lastName: string | null; email: string }) {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;
}

// A plain-text progress report for an Org Admin (whole organization) or a
// Manager (their batches), covering the last 7 or 30 days.
export async function buildReport(userId: string, frequency: Exclude<ReportFrequency, "off">) {
  const u = (await pool.query(`SELECT u.role, u.tenant_id, t.name AS org FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [userId])).rows[0];
  if (!u) return null;
  const days = frequency === "weekly" ? 7 : 30;
  let batchIds: string[] | undefined;
  if (u.role === "manager") {
    batchIds = (await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [userId])).rows.map((r) => r.batch_id);
  }
  const learners = await learnerEngagement({ tenantId: u.tenant_id, batchIds });
  const ids = learners.map((l) => l.id);
  const act = (
    await pool.query(
      `SELECT count(DISTINCT user_id) FILTER (WHERE sessions > 0)::int AS active, coalesce(sum(sessions), 0)::int AS sessions,
         coalesce(sum(active_ms), 0)::bigint AS ms
       FROM learner_activity_daily WHERE user_id = ANY($1::uuid[]) AND day > (now() AT TIME ZONE 'UTC')::date - $2::int`,
      [ids, days],
    )
  ).rows[0];
  const atRisk = learners.filter((l) => l.status === "inactive" || l.status === "not_started" || l.needsAttention).slice(0, 8);
  const achieved = learners.filter((l) => l.status === "achieved").length;
  const ending = learners.filter((l) => l.license.accessEndsAt && new Date(l.license.accessEndsAt).getTime() - Date.now() < 14 * 86400000 && l.license.status === "active");
  const scope = u.role === "manager" ? "your batches" : u.org;
  const period = frequency === "weekly" ? "this week" : "this month";
  const minutes = Math.round(Number(act.ms) / 60000);

  const lines = [
    `Progress report for ${scope} — last ${days} days`,
    "",
    `Learners: ${learners.length}`,
    `Practised ${period}: ${act.active} (${learners.length ? Math.round((act.active / learners.length) * 100) : 0}%)`,
    `Sessions completed: ${act.sessions}`,
    `Practice time: ${minutes} minutes`,
    `Reached their goal level: ${achieved}`,
  ];
  if (u.role === "org_admin") {
    const p = await poolSummary(u.tenant_id);
    lines.push(`Licenses available to assign: ${p.available}${p.nextPoolExpiry ? ` (next expiry ${p.nextPoolExpiry.slice(0, 10)})` : ""}`);
  }
  if (ending.length) lines.push("", `Access ending within 14 days: ${ending.map(name).slice(0, 10).join(", ")}${ending.length > 10 ? "…" : ""}`);
  if (atRisk.length) {
    lines.push("", "Needs attention:");
    for (const l of atRisk) lines.push(`  • ${name(l)}${l.batchName ? ` (${l.batchName})` : ""} — ${l.status.replace("_", " ")}`);
  }
  // Monthly: each batch's full Batch report, which downloads as a PDF.
  if (frequency === "monthly") {
    const batches = (
      await pool.query(`SELECT id, name FROM batches WHERE tenant_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) AND archived_at IS NULL ORDER BY name`, [
        u.tenant_id,
        batchIds ?? null,
      ])
    ).rows;
    if (batches.length) {
      lines.push("", "Batch reports (open one to download it as a PDF):");
      for (const b of batches) lines.push(`  • ${b.name}: ${APP_URL}/batch-report/${b.id}`);
    }
  }
  const summary = [
    frequency === "weekly"
      ? `${act.active} of ${learners.length} learners practised this week; ${act.sessions} sessions, ${minutes} minutes.`
      : `${act.active} of ${learners.length} learners practised this month; ${act.sessions} sessions, ${minutes} minutes.`,
    atRisk.length ? (atRisk.length === 1 ? "1 needs attention." : `${atRisk.length} need attention.`) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { text: lines.join("\n"), summary, role: u.role as string };
}

// Periodic: send each due report once per period.
export async function runScheduledReports(now = new Date()): Promise<number> {
  const subs = await pool.query(
    `SELECT s.user_id, s.frequency, s.last_period, t.timezone, t.plan_tier
     FROM report_subscriptions s JOIN users u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id
     WHERE s.frequency <> 'off' AND u.deleted_at IS NULL AND t.deactivated_at IS NULL`,
  );
  let sent = 0;
  for (const s of subs.rows) {
    if (!tierIncludes(s.plan_tier as PlanTier, "scheduled_reports")) continue;
    const period = duePeriod(s.frequency, s.timezone, now);
    if (!period || period === s.last_period) continue;
    // Claim the period first so a crash mid-send can't double-send.
    const claimed = await pool.query(
      `UPDATE report_subscriptions SET last_period = $2 WHERE user_id = $1 AND last_period IS DISTINCT FROM $2 RETURNING user_id`,
      [s.user_id, period],
    );
    if (claimed.rowCount === 0) continue;
    const report = await buildReport(s.user_id, s.frequency);
    if (!report) continue;
    await notify({
      userId: s.user_id,
      kind: "scheduled_report",
      title: `Your ${s.frequency} progress report`,
      body: report.summary,
      emailText: report.text,
      link: report.role === "manager" ? "/manager/analytics" : "/orgadmin/analytics",
      dedupeKey: `report:${s.user_id}:${period}`,
      email: true,
    });
    sent++;
  }
  return sent;
}
