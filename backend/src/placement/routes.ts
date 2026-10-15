import { Router } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { orgScope, requirePermission, staffCanSeeUser } from "../admin/staff.js";
import { finishProctoredSession, proctoringBlock } from "../proctoring/analyze.js";
import { recordCandidateResult } from "../recruitment/service.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendPlacementReminderEmail } from "../auth/mailer.js";
import { submitAttemptSchema } from "./schemas.js";
import { isTrulyCorrect, type StoredMannerScores } from "./fluencySignals.js";
import { gradeAndSaveAttempt } from "../attemptGrading.js";
import {
  CEFR_LEVELS,
  cefrRank,
  percentToCefr,
  assessSkillLevel,
  passThresholdForLevel,
  START_LEVEL,
  stepLevel,
  type CefrLevel,
} from "./cefr.js";
import { buildRoadmap, type AccessDuration, type SkillTag } from "./roadmapBuilder.js";
import { withAudioUrls } from "../voice/itemAudio.js";
import { toItemPayload } from "../itemPayload.js";
import { checkAndAwardBadges } from "../gamification/stats.js";
import { z } from "zod";


const ALL_SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];

export const placementRouter = Router();

const REMINDER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// 20 questions total, spread across these types/skills (chosen adaptively per type, not a fixed easy/medium/hard split).
const ITEMS_PER_TYPE: Record<string, number> = {
  reading: 3,
  repeats: 2,
  short_answer: 2,
  sentence_builds: 2,
  dictation: 3,
  sentence_completion: 3,
  reading_comprehension: 3,
  open_questions: 1,
  email_writing: 1,
};

// Read Aloud opens the test, same as the real Versant English Test, then
// the rest of the Speaking/Listening types, then the Writing-test types.
const TYPE_ORDER = [
  "reading",
  "repeats",
  "short_answer",
  "sentence_builds",
  "open_questions",
  "dictation",
  "sentence_completion",
  "reading_comprehension",
  "email_writing",
];

// Picks `count` rows evenly spread across difficulty, with randomness so not every learner gets the same set.
const SPREAD_WINDOW = 3;

export function pickDifficultySpread<T extends { id: string; difficulty: string | null }>(rows: T[], count: number): T[] {
  if (rows.length <= count) return rows;
  const sorted = [...rows].sort((a, b) => Number(a.difficulty ?? 0.5) - Number(b.difficulty ?? 0.5));
  const picks: T[] = [];
  const seen = new Set<string>();
  const step = (sorted.length - 1) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const target = Math.round(i * step);
    const lo = Math.max(0, target - Math.floor(SPREAD_WINDOW / 2));
    const hi = Math.min(sorted.length - 1, lo + SPREAD_WINDOW - 1);
    const candidates = sorted.slice(lo, hi + 1).filter((r) => !seen.has(r.id));
    const row = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : sorted[target];
    if (!seen.has(row.id)) {
      seen.add(row.id);
      picks.push(row);
    }
  }
  for (const row of sorted) {
    if (picks.length >= count) break;
    if (!seen.has(row.id)) {
      seen.add(row.id);
      picks.push(row);
    }
  }
  return picks;
}

// Adaptive selection: each type climbs/drops one CEFR level per answer until its budget is used.

type ItemPoolRow = {
  id: string;
  item_type_id: string;
  content: unknown;
  difficulty: string | null;
  cefr_level: string | null;
  skills: string[];
  input_method: string;
  instruction_text: string;
  question_instruction: string;
  timer_seconds: number | null;
  two_phase_read_seconds: number | null;
  two_phase_write_seconds: number | null;
  previously_attempted: boolean;
};

