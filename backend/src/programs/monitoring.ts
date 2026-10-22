// Organization monitoring of programs (ASSESSMENT_ENGINE.md section 9): each
// member's latest levels, trend across mocks, on track or at risk, last
// activity, and daily alerts to the organization.
import { pool } from "../db.js";
import { currentLevels } from "../learner/currentLevel.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { finalDay, getProgram, programCertifiedMap, programJson } from "./service.js";
import { programGap } from "./schedule.js";

type ProgramRow = NonNullable<Awaited<ReturnType<typeof getProgram>>>;

export type MemberStatus = "at_target" | "on_track" | "at_risk" | "too_early";

export const INACTIVE_DAYS = 14;
const DAY = 86_400_000;

export interface MockPoint {
  sessionId: string;
  date: string;
  cefrLevel: string | null;
  percent: number | null;
  skillLevels: Record<string, string> | null;
}

const idx = (l: string | null | undefined) => CEFR_LEVELS.indexOf((l ?? "") as CefrLevel);

// Least-squares line through (day, level index); the level it reaches by the
// target date. null with fewer than 2 mocks on different days.
export function projectLevel(points: { day: number; level: number }[], targetDay: number): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.day, 0) / n;
  const my = points.reduce((a, p) => a + p.level, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.day - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((a, p) => a + (p.day - mx) * (p.level - my), 0) / sxx;
  return my + slope * (targetDay - mx);
}

// Why a member has their status, as a code and its numbers (screens word it
// in the viewer's language) and in English (CSV and alerts).
export type StatusReason =
  | { code: "at_target" }
  | { code: "trend"; level: string }
  | { code: "missed"; n: number }
  | { code: "inactive"; days: number }
  | { code: "time_short"; gap: number; days: number }
  | { code: "too_early" };

export function reasonText(r: StatusReason): string {
  switch (r.code) {
    case "at_target":
      return "latest level meets the target";
    case "trend":
      return `trend reaches ${r.level} by the target date`;
    case "missed":
      return `${r.n} planned tests missed`;
    case "inactive":
      return `no activity for ${r.days} days`;
    case "time_short":
      return `${r.gap} levels to go with ${r.days} days left`;
    case "too_early":
      return "fewer than 2 mocks so far";
  }
}

export function memberStatus(args: {
  targetLevel: string;
  gap: number | null;
  mocks: MockPoint[];
  missed: number;
  inactiveDays: number | null;
  daysLeft: number;
  now?: number;
}): { status: MemberStatus; projected: string | null; reason: string; why: StatusReason } {
  const out = (status: MemberStatus, projected: string | null, why: StatusReason) => ({ status, projected, reason: reasonText(why), why });
  if (args.gap === 0) return out("at_target", null, { code: "at_target" });
  const points = args.mocks.filter((m) => idx(m.cefrLevel) >= 0).map((m) => ({ day: Date.parse(m.date) / DAY, level: idx(m.cefrLevel) }));
  const target = idx(args.targetLevel);
  const projectedIdx = projectLevel(points, (args.now ?? Date.now()) / DAY + args.daysLeft);
  if (projectedIdx !== null) {
    const projected = CEFR_LEVELS[Math.max(0, Math.min(5, Math.round(projectedIdx)))];
    // A quarter of a level's slack: one mock's noise shouldn't raise an alarm.
    return out(projectedIdx < target - 0.25 ? "at_risk" : "on_track", projected, { code: "trend", level: projected });
  }
  if (args.missed >= 2) return out("at_risk", null, { code: "missed", n: args.missed });
  if (args.inactiveDays !== null && args.inactiveDays >= INACTIVE_DAYS) return out("at_risk", null, { code: "inactive", days: args.inactiveDays });
  if (args.gap !== null && args.gap >= 2 && args.daysLeft < 30) return out("at_risk", null, { code: "time_short", gap: args.gap, days: args.daysLeft });
  return out("too_early", null, { code: "too_early" });
}

// A member's goal status, the same in Programs and in the Batch report. The
// goal is the program's (its overall target and any per-skill targets), else
// the batch's target level by its end.
export function goalStatus(g: {
  targetLevel: string;
  targetSkills?: Record<string, string> | null;
  level: { overall: string | null; skills: Record<string, string> | null };
  mocks: MockPoint[];
  missed: number;
  lastActivity: Date | string | null;
  // The goal's first day (the program's start, else the batch's).
  startedOn: string;
  // The target date; null when the goal has none.
  goalDate: string | null;
  now?: number;
}) {
  const now = g.now ?? Date.now();
  const gap = programGap({ target_level: g.targetLevel, target_skills: g.targetSkills ?? null }, g.level);
  const last = g.lastActivity ? new Date(g.lastActivity).getTime() : null;
  const inactiveDays = last !== null ? Math.floor((now - last) / DAY) : null;
  // Never active counts as inactive since the goal began.
  const quietFor = inactiveDays ?? Math.max(0, Math.floor((now - Date.parse(`${g.startedOn.slice(0, 10)}T00:00:00Z`)) / DAY));
  // No target date: a year, so time alone never raises an alarm.
  const daysLeft = g.goalDate ? Math.max(0, Math.round((Date.parse(`${g.goalDate.slice(0, 10)}T00:00:00Z`) - now) / DAY)) : 365;
  return { ...memberStatus({ targetLevel: g.targetLevel, gap, mocks: g.mocks, missed: g.missed, inactiveDays: quietFor, daysLeft, now }), gap, inactiveDays, daysLeft };
}

