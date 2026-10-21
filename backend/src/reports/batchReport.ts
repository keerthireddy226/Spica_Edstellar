// The Batch report for Org Admins and Managers: what a batch did in a period,
// where its learners started and are now, who reached the goal and who needs
// attention. Levels and Spica scores come from each learner's latest mock test
// (else their latest level test); the start is their first level test.
import { pool } from "../db.js";
import { learnerAccessMap } from "../licenses/service.js";
import { levelSummary } from "../placement/levels.js";
import { CEFR_LEVELS } from "../placement/cefr.js";
import { memberStatus, INACTIVE_DAYS, type MockPoint } from "../programs/monitoring.js";
import { BANDS, levelOfScore, spicaScore } from "./scoreReport.js";

export const SKILLS = ["speaking", "listening", "reading", "writing"] as const;
type Skill = (typeof SKILLS)[number];
type SkillMap<T> = Record<Skill, T>;

const DAY = 86_400_000;
// Access ending within this many days goes on the attention list.
const ACCESS_ENDING_DAYS = 14;

export type PeriodKey = "since_start" | "last_30" | "quarter" | "custom";
export type GoalStatus = "reached" | "on_track" | "at_risk" | "too_early";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// The period's first and last day (inclusive), from the preset or the dates given.
export function periodRange(key: PeriodKey, beginsOn: string, now = new Date(), custom?: { from?: string; to?: string }): { from: string; to: string } {
  const today = ymd(now);
  if (key === "last_30") return { from: ymd(new Date(now.getTime() - 29 * DAY)), to: today };
  if (key === "quarter") return { from: `${now.getUTCFullYear()}-${String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, "0")}-01`, to: today };
  if (key === "custom" && custom?.from && custom?.to) return custom.from <= custom.to ? { from: custom.from, to: custom.to } : { from: custom.to, to: custom.from };
  return { from: beginsOn <= today ? beginsOn : today, to: today };
}

// Older level tests stored each skill as { level, cappedByGap }, newer ones as "B1".
function skillLevelsOf(raw: unknown): Partial<SkillMap<string>> {
  const out: Partial<SkillMap<string>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const s of SKILLS) {
    const v = (raw as Record<string, unknown>)[s];
    const level = typeof v === "object" && v !== null ? (v as { level?: unknown }).level : v;
    if (typeof level === "string" && BANDS.some((b) => b.level === level)) out[s] = level;
  }
  return out;
}

interface Snapshot {
  level: string | null;
  score: number | null;
  skills: Partial<SkillMap<{ level: string; score: number }>>;
}

// Each skill's Spica score from its level and share right (the overall share
// when a skill's own isn't known); the overall score is their mean.
export function snapshot(levels: Partial<SkillMap<string>>, percents: Partial<SkillMap<number | null>> | null, overallPercent: number | null, overallLevel: string | null): Snapshot {
  const skills: Snapshot["skills"] = {};
  for (const s of SKILLS) {
    const level = levels[s];
    const score = spicaScore(level, percents?.[s] ?? overallPercent);
    if (level && score !== null) skills[s] = { level, score };
  }
  const scores = Object.values(skills).map((x) => x!.score);
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : spicaScore(overallLevel, overallPercent);
  return { level: score !== null ? levelOfScore(score) : overallLevel, score, skills };
}

