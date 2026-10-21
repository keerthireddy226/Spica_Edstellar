// Practice mode and mock test mode (ASSESSMENT_ENGINE.md section 5).
//
// Practice: the learner picks a set, can go back and pause, and sees the
// correct answer after each question. Mock: exam conditions. The form comes
// from questions the learner hasn't seen, each question's time runs from when
// it is first shown (session_item_views), and the server enforces it, so a
// reload or a closed tab doesn't stop the clock.
import { pool } from "../db.js";
import { groupItems, shuffle, type FormRow } from "../proctoring/forms.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";

// certified: the real assessment attempt (strictly proctored, one attempt, a
// result certificate). sample: its short free version. Both run like a mock.
export type DeliveryMode = "practice" | "mock" | "certified" | "sample";
export const isTimed = (mode: string | null | undefined): boolean => mode === "mock" || mode === "certified" || mode === "sample";

// Network and upload time allowed after a question's limit (a recorded answer
// can take a few seconds to upload).
export const MOCK_GRACE_SECONDS = 15;
// Reading a part's instructions, between questions.
const PART_INTRO_SECONDS = 30;
// The whole mock must finish within its questions' time plus this: one sitting.
const MOCK_SLACK_SECONDS = 10 * 60;
// Speaking rate used when an item has no generated recording yet.
const WORDS_PER_SECOND = 2.5;

// A mock's template: the first active set of the test type. It fixes the
// sections, their order and how many questions each has.
export async function mockTemplateExam(testTypeId: string): Promise<{ id: string; code: string } | null> {
  return (await pool.query(`SELECT id, code FROM exams WHERE is_active AND test_type_id = $1 ORDER BY code LIMIT 1`, [testTypeId])).rows[0] ?? null;
}

// Items this learner has answered or been shown, in any test. A question
// recorded as unanswered without being shown (a mock that ended first) isn't seen.
async function seenItemIds(userId: string): Promise<Set<string>> {
  const r = await pool.query(
    `SELECT a.item_id FROM attempts a JOIN sessions s ON s.id = a.session_id
     WHERE s.user_id = $1 AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)
     UNION
     SELECT v.item_id FROM session_item_views v JOIN sessions s ON s.id = v.session_id WHERE s.user_id = $1`,
    [userId],
  );
  return new Set(r.rows.map((x) => x.item_id as string));
}