async function fetchTypePool(userId: string, typeId: string): Promise<ItemPoolRow[]> {
  const result = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, i.difficulty, i.cefr_level, it.skills, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds,
       EXISTS (
         SELECT 1 FROM attempts a JOIN sessions s ON s.id = a.session_id
         WHERE s.user_id = $1 AND a.item_id = i.id
       ) AS previously_attempted
     FROM items i
     JOIN item_types it ON it.id = i.item_type_id
     WHERE i.status = 'approved' AND i.item_type_id = $2`,
    [userId, typeId],
  );
  return result.rows;
}

// Nearest-level match, excluding ids already shown; prefers unseen items, ties broken randomly.
function pickAdaptiveItem(rowPool: ItemPoolRow[], targetLevel: CefrLevel, excludeIds: Set<string>): ItemPoolRow | null {
  const candidates = rowPool.filter((r) => !excludeIds.has(r.id));
  if (candidates.length === 0) return null;
  const targetRank = cefrRank(targetLevel);
  const ranked = candidates
    .map((r) => ({
      row: r,
      distance: Math.abs(cefrRank((r.cefr_level as CefrLevel) ?? START_LEVEL) - targetRank),
    }))
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.row.previously_attempted !== b.row.previously_attempted) return a.row.previously_attempted ? 1 : -1;
      return Math.random() - 0.5;
    });
  const closestDistance = ranked[0].distance;
  const tied = ranked.filter((r) => r.distance === closestDistance && r.row.previously_attempted === ranked[0].row.previously_attempted);
  return tied[Math.floor(Math.random() * tied.length)].row;
}

// First available item for TYPE_ORDER[startIndex], or the next type if its pool is empty.
async function pickFirstItemFrom(
  userId: string,
  startIndex: number,
): Promise<{ typeIndex: number; item: ItemPoolRow } | null> {
  for (let i = startIndex; i < TYPE_ORDER.length; i++) {
    const typeId = TYPE_ORDER[i];
    const rows = await fetchTypePool(userId, typeId);
    const item = pickAdaptiveItem(rows, START_LEVEL, new Set());
    if (item) return { typeIndex: i, item };
  }
  return null;
}

interface AdaptiveComposition {
  history: string[];
  currentTypeIndex: number;
  perType: Record<string, { budget: number; shown: string[] }>;
  pendingItemId: string | null;
}

// Skipped outside production so local testing doesn't hit the same cooldown.
const scheduleLaterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
  handler: (_req, res) => {
    res.status(429).json({ error: "too_many_attempts" });
  },
});

async function activeReminder(userId: string) {
  const result = await pool.query(
    `SELECT expires_at FROM placement_reminder_tokens
     WHERE user_id = $1 AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

placementRouter.post("/schedule-later", requireAuth, scheduleLaterLimiter, async (req: AuthedRequest, res, next) => {
  try {
    // Already scheduled and still within its window — don't send a second
    // email or reset the cooldown just because the button got clicked twice
    // (e.g. a double click, or the client's disabled state was stale).
    const existing = await activeReminder(req.user!.id);
    if (existing) {
      return res.json({ scheduledUntil: existing.expires_at });
    }

    const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [req.user!.id]);
    const email = userResult.rows[0].email;

    const token = generateToken();
    const expiresAt = new Date(Date.now() + REMINDER_TTL_MS);
    await pool.query(
      `INSERT INTO placement_reminder_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [req.user!.id, hashToken(token), expiresAt],
    );

    sendPlacementReminderEmail(email, token).catch((err) =>
      console.error("failed to send placement reminder email:", err),
    );

    res.status(201).json({ scheduledUntil: expiresAt });
  } catch (err) {
    next(err);
  }
});

// Reconstructs an adaptive session's question history in shown order, for resuming (POST /session) and GET /session/:id.
async function buildHistoryResponse(userId: string, sessionId: string, composition: AdaptiveComposition, completed: boolean) {
  const itemIds = composition.history;
  const itemsResult = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction, it.timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[])`,
    [itemIds],
  );
  const byId = new Map(itemsResult.rows.map((r) => [r.id, r]));
  const attemptsResult = await pool.query(`SELECT item_id, response_text FROM attempts WHERE session_id = $1`, [
    sessionId,
  ]);
  const attemptByItem = new Map(attemptsResult.rows.map((r) => [r.item_id, r.response_text]));

  const items = itemIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((row) => ({
      ...toItemPayload(row!),
      attempted: attemptByItem.has(row!.id),
      responseText: attemptByItem.get(row!.id) ?? null,
    }));

  return {
    sessionId,
    completed,
    items: await withAudioUrls(userId, items),
  };
}

// Reuses an already-in-progress session — a refresh/double-click shouldn't mint a different, half-done test.
placementRouter.post("/session", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT id, composition FROM sessions
       WHERE user_id = $1 AND session_type = 'placement' AND completed_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id],
    );
    // Pre-adaptive-engine sessions carry an old `{ itemIds }` shape that would crash on resume — abandon and start fresh instead.
    if (existing.rows[0] && Array.isArray(existing.rows[0].composition?.history)) {
      const response = await buildHistoryResponse(req.user!.id, existing.rows[0].id, existing.rows[0].composition, false);
      return res.json(response);
    }
    if (existing.rows[0]) {
      await pool.query(`UPDATE sessions SET completed_at = now() WHERE id = $1`, [existing.rows[0].id]);
    }

    const first = await pickFirstItemFrom(req.user!.id, 0);
    if (!first) return res.status(500).json({ error: "no_items_available" });

    const composition: AdaptiveComposition = {
      history: [first.item.id],
      currentTypeIndex: first.typeIndex,
      perType: { [TYPE_ORDER[first.typeIndex]]: { budget: ITEMS_PER_TYPE[TYPE_ORDER[first.typeIndex]], shown: [first.item.id] } },
      pendingItemId: first.item.id,
    };
    const sessionResult = await pool.query(
      `INSERT INTO sessions (user_id, session_type, mode, composition)
       VALUES ($1, 'placement', 'exam', $2) RETURNING id`,
      [req.user!.id, JSON.stringify(composition)],
    );

    res.status(201).json({
      sessionId: sessionResult.rows[0].id,
      items: await withAudioUrls(req.user!.id, [toItemPayload(first.item)]),
    });
  } catch (err) {
    next(err);
  }
});

