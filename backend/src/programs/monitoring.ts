// Organization monitoring of programs (ASSESSMENT_ENGINE.md section 9): each
// member's latest levels, trend across mocks, on track or at risk, last
// activity, and daily alerts to the organization.
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { getProgram, programJson } from "./service.js";
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

export function memberStatus(args: {
  targetLevel: string;
  gap: number | null;
  mocks: MockPoint[];
  missed: number;
  inactiveDays: number | null;
  daysLeft: number;
}): { status: MemberStatus; projected: string | null; reason: string } {
  if (args.gap === 0) return { status: "at_target", projected: null, reason: "latest level meets the target" };
  const points = args.mocks.filter((m) => idx(m.cefrLevel) >= 0).map((m) => ({ day: Date.parse(m.date) / DAY, level: idx(m.cefrLevel) }));
  const target = idx(args.targetLevel);
  const projectedIdx = projectLevel(points, Date.now() / DAY + args.daysLeft);
  if (projectedIdx !== null) {
    const projected = CEFR_LEVELS[Math.max(0, Math.min(5, Math.round(projectedIdx)))];
    // A quarter of a level's slack: one mock's noise shouldn't raise an alarm.
    return projectedIdx < target - 0.25
      ? { status: "at_risk", projected, reason: `trend reaches ${projected} by the target date` }
      : { status: "on_track", projected, reason: `trend reaches ${projected} by the target date` };
  }
  if (args.missed >= 2) return { status: "at_risk", projected: null, reason: `${args.missed} planned tests missed` };
  if (args.inactiveDays !== null && args.inactiveDays >= INACTIVE_DAYS) return { status: "at_risk", projected: null, reason: `no activity for ${args.inactiveDays} days` };
  if (args.gap !== null && args.gap >= 2 && args.daysLeft < 30) return { status: "at_risk", projected: null, reason: `${args.gap} levels to go with ${args.daysLeft} days left` };
  return { status: "too_early", projected: null, reason: "fewer than 2 mocks so far" };
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
  const mocks = (
    await pool.query(
      `SELECT s.id, s.user_id, s.completed_at, s.result, si.status AS integrity_status, si.risk_level
       FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId' LEFT JOIN session_integrity si ON si.session_id = s.id
       WHERE s.user_id = ANY($1::uuid[]) AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
         AND coalesce(s.composition->>'testTypeId', e.test_type_id) = $2
       ORDER BY s.completed_at`,
      [ids, p.test_type_id],
    )
  ).rows;
  const placements = (
    await pool.query(`SELECT DISTINCT ON (user_id) user_id, cefr_level, skill_levels FROM placements WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, taken_at DESC`, [ids])
  ).rows;
  const items = (
    await pool.query(
      `SELECT user_id, count(*) FILTER (WHERE status = 'done')::int AS done, count(*) FILTER (WHERE status = 'missed')::int AS missed,
         count(*) FILTER (WHERE status = 'missed' AND kind = 'mock')::int AS missed_mocks,
         min(due_on) FILTER (WHERE status = 'due') AS next_due,
         (array_agg(kind ORDER BY due_on) FILTER (WHERE status = 'due'))[1] AS next_kind
       FROM schedule_items WHERE program_id = $1 GROUP BY user_id`,
      [p.id],
    )
  ).rows;
  const daysLeft = Math.max(0, Math.round((Date.parse(`${p.target_date}T00:00:00Z`) - Date.now()) / DAY));

  return members.map((m) => {
    const own = mocks.filter((x) => x.user_id === m.id);
    const points: MockPoint[] = own.map((x) => ({
      sessionId: x.id,
      date: new Date(x.completed_at).toISOString(),
      cefrLevel: x.result?.cefrLevel ?? null,
      percent: x.result?.overallPercent ?? null,
      skillLevels: x.result?.skillLevels ?? null,
    }));
    const latest = [...points].reverse().find((x) => x.cefrLevel);
    const placement = placements.find((x) => x.user_id === m.id);
    const level = latest ? { overall: latest.cefrLevel, skills: latest.skillLevels ?? {} } : { overall: placement?.cefr_level ?? null, skills: placement?.skill_levels ?? {} };
    const it = items.find((x) => x.user_id === m.id);
    const inactiveDays = m.last_activity ? Math.floor((Date.now() - new Date(m.last_activity).getTime()) / DAY) : null;
    const gap = programGap(p, level);
    const st = memberStatus({ targetLevel: p.target_level, gap, mocks: points, missed: it?.missed ?? 0, inactiveDays, daysLeft });
    const lastMock = own[own.length - 1];
    return {
      userId: m.id as string,
      name: m.name as string,
      email: m.email as string,
      latestLevel: level.overall as string | null,
      skillLevels: level.skills as Record<string, string>,
      levelSource: latest ? "mock" : placement ? "placement" : null,
      gap,
      status: st.status,
      projected: st.projected,
      statusReason: st.reason,
      mocks: points,
      lastActivity: m.last_activity ? new Date(m.last_activity).toISOString() : null,
      inactiveDays,
      done: it?.done ?? 0,
      missed: it?.missed ?? 0,
      missedMocks: it?.missed_mocks ?? 0,
      next: it?.next_due ? { dueOn: new Date(it.next_due).toISOString().slice(0, 10), kind: it.next_kind } : null,
      integrity: lastMock ? { status: lastMock.integrity_status ?? null, risk: lastMock.risk_level ?? null } : null,
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
  const header = ["Name", "Email", "Latest level", "Listening", "Speaking", "Reading", "Writing", "Target", "Status", "Projected by target date", "Mocks taken", "Done", "Missed", "Last activity", "Next test"];
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
