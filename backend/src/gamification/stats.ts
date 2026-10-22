// Shared by the dashboard (read) and session-completion (write) paths, so
// both always agree on the same numbers — no second copy of this logic.
import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";

export type SkillTag = "listening" | "speaking" | "reading" | "writing";
export const ALL_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];

// A skill counts "mastered" once there's real evidence (not one lucky
// question) and it clears a real bar — same shape as the CEFR pass bars
// elsewhere, deliberately never gated on time spent or session count.
const MASTERY_MIN_GRADED = 5;
const MASTERY_ACCURACY = 0.8;

// Missed days that don't break a streak — "fun" shouldn't mean punishing one
// off day. Not tracked per calendar month (no persisted counter exists for
// that); applied as a flat allowance each time the streak is computed.
const STREAK_FREEZE_DAYS = 2;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Longest run of consecutive practice days (ending today or yesterday),
// forgiving up to STREAK_FREEZE_DAYS missed days along the way instead of
// resetting to zero on the first gap.
export function computeStreakDays(completedDates: string[]): number {
  const days = new Set(completedDates);
  const today = new Date();
  let cursor = dayKey(today);
  if (!days.has(cursor)) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    cursor = dayKey(yesterday);
    if (!days.has(cursor)) return 0;
  }
  let streak = 0;
  let freezesUsed = 0;
  const d = new Date(cursor);
  for (;;) {
    if (days.has(dayKey(d))) {
      streak++;
    } else if (freezesUsed < STREAK_FREEZE_DAYS) {
      freezesUsed++;
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export interface LearnerStats {
  sessions: number;
  questionsCompleted: number;
  practiceMinutes: number;
  streakDays: number;
  accuracyPercent: number | null;
  skillAccuracy: Record<SkillTag, { correct: number; graded: number }>;
  masteredSkillsCount: number;
  // 1 is the baseline everyone starts at — only climbs as skills are
  // mastered (MASTERY_ACCURACY cleared with MASTERY_MIN_GRADED+ graded
  // answers), never from elapsed time, session count, or items attempted.
  level: number;
  // A fun running counter, not a gate on anything — rises only with real
  // graded-correct answers, never with time spent.
  totalXp: number;
  placementsCount: number;
}

export async function getLearnerStats(userId: string): Promise<LearnerStats> {
  const sessionsResult = await pool.query(
    // Sessions with at least one answer: one opened and left empty isn't practice.
    `SELECT started_at, completed_at FROM sessions s
     WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))`,
    [userId],
  );
  const sessions = sessionsResult.rows.length;
  // Real time actually spent answering, not session wall-clock span — a
  // session left open on another page/overnight added no active_ms, so it
  // adds no practice time, instead of needing a per-session cap to contain it.
  const activeMsResult = await pool.query(
    `SELECT COALESCE(SUM(a.active_ms), 0) AS total_active_ms
     FROM attempts a JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = $1 AND s.session_type = 'practice'`,
    [userId],
  );
  const practiceMinutes = Math.round(Number(activeMsResult.rows[0].total_active_ms) / 60_000);
  const streakDays = computeStreakDays(sessionsResult.rows.map((r) => dayKey(new Date(r.completed_at))));

  const questionsCompletedResult = await pool.query(
    `SELECT count(*) FROM attempts a JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = $1 AND s.session_type = 'practice'
       AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)`,
    [userId],
  );
  const questionsCompleted = Number(questionsCompletedResult.rows[0].count);

  const accuracyResult = await pool.query(
    `SELECT sc.content_score, sc.manner_scores, i.cefr_level, it.input_method, it.skills
     FROM attempts a
     JOIN sessions s ON s.id = a.session_id
     JOIN scores sc ON sc.attempt_id = a.id
     JOIN items i ON i.id = a.item_id
     JOIN item_types it ON it.id = i.item_type_id
     WHERE s.user_id = $1 AND s.session_type = 'practice' AND sc.status = 'scored'
       -- Answered questions only: a skipped one says nothing about accuracy.
       AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)`,
    [userId],
  );
  const gradedRows = accuracyResult.rows.map((r) => ({
    correct: isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel),
    skills: r.skills as SkillTag[],
  }));
  const accuracyPercent =
    gradedRows.length === 0 ? null : Math.round((gradedRows.filter((r) => r.correct).length / gradedRows.length) * 100);

  const skillAccuracy = {} as Record<SkillTag, { correct: number; graded: number }>;
  for (const skill of ALL_SKILLS) {
    const touching = gradedRows.filter((r) => r.skills.includes(skill));
    skillAccuracy[skill] = { correct: touching.filter((r) => r.correct).length, graded: touching.length };
  }
  const masteredSkillsCount = ALL_SKILLS.filter((skill) => {
    const { correct, graded } = skillAccuracy[skill];
    return graded >= MASTERY_MIN_GRADED && correct / graded >= MASTERY_ACCURACY;
  }).length;

  const placementsResult = await pool.query(`SELECT count(*) FROM placements WHERE user_id = $1`, [userId]);

  return {
    sessions,
    questionsCompleted,
    practiceMinutes,
    streakDays,
    accuracyPercent,
    skillAccuracy,
    masteredSkillsCount,
    level: 1 + masteredSkillsCount,
    totalXp: gradedRows.filter((r) => r.correct).length * 10,
    placementsCount: Number(placementsResult.rows[0].count),
  };
}

interface AchievementCheck {
  id: string;
  met: (stats: LearnerStats) => boolean;
}

// Mirrors the achievements seeded in the migration — kept here, next to the
// logic that decides when each one unlocks, rather than scattered.
const ACHIEVEMENT_CHECKS: AchievementCheck[] = [
  { id: "first_session", met: (s) => s.sessions >= 1 },
  { id: "ten_questions", met: (s) => s.questionsCompleted >= 10 },
  { id: "streak_3", met: (s) => s.streakDays >= 3 },
  { id: "sharp", met: (s) => s.accuracyPercent !== null && s.accuracyPercent >= 80 },
  { id: "streak_7", met: (s) => s.streakDays >= 7 },
  { id: "streak_30", met: (s) => s.streakDays >= 30 },
  { id: "full_coverage", met: (s) => ALL_SKILLS.every((skill) => s.skillAccuracy[skill].graded >= 1) },
  { id: "first_placement", met: (s) => s.placementsCount >= 1 },
  { id: "level_up", met: (s) => s.level >= 2 },
];

// Called after a practice or placement session completes. Idempotent —
// user_achievements' primary key is (user_id, achievement_id), so an
// already-earned badge is just skipped, never duplicated or re-timestamped.
// Returns the badges earned just now (for the "badge unlocked" moment) and
// the stats they were judged on.
export async function checkAndAwardBadges(userId: string): Promise<{ newBadges: { id: string; title: string; icon: string }[]; stats: LearnerStats }> {
  const stats = await getLearnerStats(userId);
  const newlyMet = ACHIEVEMENT_CHECKS.filter((c) => c.met(stats));
  if (newlyMet.length === 0) return { newBadges: [], stats };
  const inserted = await pool.query(
    `WITH ins AS (
       INSERT INTO user_achievements (user_id, achievement_id)
       SELECT $1, unnest($2::text[])
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id
     )
     SELECT a.id, a.title, a.icon FROM ins JOIN achievements a ON a.id = ins.achievement_id`,
    [userId, newlyMet.map((c) => c.id)],
  );
  return { newBadges: inserted.rows, stats };
}