// Side-effect-free peek (no session created, unlike POST /session) so the intro page can offer "Continue" — registered before :sessionId so "current" isn't swallowed as an id.
placementRouter.get("/session/current", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT composition FROM sessions
       WHERE user_id = $1 AND session_type = 'placement' AND completed_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user!.id],
    );
    const row = existing.rows[0];
    if (!row || !Array.isArray(row.composition?.history)) {
      return res.json({ inProgress: false });
    }
    // history includes the current not-yet-answered question, so this is a
    // "questions shown so far" count, not a strict answered-count — good
    // enough for a progress hint, not worth a second query to be exact.
    res.json({ inProgress: true, questionsShown: row.composition.history.length });
  } catch (err) {
    next(err);
  }
});

placementRouter.get("/session/:sessionId", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `SELECT id, composition, completed_at FROM sessions WHERE id = $1 AND user_id = $2`,
      [req.params.sessionId, req.user!.id],
    );
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (!Array.isArray(session.composition?.history)) {
      return res.status(410).json({ error: "session_predates_adaptive_engine" });
    }

    const response = await buildHistoryResponse(req.user!.id, session.id, session.composition, !!session.completed_at);
    res.json(response);
  } catch (err) {
    next(err);
  }
});

placementRouter.post("/session/:sessionId/attempts", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = submitAttemptSchema.parse(req.body);

    const sessionResult = await pool.query(`SELECT id, composition, completed_at FROM sessions WHERE id = $1 AND user_id = $2`, [
      req.params.sessionId,
      req.user!.id,
    ]);
    const session = sessionResult.rows[0];
    if (!session) return res.status(404).json({ error: "session_not_found" });
    if (session.completed_at) return res.status(409).json({ error: "session_already_completed" });
    const blocked = await proctoringBlock(session.id, req.user!.id);
    if (blocked) return res.status(409).json({ error: blocked });
    if (!Array.isArray(session.composition?.history)) {
      return res.status(410).json({ error: "session_predates_adaptive_engine" });
    }

    const composition = session.composition as AdaptiveComposition;
    // Guards against a stale client submitting for a question that's no longer the one pending.
    if (composition.pendingItemId !== body.itemId) {
      return res.status(409).json({ error: "not_the_current_item" });
    }
    // Snapshot before `composition` gets mutated below — used as a
    // compare-and-swap guard on the final UPDATE, so two concurrent
    // submissions for the same session can't silently overwrite one
    // another's composition update (only one wins; the other gets a 409).
    const originalCompositionJson = JSON.stringify(composition);

    // Guards against a duplicate network retry of the same submission —
    // the adaptive flow never intentionally resubmits an already-answered
    // question (there's no "Back"), but a retry shouldn't double-count.
    const graded = await gradeAndSaveAttempt(session.id, body);
    if (!graded) return res.status(404).json({ error: "item_not_found" });

    // Adaptive step: skip counts as wrong (same as a miss); a grading-service
    // failure stays at the same level (not the learner's fault either way).
    const { attemptId, item, grade, wasCorrect } = graded;
    const currentType = item.item_type_id as string;
    const typeState = composition.perType[currentType];
    let nextItem: ItemPoolRow | null = null;

    if (typeState.shown.length < typeState.budget) {
      const nextLevel =
        grade.status === "failed" ? ((item.cefr_level as CefrLevel) ?? START_LEVEL) : stepLevel((item.cefr_level as CefrLevel) ?? START_LEVEL, wasCorrect);
      const rows = await fetchTypePool(req.user!.id, currentType);
      nextItem = pickAdaptiveItem(rows, nextLevel, new Set(typeState.shown));
    }

    if (nextItem) {
      typeState.shown.push(nextItem.id);
      composition.history.push(nextItem.id);
      composition.pendingItemId = nextItem.id;
    } else {
      // Type's budget used up (or pool ran dry) — move to the next type with items.
      const next = await pickFirstItemFrom(req.user!.id, composition.currentTypeIndex + 1);
      if (next) {
        composition.currentTypeIndex = next.typeIndex;
        composition.perType[TYPE_ORDER[next.typeIndex]] = {
          budget: ITEMS_PER_TYPE[TYPE_ORDER[next.typeIndex]],
          shown: [next.item.id],
        };
        composition.history.push(next.item.id);
        composition.pendingItemId = next.item.id;
        nextItem = next.item;
      } else {
        // Nothing left anywhere — the test is done.
        composition.pendingItemId = null;
      }
    }

    const updateResult = await pool.query(
      `UPDATE sessions SET composition = $1 WHERE id = $2 AND composition = $3::jsonb RETURNING id`,
      [JSON.stringify(composition), session.id, originalCompositionJson],
    );
    if (!updateResult.rows[0]) {
      // Another request for this same session already advanced the
      // composition first — this attempt is still saved (gradeAndSaveAttempt
      // already committed it), it just lost the race to pick the next item.
      return res.status(409).json({ error: "session_composition_conflict" });
    }

    res.status(201).json({
      attemptId,
      status: grade.status,
      correct: grade.status === "scored" ? wasCorrect : grade.correct,
      // null means there's nothing left to ask — the frontend should call
      // /complete once it sees this instead of waiting on a fixed count.
      nextItem: nextItem ? (await withAudioUrls(req.user!.id, [toItemPayload(nextItem)]))[0] : null,
    });
  } catch (err) {
    next(err);
  }
});

