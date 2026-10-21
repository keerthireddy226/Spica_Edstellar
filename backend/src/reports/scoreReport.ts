// The learner's score report after a practice test or mock: a Spica score
// (10-90, Spica's own scale aligned to CEFR) overall and per skill, each
// skill's strongest and weakest question types, an eight-part skill profile
// and the speaking and writing breakdowns. Worked out from the stored answers
// when the report is opened: no AI call, nothing to rebuild.
import QRCode from "qrcode";
import { pool } from "../db.js";
import { APP_URL } from "../auth/mailer.js";
import { levelSummary } from "../placement/levels.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import { wordDiff, diffSummary } from "./wordDiff.js";
import type { FeedbackReport } from "./feedbackReport.js";

const SKILLS = ["speaking", "listening", "reading", "writing"] as const;
type Skill = (typeof SKILLS)[number];

// The Spica score's CEFR bands.
export const BANDS = [
  { level: "Pre-A1", min: 10, max: 19 },
  { level: "A1", min: 20, max: 29 },
  { level: "A2", min: 30, max: 39 },
  { level: "B1", min: 40, max: 54 },
  { level: "B2", min: 55, max: 69 },
  { level: "C1", min: 70, max: 79 },
  { level: "C2", min: 80, max: 90 },
] as const;
const ORDER = BANDS.map((b) => b.level as string);

// A skill's level sets its band; the share of its questions right places it within the band.
export function spicaScore(level: string | null | undefined, percent: number | null | undefined): number | null {
  const band = BANDS.find((b) => b.level === level);
  if (!band) return null;
  const p = Math.max(0, Math.min(100, percent ?? 50)) / 100;
  return Math.round(band.min + (band.max - band.min) * p);
}

export function levelOfScore(score: number): string {
  return (BANDS.find((b) => score >= b.min && score <= b.max) ?? (score < 10 ? BANDS[0] : BANDS[BANDS.length - 1])).level;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x: number | null) => (x === null ? null : Math.max(0, Math.min(100, Math.round(x))));

interface Row {
  item_type_id: string;
  type_name: string;
  skills: string[];
  input_method: string;
  cefr_level: string | null;
  content: Record<string, unknown>;
  answer_set: Record<string, unknown> | null;
  response_text: string | null;
  response_uri: string | null;
  status: string;
  content_score: number | null;
  manner_scores: { wordsPerMinute?: number; fillerCount?: number; gemini?: { pronunciation?: number; fluency?: number; transcript?: string; comment?: string } } | null;
}

export interface ScoreReport {
  learner: { name: string; learnerId: string | null };
  reportId: string | null;
  completedAt: string | null;
  // Printed on every page of the PDF: where to check it (a real test's
  // certificate page, otherwise the report itself) and its QR code.
  check: { url: string; qr: string };
  overall: { score: number; level: string } | null;
  goal: string | null;
  skills: {
    skill: Skill;
    score: number;
    level: string;
    percent: number;
    status: "below" | "meets" | "above" | null;
    types: { itemTypeId: string; typeName: string; right: number; total: number }[];
    strengths: { itemTypeId: string; typeName: string; right: number; total: number }[];
    focus: { itemTypeId: string; typeName: string; right: number; total: number }[];
  }[];
  profile: { key: string; value: number | null }[];
  speaking: {
    answers: number;
    // Recordings in which no speech was heard (left out of the scores).
    silent: number;
    wordsPerMinute: number | null;
    fillers: number | null;
    fluency: number | null;
    clarity: number | null;
    grammar: number | null;
    vocabulary: number | null;
    example: { typeName: string; transcript: string; comment: string | null } | null;
  } | null;
  writing: {
    answers: number;
    grammar: number | null;
    vocabulary: number | null;
    spelling: number | null;
    task: number | null;
    errors: Record<string, number>;
    // The scores come from marked errors (a full test report), else from the answers' scores.
    marked: boolean;
    example: { text: string; correction: string; reason: string } | null;
  } | null;
}

const answered = (r: Row) => !!(r.response_text || r.response_uri);
const right = (r: Row) =>
  answered(r) && r.status === "scored" && r.content_score !== null && isTrulyCorrect(Number(r.content_score), r.cefr_level as never, r.input_method, r.manner_scores as never, passThresholdForLevel);
const scoreOf = (r: Row) => (r.status === "scored" && r.content_score !== null ? Number(r.content_score) * 100 : answered(r) ? null : 0);

