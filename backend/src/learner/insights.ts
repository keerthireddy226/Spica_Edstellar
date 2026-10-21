// What the app knows about a learner's practice, turned into guidance: are
// they on pace for their goal date, which questions to retry, and the one
// thing to do next. Rules over their own data, no AI call.
import { readiness } from "../assessment/service.js";
import { pool } from "../db.js";
import { dateOnly } from "../lib/dateOnly.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { quotaUsage } from "../programs/quotas.js";
import type { SkillTag } from "../gamification/stats.js";
import { LEVELS, pathSummary, skillPath } from "./path.js";

const SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const DAY_MS = 86_400_000;

// Wrong answers come back after this long, not straight away.
const RETRY_AFTER_HOURS = 12;
export const RETRY_SET_SIZE = 5;
// A recent-accuracy figure needs at least this many graded answers.
const MIN_GRADED = 4;

export function daysUntilDate(date: Date | string): number {
  const d = new Date(date);
  const today = new Date();
  return Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY_MS);
}

export type PaceStatus = "new" | "on_track" | "slightly_behind" | "behind";

// Practice minutes over the last 7 days against the plan's daily minutes.
export function paceStatus(minutesDone: number, minutesPerDay: number, daysCounted: number): PaceStatus {
  if (daysCounted < 2) return "new";
  const ratio = minutesDone / Math.max(1, minutesPerDay * daysCounted);
  if (ratio >= 0.8) return "on_track";
  if (ratio >= 0.5) return "slightly_behind";
  return "behind";
}

export interface GoalStatus {
  goalLevel: string | null;
  examDate: string | null;
  daysLeft: number | null;
  minutesPerDay: number | null;
  minutesLast7Days: number;
  pace: PaceStatus;
}

export async function goalStatus(userId: string): Promise<GoalStatus> {
  const profile = (await pool.query(`SELECT goal_level, exam_date FROM participant_profiles WHERE user_id = $1`, [userId])).rows[0] ?? {};
  const roadmap = (await pool.query(`SELECT minutes_per_day FROM roadmaps WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1`, [userId])).rows[0];
  const r = await pool.query(
    `SELECT coalesce(sum(a.active_ms) FILTER (WHERE a.submitted_at >= now() - interval '7 days'), 0) AS ms,
            min(a.submitted_at) AS first_at
     FROM attempts a JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = $1 AND s.session_type IN ('practice', 'mocktest')`,
    [userId],
  );
  const minutesLast7Days = Math.round(Number(r.rows[0].ms) / 60_000);
  const plan = (await pool.query(`SELECT generated_at FROM roadmaps WHERE user_id = $1 ORDER BY generated_at ASC LIMIT 1`, [userId])).rows[0];
  // Days the plan has been running, up to a week.
  const since = plan?.generated_at ?? r.rows[0].first_at;
  const daysCounted = since ? Math.min(7, Math.floor((Date.now() - new Date(since).getTime()) / DAY_MS) + 1) : 0;
  const examDate = profile.exam_date ? dateOnly(profile.exam_date) : null;
  const daysLeft = examDate ? daysUntilDate(examDate) : null;
  return {
    goalLevel: profile.goal_level && profile.goal_level !== "unsure" ? profile.goal_level : null,
    examDate: daysLeft !== null && daysLeft >= 0 ? examDate : null,
    daysLeft: daysLeft !== null && daysLeft >= 0 ? daysLeft : null,
    minutesPerDay: roadmap?.minutes_per_day ?? null,
    minutesLast7Days,
    pace: roadmap ? paceStatus(minutesLast7Days, roadmap.minutes_per_day, daysCounted) : "new",
  };
}

interface RetryItem {
  itemId: string;
  skill: SkillTag;
}

