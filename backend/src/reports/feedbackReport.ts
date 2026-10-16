// The AI feedback report after a practice test or mock (ASSESSMENT_ENGINE.md
// section 7). Built in the background from what's already stored; new AI
// calls only for written answers, explanations an older question doesn't
// have yet (then kept on the question), and the summary.
import { pool } from "../db.js";
import { generateJson, type Usage } from "../generation/gemini.js";
import { learnerQuota } from "../programs/quotas.js";
import { activeProgramOf } from "../programs/service.js";
import { wordDiff, diffSummary, type WordOp } from "./wordDiff.js";

export const REPORT_MODEL = process.env.GEMINI_REPORT_MODEL || "gemini-3.5-flash";
const SKILLS = ["listening", "speaking", "reading", "writing"] as const;

type Json = Record<string, unknown>;

interface AttemptRow {
  attempt_id: string;
  item_id: string;
  item_type_id: string;
  input_method: string;
  skills: string[];
  type_name: string;
  part_label: string | null;
  content: Json;
  answer_set: Json | null;
  explanation: Json | null;
  cefr_level: string | null;
  response_text: string | null;
  response_uri: string | null;
  status: string;
  content_score: number | null;
  reason: string | null;
  manner_scores: Json | null;
  // Answered and not fully right (set while building).
  answered_wrong?: boolean;
}

export interface Explanation {
  why?: string;
  evidence?: string;
  distractors?: string[];
}

export interface WritingError {
  text: string;
  correction: string;
  type: "spelling" | "grammar" | "vocabulary" | "punctuation" | "task";
  reason: string;
}

export interface ReportQuestion {
  itemId: string;
  itemTypeId: string;
  typeName: string;
  part: string | null;
  skills: string[];
  level: string | null;
  // What was asked, shortened for the review list.
  prompt: string;
  answered: boolean;
  status: string;
  score: number | null;
  // Multiple choice: each question's options, the chosen and the right one.
  choices?: { stem: string | null; options: string[]; chosen: number | null; correct: number | null; explanation?: Explanation }[];
  // Typed or spoken with a known target: words different, missing, added.
  words?: { target: string; ops: WordOp[]; accuracy: number };
  // Written answers.
  writing?: { answer: string; errors: WritingError[]; modelAnswer: string; comment: string };
  // Spoken open answers.
  speech?: { transcript: string | null; wordsPerMinute: number | null; fillers: number | null; clarity: number | null; comment: string | null; noisy: boolean };
  comment: string | null;
}

export interface NextStep {
  title: string;
  why: string;
  skill: string;
  link: { testTypeId: string } | null;
}

export interface FeedbackReport {
  version: 1;
  level: "summary" | "full";
  deliveryMode: string;
  testTypeId: string | null;
  overall: { cefrLevel: string | null; percent: number | null; skillLevels: Json | null; scoreBand: Json | null };
  target: { level: string; date: string; programName: string } | null;
  analysis: string;
  nextSteps: NextStep[];
  questions?: ReportQuestion[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const short = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function promptOf(r: AttemptRow): string {
  const c = r.content;
  const main = str(c.question) || str(c.prompt) || str(c.sentence) || str(c.situation) || str(c.text) || str(c.audio) || str(c.passage) || str(c.story);
  return short(main.replace(/\s+/g, " ").trim());
}

const WRITING_TYPES = new Set(["email_writing", "free_writing", "lc_write_task1", "lc_write_task2", "summary_and_opinion", "passage_reconstruction"]);

// A known target the learner had to say or type word for word.
function knownTarget(r: AttemptRow): string | null {
  const a = r.answer_set ?? {};
  if (r.item_type_id === "repeats" || r.item_type_id === "dictation" || r.item_type_id === "typing") return str(a.exact) || str(r.content.text) || null;
  if (r.item_type_id === "reading") return str(a.exact) || str(r.content.text) || null;
  if (r.item_type_id === "sentence_builds") {
    const options = [str(a.correct), ...((a.alternates as string[]) ?? [])].filter(Boolean);
    if (!options.length) return null;
    // The version closest to what was said.
    return options.map((t) => ({ t, acc: diffSummary(wordDiff(t, r.response_text ?? "")).accuracy })).sort((x, y) => y.acc - x.acc)[0].t;
  }
  return null;
}

function parseChoices(r: AttemptRow): ReportQuestion["choices"] {
  const c = r.content;
  const a = r.answer_set ?? {};
  const expl = r.explanation as (Explanation & { questions?: Explanation[] }) | null;
  if (r.input_method === "radio") {
    const chosen = r.response_text !== null && r.response_text !== "" && Number.isInteger(Number(r.response_text)) ? Number(r.response_text) : null;
    return [{ stem: str(c.question) || null, options: (c.options as string[]) ?? [], chosen, correct: typeof a.correctIndex === "number" ? a.correctIndex : null, explanation: expl && !expl.questions ? expl : undefined }];
  }
  if (r.input_method === "mcq_group") {
    let given: unknown[] = [];
    try {
      given = JSON.parse(r.response_text ?? "[]");
    } catch {
      given = [];
    }
    const correct = (a.correct as number[]) ?? [];
    return ((c.questions as { stem?: string; options: string[] }[]) ?? []).map((q, i) => ({
      stem: q.stem ?? null,
      options: q.options ?? [],
      chosen: Number.isInteger(given[i]) ? (given[i] as number) : null,
      correct: correct[i] ?? null,
      explanation: expl?.questions?.[i],
    }));
  }
  return undefined;
}

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          questions: { type: "array", items: { type: "object", properties: { why: { type: "string" }, evidence: { type: "string" } }, required: ["why", "evidence"] } },
        },
        required: ["id", "questions"],
      },
    },
  },
  required: ["items"],
};

