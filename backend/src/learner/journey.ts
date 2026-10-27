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
import { mockAllowance, quotaUsage, testTypesPreparing } from "../programs/quotas.js";
import { scheduleTests, type Slot } from "./testSchedule.js";
import { learnerProgram } from "../programs/service.js";
import { myTests, readiness } from "../assessment/service.js";
import { learnerAccess } from "../licenses/service.js";

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
  kind: "sets" | "practice_test" | "retry" | "level_check" | "mock" | "final" | "final_choose";
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
  // Past tests come first (done, with their level), then today and the plan.
  checkpoints: {
    date: string;
    kind: "practice_test" | "level_check" | "mock" | "exam" | "today" | "final" | "certificate";
    done: boolean;
    // The final assessment: open now, or still to get (no plan includes one yet);
    // needsMock: it opens after a mock test and none is planned before it.
    open?: boolean;
    needsMock?: boolean;
    toGet?: boolean;
    // A certificate: its code (for the link).
    code?: string;
    skill?: SkillTag;
    level?: string;
    // A mock placed on the day new mocks arrive.
    onReset?: boolean;
    // Past tests: attempts that day.
    attempts?: number;
  }[];
  nextStep: NextStep | null;
  // Where the test plan comes from: the organization's program, or the plan's allowance.
  planSource: { kind: "program"; name: string } | { kind: "allowance"; practicePerMonth: number | null; mocksPerMonth: number | null; mocksPerTestType?: boolean };
}

// The final assessment's place in the plan: a certificate already earned, an
// attempt still to take (open or when it opens), or none in the plan.
async function finalAssessmentState(userId: string) {
  const tests = await myTests(userId).catch(() => []);
  const pending = tests.find((t) => t.kind !== "level" && t.attemptsLeft > 0 && t.unlock.state !== "expired");
  const taken = tests.some((t) => t.kind !== "level" && t.attempts.length > 0);
  const c = (
    await pool.query(
      `SELECT code, cefr_level, spica_score, issued_at FROM certificates WHERE user_id = $1 AND kind = 'result' AND revoked_at IS NULL
         AND (valid_until IS NULL OR valid_until >= current_date) ORDER BY issued_at DESC LIMIT 1`,
      [userId],
    )
  ).rows[0];
  return {
    certificate: c ? { code: c.code as string, issuedAt: c.issued_at as Date, label: [c.cefr_level, c.spica_score].filter((x) => x !== null && x !== undefined).join(" · ") } : null,
    pending: pending
      ? {
          open: pending.unlock.state === "open" && !pending.chooseTest,
          chooseTest: pending.chooseTest,
          opensOn: "opensOn" in pending.unlock ? dateOnly(new Date(pending.unlock.opensOn)) : null,
        }
      : null,
    taken,
  };
}