// Practice-module questions whose latest answer was wrong, oldest mistake
// first, once they're at least RETRY_AFTER_HOURS old.
export async function retryItems(userId: string, skill?: SkillTag): Promise<RetryItem[]> {
  const r = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (a.item_id) a.item_id, a.submitted_at, s.composition->>'skill' AS skill,
         sc.status, sc.content_score, sc.manner_scores, i.cefr_level, it.input_method
       FROM attempts a
       JOIN sessions s ON s.id = a.session_id
       JOIN items i ON i.id = a.item_id AND i.status = 'approved' AND i.pool = 'practice'
       JOIN item_types it ON it.id = i.item_type_id
       LEFT JOIN scores sc ON sc.attempt_id = a.id
       WHERE s.user_id = $1 AND s.session_type = 'practice' AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)
       ORDER BY a.item_id, a.submitted_at DESC
     ) latest
     WHERE status = 'scored' AND submitted_at < now() - make_interval(hours => $2) AND ($3::text IS NULL OR skill = $3)
     ORDER BY submitted_at ASC`,
    [userId, RETRY_AFTER_HOURS, skill ?? null],
  );
  return r.rows
    .filter((x) => SKILLS.includes(x.skill) && !isTrulyCorrect(Number(x.content_score), x.cefr_level, x.input_method, x.manner_scores, passThresholdForLevel))
    .map((x) => ({ itemId: x.item_id, skill: x.skill }));
}

export async function retryCounts(userId: string): Promise<Record<SkillTag, number>> {
  const counts = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<SkillTag, number>;
  for (const it of await retryItems(userId)) counts[it.skill]++;
  return counts;
}

interface TypeAccuracy {
  skill: SkillTag;
  itemTypeId: string;
  typeName: string;
  graded: number;
  correct: number;
}

// Accuracy per skill and question type over the last 30 days of practice.
async function recentTypeAccuracy(userId: string): Promise<TypeAccuracy[]> {
  const r = await pool.query(
    `SELECT s.composition->>'skill' AS skill, i.item_type_id, it.name AS type_name, sc.content_score, sc.manner_scores, i.cefr_level, it.input_method
     FROM attempts a
     JOIN sessions s ON s.id = a.session_id
     JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored'
     JOIN items i ON i.id = a.item_id
     JOIN item_types it ON it.id = i.item_type_id
     WHERE s.user_id = $1 AND s.session_type = 'practice' AND a.submitted_at >= now() - interval '30 days'`,
    [userId],
  );
  const by = new Map<string, TypeAccuracy>();
  for (const x of r.rows) {
    if (!SKILLS.includes(x.skill)) continue;
    const key = `${x.skill}|${x.item_type_id}`;
    const t = by.get(key) ?? { skill: x.skill, itemTypeId: x.item_type_id, typeName: x.type_name, graded: 0, correct: 0 };
    t.graded++;
    if (isTrulyCorrect(Number(x.content_score), x.cefr_level, x.input_method, x.manner_scores, passThresholdForLevel)) t.correct++;
    by.set(key, t);
  }
  return [...by.values()];
}

// The weakest skill: the lowest path level; among equals, the lowest recent
// practice accuracy (or level-test score where there's too little practice).
async function weakestSkill(userId: string, types: TypeAccuracy[]): Promise<SkillTag> {
  const placement = (await pool.query(`SELECT skill_percents FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  const levels = await pathSummary(userId);
  const accuracy = (skill: SkillTag) => {
    const t = types.filter((x) => x.skill === skill);
    const graded = t.reduce((n, x) => n + x.graded, 0);
    if (graded >= MIN_GRADED * 2) return t.reduce((n, x) => n + x.correct, 0) / graded;
    return (Number(placement?.skill_percents?.[skill] ?? 50) || 0) / 100;
  };
  const rank = (s: SkillTag) => LEVELS.indexOf(levels[s]);
  return SKILLS.reduce((weakest, s) => (rank(s) < rank(weakest) || (rank(s) === rank(weakest) && accuracy(s) < accuracy(weakest)) ? s : weakest));
}

