// What the app knows about a learner's practice, turned into guidance: are
// they on pace for their goal date, which questions to retry, and the one
// thing to do next. Rules over their own data, no AI call.
import { pool } from "../db.js";
import { dateOnly } from "../lib/dateOnly.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { quotaUsage } from "../programs/quotas.js";
import type { SkillTag } from "../gamification/stats.js";

const SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const DAY_MS = 86_400_000;

// Wrong answers come back after this long, not straight away.
const RETRY_AFTER_HOURS = 12;
export const RETRY_SET_SIZE = 5;
// A recent-accuracy figure needs at least this many graded answers.
const MIN_GRADED = 4;
// Two finished sets in a row at or above / at or below these move the level.
export const LEVEL_UP_ACCURACY = 0.8;
export const LEVEL_DOWN_ACCURACY = 0.4;

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

// The weakest skill: lowest recent practice accuracy where there's enough
// evidence, otherwise the lowest skill from the latest level test.
async function weakestSkill(userId: string, types: TypeAccuracy[]): Promise<SkillTag> {
  const placement = (await pool.query(`SELECT skill_percents FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  const score = (skill: SkillTag) => {
    const t = types.filter((x) => x.skill === skill);
    const graded = t.reduce((n, x) => n + x.graded, 0);
    if (graded >= MIN_GRADED * 2) return t.reduce((n, x) => n + x.correct, 0) / graded;
    return (Number(placement?.skill_percents?.[skill] ?? 50) || 0) / 100;
  };
  return SKILLS.reduce((weakest, s) => (score(s) < score(weakest) ? s : weakest));
}

// Units of a type, in level order.
async function typeUnits(itemTypeId: string) {
  return (await pool.query(`SELECT id, name, order_index FROM units WHERE item_type_id = $1 ORDER BY order_index`, [itemTypeId])).rows as {
    id: string;
    name: string;
    order_index: number;
  }[];
}

// Share right in a finished practice session (skipped counts as wrong).
async function sessionAccuracy(sessionId: string, total: number): Promise<number> {
  const r = await pool.query(
    `SELECT sc.content_score, sc.manner_scores, i.cefr_level, it.input_method
     FROM attempts a JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored'
     JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
     WHERE a.session_id = $1`,
    [sessionId],
  );
  const right = r.rows.filter((x) => isTrulyCorrect(Number(x.content_score), x.cefr_level, x.input_method, x.manner_scores, passThresholdForLevel)).length;
  return total > 0 ? right / total : 0;
}

export interface LevelSuggestion {
  direction: "up" | "down";
  unitId: string;
  unitName: string;
}

// Two finished sets in a row of one type and skill, both in the same level,
// both strong (or both weak): suggest the next level up (or down).
export async function levelSuggestion(userId: string, itemTypeId: string, skill: string): Promise<LevelSuggestion | null> {
  const last = (
    await pool.query(
      `SELECT se.id, jsonb_array_length(se.composition->'itemIds') AS total, st.unit_id
       FROM sessions se JOIN sets st ON st.id::text = se.composition->>'setId' JOIN units u ON u.id = st.unit_id
       WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
         AND u.item_type_id = $2 AND se.composition->>'skill' = $3
       ORDER BY se.completed_at DESC LIMIT 2`,
      [userId, itemTypeId, skill],
    )
  ).rows;
  if (last.length < 2 || last[0].unit_id !== last[1].unit_id) return null;
  const acc = await Promise.all(last.map((x) => sessionAccuracy(x.id, Number(x.total))));
  const direction = acc.every((a) => a >= LEVEL_UP_ACCURACY) ? "up" : acc.every((a) => a <= LEVEL_DOWN_ACCURACY) ? "down" : null;
  if (!direction) return null;
  const units = await typeUnits(itemTypeId);
  const at = units.findIndex((u) => u.id === last[0].unit_id);
  const target = units[at + (direction === "up" ? 1 : -1)];
  return target ? { direction, unitId: target.id, unitName: target.name } : null;
}

// The level a learner works at in one type: where their latest set of it
// was (moved by the up/down rule), else their level-test level.
async function workingUnit(userId: string, itemTypeId: string, skill: SkillTag) {
  const units = await typeUnits(itemTypeId);
  if (!units.length) return null;
  const suggestion = await levelSuggestion(userId, itemTypeId, skill);
  if (suggestion) return units.find((u) => u.id === suggestion.unitId) ?? null;
  const last = (
    await pool.query(
      `SELECT st.unit_id FROM sessions se JOIN sets st ON st.id::text = se.composition->>'setId' JOIN units u ON u.id = st.unit_id
       WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND u.item_type_id = $2 AND se.composition->>'skill' = $3
       ORDER BY se.completed_at DESC LIMIT 1`,
      [userId, itemTypeId, skill],
    )
  ).rows[0];
  if (last) return units.find((u) => u.id === last.unit_id) ?? units[0];
  const level = (await pool.query(`SELECT cefr_level, skill_levels FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  const cefr: string = level?.skill_levels?.[skill] ?? level?.cefr_level ?? "A1";
  return units.find((u) => u.name.startsWith(cefr)) ?? units[0];
}

// First set of a unit (for this skill) the learner hasn't finished.
async function nextSetIn(userId: string, unitId: string, skill: SkillTag) {
  return (
    await pool.query(
      `SELECT st.id, st.name FROM sets st
       WHERE st.unit_id = $1
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $2))
         AND NOT EXISTS (SELECT 1 FROM sessions se WHERE se.user_id = $3 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND se.composition->>'setId' = st.id::text)
       ORDER BY st.order_index LIMIT 1`,
      [unitId, skill, userId],
    )
  ).rows[0] as { id: string; name: string } | undefined;
}

export type NextStep =
  | { kind: "mock"; daysLeft: number }
  | { kind: "practice_test"; daysSince: number | null }
  | { kind: "retry"; skill: SkillTag; count: number }
  | {
      kind: "set";
      skill: SkillTag;
      itemTypeId: string;
      typeName: string;
      unitId: string;
      unitName: string;
      setId: string;
      setName: string;
      // Why this one: the learner's weak spot, or a type not tried yet.
      why: "weak_type" | "untried_type" | "keep_going";
      accuracy: number | null;
    };

// The single most useful thing to do now, by priority: a mock before the
// exam, a regular practice test, old mistakes, then the weakest question type.
export async function nextStep(userId: string): Promise<NextStep | null> {
  const goal = await goalStatus(userId);
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
  if (retry[retrySkill] >= RETRY_SET_SIZE) return { kind: "retry", skill: retrySkill, count: retry[retrySkill] };

  const types = await recentTypeAccuracy(userId);
  const skill = await weakestSkill(userId, types);
  const skillTypes = (
    await pool.query(
      `SELECT DISTINCT it.id, it.name FROM item_types it JOIN units u ON u.item_type_id = it.id JOIN sets st ON st.unit_id = u.id
       WHERE $1 = ANY(it.skills) AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $1))
       ORDER BY it.name`,
      [skill],
    )
  ).rows as { id: string; name: string }[];
  const tried = types.filter((t) => t.skill === skill && t.graded >= MIN_GRADED).sort((a, b) => a.correct / a.graded - b.correct / b.graded);
  const untried = skillTypes.filter((t) => !types.some((x) => x.skill === skill && x.itemTypeId === t.id));
  const weak = tried.find((t) => t.correct / t.graded < 0.7);
  const order: { id: string; name: string; why: "weak_type" | "untried_type" | "keep_going"; accuracy: number | null }[] = [
    ...(weak ? [{ id: weak.itemTypeId, name: weak.typeName, why: "weak_type" as const, accuracy: weak.correct / weak.graded }] : []),
    ...untried.map((t) => ({ id: t.id, name: t.name, why: "untried_type" as const, accuracy: null })),
    ...tried.map((t) => ({ id: t.itemTypeId, name: t.typeName, why: "keep_going" as const, accuracy: t.correct / t.graded })),
  ];
  for (const t of order) {
    const unit = await workingUnit(userId, t.id, skill);
    if (!unit) continue;
    const set = await nextSetIn(userId, unit.id, skill);
    if (!set) continue;
    return {
      kind: "set",
      skill,
      itemTypeId: t.id,
      typeName: t.name,
      unitId: unit.id,
      unitName: unit.name,
      setId: set.id,
      setName: set.name,
      why: t.why,
      accuracy: t.accuracy === null ? null : Math.round(t.accuracy * 100),
    };
  }
  return null;
}