// One mock form for this test type, in section order, each section as long
// as the template's. Questions come from every set of the test type; groups of
// questions the learner has seen least come first (ties in random order), and
// questions sharing one passage stay together. Only questions a person
// approved for mocks are used. A section the pool can't fill exactly uses
// the template's own questions.
export async function mockFormItemIds(testTypeId: string, userId: string, templateExamId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT i.id, e.id AS exam_id, i.exam_order, ep.sort_order, ep.part_label, i.content, i.mock_approved
     FROM exams e
     JOIN exam_parts ep ON ep.exam_id = e.id
     JOIN items i ON i.exam_part_id = ep.id
     WHERE e.is_active AND e.test_type_id = $1 AND i.status = 'approved'
     ORDER BY ep.sort_order, e.code, i.exam_order`,
    [testTypeId],
  );
  const rows: (FormRow & { mock_approved: boolean })[] = r.rows;
  const seen = await seenItemIds(userId);
  const ids: string[] = [];
  for (const sortOrder of [...new Set(rows.map((x) => x.sort_order))]) {
    const section = rows.filter((x) => x.sort_order === sortOrder);
    const own = section.filter((x) => x.exam_id === templateExamId);
    const target = own.length;
    if (target === 0) continue;
    const groups = shuffle(groupItems(section.filter((x) => x.mock_approved)))
      .map((g) => ({ g, seen: g.filter((x) => seen.has(x.id)).length / g.length }))
      .sort((a, b) => a.seen - b.seen)
      .map((x) => x.g);
    const picked: FormRow[] = [];
    for (const g of groups) {
      if (picked.length + g.length <= target) picked.push(...g);
      if (picked.length === target) break;
    }
    ids.push(...(picked.length === target ? picked : own).map((x) => x.id));
  }
  return ids;
}

interface TimingRow {
  id: string;
  content: Record<string, unknown>;
  timer_seconds: number | null;
  estimated_seconds: number | null;
  two_phase_read_seconds: number | null;
  prep_seconds: number | null;
  audio_ms: number | null;
}

function wordCount(v: unknown): number {
  if (typeof v === "string") return v.trim().split(/\s+/).filter(Boolean).length;
  if (Array.isArray(v)) return v.reduce((n: number, x) => n + wordCount(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce((n: number, x) => n + wordCount(x), 0);
  return 0;
}

// Recordings play twice, as in the real exam (and the player's limit).
const PLAYS = 2;

// Seconds a mock allows for one question: its answer time, plus listening
// to its recording twice, reading time (two-phase items) and preparation
// time (speaking). With measured recording lengths, LanguageCert A1-B1
// Listening comes to 32 minutes (published: 30) and A1-C2 to 54 (published: 50).
export function allowedSeconds(row: Omit<TimingRow, "id">): number {
  const answer = row.timer_seconds ?? row.estimated_seconds ?? 60;
  const audioSeconds =
    row.audio_ms != null ? row.audio_ms / 1000 : row.content?.audio != null ? wordCount(row.content.audio) / WORDS_PER_SECOND : 0;
  const listening = audioSeconds > 0 ? Math.ceil(PLAYS * audioSeconds) + 5 : 0;
  return answer + listening + (row.two_phase_read_seconds ?? 0) + (row.prep_seconds ?? 0);
}

// Each question's limit, by item id. `timers`: a built test's own answer
// times for some questions (they replace the question's usual one).
export async function mockLimits(itemIds: string[], timers: Record<string, number> = {}): Promise<Record<string, number>> {
  const r = await pool.query(
    `SELECT i.id, i.content, COALESCE(i.timer_seconds, it.timer_seconds) AS timer_seconds, it.estimated_seconds,
       it.two_phase_read_seconds, it.prep_seconds,
       (SELECT max(ia.duration_ms) FROM item_audio ia WHERE ia.item_id = i.id) AS audio_ms
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.id = ANY($1::uuid[])`,
    [itemIds],
  );
  return Object.fromEntries((r.rows as TimingRow[]).map((row) => [row.id, allowedSeconds({ ...row, timer_seconds: timers[row.id] ?? row.timer_seconds })]));
}

// When the whole mock must be finished.
export function mockDeadline(limits: Record<string, number>, partCount: number, start = new Date()): Date {
  const total = Object.values(limits).reduce((a, b) => a + b, 0) + partCount * PART_INTRO_SECONDS + MOCK_SLACK_SECONDS;
  return new Date(start.getTime() + total * 1000);
}

export interface MockComposition {
  limits?: Record<string, number>;
  deadlineAt?: string;
}

// When each question was first shown, by item id.
export async function itemViews(sessionId: string): Promise<Map<string, Date>> {
  const r = await pool.query(`SELECT item_id, shown_at FROM session_item_views WHERE session_id = $1`, [sessionId]);
  return new Map(r.rows.map((x) => [x.item_id as string, x.shown_at as Date]));
}

// Records the first time a question is shown; later calls keep that time.
export async function recordView(sessionId: string, itemId: string): Promise<Date> {
  await pool.query(`INSERT INTO session_item_views (session_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [sessionId, itemId]);
  return (await itemViews(sessionId)).get(itemId)!;
}

// Seconds left on a question shown at shownAt (never below 0), capped by the
// mock's overall deadline. null when the question hasn't been shown yet.
export function secondsLeft(composition: MockComposition, itemId: string, shownAt: Date | undefined, now = new Date()): number | null {
  const limit = composition.limits?.[itemId];
  if (limit == null || !shownAt) return null;
  let end = shownAt.getTime() + limit * 1000;
  if (composition.deadlineAt) end = Math.min(end, new Date(composition.deadlineAt).getTime());
  return Math.max(0, Math.round((end - now.getTime()) / 1000));
}