export type NextStep =
  // The final assessment: its test to choose, or open and the mock tests reach the goal.
  | { kind: "final"; chooseTest: boolean }
  | { kind: "mock"; daysLeft: number }
  | { kind: "practice_test"; daysSince: number | null }
  // types: the question types of the 5 questions the retry set will hold.
  | { kind: "retry"; skill: SkillTag; count: number; types: string[] }
  | {
      kind: "set";
      skill: SkillTag;
      itemTypeId: string;
      typeName: string;
      unitId: string;
      unitName: string;
      setId: string;
      setName: string;
      level: string;
      // Every set at this level is done; this is a retake of the weakest.
      retake: boolean;
    };

// The single most useful thing to do now, by priority: a mock before the
// exam, a regular practice test, old mistakes, then the weakest question type.
export async function nextStep(userId: string): Promise<NextStep | null> {
  const goal = await goalStatus(userId);
  // Ready for the final assessment (it's open and the mocks reach the goal), or its test to choose.
  const r = await readiness(userId).catch(() => null);
  if (r?.final && !r.certificate) {
    if (r.final.chooseTest) return { kind: "final", chooseTest: true };
    if (r.final.unlock.state === "open" && (r.ready || (goal.daysLeft !== null && goal.daysLeft <= 7))) return { kind: "final", chooseTest: false };
  }
  const tests = (
    await pool.query(
      `SELECT delivery_mode, max(completed_at) AS last FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NOT NULL AND coalesce(composition->>'abandoned', 'false') <> 'true'
       GROUP BY delivery_mode`,
      [userId],
    )
  ).rows;
  const lastOf = (mode: string) => tests.find((t) => t.delivery_mode === mode)?.last as Date | undefined;
  const quota = await quotaUsage(userId).catch(() => null);
  const mocksLeft = !quota || quota.mocksPerMonth === null ? Infinity : quota.mocksPerMonth - quota.mocksUsed;
  const testsLeft = !quota || quota.practicePerMonth === null ? Infinity : quota.practicePerMonth - quota.practiceUsed;
  const daysSince = (d?: Date) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY_MS) : null);

  // A full mock in the last two weeks before the exam.
  if (goal.daysLeft !== null && goal.daysLeft <= 14 && mocksLeft > 0 && (daysSince(lastOf("mock")) ?? Infinity) > 7) {
    return { kind: "mock", daysLeft: goal.daysLeft };
  }

  const setsSinceTest = Number(
    (
      await pool.query(
        `SELECT count(*) FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NOT NULL AND composition->>'setId' IS NOT NULL AND completed_at > $2`,
        [userId, lastOf("practice") ?? new Date(0)],
      )
    ).rows[0].count,
  );
  // A practice test a week, once there's some practice since the last one.
  if (testsLeft > 0 && setsSinceTest >= 5 && (daysSince(lastOf("practice")) ?? Infinity) >= 7) {
    return { kind: "practice_test", daysSince: daysSince(lastOf("practice")) };
  }

  const retry = await retryCounts(userId);
  const retrySkill = SKILLS.reduce((a, b) => (retry[b] > retry[a] ? b : a));
  if (retry[retrySkill] >= RETRY_SET_SIZE) {
    const ids = (await retryItems(userId, retrySkill)).slice(0, RETRY_SET_SIZE).map((x) => x.itemId);
    const types = (
      await pool.query(`SELECT DISTINCT it.name FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.id = ANY($1::uuid[]) ORDER BY it.name`, [ids])
    ).rows.map((r) => r.name as string);
    return { kind: "retry", skill: retrySkill, count: retry[retrySkill], types };
  }

  // Otherwise the next set on the weakest skill's path.
  const skill = await weakestSkill(userId, await recentTypeAccuracy(userId));
  const next = (await skillPath(userId, skill)).next;
  return next
    ? { kind: "set", skill, itemTypeId: next.itemTypeId, typeName: next.typeName, unitId: next.unitId, unitName: next.unitName, setId: next.setId, setName: next.setName, level: next.level, retake: next.retake }
    : null;
}
