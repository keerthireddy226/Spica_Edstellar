import { pool } from "../db.js";
import { dateOnly } from "../lib/dateOnly.js";
import { CEFR_LEVELS, cefrRank, type CefrLevel } from "../placement/cefr.js";
import { buildRoadmap, type AccessDuration, type SkillTag } from "../placement/roadmapBuilder.js";
import { overallFromSkills, pathSummary } from "../learner/path.js";

// Builds and stores a learner's roadmap from their level, goal and dates.
// `dayOffsetBase` shifts milestone days so they stay counted from the start of
// the access window when the roadmap is rebuilt part-way through it.
export async function saveRoadmap(userId: string, cefrLevel: CefrLevel, skillPercents: Record<SkillTag, number>, dayOffsetBase = 0) {
  const profileResult = await pool.query(
    `SELECT goal_level, exam_date, access_duration, daily_minutes_preference FROM participant_profiles WHERE user_id = $1`,
    [userId],
  );
  const profile = profileResult.rows[0] ?? {};
  const goalLevel: CefrLevel =
    profile.goal_level && profile.goal_level !== "unsure"
      ? profile.goal_level
      : CEFR_LEVELS[Math.min(cefrRank(cefrLevel) + 1, CEFR_LEVELS.length - 1)];

  const roadmap = buildRoadmap({
    assessedLevel: cefrLevel,
    goalLevel,
    examDate: profile.exam_date ? dateOnly(profile.exam_date) : null,
    accessDuration: (profile.access_duration as AccessDuration) ?? "3months",
    dailyMinutesPreference: profile.daily_minutes_preference ?? 30,
    skillPercents,
  });

  const roadmapResult = await pool.query(
    `INSERT INTO roadmaps (user_id, pace, minutes_per_day, total_hours_estimate) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, roadmap.pace, roadmap.minutesPerDay, roadmap.totalHoursEstimate],
  );
  const roadmapId = roadmapResult.rows[0].id;

  for (const m of roadmap.milestones) {
    await pool.query(
      `INSERT INTO roadmap_milestones (roadmap_id, level, label, target_day_offset, focus_skill) VALUES ($1, $2, $3, $4, $5)`,
      [roadmapId, m.level, m.labelType, dayOffsetBase + m.targetDayOffset, m.focusSkill],
    );
  }

  return { goalLevel };
}

// A new plan from the learner's current level (their Practice Modules path
// levels, which start from the level test) after they change their goal,
// exam date or daily time, or their level moves. Nothing happens before the
// first level test.
export async function rebuildRoadmap(userId: string): Promise<boolean> {
  const placement = (
    await pool.query(`SELECT cefr_level, skill_percents FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])
  ).rows[0];
  if (!placement?.cefr_level) return false;
  const current = overallFromSkills(await pathSummary(userId)) ?? placement.cefr_level;
  const start = (await pool.query(`SELECT access_window_start_date FROM participant_profiles WHERE user_id = $1`, [userId])).rows[0]
    ?.access_window_start_date;
  const daysSinceStart = start ? Math.max(0, Math.round((Date.now() - new Date(start).getTime()) / 86_400_000)) : 0;
  await saveRoadmap(userId, current, placement.skill_percents, daysSinceStart);
  return true;
}