// An answer that arrives after its question's time (plus the grace) is
// recorded as unanswered.
export function answerTooLate(composition: MockComposition, itemId: string, shownAt: Date, now = new Date()): boolean {
  const limit = composition.limits?.[itemId];
  const graceMs = MOCK_GRACE_SECONDS * 1000;
  if (limit != null && now.getTime() > shownAt.getTime() + limit * 1000 + graceMs) return true;
  return !!composition.deadlineAt && now.getTime() > new Date(composition.deadlineAt).getTime() + graceMs;
}

export interface ScoreBand {
  level: string;
  from: number;
  to: number;
}

interface ScoreScale {
  min: number;
  max: number;
  bands: { from: number; level: string }[];
}

// The family's published score range for a CEFR level, e.g. LanguageCert B2
// = 60-74. null when the family publishes no scale or the level isn't on it.
export function bandForLevel(scale: ScoreScale | null, level: string | null | undefined): ScoreBand | null {
  if (!scale?.bands?.length || !level) return null;
  const bands = [...scale.bands].sort((a, b) => b.from - a.from);
  const i = bands.findIndex((b) => b.level === level);
  if (i < 0) return null;
  return { level, from: bands[i].from, to: i === 0 ? scale.max : bands[i - 1].from - 1 };
}

export async function familyScoreScale(testTypeId: string | null): Promise<ScoreScale | null> {
  if (!testTypeId) return null;
  const r = await pool.query(`SELECT f.score_scale FROM test_types tt JOIN exam_families f ON f.id = tt.family_id WHERE tt.id = $1`, [testTypeId]);
  return r.rows[0]?.score_scale ?? null;
}

// The answer key shown after a practice question.
export interface AnswerKey {
  index?: number;
  indexes?: number[];
  text?: string;
  points?: string[];
}

export function answerKey(answerSet: unknown): AnswerKey | null {
  const s = (answerSet ?? {}) as Record<string, unknown>;
  if (typeof s.correctIndex === "number") return { index: s.correctIndex };
  if (Array.isArray(s.correct) && s.correct.every((x) => Number.isInteger(x))) return { indexes: s.correct as number[] };
  if (typeof s.correct === "string") return { text: s.correct };
  if (typeof s.exact === "string") return { text: s.exact };
  if (Array.isArray(s.acceptable_answers) && typeof s.acceptable_answers[0] === "string") return { text: s.acceptable_answers[0] };
  if (Array.isArray(s.key_points)) return { points: s.key_points.filter((x): x is string => typeof x === "string") };
  return null;
}

export interface PracticeFeedback {
  status: "scored" | "pending" | "failed";
  correct: boolean | null;
  score: number | null;
  answer: AnswerKey | null;
  // The AI grader's reason, for writing and speaking.
  reason: string | null;
}

// Feedback on one practice answer, read back from the stored score.
export async function practiceFeedback(sessionId: string, itemId: string): Promise<PracticeFeedback | null> {
  const r = (
    await pool.query(
      `SELECT sc.status, sc.content_score, sc.reason, sc.manner_scores, i.answer_set, i.cefr_level, it.input_method
       FROM attempts a JOIN scores sc ON sc.attempt_id = a.id JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
       WHERE a.session_id = $1 AND a.item_id = $2`,
      [sessionId, itemId],
    )
  ).rows[0];
  if (!r) return null;
  const score = r.content_score == null ? null : Number(r.content_score);
  return {
    status: r.status,
    correct: r.status === "scored" ? isTrulyCorrect(score, r.cefr_level, r.input_method, r.manner_scores, passThresholdForLevel) : null,
    score,
    answer: answerKey(r.answer_set),
    reason: r.reason ?? null,
  };
}