// Every member of a program with levels, trend, status and activity.
export async function programMonitoring(p: ProgramRow) {
  const members = (
    await pool.query(
      `SELECT u.id, u.email, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name,
         (SELECT max(t) FROM (SELECT max(s.started_at) AS t FROM sessions s WHERE s.user_id = u.id
                              UNION ALL SELECT max(a.submitted_at) FROM attempts a JOIN sessions s2 ON s2.id = a.session_id WHERE s2.user_id = u.id) x) AS last_activity
       FROM users u WHERE u.batch_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL ORDER BY name`,
      [p.batch_id],
    )
  ).rows;
  const ids = members.map((m) => m.id as string);
  // Mock tests of the program's test, not set aside part way.
  const mocks = (
    await pool.query(
      `SELECT s.id, s.user_id, s.completed_at, s.result, si.status AS integrity_status, si.risk_level
       FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId' LEFT JOIN session_integrity si ON si.session_id = s.id
       WHERE s.user_id = ANY($1::uuid[]) AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND coalesce(s.composition->>'testTypeId', e.test_type_id) = $2
       ORDER BY s.completed_at`,
      [ids, p.test_type_id],
    )
  ).rows;
  const levels = await currentLevels(ids, { testTypeId: p.test_type_id });
  // Items on or after the final assessment's day aren't part of the plan.
  const items = (
    await pool.query(
      `SELECT user_id, count(*) FILTER (WHERE status = 'done')::int AS done,
         count(*) FILTER (WHERE status = 'missed' AND ($2::date IS NULL OR due_on < $2))::int AS missed,
         count(*) FILTER (WHERE status = 'missed' AND kind = 'mock' AND ($2::date IS NULL OR due_on < $2))::int AS missed_mocks,
         min(due_on) FILTER (WHERE status = 'due' AND ($2::date IS NULL OR due_on < $2)) AS next_due,
         (array_agg(kind ORDER BY due_on) FILTER (WHERE status = 'due' AND ($2::date IS NULL OR due_on < $2)))[1] AS next_kind
       FROM schedule_items WHERE program_id = $1 GROUP BY user_id`,
      [p.id, finalDay(p)],
    )
  ).rows;
  // The program's final assessment for each member, and their certificate for its test.
  const finals = (await pool.query(`SELECT user_id, attempts_used FROM entitlements WHERE program_id = $1 AND revoked_at IS NULL`, [p.id])).rows;
  const certified = await programCertifiedMap(ids, p.test_type_id);

  return members.map((m) => {
    const own = mocks.filter((x) => x.user_id === m.id);
    const points: MockPoint[] = own.map((x) => ({
      sessionId: x.id,
      date: new Date(x.completed_at).toISOString(),
      cefrLevel: x.result?.cefrLevel ?? null,
      percent: x.result?.overallPercent ?? null,
      skillLevels: x.result?.skillLevels ?? null,
    }));
    const current = levels.get(m.id) ?? null;
    const level = { overall: current?.level ?? null, skills: current?.skills ?? {} };
    const it = items.find((x) => x.user_id === m.id);
    const st = goalStatus({
      targetLevel: p.target_level,
      targetSkills: p.target_skills,
      level,
      mocks: points,
      missed: it?.missed ?? 0,
      lastActivity: m.last_activity,
      startedOn: p.starts_on,
      goalDate: p.target_date,
    });
    const lastMock = own[own.length - 1];
    const cert = certified.get(m.id) ?? null;
    const final = finals.find((f) => f.user_id === m.id);
    return {
      userId: m.id as string,
      name: m.name as string,
      email: m.email as string,
      latestLevel: level.overall,
      skillLevels: level.skills,
      levelSource: current?.source ?? null,
      gap: st.gap,
      status: st.status,
      projected: st.projected,
      statusReason: st.reason,
      // The reason as a code and its numbers, for screens to word.
      statusWhy: st.why,
      mocks: points,
      lastActivity: m.last_activity ? new Date(m.last_activity).toISOString() : null,
      inactiveDays: st.inactiveDays,
      done: it?.done ?? 0,
      missed: it?.missed ?? 0,
      missedMocks: it?.missed_mocks ?? 0,
      next: it?.next_due ? { dueOn: new Date(it.next_due).toISOString().slice(0, 10), kind: it.next_kind } : null,
      integrity: lastMock ? { status: lastMock.integrity_status ?? null, risk: lastMock.risk_level ?? null } : null,
      certified: cert,
      finalAssessment: cert ? ("certified" as const) : final ? (final.attempts_used > 0 ? ("taken" as const) : ("waiting" as const)) : ("none" as const),
    };
  });
}