interface ScoredAttemptRow {
  status: string;
  content_score: number | string | null;
  manner_scores: StoredMannerScores | null;
  skills: string[];
  input_method: string;
  cefr_level: CefrLevel | null;
}

function rowIsCorrect(r: ScoredAttemptRow): boolean {
  return isTrulyCorrect(Number(r.content_score), r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel);
}

// Per-skill percent/level, plus the same percents shaped for buildRoadmap's "weakest first" ranking.
function computeSkillBreakdown(graded: ScoredAttemptRow[], overallPercent: number) {
  const skillPercents = {} as Record<SkillTag, number | null>;
  const skillLevels = {} as Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null>;
  const roadmapSkillPercents = {} as Record<SkillTag, number>;
  for (const skill of ALL_SKILLS) {
    const relevant = graded.filter((r) => r.skills.includes(skill));
    if (relevant.length === 0) {
      skillPercents[skill] = null;
      skillLevels[skill] = null;
      roadmapSkillPercents[skill] = overallPercent;
      continue;
    }
    const percent = Math.round((relevant.filter(rowIsCorrect).length / relevant.length) * 100);
    // Highest CEFR level actually sustained, not just a flat percentage; falls back to percent only if no cefr_level tags exist yet.
    const assessed = assessSkillLevel(relevant.map((r) => ({ cefrLevel: r.cefr_level, correct: rowIsCorrect(r) })));
    skillPercents[skill] = percent;
    skillLevels[skill] = { level: assessed.level ?? percentToCefr(percent), cappedByGap: assessed.cappedByGap };
    roadmapSkillPercents[skill] = percent;
  }
  return { skillPercents, skillLevels, roadmapSkillPercents };
}

