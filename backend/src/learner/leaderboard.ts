// Group leaderboards: a batch's learners ranked on this week's progress
// points (effort and results, reset every Monday), not on their level, so
// anyone can lead a week. Learners see their percentile and a top 5; the
// bottom half sees how to move up rather than their rank. Admins and
// managers see the whole batch.
import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { overallFromSkills, pathSummary } from "./path.js";

const DAY_MS = 86_400_000;
// Shown to learners only when at least this many practised this week.
export const MIN_ACTIVE = 5;

export const POINTS = { set: 10, correct: 2, test: 25, activeDay: 5 } as const;

// Monday 00:00 UTC of the week holding `d`.
export function weekStart(d: Date): Date {
  const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7));
  return s;
}

export interface WeekPoints {
  points: number;
  sets: number;
  correct: number;
  tests: number;
  activeDays: number;
}

export function pointsOf(p: Omit<WeekPoints, "points">): number {
  return p.sets * POINTS.set + p.correct * POINTS.correct + p.tests * POINTS.test + p.activeDays * POINTS.activeDay;
}

// Each learner's points for sets, right answers, tests and days practised in [from, to).
export async function weeklyPoints(userIds: string[], from: Date, to: Date): Promise<Map<string, WeekPoints>> {
  const out = new Map<string, WeekPoints>(userIds.map((id) => [id, { points: 0, sets: 0, correct: 0, tests: 0, activeDays: 0 }]));
  if (!userIds.length) return out;
  const sessions = await pool.query(
    `SELECT user_id, session_type, completed_at FROM sessions
     WHERE user_id = ANY($1::uuid[]) AND completed_at >= $2 AND completed_at < $3
       AND session_type IN ('practice', 'mocktest') AND coalesce(composition->>'abandoned', 'false') <> 'true'`,
    [userIds, from, to],
  );
  const days = new Map<string, Set<string>>();
  for (const s of sessions.rows) {
    const p = out.get(s.user_id)!;
    if (s.session_type === "practice") p.sets++;
    else p.tests++;
    const set = days.get(s.user_id) ?? new Set<string>();
    set.add(new Date(s.completed_at).toISOString().slice(0, 10));
    days.set(s.user_id, set);
  }
  const answers = await pool.query(
    `SELECT s.user_id, sc.content_score, sc.manner_scores, i.cefr_level, it.input_method
     FROM attempts a JOIN sessions s ON s.id = a.session_id
     JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored'
     JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
     WHERE s.user_id = ANY($1::uuid[]) AND a.submitted_at >= $2 AND a.submitted_at < $3 AND s.session_type IN ('practice', 'mocktest')`,
    [userIds, from, to],
  );
  for (const a of answers.rows) {
    if (isTrulyCorrect(Number(a.content_score), a.cefr_level, a.input_method, a.manner_scores, passThresholdForLevel)) out.get(a.user_id)!.correct++;
  }
  for (const [id, p] of out) {
    p.activeDays = days.get(id)?.size ?? 0;
    p.points = pointsOf(p);
  }
  return out;
}

// Rank 1 is the most points; equal points share a rank.
export function ranks(points: Map<string, number>): Map<string, number> {
  const sorted = [...points.entries()].sort((a, b) => b[1] - a[1]);
  const out = new Map<string, number>();
  sorted.forEach(([id, p], i) => out.set(id, i > 0 && sorted[i - 1][1] === p ? out.get(sorted[i - 1][0])! : i + 1));
  return out;
}

// "Top X%": the share of the group at or above this rank, to the nearest 5.
export function topPercent(rank: number, size: number): number {
  return Math.min(100, Math.max(5, Math.ceil(((rank / size) * 100) / 5) * 5));
}

const displayName = (u: { first_name: string | null; last_name: string | null; leaderboard_hidden: boolean }) =>
  u.leaderboard_hidden ? null : [u.first_name, u.last_name ? `${u.last_name[0]}.` : null].filter(Boolean).join(" ") || null;

async function members(batchId: string) {
  return (
    await pool.query(
      `SELECT id, email, first_name, last_name, leaderboard_hidden FROM users
       WHERE batch_id = $1 AND role = 'learner' AND deleted_at IS NULL`,
      [batchId],
    )
  ).rows as { id: string; email: string; first_name: string | null; last_name: string | null; leaderboard_hidden: boolean }[];
}

