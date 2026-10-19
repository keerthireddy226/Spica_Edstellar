// "My journey": the learner's whole plan in one place, from the same sources
// as everywhere else (Practice Modules path, tests, goal and exam date):
// real progress to the goal, the levels still to reach with each skill's
// progress, this week's tasks (ticked off by what's been done) and the
// checkpoints up to the exam.
import { pool } from "../db.js";
import type { SkillTag } from "../gamification/stats.js";
import { dateOnly } from "../lib/dateOnly.js";
import { goalStatus, nextStep, retryCounts, type GoalStatus, type NextStep } from "./insights.js";
import { LEVELS, PASS_SETS, overallFromSkills, skillPath, type Level, type SkillPath } from "./path.js";

const SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const DAY_MS = 86_400_000;
const rank = (l: string | null | undefined) => (l ? LEVELS.indexOf(l as Level) : -1);
// About ten minutes per set of five questions.
const MINUTES_PER_SET = 10;

// Level-test skill levels were stored as "B1" or { level: "B1" }.
function levelOf(raw: unknown): Level | null {
  const v = typeof raw === "object" && raw !== null ? (raw as { level?: unknown }).level : raw;
  return typeof v === "string" && rank(v) >= 0 ? (v as Level) : null;
}

// How far through its current level a skill is: the share of the sets needed
// to pass it that its question types have done (0-1).
function partWay(path: SkillPath): number {
  const atLevel = path.types.filter((t) => t.level === path.level);
  if (!atLevel.length) return 0;
  return atLevel.reduce((n, t) => n + Math.min(1, t.setsDone / Math.max(1, Math.min(PASS_SETS, t.setsTotal))), 0) / atLevel.length;
}

export interface JourneyTask {
  id: string;
  kind: "sets" | "practice_test" | "retry" | "level_check" | "mock";
  done: boolean;
  // For the screen to word: counts, skill, date.
  count?: number;
  target?: number;
  skill?: SkillTag;
  date?: string;
  href: string;
}

export interface Journey {
  current: Level | null;
  goal: Level | null;
  startLevel: Level | null;
  goalReached: boolean;
  examDate: string | null;
  daysLeft: number | null;
  pace: GoalStatus["pace"];
  minutesPerDay: number | null;
  progressPercent: number;
  skills: { skill: SkillTag; level: Level; startLevel: Level | null; progressPercent: number; partWay: number }[];
  steps: { level: Level; skills: { skill: SkillTag; state: "done" | "now" | "later"; partWay: number }[] }[];
  week: JourneyTask[];
  checkpoints: { date: string; kind: "practice_test" | "level_check" | "mock" | "exam" | "today"; done: boolean; skill?: SkillTag }[];
  nextStep: NextStep | null;
}

