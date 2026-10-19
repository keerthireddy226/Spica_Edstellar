import { Router } from "express";
import { pool } from "../db.js";
import { dateOnly } from "../lib/dateOnly.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";

export const roadmapRouter = Router();

roadmapRouter.get("/", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const placementResult = await pool.query(
      `SELECT overall_percent, cefr_level, skill_percents, skill_levels, taken_at, status
       FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`,
      [req.user!.id],
    );
    const placement = placementResult.rows[0];

    const profileResult = await pool.query(
      `SELECT goal_level, assessment_scheduled_for, access_window_start_date, access_window_duration_days, exam_date
       FROM participant_profiles WHERE user_id = $1`,
      [req.user!.id],
    );
    const profile = profileResult.rows[0] ?? {};

    if (!placement) {
      return res.status(404).json({
        error: "no_placement_yet",
        assessmentScheduledFor: profile.assessment_scheduled_for ?? null,
      });
    }

    const roadmapResult = await pool.query(
      `SELECT id, pace, minutes_per_day, total_hours_estimate
       FROM roadmaps WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1`,
      [req.user!.id],
    );
    const roadmap = roadmapResult.rows[0];
    if (!roadmap) {
      return res.status(404).json({ error: "no_roadmap_yet" });
    }

    const milestonesResult = await pool.query(
      `SELECT level, label, target_day_offset, focus_skill
       FROM roadmap_milestones WHERE roadmap_id = $1 ORDER BY target_day_offset ASC`,
      [roadmap.id],
    );

    const userResult = await pool.query(`SELECT first_name FROM users WHERE id = $1`, [req.user!.id]);

    // Same "which milestone is active" logic the timeline UI uses — the
    // first milestone whose target day hasn't passed yet (or the last one,
    // once they're all behind schedule).
    const daysSinceStart = profile.access_window_start_date
      ? Math.round((Date.now() - new Date(profile.access_window_start_date).getTime()) / 86_400_000)
      : 0;
    const milestones = milestonesResult.rows;
    const currentMilestone =
      milestones.find((m) => m.target_day_offset >= daysSinceStart) ?? milestones[milestones.length - 1];
    const focusSkill = currentMilestone?.focus_skill ?? "listening";

    // All item types for this skill (not just 5) so a completed batch can
    // roll over to the next one — see the batching below.
    const allItemTypesResult = await pool.query(
      `SELECT it.id, it.name, it.question_instruction, it.estimated_seconds,
         EXISTS (
           SELECT 1 FROM attempts a
           JOIN sessions s ON s.id = a.session_id
           JOIN items i ON i.id = a.item_id
           WHERE s.user_id = $2 AND s.session_type = 'practice' AND i.item_type_id = it.id
             AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)
         ) AS completed
       FROM item_types it WHERE $1 = ANY(it.skills) ORDER BY it.estimated_seconds ASC`,
      [focusSkill, req.user!.id],
    );

    // Show the first batch of 5 that isn't fully completed yet; once a
    // batch is all ticked, the next page load naturally serves the next 5
    // instead (falls back to the final batch if every item is completed).
    const RECOMMENDED_BATCH_SIZE = 5;
    const allTypeRows = allItemTypesResult.rows;
    let batchStart = 0;
    for (let i = 0; i < allTypeRows.length; i += RECOMMENDED_BATCH_SIZE) {
      batchStart = i;
      if (allTypeRows.slice(i, i + RECOMMENDED_BATCH_SIZE).some((r) => !r.completed)) break;
    }
    const practiceItemsResult = { rows: allTypeRows.slice(batchStart, batchStart + RECOMMENDED_BATCH_SIZE) };

    res.json({
      firstName: userResult.rows[0]?.first_name ?? null,
      placement: {
        overallPercent: Number(placement.overall_percent),
        cefrLevel: placement.cefr_level,
        skillPercents: placement.skill_percents,
        // Older placements taken before this column existed have no value —
        // the frontend falls back to just showing the percent for those.
        skillLevels: placement.skill_levels ?? null,
        takenAt: placement.taken_at,
        // Non-blocking — the learner still sees their result; this just flags
        // it as awaiting an admin's look (Phase 2 async certification).
        reviewStatus: placement.status ?? "certified",
      },
      goalLevel: profile.goal_level && profile.goal_level !== "unsure" ? profile.goal_level : placement.cefr_level,
      // The plan counts down to the exam when there is one.
      examDate: profile.exam_date ? dateOnly(profile.exam_date) : null,
      accessWindow:
        profile.access_window_start_date && profile.access_window_duration_days
          ? { startDate: profile.access_window_start_date, durationDays: profile.access_window_duration_days }
          : null,
      roadmap: {
        pace: roadmap.pace,
        minutesPerDay: roadmap.minutes_per_day,
        totalHoursEstimate: Number(roadmap.total_hours_estimate),
        milestones: milestonesResult.rows.map((m) => ({
          level: m.level,
          labelType: m.label,
          targetDayOffset: m.target_day_offset,
          focusSkill: m.focus_skill,
        })),
      },
      recommendedPractice: {
        focusSkill,
        items: practiceItemsResult.rows.map((row) => ({
          itemTypeId: row.id,
          name: row.name,
          questionInstruction: row.question_instruction,
          estimatedSeconds: row.estimated_seconds,
          completed: row.completed,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});