// Headline level: assessed across all skills from every question shown. A skip counts as wrong; grading failures are excluded. Can't outrank the weakest tested skill (avoids a strong skill masking a failed one).
function computeHeadlineLevel(
  graded: ScoredAttemptRow[],
  allRows: ScoredAttemptRow[],
  correctCount: number,
  pendingCount: number,
  skillLevels: Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null>,
) {
  const gradedLevels = new Set(graded.map((r) => r.cefr_level));
  const skippedAsWrong = allRows
    .filter((r) => r.status === "pending" && gradedLevels.has(r.cefr_level))
    .map((r) => ({ cefrLevel: r.cefr_level, correct: false }));
  const answeredEvidence = graded.map((r) => ({ cefrLevel: r.cefr_level, correct: rowIsCorrect(r) }));
  const overallAssessment = assessSkillLevel([...answeredEvidence, ...skippedAsWrong]);
  // Fallback percentage (no level certified above) also counts skips as wrong, or a mostly-skipped test would look fine.
  const overallPercentForLevel = Math.round((correctCount / (graded.length + pendingCount)) * 100);
  const pooledCefrLevel: CefrLevel = overallAssessment.level ?? percentToCefr(overallPercentForLevel);

  const testedSkillLevels = ALL_SKILLS.map((skill) => skillLevels[skill]?.level).filter(
    (level): level is CefrLevel => level != null,
  );
  const weakestTestedSkillLevel =
    testedSkillLevels.length > 0
      ? testedSkillLevels.reduce((weakest, level) => (cefrRank(level) < cefrRank(weakest) ? level : weakest))
      : null;
  const cefrLevel: CefrLevel =
    weakestTestedSkillLevel && cefrRank(weakestTestedSkillLevel) < cefrRank(pooledCefrLevel) ? weakestTestedSkillLevel : pooledCefrLevel;
  // Once a weak skill has pulled the headline down below what the pooled walk found, that's the real, complete reason
  // why — the gap caveat only makes sense when the pooled result stands as-is.
  const cefrCappedByGap = cefrLevel === pooledCefrLevel && overallAssessment.cappedByGap;
  return { cefrLevel, cefrCappedByGap };
}