// Older questions have no explanation: write them once for the questions this
// learner got wrong, and keep them on the question for everyone after.
async function fillExplanations(rows: AttemptRow[], usage: Usage): Promise<void> {
  const need = rows.filter((r) => (r.input_method === "radio" || r.input_method === "mcq_group") && !r.explanation && r.answered_wrong);
  if (need.length === 0) return;
  const prompt = `For each multiple-choice English test question below, explain to a learner why the correct option is right (one or two simple sentences) and give the exact words in the text or recording script that show it. Return one entry per question in the item, in order.

${need
  .map((r) => {
    const choices = parseChoices(r) ?? [];
    return `ITEM ${r.item_id}
${r.content.audio ? "Recording script" : "Text"}: ${str(r.content.audio) || str(r.content.passage) || str(r.content.text) || str(r.content.sentence) || str(r.content.dialogue) || str(r.content.story)}
${choices.map((q, i) => `Q${i + 1}: ${q.stem ?? ""} Options: ${q.options.map((o, j) => `${j}) ${o}`).join("; ")}. Correct: ${q.correct}`).join("\n")}`;
  })
  .join("\n\n")}`;
  const r = await generateJson<{ items: { id: string; questions: { why: string; evidence: string }[] }[] }>({ model: REPORT_MODEL, prompt, schema: EXPLAIN_SCHEMA, temperature: 0.2 });
  usage.inputTokens += r.usage.inputTokens;
  usage.outputTokens += r.usage.outputTokens;
  for (const e of r.data.items ?? []) {
    const row = need.find((x) => x.item_id === e.id);
    if (!row || !e.questions?.length) continue;
    const explanation = row.input_method === "radio" ? e.questions[0] : { questions: e.questions };
    row.explanation = explanation;
    await pool.query(`UPDATE items SET explanation = $2 WHERE id = $1 AND explanation IS NULL`, [row.item_id, JSON.stringify(explanation)]);
  }
}

const WRITING_SCHEMA = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The exact words from the learner's answer, copied character for character." },
          correction: { type: "string" },
          type: { type: "string", enum: ["spelling", "grammar", "vocabulary", "punctuation", "task"] },
          reason: { type: "string", description: "One short line a learner understands." },
        },
        required: ["text", "correction", "type", "reason"],
      },
    },
    modelAnswer: { type: "string", description: "The learner's answer rewritten correctly at the target level, keeping their ideas." },
    comment: { type: "string", description: "Two sentences: what was good and the most important thing to improve." },
  },
  required: ["errors", "modelAnswer", "comment"],
};

async function writingFeedback(r: AttemptRow, usage: Usage): Promise<ReportQuestion["writing"]> {
  const answer = r.response_text ?? "";
  const task = str(r.content.prompt) || str(r.content.passage) || str(r.content.text);
  const prompt = `You are an English teacher marking a learner's written answer (target level ${r.cefr_level ?? "B1"}).
Task: ${task}

Learner's answer:
"""${answer}"""

List the errors (at most 15, most important first). "text" must be copied exactly from the answer. British, American, Indian and other standard spellings are all correct: never mark one as an error. Use type "task" for missing parts of the task. Then rewrite the answer correctly at the target level, keeping the learner's ideas, and add a two-sentence comment.`;
  const res = await generateJson<{ errors: WritingError[]; modelAnswer: string; comment: string }>({ model: REPORT_MODEL, prompt, schema: WRITING_SCHEMA, temperature: 0.2 });
  usage.inputTokens += res.usage.inputTokens;
  usage.outputTokens += res.usage.outputTokens;
  // Only errors whose words are really in the answer can be marked.
  return { answer, errors: (res.data.errors ?? []).filter((e) => e.text && answer.includes(e.text)), modelAnswer: res.data.modelAnswer ?? "", comment: res.data.comment ?? "" };
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    analysis: { type: "string", description: "3-5 sentences to the learner: strengths, weaknesses by skill, against the target if there is one." },
    nextSteps: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: { title: { type: "string" }, why: { type: "string" }, skill: { type: "string", enum: [...SKILLS] } },
        required: ["title", "why", "skill"],
      },
    },
  },
  required: ["analysis", "nextSteps"],
};