export async function scoreReport(sessionId: string, stored: FeedbackReport | null): Promise<ScoreReport | null> {
  const s = (
    await pool.query(
      `SELECT s.user_id, s.test_code, s.completed_at, s.composition, s.program_id,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.participant_id, pp.goal_level
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN participant_profiles pp ON pp.user_id = s.user_id WHERE s.id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!s) return null;
  const raw = (
    await pool.query(
      `SELECT i.item_type_id, it.name AS type_name, it.skills, it.input_method, i.cefr_level, i.content, i.answer_set,
         a.response_text, a.response_uri, coalesce(sc.status, 'pending') AS status, sc.content_score, sc.manner_scores
       FROM attempts a JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id LEFT JOIN scores sc ON sc.attempt_id = a.id
       WHERE a.session_id = $1`,
      [sessionId],
    )
  ).rows as Row[];
  if (!raw.length) return null;
  // Questions left blank count as wrong, as in the result saved when the test finished.
  const rows = raw.map((r) => (r.status === "pending" && !answered(r) ? { ...r, status: "scored", content_score: 0 } : r));

  const summary = levelSummary(rows as never);
  const goalRaw: string | null = stored?.target?.level ?? (s.goal_level && s.goal_level !== "unsure" ? s.goal_level : null);
  const goal = goalRaw && ORDER.includes(goalRaw) ? goalRaw : null;

  const skills: ScoreReport["skills"] = [];
  for (const skill of SKILLS) {
    const level = summary?.skillLevels?.[skill as never] as string | undefined;
    const percent = summary?.skillPercents?.[skill as never] as number | undefined;
    const score = spicaScore(level, percent);
    if (!level || score === null) continue;
    // Each question type of the skill: how many right.
    const byType = new Map<string, { itemTypeId: string; typeName: string; right: number; total: number }>();
    for (const r of rows.filter((x) => x.skills.includes(skill) && x.status !== "pending")) {
      const t = byType.get(r.item_type_id) ?? { itemTypeId: r.item_type_id, typeName: r.type_name, right: 0, total: 0 };
      t.total++;
      if (right(r)) t.right++;
      byType.set(r.item_type_id, t);
    }
    const types = [...byType.values()];
    const share = (t: { right: number; total: number }) => t.right / Math.max(1, t.total);
    const status = goal ? (ORDER.indexOf(level) < ORDER.indexOf(goal) ? "below" : ORDER.indexOf(level) > ORDER.indexOf(goal) ? "above" : "meets") : null;
    skills.push({
      skill,
      score,
      level,
      percent: percent ?? 0,
      status,
      types,
      strengths: types.filter((t) => t.total >= 2 && share(t) >= 0.75).sort((a, b) => share(b) - share(a)).slice(0, 2),
      focus: types.filter((t) => share(t) < 0.6).sort((a, b) => share(a) - share(b)).slice(0, 2),
    });
  }
  const overallScore = skills.length ? Math.round(avg(skills.map((x) => x.score))!) : null;

  // Speaking: the recordings' fluency and clarity (0-1 from the grader), speed and fillers.
  const recorded = rows.filter((r) => r.input_method === "mic" && answered(r) && r.status === "scored");
  const heard = (r: Row) => !!(r.manner_scores?.gemini?.transcript?.trim() || r.response_text?.trim());
  const spoken = recorded.filter(heard);
  const silent = recorded.length - spoken.length;
  const gem = spoken.map((r) => r.manner_scores?.gemini).filter((g): g is NonNullable<typeof g> => !!g);
  const wpm = spoken.map((r) => r.manner_scores?.wordsPerMinute).filter((x): x is number => typeof x === "number" && x > 0);
  const fillers = spoken.map((r) => r.manner_scores?.fillerCount).filter((x): x is number => typeof x === "number");
  // Only answered questions: a skipped one says nothing about grammar or vocabulary.
  const typeScore = (types: string[]) => pct(avg(rows.filter((r) => types.includes(r.item_type_id) && answered(r)).map(scoreOf).filter((x): x is number => x !== null)));
  const clarity = pct(avg(gem.map((g) => (g.pronunciation ?? 0) * 100)));
  const fluency = pct(avg(gem.map((g) => (g.fluency ?? 0) * 100)));
  const spokenGrammar = typeScore(["sentence_builds"]);
  const vocabulary = typeScore(["short_answer", "sentence_completion"]);
  // An open answer with the least clear speech, as an example.
  const exampleRow = spoken
    .filter((r) => ["story_retelling", "conversations", "short_answer", "open_questions", "speaking_situations"].includes(r.item_type_id) && (r.manner_scores?.gemini?.transcript || r.response_text))
    .sort((a, b) => (a.manner_scores?.gemini?.pronunciation ?? 1) - (b.manner_scores?.gemini?.pronunciation ?? 1))[0];
  const speaking = recorded.length
    ? {
        answers: spoken.length,
        silent,
        wordsPerMinute: wpm.length ? Math.round(avg(wpm)!) : null,
        fillers: fillers.length ? fillers.reduce((a, b) => a + b, 0) : null,
        fluency,
        clarity,
        grammar: spokenGrammar,
        vocabulary,
        example: exampleRow
          ? { typeName: exampleRow.type_name, transcript: String(exampleRow.manner_scores?.gemini?.transcript || exampleRow.response_text), comment: exampleRow.manner_scores?.gemini?.comment ?? null }
          : null,
      }
    : null;

  // Writing: the marked errors per 100 words (from the full report), else the answers' scores.
  const writtenTypes = ["dictation", "passage_reconstruction", "email_writing", "free_writing", "summary_and_opinion", "typing"];
  const written = rows.filter((r) => writtenTypes.includes(r.item_type_id) && answered(r));
  const marked = (stored?.questions ?? []).filter((q) => q.writing);
  const words = marked.reduce((n, q) => n + (q.writing!.answer.trim().split(/\s+/).filter(Boolean).length || 0), 0);
  const errors = marked.flatMap((q) => q.writing!.errors).reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});
  const fromErrors = (n: number) => (words >= 20 ? pct(100 - (n / words) * 100 * 10) : null);
  const dictationAccuracy = pct(
    avg(
      rows
        .filter((r) => r.item_type_id === "dictation" && r.response_text)
        .map((r) => diffSummary(wordDiff(String(r.answer_set?.exact ?? r.content.text ?? ""), r.response_text ?? "")).accuracy * 100),
    ),
  );
  const firstError = marked.flatMap((q) => q.writing!.errors).find((e) => e.type === "grammar") ?? marked.flatMap((q) => q.writing!.errors)[0];
  const writing = written.length
    ? {
        answers: written.length,
        grammar: fromErrors(errors.grammar ?? 0) ?? typeScore(["passage_reconstruction", "email_writing", "free_writing", "summary_and_opinion"]),
        vocabulary: fromErrors(errors.vocabulary ?? 0),
        spelling: fromErrors((errors.spelling ?? 0) + (errors.punctuation ?? 0)) ?? dictationAccuracy,
        task: typeScore(["passage_reconstruction", "email_writing", "free_writing", "summary_and_opinion"]),
        errors,
        marked: words >= 20,
        example: firstError ? { text: firstError.text, correction: firstError.correction, reason: firstError.reason } : null,
      }
    : null;

  const skillPercent = (k: Skill) => skills.find((x) => x.skill === k)?.percent ?? null;
  const profile = [
    { key: "listening", value: pct(skillPercent("listening")) },
    { key: "reading", value: pct(skillPercent("reading")) },
    { key: "fluency", value: fluency },
    { key: "pronunciation", value: clarity },
    { key: "spokenGrammar", value: spokenGrammar },
    { key: "vocabulary", value: pct(avg([vocabulary, writing?.vocabulary ?? null].filter((x): x is number => x !== null))) },
    { key: "writtenGrammar", value: writing?.grammar ?? null },
    { key: "spelling", value: writing?.spelling ?? null },
  ];

  const cert = (await pool.query(`SELECT code FROM certificates WHERE session_id = $1 AND kind = 'result' AND revoked_at IS NULL LIMIT 1`, [sessionId])).rows[0];
  const checkUrl = cert ? `${APP_URL}/certificate/${cert.code}` : `${APP_URL}/practice-tests/report/${sessionId}`;
  return {
    learner: { name: s.name, learnerId: s.participant_id ?? null },
    reportId: s.test_code ?? null,
    check: { url: checkUrl, qr: await QRCode.toDataURL(checkUrl, { margin: 0, width: 160, color: { dark: "#1f3a5f", light: "#ffffff" } }) },
    completedAt: s.completed_at ? new Date(s.completed_at).toISOString() : null,
    overall: overallScore === null ? null : { score: overallScore, level: levelOfScore(overallScore) },
    goal,
    skills,
    profile,
    speaking,
    writing,
  };
}

// The speaking and writing breakdowns alone (a Practice Modules set).
export async function answerDetail(sessionId: string): Promise<{ speaking: ScoreReport["speaking"]; writing: ScoreReport["writing"] }> {
  const r = await scoreReport(sessionId, null);
  return { speaking: r?.speaking ?? null, writing: r?.writing ?? null };
}