export type MemberRow = Awaited<ReturnType<typeof programMonitoring>>[number];

export function monitoringCsv(p: ProgramRow, rows: MemberRow[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "Name",
    "Email",
    "Latest level",
    "Listening",
    "Speaking",
    "Reading",
    "Writing",
    "Target",
    "Status",
    "Projected by target date",
    "Mocks taken",
    "Done",
    "Missed",
    "Last activity",
    "Next test",
    "Final assessment",
    "Certified level",
    "Spica score",
    "Certificate",
  ];
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.latestLevel,
      r.skillLevels?.listening,
      r.skillLevels?.speaking,
      r.skillLevels?.reading,
      r.skillLevels?.writing,
      p.target_level,
      r.status,
      r.projected,
      r.mocks.length,
      r.done,
      r.missed,
      r.lastActivity?.slice(0, 10),
      r.next ? `${r.next.kind} ${r.next.dueOn}` : "",
      r.finalAssessment,
      r.certified?.level,
      r.certified?.score,
      r.certified?.code,
    ]
      .map(cell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

// Who hears about a program: the organization's admins and the batch's managers.
async function programRecipients(p: ProgramRow): Promise<string[]> {
  const managers = (await pool.query(`SELECT user_id FROM batch_managers bm JOIN users u ON u.id = bm.user_id WHERE bm.batch_id = $1 AND u.deleted_at IS NULL`, [p.batch_id])).rows.map(
    (r) => r.user_id as string,
  );
  return [...new Set([...(await orgAdminIds(p.tenant_id)), ...managers])];
}

// Daily: new alerts per program, sent as one summary to each recipient.
export async function runProgramAlerts(): Promise<number> {
  const programs = (await pool.query(`SELECT id FROM programs WHERE status = 'active'`)).rows;
  let sent = 0;
  for (const { id } of programs) {
    const p = await getProgram(id);
    if (!p) continue;
    const rows = await programMonitoring(p);
    const raised: { kind: string; name: string }[] = [];
    for (const r of rows) {
      const kinds: [string, boolean, string][] = [
        ["at_risk", r.status === "at_risk", r.statusReason],
        ["inactive", r.inactiveDays !== null && r.inactiveDays >= INACTIVE_DAYS, `${r.inactiveDays} days`],
        ["missed_mock", r.missedMocks > 0, `${r.missedMocks} missed`],
      ];
      for (const [kind, on, detail] of kinds) {
        if (!on) continue;
        // A missed mock alerts once per missed mock; the others once a week.
        const recent = await pool.query(
          `SELECT detail FROM program_alerts WHERE program_id = $1 AND user_id = $2 AND kind = $3 AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 1`,
          [p.id, r.userId, kind],
        );
        if (recent.rows[0] && (kind !== "missed_mock" || recent.rows[0].detail === detail)) continue;
        await pool.query(`INSERT INTO program_alerts (program_id, user_id, kind, detail) VALUES ($1, $2, $3, $4)`, [p.id, r.userId, kind, detail]);
        raised.push({ kind, name: r.name });
      }
    }
    if (raised.length === 0) continue;
    const count = (k: string) => raised.filter((x) => x.kind === k).length;
    const body = [
      count("at_risk") ? `At risk of missing the target: ${raised.filter((x) => x.kind === "at_risk").map((x) => x.name).join(", ")}.` : "",
      count("inactive") ? `No activity for ${INACTIVE_DAYS} days: ${raised.filter((x) => x.kind === "inactive").map((x) => x.name).join(", ")}.` : "",
      count("missed_mock") ? `Missed a planned mock test: ${raised.filter((x) => x.kind === "missed_mock").map((x) => x.name).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    for (const userId of await programRecipients(p)) {
      const role = (await pool.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0]?.role;
      await notify({
        userId,
        kind: "program_alert",
        title: `${p.name}: ${raised.length} new alert${raised.length === 1 ? "" : "s"}`,
        body,
        link: role === "manager" ? "/manager/programs" : "/orgadmin/programs",
        email: true,
        dedupeKey: `program-alert:${p.id}:${userId}:${new Date().toISOString().slice(0, 10)}`,
        meta: { programId: p.id },
      });
      sent++;
    }
  }
  return sent;
}

export { programJson };
