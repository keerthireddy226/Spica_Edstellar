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
import { resolveBank, type ExamPurpose } from "../catalogue/banks.js";

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

// A mock's template: the first active practice set of the test type. It fixes
// the sections, their order and how many questions each has. The mock and
// real-test banks are laid out the same way (same part labels and sort_order),
// so their questions slot into the template's sections.
export async function mockTemplateExam(testTypeId: string): Promise<{ id: string; code: string } | null> {
  return (
    await pool.query(`SELECT id, code FROM exams WHERE is_active AND purpose = 'practice' AND test_type_id = $1 ORDER BY code LIMIT 1`, [testTypeId])
  ).rows[0] ?? null;
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

export type BankRow = FormRow & { mock_approved: boolean; certified_exposures?: number };

// One form from a bank's rows: each section (sort_order) gets exactly as many
// questions as the template has there. Groups of questions the learner has
// seen least come first (ties in random order), questions sharing one passage
// stay together, and only questions a person approved for mocks are used.
// exposureCap: question groups used in that many real tests or more go last.
// A section the draw can't fill exactly takes one exam's whole section of the
// right length (the template's first, then the least seen); failing that, what
// the draw found.
export function pickBankForm(
  rows: BankRow[],
  targets: Map<number, number>,
  seen: Set<string>,
  templateExamId: string,
  exposureCap = Infinity,
): string[] {
  const ids: string[] = [];
  const seenShare = (g: FormRow[]) => g.filter((x) => seen.has(x.id)).length / g.length;
  for (const [sortOrder, target] of [...targets.entries()].sort((a, b) => a[0] - b[0])) {
    if (target <= 0) continue;
    const section = rows.filter((x) => x.sort_order === sortOrder);
    const over = (g: BankRow[]) => g.some((x) => (x.certified_exposures ?? 0) >= exposureCap);
    const groups = shuffle(groupItems(section.filter((x) => x.mock_approved)))
      .map((g) => ({ g, over: Number(over(g)), seen: seenShare(g) }))
      .sort((a, b) => a.over - b.over || a.seen - b.seen)
      .map((x) => x.g);
    const picked: BankRow[] = [];
    for (const g of groups) {
      if (picked.length + g.length <= target) picked.push(...g);
      if (picked.length === target) break;
    }
    if (picked.length !== target) {
      const byExam = new Map<string, BankRow[]>();
      for (const x of section) byExam.set(x.exam_id, [...(byExam.get(x.exam_id) ?? []), x]);
      const whole = shuffle([...byExam.entries()].filter(([, xs]) => xs.length === target)).sort(
        (a, b) => Number(b[0] === templateExamId) - Number(a[0] === templateExamId) || seenShare(a[1]) - seenShare(b[1]),
      )[0];
      if (whole) {
        ids.push(...whole[1].map((x) => x.id));
        continue;
      }
    }
    ids.push(...picked.map((x) => x.id));
  }
  return ids;
}

// One mock (or real test) form for this test type, in section order, each
// section as long as the template's. Questions come only from the given bank's
// exams of the test type: mocks from the mock bank, real tests from the
// real-test bank, so a mock never shows a real test's questions and neither
// repeats a practice set. A test type whose bank isn't loaded yet uses its
// practice sets (resolveBank).
export async function mockFormItemIds(
  testTypeId: string,
  userId: string,
  templateExamId: string,
  exposureCap = Infinity,
  wanted: Exclude<ExamPurpose, "practice"> = "mock",
): Promise<string[]> {
  const bank = await resolveBank(testTypeId, wanted);
  const r = await pool.query(
    `SELECT i.id, e.id AS exam_id, i.exam_order, ep.sort_order, ep.part_label, i.content, i.mock_approved, i.certified_exposures
     FROM exams e
     JOIN exam_parts ep ON ep.exam_id = e.id
     JOIN items i ON i.exam_part_id = ep.id
     WHERE e.is_active AND e.test_type_id = $1 AND e.purpose = $2 AND i.status = 'approved'
     ORDER BY ep.sort_order, e.code, i.exam_order`,
    [testTypeId, bank],
  );
  const targets = await pool.query(
    `SELECT ep.sort_order, count(*)::int AS n FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved'
     WHERE ep.exam_id = $1 GROUP BY ep.sort_order`,
    [templateExamId],
  );
  return pickBankForm(
    r.rows,
    new Map(targets.rows.map((t) => [t.sort_order as number, t.n as number])),
    await seenItemIds(userId),
    templateExamId,
    exposureCap,
  );
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
  // Noise pauses: seconds added to a question's time (and to deadlineAt) after
  // the test was paused for loud background noise, the pause in progress, and
  // the total paused so far (capped at MAX_NOISE_PAUSE_SECONDS).
  extraSeconds?: Record<string, number>;
  noisePause?: { itemId: string; startedAt: string } | null;
  pausedSeconds?: number;
}

// A test can be held for background noise this long in total; after that the
// clock runs again, so a pause can't become extra time without limit.
export const MAX_NOISE_PAUSE_SECONDS = 300;

// Seconds a noise pause in progress has held the clock so far (within the cap).
export function ongoingPauseSeconds(c: MockComposition, now = new Date()): number {
  if (!c.noisePause) return 0;
  const held = Math.max(0, (now.getTime() - new Date(c.noisePause.startedAt).getTime()) / 1000);
  return Math.min(held, Math.max(0, MAX_NOISE_PAUSE_SECONDS - (c.pausedSeconds ?? 0)));
}

// Extra seconds a question has, from finished pauses and one in progress.
function extraFor(c: MockComposition, itemId: string, now: Date): number {
  return (c.extraSeconds?.[itemId] ?? 0) + (c.noisePause?.itemId === itemId ? ongoingPauseSeconds(c, now) : 0);
}

// The whole test's deadline, held while a pause is in progress.
function deadlineOf(c: MockComposition, now: Date): number | null {
  return c.deadlineAt ? new Date(c.deadlineAt).getTime() + ongoingPauseSeconds(c, now) * 1000 : null;
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
  let end = shownAt.getTime() + (limit + extraFor(composition, itemId, now)) * 1000;
  const deadline = deadlineOf(composition, now);
  if (deadline !== null) end = Math.min(end, deadline);
  return Math.max(0, Math.round((end - now.getTime()) / 1000));
}

// An answer that arrives after its question's time (plus the grace) is
// recorded as unanswered.
export function answerTooLate(composition: MockComposition, itemId: string, shownAt: Date, now = new Date()): boolean {
  const limit = composition.limits?.[itemId];
  const graceMs = MOCK_GRACE_SECONDS * 1000;
  if (limit != null && now.getTime() > shownAt.getTime() + (limit + extraFor(composition, itemId, now)) * 1000 + graceMs) return true;
  const deadline = deadlineOf(composition, now);
  return deadline !== null && now.getTime() > deadline + graceMs;
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

// ---- Level tests (A1-C2) ----

// A level test: questions at one CEFR level covering all four skills, from
// the Practice Modules question bank (which has every level). Parts in order.
export const LEVEL_TEST_BLUEPRINT: { itemTypeId: string; count: number }[] = [
  { itemTypeId: "reading", count: 3 }, // Read Aloud: speaking, reading
  { itemTypeId: "repeats", count: 4 }, // listening, speaking
  { itemTypeId: "short_answer", count: 3 }, // listening, speaking
  { itemTypeId: "response_selection", count: 4 }, // listening
  { itemTypeId: "reading_comprehension", count: 4 }, // reading
  { itemTypeId: "sentence_completion", count: 5 }, // writing
  { itemTypeId: "dictation", count: 4 }, // listening, writing
  { itemTypeId: "email_writing", count: 1 }, // writing
];
// Pass: this share right overall, and at least LEVEL_SKILL_MIN in every skill.
export const LEVEL_PASS_OVERALL = 70;
export const LEVEL_SKILL_MIN = 50;
// After a level test that wasn't passed, the next one opens this many days later.
export const LEVEL_RETAKE_DAYS = 7;

// The level test's questions for a learner, at the level: the questions
// written only for level tests first (never practised anywhere else), then
// unseen ones. Questions used in `exposureCap` real tests or more go last
// (kept out while enough others remain), so a real test's questions don't circulate.
export async function levelTestItemIds(level: string, userId: string, exposureCap = Infinity): Promise<string[]> {
  const seen = await seenItemIds(userId);
  const ids: string[] = [];
  for (const part of LEVEL_TEST_BLUEPRINT) {
    const r = await pool.query(
      `SELECT id, certified_exposures, pool = 'level_test' AS reserved FROM items WHERE item_type_id = $1 AND cefr_level = $2 AND status = 'approved' AND exam_part_id IS NULL`,
      [part.itemTypeId, level],
    );
    const pool_ = shuffle(r.rows as { id: string; certified_exposures: number; reserved: boolean }[]).sort(
      (a, b) =>
        Number(b.reserved) - Number(a.reserved) ||
        Number(a.certified_exposures >= exposureCap) - Number(b.certified_exposures >= exposureCap) ||
        Number(seen.has(a.id)) - Number(seen.has(b.id)),
    );
    ids.push(...pool_.slice(0, part.count).map((x) => x.id));
  }
  return ids;
}

// Whether a finished level test was passed, from each skill's share right
// (pass marks from the assessment settings when given).
export function levelTestPassed(
  overallPercent: number | null,
  skillPercents: Record<string, number | null | undefined>,
  marks: { overall: number; skill: number } = { overall: LEVEL_PASS_OVERALL, skill: LEVEL_SKILL_MIN },
): boolean {
  if (overallPercent === null || overallPercent < marks.overall) return false;
  const skills = Object.values(skillPercents).filter((x): x is number => typeof x === "number");
  return skills.length > 0 && skills.every((p) => p >= marks.skill);
}