// The learner's view of their group this week.
export async function learnerBoard(userId: string) {
  const me = (
    await pool.query(
      `SELECT u.batch_id, u.leaderboard_hidden, b.name, b.leaderboard_enabled FROM users u LEFT JOIN batches b ON b.id = u.batch_id WHERE u.id = $1`,
      [userId],
    )
  ).rows[0];
  if (!me?.batch_id || !me.leaderboard_enabled) return { enabled: false as const };
  const people = await members(me.batch_id);
  const now = new Date();
  const from = weekStart(now);
  const week = await weeklyPoints(people.map((p) => p.id), from, new Date(now.getTime() + DAY_MS));
  const active = [...week.values()].filter((p) => p.points > 0).length;
  const mine = week.get(userId) ?? { points: 0, sets: 0, correct: 0, tests: 0, activeDays: 0 };
  const base = { enabled: true as const, group: me.name as string, hidden: !!me.leaderboard_hidden, size: people.length, active, points: mine, weekStart: from.toISOString().slice(0, 10) };
  if (active < MIN_ACTIVE) return { ...base, quiet: true as const, needed: MIN_ACTIVE };

  const r = ranks(new Map([...week.entries()].map(([id, p]) => [id, p.points])));
  const rank = r.get(userId)!;
  const lastWeek = await weeklyPoints(people.map((p) => p.id), new Date(from.getTime() - 7 * DAY_MS), from);
  const lastRank = mine.points > 0 || [...lastWeek.values()].some((p) => p.points > 0) ? ranks(new Map([...lastWeek.entries()].map(([id, p]) => [id, p.points]))).get(userId) : undefined;
  const sorted = [...week.entries()].sort((a, b) => b[1].points - a[1].points);
  const halfLine = sorted[Math.max(0, Math.ceil(people.length / 2) - 1)][1].points;
  const top = sorted.slice(0, 5).map(([id, p]) => {
    const person = people.find((x) => x.id === id)!;
    return { name: displayName(person), points: p.points, rank: r.get(id)!, me: id === userId };
  });
  // The learner's own level (only theirs; peers never see each other's level).
  const myLevel = overallFromSkills(await pathSummary(userId));
  return {
    ...base,
    quiet: false as const,
    rank,
    myLevel,
    topPercent: topPercent(rank, people.length),
    topHalf: rank <= Math.ceil(people.length / 2),
    // Places climbed since last week's final standing (negative: dropped).
    climbed: lastRank !== undefined ? lastRank - rank : null,
    pointsToTopHalf: Math.max(0, halfLine - mine.points + 1),
    top,
  };
}

// The whole batch for its admin or managers: names, points, level, last active.
export async function adminBoard(batchId: string) {
  const b = (await pool.query(`SELECT name, leaderboard_enabled FROM batches WHERE id = $1`, [batchId])).rows[0];
  const people = await members(batchId);
  const now = new Date();
  const week = await weeklyPoints(people.map((p) => p.id), weekStart(now), new Date(now.getTime() + DAY_MS));
  const r = ranks(new Map([...week.entries()].map(([id, p]) => [id, p.points])));
  const last = await pool.query(
    `SELECT user_id, max(completed_at) AS at FROM sessions WHERE user_id = ANY($1::uuid[]) AND completed_at IS NOT NULL GROUP BY user_id`,
    [people.map((p) => p.id)],
  );
  const lastBy = new Map(last.rows.map((x) => [x.user_id, x.at]));
  const rows = await Promise.all(
    people.map(async (p) => ({
      id: p.id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email,
      hidden: p.leaderboard_hidden,
      rank: r.get(p.id)!,
      ...week.get(p.id)!,
      level: overallFromSkills(await pathSummary(p.id)),
      lastActive: lastBy.get(p.id) ?? null,
    })),
  );
  rows.sort((a, b) => a.rank - b.rank);
  return { enabled: !!b?.leaderboard_enabled, group: b?.name ?? null, weekStart: weekStart(now).toISOString().slice(0, 10), rows };
}