async function saveRoadmap(userId: string, cefrLevel: CefrLevel, roadmapSkillPercents: Record<SkillTag, number>) {
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
    examDate: profile.exam_date ? new Date(profile.exam_date).toISOString().slice(0, 10) : null,
    accessDuration: (profile.access_duration as AccessDuration) ?? "3months",
    dailyMinutesPreference: profile.daily_minutes_preference ?? 30,
    skillPercents: roadmapSkillPercents,
  });

  const roadmapResult = await pool.query(
    `INSERT INTO roadmaps (user_id, pace, minutes_per_day, total_hours_estimate) VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, roadmap.pace, roadmap.minutesPerDay, roadmap.totalHoursEstimate],
  );
  const roadmapId = roadmapResult.rows[0].id;

  for (const m of roadmap.milestones) {
    await pool.query(
      `INSERT INTO roadmap_milestones (roadmap_id, level, label, target_day_offset, focus_skill) VALUES ($1, $2, $3, $4, $5)`,
      [roadmapId, m.level, m.labelType, m.targetDayOffset, m.focusSkill],
    );
  }

  return { goalLevel };
}

placementRouter.post("/session/:sessionId/complete", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const sessionResult = await pool.query(
      `UPDATE sessions SET completed_at = now() WHERE id = $1 AND user_id = $2 AND completed_at IS NULL RETURNING id`,
      [req.params.sessionId, req.user!.id],
    );
    if (!sessionResult.rows[0]) return res.status(404).json({ error: "session_not_found_or_already_completed" });

    const summaryResult = await pool.query(
      `SELECT sc.status, sc.content_score, sc.manner_scores, it.skills, it.input_method, i.cefr_level
       FROM attempts a
       JOIN scores sc ON sc.attempt_id = a.id
       JOIN items i ON i.id = a.item_id
       JOIN item_types it ON it.id = i.item_type_id
       WHERE a.session_id = $1`,
      [req.params.sessionId],
    );
    const rows: ScoredAttemptRow[] = summaryResult.rows;
    const graded = rows.filter((r) => r.status === "scored");
    // Each row's own CEFR level sets its own pass bar — see isTrulyCorrect.
    const correctCount = graded.filter(rowIsCorrect).length;
    const pendingCount = rows.filter((r) => r.status === "pending").length;
    // Distinct from pending: grading was attempted but the AI call itself broke.
    const failedCount = rows.filter((r) => r.status === "failed").length;

    // Nothing graded yet — return the raw tally without a placement/roadmap.
    if (graded.length === 0) {
      await finishProctoredSession(req.params.sessionId as string).catch((err) => console.error("placement /complete: proctoring analysis failed:", err));
      if (req.user!.role === "candidate") {
        await recordCandidateResult(req.user!.id, req.params.sessionId as string).catch((err) => console.error("placement /complete: candidate result failed:", err));
      }
      return res.json({ gradedCount: 0, correctCount: 0, pendingCount, failedCount });
    }

    const overallPercent = Math.round((correctCount / graded.length) * 100);
    const { skillPercents, skillLevels, roadmapSkillPercents } = computeSkillBreakdown(graded, overallPercent);
    const { cefrLevel, cefrCappedByGap } = computeHeadlineLevel(graded, rows, correctCount, pendingCount, skillLevels);

    // Any flagged face check from this session (enrollment mismatch, repeated
    // environmental failures, a mid-test spoof) holds the result for review —
    // not a block, the learner still sees their result, just marked as pending.
    const flagged = await pool.query(
      `SELECT 1 FROM face_check_results WHERE session_id = $1 AND flagged_for_review LIMIT 1`,
      [req.params.sessionId],
    );
    // The proctoring signals count the same way; a failure there never
    // blocks the result.
    const integrity = await finishProctoredSession(req.params.sessionId as string).catch((err) => {
      console.error("placement /complete: proctoring analysis failed (non-fatal):", err);
      return null;
    });
    const status = flagged.rows[0] || integrity?.status === "flagged" ? "pending_review" : "certified";

    await pool.query(
      `INSERT INTO placements (user_id, session_id, overall_percent, cefr_level, skill_percents, skill_levels, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.user!.id, req.params.sessionId, overallPercent, cefrLevel, JSON.stringify(skillPercents), JSON.stringify(skillLevels), status],
    );

    // Candidates get no learning plan; their result goes to the recruiter.
    const candidate = req.user!.role === "candidate";
    const { goalLevel } = candidate ? { goalLevel: null } : await saveRoadmap(req.user!.id, cefrLevel, roadmapSkillPercents);
    if (candidate) {
      await recordCandidateResult(req.user!.id, req.params.sessionId as string).catch((err) => console.error("placement /complete: candidate result failed:", err));
    } else {
      await checkAndAwardBadges(req.user!.id);
    }

    res.json({
      gradedCount: graded.length,
      correctCount,
      pendingCount,
      failedCount,
      overallPercent,
      cefrLevel,
      cefrCappedByGap,
      skillPercents,
      skillLevels,
      reviewStatus: status,
      goalLevel,
    });
  } catch (err) {
    next(err);
  }
});

// --- Admin review surface (Phase 2 async certification) ---

// Edstellar staff with "Score review" only. An Admin sees learners in their
// own organizations plus individual learners; a Super Admin sees everyone.
placementRouter.get("/admin/pending-review", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    const scope = orgScope(req, "t", 1);
    const result = await pool.query(
      `SELECT p.id, p.user_id, u.email, concat_ws(' ', u.first_name, u.last_name) AS name, p.taken_at, p.overall_percent, p.cefr_level,
              CASE WHEN t.type = 'cohort' THEN t.name END AS org_name,
              coalesce(json_agg(json_build_object(
                'decision', fcr.decision, 'similarityScore', fcr.similarity_score,
                'sampleUri', fcr.sample_uri, 'createdAt', fcr.created_at
              ) ORDER BY fcr.created_at) FILTER (WHERE fcr.id IS NOT NULL), '[]') AS flagged_checks,
              si.risk_score, si.risk_level, si.reasons AS integrity_reasons, si.session_id AS integrity_session_id
       FROM placements p
       JOIN users u ON u.id = p.user_id
       JOIN tenants t ON t.id = u.tenant_id
       LEFT JOIN face_check_results fcr ON fcr.session_id = p.session_id AND fcr.flagged_for_review
       LEFT JOIN session_integrity si ON si.session_id = p.session_id
       WHERE p.status = 'pending_review' ${scope.sql ? `AND (t.type <> 'cohort' OR (true ${scope.sql}))` : ""}
       GROUP BY p.id, u.id, t.id, si.session_id
       ORDER BY p.taken_at ASC`,
      scope.params,
    );
    res.json({ placements: result.rows });
  } catch (err) {
    next(err);
  }
});