// A live test type to practise a skill in: the one just taken if it has the
// skill, else the first that does.
async function skillLink(skill: string, testTypeId: string | null): Promise<{ testTypeId: string } | null> {
  const r = await pool.query(`SELECT id FROM test_types WHERE status = 'live' AND $1 = ANY(skills) ORDER BY (id = $2) DESC, sort_order LIMIT 1`, [skill, testTypeId]);
  return r.rows[0] ? { testTypeId: r.rows[0].id } : null;
}

export async function buildReport(sessionId: string): Promise<void> {
  const s = (await pool.query(`SELECT id, user_id, delivery_mode, composition, result, program_id FROM sessions WHERE id = $1`, [sessionId])).rows[0];
  if (!s) return;
  const quota = await learnerQuota(s.user_id);
  const level: "summary" | "full" = quota?.reportLevel ?? "full";
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  await pool.query(
    `INSERT INTO feedback_reports (session_id, status, report_level, model) VALUES ($1, 'pending', $2, $3)
     ON CONFLICT (session_id) DO UPDATE SET status = 'pending', report_level = $2, model = $3, error = NULL, updated_at = now()`,
    [sessionId, level, REPORT_MODEL],
  );
  try {
    const order: string[] = (s.composition?.itemIds as string[]) ?? [];
    const rows = (
      await pool.query(
        `SELECT a.id AS attempt_id, a.item_id, i.item_type_id, it.input_method, it.skills, it.name AS type_name, ep.part_label,
           i.content, i.answer_set, i.explanation, i.cefr_level, a.response_text, a.response_uri,
           coalesce(sc.status, 'pending') AS status, sc.content_score, sc.reason, sc.manner_scores
         FROM attempts a JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
         LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN scores sc ON sc.attempt_id = a.id
         WHERE a.session_id = $1`,
        [sessionId],
      )
    ).rows as AttemptRow[];
    rows.sort((x, y) => order.indexOf(x.item_id) - order.indexOf(y.item_id));
    for (const r of rows) {
      const answered = !!(r.response_text || r.response_uri);
      r.answered_wrong = answered && r.status === "scored" && Number(r.content_score) < 1;
    }

    const questions: ReportQuestion[] = [];
    if (level === "full") {
      await fillExplanations(rows, usage).catch((err) => console.error("report: explanations failed:", err));
      for (const r of rows) {
        const answered = !!(r.response_text || r.response_uri);
        const q: ReportQuestion = {
          itemId: r.item_id,
          itemTypeId: r.item_type_id,
          typeName: r.type_name,
          part: r.part_label,
          skills: r.skills,
          level: r.cefr_level,
          prompt: promptOf(r),
          answered,
          status: r.status,
          score: r.content_score === null ? null : Number(r.content_score),
          comment: r.reason,
        };
        q.choices = parseChoices(r);
        const target = answered ? knownTarget(r) : null;
        if (target && r.response_text) {
          const ops = wordDiff(target, r.response_text);
          q.words = { target, ops, accuracy: Math.round(diffSummary(ops).accuracy * 100) / 100 };
        }
        if (answered && WRITING_TYPES.has(r.item_type_id) && (r.response_text ?? "").trim().length > 0) {
          q.writing = await writingFeedback(r, usage).catch((err) => {
            console.error("report: writing feedback failed:", err);
            return undefined;
          });
        }
        if (answered && r.input_method === "mic" && !target) {
          const m = (r.manner_scores ?? {}) as { wordsPerMinute?: number; fillerCount?: number; gemini?: { pronunciation?: number; comment?: string }; noise?: { noisy?: boolean } };
          q.speech = {
            transcript: r.response_text,
            wordsPerMinute: m.wordsPerMinute ?? null,
            fillers: m.fillerCount ?? null,
            clarity: m.gemini?.pronunciation ?? null,
            comment: m.gemini?.comment ?? null,
            noisy: !!m.noise?.noisy,
          };
        }
        questions.push(q);
      }
    }

    // Target: the learner's program for this test type.
    const testTypeId: string | null = s.composition?.testTypeId ?? (await pool.query(`SELECT test_type_id FROM exams WHERE id::text = $1`, [s.composition?.examId ?? ""])).rows[0]?.test_type_id ?? null;
    const program = s.program_id
      ? (await pool.query(`SELECT name, target_level, target_date FROM programs WHERE id = $1`, [s.program_id])).rows[0]
      : await activeProgramOf(s.user_id).then((p) => (p && p.test_type_id === testTypeId ? { name: p.name, target_level: p.target_level, target_date: p.target_date } : null));
    const target = program ? { level: program.target_level as string, date: String(program.target_date).slice(0, 10), programName: program.name as string } : null;
    if (program && program.target_date instanceof Date) target!.date = program.target_date.toISOString().slice(0, 10);

    // The summary: one call over the structured results.
    const bySkill = Object.fromEntries(
      SKILLS.map((sk) => {
        const qs = rows.filter((r) => r.skills.includes(sk));
        return [sk, { questions: qs.length, unanswered: qs.filter((r) => !(r.response_text || r.response_uri)).length, wrongTypes: [...new Set(qs.filter((r) => r.answered_wrong).map((r) => r.type_name))] }];
      }).filter(([, v]) => (v as { questions: number }).questions > 0),
    );
    const writingErrors = questions.flatMap((q) => q.writing?.errors ?? []).reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.type]: (acc[e.type] ?? 0) + 1 }), {});
    const wordIssues = questions.reduce((n, q) => n + (q.words ? diffSummary(q.words.ops).substituted + diffSummary(q.words.ops).missing : 0), 0);
    const summaryPrompt = `Write a short feedback summary for an English learner after a ${s.delivery_mode === "mock" ? "mock exam" : "practice test"}.
Results: ${JSON.stringify(s.result ?? {})}
${target ? `Target: ${target.level} by ${target.date} (${target.programName}).` : "No target level set."}
By skill: ${JSON.stringify(bySkill)}
Writing errors by type: ${JSON.stringify(writingErrors)}
Words said or typed differently from a target: ${wordIssues}
Address the learner as "you". Be honest and encouraging, specific, and simple (B1 English). Then give exactly 3 next steps, each a concrete thing to practise, for the weakest skills first. Never mention accents as a problem.`;
    const summary = await generateJson<{ analysis: string; nextSteps: { title: string; why: string; skill: string }[] }>({ model: REPORT_MODEL, prompt: summaryPrompt, schema: SUMMARY_SCHEMA, temperature: 0.3 });
    usage.inputTokens += summary.usage.inputTokens;
    usage.outputTokens += summary.usage.outputTokens;
    const nextSteps: NextStep[] = await Promise.all(
      (summary.data.nextSteps ?? []).slice(0, 3).map(async (n) => ({ ...n, link: await skillLink(n.skill, testTypeId) })),
    );

    const report: FeedbackReport = {
      version: 1,
      level,
      deliveryMode: s.delivery_mode ?? "practice",
      testTypeId,
      overall: { cefrLevel: s.result?.cefrLevel ?? null, percent: s.result?.overallPercent ?? null, skillLevels: s.result?.skillLevels ?? null, scoreBand: s.result?.scoreBand ?? null },
      target,
      analysis: summary.data.analysis ?? "",
      nextSteps,
      ...(level === "full" ? { questions } : {}),
    };
    await pool.query(
      `UPDATE feedback_reports SET status = 'ready', report = $2, input_tokens = $3, output_tokens = $4, updated_at = now() WHERE session_id = $1`,
      [sessionId, JSON.stringify(report), usage.inputTokens, usage.outputTokens],
    );
  } catch (err) {
    await pool.query(`UPDATE feedback_reports SET status = 'failed', error = $2, input_tokens = $3, output_tokens = $4, updated_at = now() WHERE session_id = $1`, [
      sessionId,
      String((err as Error).message ?? err).slice(0, 500),
      usage.inputTokens,
      usage.outputTokens,
    ]);
    throw err;
  }
}

// Recorded answers still being graded: wait for them (the queue retries).
export async function reportReady(sessionId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM attempts a JOIN scores sc ON sc.attempt_id = a.id WHERE a.session_id = $1 AND sc.status = 'pending' AND a.response_uri IS NOT NULL`,
    [sessionId],
  );
  return r.rows[0].n === 0;
}