// Results of finished mock tests saved before the level (or each skill's share
// right) was stored with them: worked out from the answers once, then kept.
// Questions left blank count as wrong, as when the test finishes.
async function fillResults(sessions: { id: string; result: Record<string, any> | null }[]): Promise<void> {
  if (!sessions.length) return;
  const rows = (
    await pool.query(
      `SELECT a.session_id, i.item_type_id, it.skills, it.input_method, i.cefr_level, i.content, i.answer_set,
         a.response_text, a.response_uri, coalesce(sc.status, 'pending') AS status, sc.content_score, sc.manner_scores
       FROM attempts a JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id LEFT JOIN scores sc ON sc.attempt_id = a.id
       WHERE a.session_id = ANY($1::uuid[])`,
      [sessions.map((x) => x.id)],
    )
  ).rows.map((r) => (r.status === "pending" && !r.response_text && !r.response_uri ? { ...r, status: "scored", content_score: 0 } : r));
  for (const x of sessions) {
    const summary = levelSummary(rows.filter((r) => r.session_id === x.id) as never);
    if (!summary) continue;
    const percents = Object.values(summary.skillPercents) as number[];
    const add = {
      cefrLevel: x.result?.cefrLevel ?? summary.cefrLevel,
      skillLevels: x.result?.skillLevels ?? summary.skillLevels,
      skillPercents: summary.skillPercents,
      overallPercent: x.result?.overallPercent ?? (percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null),
    };
    x.result = { ...(x.result ?? {}), ...add };
    await pool.query(`UPDATE sessions SET result = coalesce(result, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [x.id, JSON.stringify(add)]);
  }
}

export interface BatchReportOptions {
  period: PeriodKey;
  from?: string;
  to?: string;
  // Org Admins, and Managers when the organization allows it.
  canOpenReports: boolean;
}

export async function batchReport(tenantId: string, batchId: string, opts: BatchReportOptions) {
  const b = (
    await pool.query(
      `SELECT b.id, b.name, b.batch_code, b.target_cefr, b.duration_months, coalesce(b.start_date, b.created_at::date) AS begins_on, t.name AS org_name
       FROM batches b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = $1 AND b.tenant_id = $2`,
      [batchId, tenantId],
    )
  ).rows[0];
  if (!b) return null;
  const beginsOn = ymd(new Date(b.begins_on));
  const { from, to } = periodRange(opts.period, beginsOn, new Date(), { from: opts.from, to: opts.to });
  const toEnd = new Date(`${to}T00:00:00Z`).getTime() + DAY;

  const program = (
    await pool.query(
      `SELECT p.id, p.test_type_id, p.target_level, p.target_date, tt.name AS test_name
       FROM programs p LEFT JOIN test_types tt ON tt.id = p.test_type_id WHERE p.batch_id = $1 AND p.status = 'active'`,
      [batchId],
    )
  ).rows[0];
  // The goal: the batch's program, else the batch's target level by its end.
  const batchEnd = b.duration_months ? new Date(new Date(b.begins_on).getTime() + b.duration_months * 30.44 * DAY) : null;
  const goalLevel: string | null = program?.target_level ?? b.target_cefr ?? null;
  const goalDate: string | null = program ? ymd(new Date(program.target_date)) : batchEnd ? ymd(batchEnd) : null;
  const daysLeft = goalDate ? Math.max(0, Math.round((Date.parse(`${goalDate}T00:00:00Z`) - Date.now()) / DAY)) : null;

  const members = (
    await pool.query(
      `SELECT u.id, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.participant_id,
         (SELECT max(t) FROM (SELECT max(s.started_at) AS t FROM sessions s WHERE s.user_id = u.id
                              UNION ALL SELECT max(a.submitted_at) FROM attempts a JOIN sessions s2 ON s2.id = a.session_id WHERE s2.user_id = u.id) x) AS last_activity
       FROM users u WHERE u.batch_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL ORDER BY name`,
      [batchId],
    )
  ).rows;
  const ids = members.map((m) => m.id as string);

  const [placements, mocks, counts, minutes, certificates, managers, missed, access] = await Promise.all([
    pool.query(
      `SELECT user_id, taken_at, cefr_level, overall_percent, skill_percents, skill_levels FROM placements
       WHERE user_id = ANY($1::uuid[]) AND status <> 'fraud_confirmed' ORDER BY taken_at`,
      [ids],
    ),
    // Finished mock tests (of the program's test when there is one).
    pool.query(
      `SELECT s.id, s.user_id, s.completed_at, s.result FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       WHERE s.user_id = ANY($1::uuid[]) AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
         AND ($2::text IS NULL OR coalesce(s.composition->>'testTypeId', e.test_type_id) = $2)
       ORDER BY s.completed_at`,
      [ids, program?.test_type_id ?? null],
    ),
    pool.query(
      `SELECT user_id, count(*) FILTER (WHERE delivery_mode = 'practice')::int AS practice, count(*) FILTER (WHERE delivery_mode = 'mock')::int AS mock
       FROM sessions WHERE user_id = ANY($1::uuid[]) AND session_type = 'mocktest' AND completed_at >= $2::date AND completed_at < $3::date + 1
       GROUP BY user_id`,
      [ids, from, to],
    ),
    pool.query(
      `SELECT user_id, coalesce(sum(active_ms), 0)::bigint AS ms FROM learner_activity_daily
       WHERE user_id = ANY($1::uuid[]) AND day BETWEEN $2::date AND $3::date GROUP BY user_id`,
      [ids, from, to],
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM certificates c
       WHERE (c.batch_id = $1 OR c.user_id = ANY($2::uuid[])) AND c.revoked_at IS NULL AND c.issued_at >= $3::date AND c.issued_at < $4::date + 1`,
      [batchId, ids, from, to],
    ),
    pool.query(
      `SELECT coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name FROM batch_managers bm JOIN users u ON u.id = bm.user_id WHERE bm.batch_id = $1 ORDER BY 1`,
      [batchId],
    ),
    program
      ? pool.query(
          `SELECT user_id, count(*) FILTER (WHERE status = 'missed')::int AS missed, count(*) FILTER (WHERE status = 'missed' AND kind = 'mock')::int AS missed_mocks,
             max(due_on) FILTER (WHERE status = 'missed' AND kind = 'mock') AS last_missed_mock
           FROM schedule_items WHERE program_id = $1 GROUP BY user_id`,
          [program.id],
        )
      : Promise.resolve({ rows: [] as Record<string, any>[] }),
    learnerAccessMap(ids),
  ]);

  // Each mock's level and skill shares, worked out where they weren't stored; only mocks with a level count.
  await fillResults(mocks.rows.filter((m) => !m.result?.cefrLevel || !m.result?.skillPercents));
  const leveled = mocks.rows.filter((m) => m.result?.cefrLevel);
  const latestMock = new Map<string, Record<string, any>>();
  for (const m of leveled) latestMock.set(m.user_id, m);

  const now = Date.now();
  const learners = members.map((m) => {
    const own = placements.rows.filter((p) => p.user_id === m.id);
    const ownMocks = leveled.filter((x) => x.user_id === m.id);
    const firstPlacement = own[0];
    const lastPlacement = own[own.length - 1];
    const mock = latestMock.get(m.id);
    const fromPlacement = (p: Record<string, any>) => snapshot(skillLevelsOf(p.skill_levels), p.skill_percents, Number(p.overall_percent), p.cefr_level);
    const fromMock = (x: Record<string, any>) =>
      snapshot(skillLevelsOf(x.result.skillLevels), x.result.skillPercents ?? null, x.result.overallPercent ?? null, x.result.cefrLevel);
    const start = firstPlacement ? fromPlacement(firstPlacement) : ownMocks[0] ? fromMock(ownMocks[0]) : null;
    const current = mock ? fromMock(mock) : lastPlacement ? fromPlacement(lastPlacement) : null;

    const lastActivity = m.last_activity ? new Date(m.last_activity) : null;
    const inactiveDays = lastActivity ? Math.floor((now - lastActivity.getTime()) / DAY) : null;
    const mi = missed.rows.find((x) => x.user_id === m.id);
    let goal: GoalStatus | null = null;
    let projected: string | null = null;
    if (goalLevel) {
      const target = CEFR_LEVELS.indexOf(goalLevel as never);
      const at = current?.level ? CEFR_LEVELS.indexOf(current.level as never) : -1;
      const points: MockPoint[] = ownMocks.map((x) => ({
        sessionId: x.id,
        date: new Date(x.completed_at).toISOString(),
        cefrLevel: x.result.cefrLevel,
        percent: x.result.overallPercent ?? null,
        skillLevels: x.result.skillLevels ?? null,
      }));
      const st = memberStatus({
        targetLevel: goalLevel,
        gap: at >= 0 ? Math.max(0, target - at) : null,
        mocks: points,
        missed: mi?.missed ?? 0,
        // Never active counts as inactive since the batch began.
        inactiveDays: inactiveDays ?? Math.floor((now - new Date(b.begins_on).getTime()) / DAY),
        daysLeft: daysLeft ?? 365,
      });
      goal = st.status === "at_target" ? "reached" : st.status;
      projected = st.projected;
    }
    const c = counts.rows.find((x) => x.user_id === m.id);
    const a = access.get(m.id);
    return {
      id: m.id as string,
      name: m.name as string,
      participantId: (m.participant_id as string | null) ?? null,
      start,
      current,
      levelSource: mock ? ("mock" as const) : lastPlacement ? ("level_test" as const) : null,
      practiceTests: c?.practice ?? 0,
      mockTests: c?.mock ?? 0,
      minutes: Math.round(Number(minutes.rows.find((x) => x.user_id === m.id)?.ms ?? 0) / 60000),
      goal,
      projected,
      lastActivity: lastActivity ? lastActivity.toISOString() : null,
      inactiveDays,
      accessEndsAt: a && (a.status === "active" || a.status === "grace") ? (a.status === "grace" ? a.graceEndsAt : a.accessEndsAt) : null,
      missedMocks: mi?.missed_mocks ?? 0,
      lastMissedMock: mi?.last_missed_mock ? ymd(new Date(mi.last_missed_mock)) : null,
      // The latest mock's score report, when the viewer may open it.
      reportSessionId: opts.canOpenReports && mock ? (mock.id as string) : null,
    };
  });

  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null);
  const goalMin = goalLevel ? (BANDS.find((x) => x.level === goalLevel)?.min ?? null) : null;
  const levelCounts = (pick: (l: (typeof learners)[number]) => Snapshot | null) =>
    Object.fromEntries(
      SKILLS.map((s) => {
        const c: Record<string, number> = {};
        for (const l of learners) {
          const level = pick(l)?.skills[s]?.level;
          if (level) c[level] = (c[level] ?? 0) + 1;
        }
        return [s, c];
      }),
    ) as SkillMap<Record<string, number>>;
  const skillMean = (pick: (l: (typeof learners)[number]) => Snapshot | null, s: Skill) =>
    mean(learners.map((l) => pick(l)?.skills[s]?.score).filter((x): x is number => typeof x === "number"));
  const ends = (l: (typeof learners)[number]) => (l.accessEndsAt ? (Date.parse(l.accessEndsAt) - now) / DAY : null);

  return {
    batch: {
      id: b.id as string,
      name: b.name as string,
      batchCode: (b.batch_code as string | null) ?? null,
      organization: b.org_name as string,
      testName: (program?.test_name as string | undefined) ?? null,
      managers: managers.rows.map((x) => x.name as string),
      beginsOn,
    },
    goal: goalLevel ? { level: goalLevel, date: goalDate, daysLeft, minScore: goalMin, fromProgram: !!program } : null,
    period: { key: opts.period, from, to },
    generatedAt: new Date().toISOString(),
    summary: {
      learners: learners.length,
      active: learners.filter((l) => l.inactiveDays !== null && l.inactiveDays < INACTIVE_DAYS).length,
      activeDays: INACTIVE_DAYS,
      practiceMinutes: learners.reduce((x, l) => x + l.minutes, 0),
      practiceTests: learners.reduce((x, l) => x + l.practiceTests, 0),
      mockTests: learners.reduce((x, l) => x + l.mockTests, 0),
      certificates: certificates.rows[0].n as number,
      scoreNow: mean(learners.map((l) => l.current?.score).filter((x): x is number => typeof x === "number")),
      scoreStart: mean(learners.map((l) => l.start?.score).filter((x): x is number => typeof x === "number")),
    },
    goalCounts: goalLevel
      ? {
          reached: learners.filter((l) => l.goal === "reached").length,
          onTrack: learners.filter((l) => l.goal === "on_track").length,
          atRisk: learners.filter((l) => l.goal === "at_risk").length,
          tooEarly: learners.filter((l) => l.goal === "too_early").length,
        }
      : null,
    levels: { start: levelCounts((l) => l.start), now: levelCounts((l) => l.current) },
    scores: learners.map((l) => l.current?.score).filter((x): x is number => typeof x === "number"),
    profile: Object.fromEntries(SKILLS.map((s) => [s, { now: skillMean((l) => l.current, s), start: skillMean((l) => l.start, s) }])) as SkillMap<{
      now: number | null;
      start: number | null;
    }>,
    learners,
    attention: {
      inactive: learners
        .filter((l) => l.inactiveDays === null || l.inactiveDays >= INACTIVE_DAYS)
        .map((l) => ({ id: l.id, name: l.name, days: l.inactiveDays }))
        .sort((x, y) => (y.days ?? 1e9) - (x.days ?? 1e9)),
      offPace: learners
        .filter((l) => l.goal === "at_risk")
        .map((l) => ({ id: l.id, name: l.name, score: l.current?.score ?? null, needs: goalMin !== null && l.current?.score != null ? Math.max(0, goalMin - l.current.score) : null, projected: l.projected }))
        .sort((x, y) => (y.needs ?? 0) - (x.needs ?? 0)),
      accessEnding: learners
        .filter((l) => {
          const d = ends(l);
          return d !== null && d >= 0 && d <= ACCESS_ENDING_DAYS;
        })
        .map((l) => ({ id: l.id, name: l.name, endsAt: l.accessEndsAt! }))
        .sort((x, y) => x.endsAt.localeCompare(y.endsAt)),
      missedMock: learners.filter((l) => l.missedMocks > 0).map((l) => ({ id: l.id, name: l.name, count: l.missedMocks, last: l.lastMissedMock })),
      accessEndingDays: ACCESS_ENDING_DAYS,
    },
    canOpenReports: opts.canOpenReports,
  };
}

export type BatchReport = NonNullable<Awaited<ReturnType<typeof batchReport>>>;