// Decided reviews and how the queue is doing, scoped like the queue itself.
placementRouter.get("/admin/review-history", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    const scope = orgScope(req, "t", 1);
    const where = `${scope.sql ? `AND (t.type <> 'cohort' OR (true ${scope.sql}))` : ""}`;
    const [history, stats] = await Promise.all([
      pool.query(
        `SELECT p.id, u.email, concat_ws(' ', u.first_name, u.last_name) AS name, CASE WHEN t.type = 'cohort' THEN t.name END AS org_name,
           p.status, p.cefr_level, p.overall_percent, p.taken_at, p.reviewed_at, p.review_note,
           concat_ws(' ', r.first_name, r.last_name) AS reviewer
         FROM placements p JOIN users u ON u.id = p.user_id JOIN tenants t ON t.id = u.tenant_id
         LEFT JOIN users r ON r.id = p.reviewed_by
         WHERE p.status IN ('certified', 'fraud_confirmed') AND p.reviewed_at IS NOT NULL ${where}
         ORDER BY p.reviewed_at DESC LIMIT 100`,
        scope.params,
      ),
      pool.query(
        `SELECT count(*) FILTER (WHERE p.status = 'pending_review')::int AS pending,
           count(*) FILTER (WHERE p.reviewed_at >= date_trunc('month', now()))::int AS decided_month,
           count(*) FILTER (WHERE p.status = 'fraud_confirmed')::int AS fraud,
           count(*) FILTER (WHERE p.status = 'certified' AND p.reviewed_at IS NOT NULL)::int AS cleared,
           count(*)::int AS placements_total,
           coalesce(avg(extract(epoch FROM p.reviewed_at - p.taken_at) / 3600) FILTER (WHERE p.reviewed_at IS NOT NULL), 0)::float AS avg_hours
         FROM placements p JOIN users u ON u.id = p.user_id JOIN tenants t ON t.id = u.tenant_id
         WHERE true ${where}`,
        scope.params,
      ),
    ]);
    const st = stats.rows[0];
    res.json({
      stats: { pending: st.pending, decidedThisMonth: st.decided_month, fraud: st.fraud, cleared: st.cleared, placements: st.placements_total, avgHoursToDecide: Math.round(st.avg_hours) },
      history: history.rows,
    });
  } catch (err) {
    next(err);
  }
});

const placementReviewSchema = z.object({
  verdict: z.enum(["certified", "fraud_confirmed"]),
  note: z.string().optional(),
});

placementRouter.post("/admin/:id/review", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!(await requirePermission(req, res, "scoreReview"))) return;
  try {
    const body = placementReviewSchema.parse(req.body);
    const owner = await pool.query(`SELECT user_id FROM placements WHERE id = $1`, [req.params.id]);
    if (!owner.rows[0] || !(await staffCanSeeUser(req, owner.rows[0].user_id))) return res.status(404).json({ error: "not_pending_review" });
    const result = await pool.query(
      `UPDATE placements SET status = $1, reviewed_by = $2, reviewed_at = now(), review_note = $3
       WHERE id = $4 AND status = 'pending_review'
       RETURNING id`,
      [body.verdict, req.user!.id, body.note ?? null, req.params.id],
    );
    if (!result.rows[0]) return res.status(400).json({ error: "not_pending_review" });
    await pool.query(
      `UPDATE session_integrity SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now()
       WHERE session_id = (SELECT session_id FROM placements WHERE id = $1)`,
      [req.params.id, body.verdict === "fraud_confirmed" ? "violation" : "cleared", req.user!.id, body.note ?? null],
    );
    res.json({ status: body.verdict });
  } catch (err) {
    next(err);
  }
});