export async function journey(userId: string): Promise<Journey> {
  const goal = await goalStatus(userId);
  const placement = (await pool.query(`SELECT cefr_level, skill_levels FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  const paths = await Promise.all(SKILLS.map((s) => skillPath(userId, s)));
  const levels = Object.fromEntries(paths.map((p) => [p.skill, p.level])) as Record<SkillTag, Level>;
  const current = overallFromSkills(levels);
  const target: Level | null = (goal.goalLevel as Level | null) ?? (current ? LEVELS[Math.min(5, rank(current) + 1)] : null);
  const startLevel = levelOf(placement?.cefr_level);

  // Progress per skill: levels gained since the level test (plus the way
  // through the current one) out of the levels between it and the goal.
  const skills = paths.map((p) => {
    const start = levelOf(placement?.skill_levels?.[p.skill]) ?? startLevel;
    const from = rank(start ?? p.level);
    const to = rank(target);
    const way = partWay(p);
    const pct = to <= from ? 100 : Math.max(0, Math.min(100, Math.round(((rank(p.level) - from + (rank(p.level) < to ? way : 0)) / (to - from)) * 100)));
    return { skill: p.skill, level: p.level, startLevel: start, progressPercent: rank(p.level) >= to ? 100 : pct, partWay: Math.round(way * 100) / 100 };
  });
  const progressPercent = skills.length ? Math.round(skills.reduce((n, s) => n + s.progressPercent, 0) / skills.length) : 0;
  const goalReached = !!target && skills.every((s) => rank(s.level) >= rank(target));

  // The levels still to reach, each with every skill's state.
  const lowest = Math.min(...skills.map((s) => rank(s.level)));
  const steps = target
    ? LEVELS.filter((l) => rank(l) > lowest && rank(l) <= rank(target)).map((level) => ({
        level,
        skills: skills.map((s) => ({
          skill: s.skill,
          state: (rank(s.level) >= rank(level) ? "done" : rank(s.level) === rank(level) - 1 ? "now" : "later") as "done" | "now" | "later",
          partWay: rank(s.level) === rank(level) - 1 ? s.partWay : rank(s.level) >= rank(level) ? 1 : 0,
        })),
      }))
    : [];

  // --- This week ---
  const week: JourneyTask[] = [];
  const setsPerDay = Math.max(1, Math.min(6, Math.round((goal.minutesPerDay ?? 30) / MINUTES_PER_SET)));
  const today = Number(
    (
      await pool.query(
        `SELECT count(*) FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND completed_at >= date_trunc('day', now())
           AND (composition->>'setId' IS NOT NULL OR composition->>'retry' = 'true')`,
        [userId],
      )
    ).rows[0].count,
  );
  week.push({ id: "sets", kind: "sets", done: today >= setsPerDay, count: today, target: setsPerDay, href: "/modules" });

  const tests = (
    await pool.query(
      `SELECT delivery_mode, max(completed_at) AS last FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NOT NULL AND coalesce(composition->>'abandoned', 'false') <> 'true'
       GROUP BY delivery_mode`,
      [userId],
    )
  ).rows;
  const lastOf = (mode: string): Date | null => tests.find((t) => t.delivery_mode === mode)?.last ?? null;
  const lastPractice = lastOf("practice");
  const practiceDone = !!lastPractice && Date.now() - new Date(lastPractice).getTime() < 7 * DAY_MS;
  week.push({ id: "practice_test", kind: "practice_test", done: practiceDone, href: "/practice-tests" });

  const retry = await retryCounts(userId);
  const retrySkill = SKILLS.reduce((a, b) => (retry[b] > retry[a] ? b : a));
  if (retry[retrySkill] >= 5) week.push({ id: "retry", kind: "retry", done: false, count: retry[retrySkill], skill: retrySkill, href: `/modules?skill=${retrySkill}&retry=1` });

  // Skills a test showed lower than the path, with no level check since.
  const flagged = (
    await pool.query(
      `SELECT completed_at, result->'pathCompare' AS pc FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NOT NULL AND result ? 'pathCompare'
       ORDER BY completed_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (flagged?.pc) {
    for (const skill of SKILLS) {
      if (flagged.pc[skill]?.action !== "below") continue;
      const checked = (
        await pool.query(
          `SELECT 1 FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND completed_at > $2 AND composition->>'check' = 'true' AND composition->>'skill' = $3 LIMIT 1`,
          [userId, flagged.completed_at, skill],
        )
      ).rowCount;
      week.push({ id: `check_${skill}`, kind: "level_check", done: !!checked, skill, href: `/modules?skill=${skill}&check=1` });
    }
  }

  // A full mock a week before the exam (or one this month without a date).
  const lastMock = lastOf("mock");
  const examDate = goal.examDate;
  const mockDue = examDate ? new Date(new Date(examDate).getTime() - 7 * DAY_MS) : null;
  const mockDone = mockDue
    ? !!lastMock && new Date(lastMock).getTime() > mockDue.getTime() - 21 * DAY_MS
    : !!lastMock && new Date(lastMock).getMonth() === new Date().getMonth() && new Date(lastMock).getFullYear() === new Date().getFullYear();
  if (!mockDue || mockDue.getTime() - Date.now() < 21 * DAY_MS) {
    week.push({ id: "mock", kind: "mock", done: mockDone, date: mockDue ? dateOnly(mockDue) : undefined, href: "/mock-exams" });
  }

  // --- Checkpoints up to the exam ---
  const checkpoints: Journey["checkpoints"] = [{ date: dateOnly(new Date()), kind: "today", done: true }];
  const nextPractice = practiceDone ? new Date(new Date(lastPractice!).getTime() + 7 * DAY_MS) : new Date();
  const until = examDate ? new Date(examDate).getTime() : Date.now() + 28 * DAY_MS;
  for (let d = nextPractice.getTime(), n = 0; d < until && n < 4; d += 7 * DAY_MS, n++) {
    checkpoints.push({ date: dateOnly(new Date(d)), kind: "practice_test", done: false });
  }
  for (const t of week.filter((x) => x.kind === "level_check" && !x.done)) checkpoints.push({ date: dateOnly(new Date()), kind: "level_check", done: false, skill: t.skill });
  if (mockDue) checkpoints.push({ date: dateOnly(mockDue), kind: "mock", done: mockDone });
  if (examDate) checkpoints.push({ date: examDate, kind: "exam", done: false });
  checkpoints.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "today" ? -1 : b.kind === "today" ? 1 : 0));

  return {
    current,
    goal: target,
    startLevel,
    goalReached,
    examDate,
    daysLeft: goal.daysLeft,
    pace: goal.pace,
    minutesPerDay: goal.minutesPerDay,
    progressPercent: goalReached ? 100 : progressPercent,
    skills,
    steps,
    week,
    checkpoints,
    nextStep: await nextStep(userId),
  };
}