export async function journey(userId: string): Promise<Journey> {
  const goal = await goalStatus(userId);
  const fa = await finalAssessmentState(userId);
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
  // The final assessment ends the plan: once it's taken (certified, or still
  // being scored or reviewed) with no new one to take, no practice test is asked for.
  const planOver = !fa.pending && (!!fa.certificate || fa.taken);
  if (!planOver) week.push({ id: "practice_test", kind: "practice_test", done: practiceDone, href: "/practice-tests" });

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

  // --- Test plan: weekly practice tests with mocks spaced by the allowance ---
  const lastMock = lastOf("mock");
  const examDate = goal.examDate;
  const quota = await quotaUsage(userId).catch(() => null);
  // Full access counts mocks per test type: the plan has them for each test the learner prepares for.
  const mocks = mockAllowance(quota, quota?.mocksPerTestType ? await testTypesPreparing(userId).catch(() => []) : []);
  // An organization's program sets the dates itself; otherwise the plan's
  // monthly allowance spaces the tests.
  const program = await learnerProgram(userId).catch(() => null);
  // No test is planned after access ends.
  const access = await learnerAccess(userId).catch(() => null);
  const slots: Slot[] = program?.upcoming.length
    ? program.upcoming.map((x) => ({ date: new Date(x.dueOn), kind: x.kind === "mock" ? ("mock" as const) : ("practice_test" as const) }))
    : scheduleTests({
        today: new Date(),
        examDate: examDate ? new Date(examDate) : null,
        lastPractice: lastPractice ? new Date(lastPractice) : null,
        lastMock: lastMock ? new Date(lastMock) : null,
        mocksPerMonth: mocks.perMonth,
        mocksLeft: mocks.left,
        practicePerMonth: quota ? quota.practicePerMonth : null,
        practiceLeft: quota && quota.practicePerMonth !== null ? Math.max(0, quota.practicePerMonth - quota.practiceUsed) : null,
        resetsOn: quota ? new Date(quota.resetsOn) : null,
        accessEnds: access?.accessEndsAt && access.status === "active" ? new Date(access.accessEndsAt) : null,
      });

  // --- The plan ends with the final assessment: no practice or mock test after it ---
  // Its day: today when it's open and the mock tests reach the goal; otherwise
  // the end of the plan (the exam day, the program's final assessment day, or
  // the day it opens anyway), or after the last planned test when none of those
  // is set. A new final assessment to take (say Full access was renewed) is
  // planned the same way, even after an older certificate. Once taken (still
  // being scored, under review or void) or certified with none left to take,
  // the plan ends today: nothing more is planned.
  const todayDate = dateOnly(new Date());
  const ready = await readiness(userId).catch(() => null);
  const lastSlot = slots.length ? dateOnly(slots[slots.length - 1].date) : null;
  let finalDate: string | null = null;
  if (fa.pending) {
    if (fa.pending.open && ready?.ready) finalDate = todayDate;
    else {
      const programDay = program?.program.finalAssessment ? (program.program.finalAssessmentOn ?? null) : null;
      const set = [examDate, programDay].filter((x): x is string => !!x && x >= todayDate).sort();
      const opensOn = fa.pending.open ? null : (fa.pending.opensOn ?? null);
      if (set.length) {
        finalDate = [set[0], opensOn].filter((x): x is string => !!x && x >= todayDate).sort()[0];
      } else {
        // No exam or program day: after the planned tests (the day after the
        // last one), and not before the final assessment opens.
        const afterTests = lastSlot ? dateOnly(new Date(new Date(lastSlot).getTime() + DAY_MS)) : todayDate;
        finalDate = opensOn && opensOn > afterTests ? opensOn : afterTests;
      }
    }
  } else if (!planOver) {
    finalDate = examDate && examDate >= todayDate ? examDate : (lastSlot ?? todayDate);
  }
  const planEnd = planOver ? todayDate : finalDate;
  if (planEnd) slots.splice(0, slots.length, ...slots.filter((s) => dateOnly(s.date) <= planEnd));

  // This week's mock (when one falls in the next 7 days), or one just done.
  const mockDoneThisWeek = !!lastMock && Date.now() - new Date(lastMock).getTime() < 7 * DAY_MS;
  const nextMock = slots.find((x) => x.kind === "mock");
  if (mockDoneThisWeek || (nextMock && nextMock.date.getTime() - Date.now() < 7 * DAY_MS)) {
    week.push({
      id: "mock",
      kind: "mock",
      done: mockDoneThisWeek,
      date: nextMock ? dateOnly(nextMock.date) : undefined,
      count: mocks.left ?? undefined,
      target: quota ? (mocks.perMonth ?? undefined) : undefined,
      href: "/mock-exams",
    });
  }

  // --- Checkpoints: recent tests (with their level), today, the plan, exam day ---
  // The last two test days (several attempts on one day are one point).
  const pastRows = (
    await pool.query(
      `SELECT delivery_mode, completed_at, result->>'cefrLevel' AS level FROM sessions
       WHERE user_id = $1 AND session_type = 'mocktest' AND completed_at IS NOT NULL AND coalesce(composition->>'abandoned', 'false') <> 'true'
       ORDER BY completed_at DESC LIMIT 20`,
      [userId],
    )
  ).rows;
  const pastGroups: Journey["checkpoints"] = [];
  for (const t of pastRows) {
    const date = dateOnly(new Date(t.completed_at));
    const kind = t.delivery_mode === "mock" ? ("mock" as const) : ("practice_test" as const);
    const same = pastGroups.find((g) => g.date === date && g.kind === kind);
    if (same) same.attempts = (same.attempts ?? 1) + 1;
    else if (pastGroups.length < 2) pastGroups.push({ date, kind, done: true, level: t.level ?? undefined, attempts: 1 });
  }
  const checkpoints: Journey["checkpoints"] = pastGroups.reverse();
  checkpoints.push({ date: dateOnly(new Date()), kind: "today", done: true });
  for (const t of week.filter((x) => x.kind === "level_check" && !x.done)) checkpoints.push({ date: dateOnly(new Date()), kind: "level_check", done: false, skill: t.skill });
  for (const slot of slots) checkpoints.push({ date: dateOnly(slot.date), kind: slot.kind, done: false, onReset: slot.onReset });
  if (examDate) checkpoints.push({ date: examDate, kind: "exam", done: false });

  // --- The end of the plan: the final assessment, then the certificate ---
  if (fa.certificate) {
    checkpoints.push({ date: dateOnly(new Date(fa.certificate.issuedAt)), kind: "certificate", done: true, level: fa.certificate.label, code: fa.certificate.code });
  }
  if (finalDate && fa.pending) {
    const mockBefore = slots.some((s) => s.kind === "mock" && dateOnly(s.date) <= finalDate!);
    checkpoints.push({ date: finalDate, kind: "final", done: false, open: fa.pending.open, needsMock: !fa.pending.open && !mockBefore && fa.pending.opensOn !== null && fa.pending.opensOn > finalDate });
    checkpoints.push({ date: finalDate, kind: "certificate", done: false });
  } else if (finalDate) {
    // Not in the learner's plan yet: shown at the end, to get one.
    checkpoints.push({ date: finalDate, kind: "final", done: false, toGet: true });
    checkpoints.push({ date: finalDate, kind: "certificate", done: false, toGet: true });
  }
  if (fa.pending?.open || fa.pending?.chooseTest) {
    week.push({ id: "final", kind: fa.pending.chooseTest ? "final_choose" : "final", done: false, href: "/assessment" });
  }
  // In date order; on the same day, done tests, then today, then what's next, the
  // exam, the final assessment and its certificate last.
  const order = (c: (typeof checkpoints)[number]) =>
    c.done && c.kind !== "today" && c.kind !== "certificate" ? 0 : c.kind === "today" ? 1 : c.kind === "final" ? 4 : c.kind === "certificate" ? 5 : c.kind === "exam" ? 3 : 2;
  checkpoints.sort((a, b) => a.date.localeCompare(b.date) || order(a) - order(b));

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
    planSource: program?.upcoming.length
      ? { kind: "program", name: program.program.name }
      : { kind: "allowance", practicePerMonth: quota?.practicePerMonth ?? null, mocksPerMonth: quota?.mocksPerMonth ?? null, mocksPerTestType: quota?.mocksPerTestType ?? false },
  };
}
