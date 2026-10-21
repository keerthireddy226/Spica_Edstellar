// Tutor (Coach Mode) memory — a short, facts-only summary of the learner that
// rides along in the system instruction so the tutor's help is personal.
// Read-only over existing tables; nothing here is AI-generated or persisted.
import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { ALL_SKILLS, computeStreakDays, type SkillTag } from "../gamification/stats.js";

const RECENT_DAYS = 30;
// Below this many graded answers a skill/type percentage is noise, not a fact.
const MIN_GRADED_SKILL = 3;
const MIN_GRADED_TYPE = 4;
const MAX_WEAK_TYPES = 3;
// A type only counts as "weak" when the learner is actually missing it.
const WEAK_TYPE_MAX_ACCURACY = 70;

export interface LearnerFacts {
  firstName: string | null;
  currentLevel: string | null;
  goalLevel: string | null;
  targetExam: string | null;
  examReason: string | null;
  examDate: string | null; // YYYY-MM-DD
  examDaysLeft: number | null;
  dailyMinutes: number | null;
  streakDays: number;
  skillAccuracy: Partial<Record<SkillTag, { correct: number; graded: number }>>;
  weakTypes: { name: string; accuracy: number; graded: number }[];
  lastTest: {
    kind: "practice test" | "mock test";
    testName: string | null;
    date: string; // YYYY-MM-DD
    level: string | null;
    percent: number | null;
  } | null;
}

const EXAM_LABELS: Record<string, string> = {
  versant: "Spica English certificate",
  ielts: "IELTS",
  toefl: "TOEFL",
  pte: "PTE",
  cambridge: "Cambridge",
};

const REASON_LABELS: Record<string, string> = {
  university: "university admission",
  job: "a job",
  immigration: "immigration",
  promotion: "a promotion",
  personal: "personal growth",
};

const pct = (correct: number, graded: number) => Math.round((correct / graded) * 100);

// Pure — every line is optional, so missing data just drops its line.
export function formatLearnerContext(f: LearnerFacts): string {
  const lines: string[] = [];
  if (f.firstName) lines.push(`First name: ${f.firstName}.`);

  const level: string[] = [];
  if (f.currentLevel) level.push(`Current CEFR level: ${f.currentLevel} (latest placement)`);
  if (f.goalLevel) level.push(`goal level: ${f.goalLevel}`);
  if (level.length) lines.push(`${level.join("; ")}.`);

  const exam: string[] = [];
  if (f.targetExam) exam.push(`Preparing for ${f.targetExam}`);
  if (f.examReason) exam.push(`${exam.length ? "for" : "Studying English for"} ${f.examReason}`);
  if (exam.length) lines.push(`${exam.join(" ")}.`);

  if (f.examDate && f.examDaysLeft != null && f.examDaysLeft >= 0) {
    lines.push(`Exam date: ${f.examDate} (${f.examDaysLeft} day${f.examDaysLeft === 1 ? "" : "s"} left).`);
  }
  if (f.dailyMinutes) lines.push(`Plans to practise ${f.dailyMinutes} minutes a day.`);
  if (f.streakDays > 0) lines.push(`Practice streak: ${f.streakDays} day${f.streakDays === 1 ? "" : "s"}.`);

  const skills = ALL_SKILLS.flatMap((s) => {
    const a = f.skillAccuracy[s];
    return a && a.graded >= MIN_GRADED_SKILL ? [`${s} ${pct(a.correct, a.graded)}%`] : [];
  });
  if (skills.length) lines.push(`Accuracy by skill (last ${RECENT_DAYS} days of practice): ${skills.join(", ")}.`);

  if (f.weakTypes.length) {
    const weak = f.weakTypes.map((t) => `${t.name} (${t.accuracy}% of ${t.graded})`).join(", ");
    lines.push(`Weakest question types recently: ${weak}.`);
  }

  if (f.lastTest) {
    const t = f.lastTest;
    const what = `Last ${t.kind}${t.testName ? ` (${t.testName})` : ""} on ${t.date}`;
    const result: string[] = [];
    if (t.level) result.push(`estimated level ${t.level}`);
    if (t.percent != null) result.push(`${t.percent}% overall`);
    lines.push(result.length ? `${what}: ${result.join(", ")}.` : `${what}.`);
  }

  return lines.join("\n");
}

async function loadLearnerFacts(userId: string): Promise<LearnerFacts> {
  const [profile, placement, streak, graded, lastTest] = await Promise.all([
    pool.query(
      `SELECT u.first_name, pp.goal_level, pp.exam_preference, pp.exam_reason, pp.daily_minutes_preference,
         pp.exam_date::text AS exam_date, (pp.exam_date - current_date) AS exam_days_left, b.target_cefr
       FROM users u
       LEFT JOIN participant_profiles pp ON pp.user_id = u.id
       LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT cefr_level FROM placements WHERE user_id = $1 AND status <> 'fraud_confirmed'
       ORDER BY taken_at DESC LIMIT 1`,
      [userId],
    ),
    pool.query(
      `SELECT DISTINCT to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM sessions
       WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NOT NULL`,
      [userId],
    ),
    pool.query(
      `SELECT sc.content_score, sc.manner_scores, i.cefr_level, it.id AS type_id, it.name AS type_name,
         it.input_method, it.skills
       FROM attempts a
       JOIN sessions s ON s.id = a.session_id
       JOIN scores sc ON sc.attempt_id = a.id
       JOIN items i ON i.id = a.item_id
       JOIN item_types it ON it.id = i.item_type_id
       WHERE s.user_id = $1 AND s.session_type = 'practice' AND sc.status = 'scored'
         AND a.submitted_at >= now() - make_interval(days => $2)`,
      [userId, RECENT_DAYS],
    ),
    // Same visibility rules as the practice-tests history endpoint.
    pool.query(
      `SELECT s.delivery_mode, to_char(s.completed_at, 'YYYY-MM-DD') AS day, s.result, tt.name AS test_name
       FROM sessions s
       LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       LEFT JOIN test_types tt ON tt.id = coalesce(s.composition->>'testTypeId', e.test_type_id)
       LEFT JOIN exam_families f ON f.id = tt.family_id
       WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.completed_at IS NOT NULL
         AND coalesce(s.composition->>'abandoned', 'false') <> 'true'
         AND coalesce(f.active, true)
       ORDER BY s.completed_at DESC LIMIT 1`,
      [userId],
    ),
  ]);

  const p = profile.rows[0] ?? {};
  const goal = p.goal_level && p.goal_level !== "unsure" ? p.goal_level : (p.target_cefr ?? null);

  const skillAccuracy: LearnerFacts["skillAccuracy"] = {};
  const byType = new Map<string, { name: string; correct: number; graded: number }>();
  for (const r of graded.rows) {
    const correct = isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
    for (const skill of r.skills as SkillTag[]) {
      const a = (skillAccuracy[skill] ??= { correct: 0, graded: 0 });
      a.graded++;
      if (correct) a.correct++;
    }
    const t = byType.get(r.type_id) ?? { name: r.type_name, correct: 0, graded: 0 };
    t.graded++;
    if (correct) t.correct++;
    byType.set(r.type_id, t);
  }
  const weakTypes = [...byType.values()]
    .filter((t) => t.graded >= MIN_GRADED_TYPE)
    .map((t) => ({ name: t.name, accuracy: pct(t.correct, t.graded), graded: t.graded }))
    .filter((t) => t.accuracy < WEAK_TYPE_MAX_ACCURACY)
    .sort((a, b) => a.accuracy - b.accuracy || b.graded - a.graded)
    .slice(0, MAX_WEAK_TYPES);

  const lt = lastTest.rows[0];
  return {
    firstName: p.first_name?.trim() || null,
    currentLevel: placement.rows[0]?.cefr_level ?? null,
    goalLevel: goal,
    // Only Versant is offered for now (other exams are hidden), so only it is named.
    targetExam: p.exam_preference === "versant" ? (EXAM_LABELS[p.exam_preference] ?? null) : null,
    examReason: REASON_LABELS[p.exam_reason] ?? null,
    examDate: p.exam_date ?? null,
    examDaysLeft: p.exam_days_left ?? null,
    dailyMinutes: p.daily_minutes_preference ?? null,
    streakDays: computeStreakDays(streak.rows.map((r) => r.day)),
    skillAccuracy,
    weakTypes,
    lastTest: lt
      ? {
          kind: lt.delivery_mode === "mock" ? "mock test" : "practice test",
          testName: lt.test_name ?? null,
          date: lt.day,
          level: lt.result?.cefrLevel ?? null,
          percent: lt.result?.overallPercent ?? null,
        }
      : null,
  };
}

// Each chat turn reuses the block instead of re-running five queries.
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 5000;
const cache = new Map<string, { text: string; at: number }>();

export async function learnerContext(userId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.text;

  const text = formatLearnerContext(await loadLearnerFacts(userId));
  if (cache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  }
  cache.set(userId, { text, at: now });
  return text;
}
