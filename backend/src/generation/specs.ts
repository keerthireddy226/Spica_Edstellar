// What each question type the pipeline can write looks like: the brief the
// generator gets, the JSON shape it must return, and the schema checks
// (ported from scripts/validateExamSets.py, which checks hand-made sets).
// LanguageCert-style types first; Versant types come later.

export type Json = Record<string, unknown>;

export interface GeneratedItem {
  topic: string;
  content: Json;
  answer_set: Json;
  explanation: Json | null;
}

const opts3 = { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 };
const question = (withStem: boolean) => ({
  type: "object",
  properties: { ...(withStem ? { stem: { type: "string" } } : {}), options: opts3 },
  required: withStem ? ["stem", "options"] : ["options"],
});
const singleExplanation = {
  type: "object",
  properties: {
    why: { type: "string", description: "Why the correct option is right, in one or two sentences a learner understands." },
    evidence: { type: "string", description: "The exact words in the text or recording that give the answer." },
    distractors: { type: "array", items: { type: "string" }, description: "For each option in order, why it is right or wrong." },
  },
  required: ["why", "evidence", "distractors"],
};
const groupExplanation = { type: "object", properties: { questions: { type: "array", items: singleExplanation } }, required: ["questions"] };

interface Spec {
  // For the generator: what one question of this type is.
  brief: string;
  content: Json;
  // "single": correctIndex; "group": correct[]; "free": no key.
  key: "single" | "group" | "free";
  groupSize?: number;
  // The text whose level and length matter, for checks.
  mainText: (c: Json) => string;
  validate: (c: Json, a: Json) => string[];
  // Listening: the longest acceptable recording, in seconds (one play).
  maxAudioSeconds?: number;
}

const words = (s: unknown) => (typeof s === "string" ? (s.match(/[A-Za-z0-9'’-]+/g) ?? []).length : 0);
const str = (v: unknown) => typeof v === "string" && v.trim().length > 0;

function threeOptions(o: unknown): string[] {
  if (!(Array.isArray(o) && o.length === 3 && o.every(str))) return ["needs 3 non-empty options"];
  if (new Set(o.map((x: string) => x.trim().toLowerCase())).size < 3) return ["duplicate options"];
  return [];
}

function singleKey(a: Json): string[] {
  return [0, 1, 2].includes(a.correctIndex as number) ? [] : ["correctIndex must be 0-2"];
}

function groupKey(a: Json, n: number): string[] {
  const c = a.correct;
  return Array.isArray(c) && c.length === n && c.every((x) => [0, 1, 2].includes(x)) ? [] : [`answer_set.correct must be ${n} indexes 0-2`];
}

function groupQuestions(c: Json, n: number, needStem: boolean): string[] {
  const qs = c.questions;
  if (!(Array.isArray(qs) && qs.length === n)) return [`needs exactly ${n} questions`];
  return qs.flatMap((q: Json, i: number) => [
    ...threeOptions(q?.options).map((p) => `question ${i + 1}: ${p}`),
    ...(needStem && !str(q?.stem) ? [`question ${i + 1}: missing stem`] : []),
  ]);
}

function range(label: string, n: number, min: number, max: number): string[] {
  return n < min || n > max ? [`${label} should be ${min}-${max} words (has ${n})`] : [];
}

export const SPECS: Record<string, Spec> = {
  lc_listen_mcq: {
    brief:
      "A short recording (one speaker, 15-45 words: an announcement, a message, someone describing something) and one question about it with 3 options. Exactly one option is right; the others are plausible but clearly wrong for someone who understood.",
    content: { type: "object", properties: { audio: { type: "string" }, question: { type: "string" }, options: opts3 }, required: ["audio", "question", "options"] },
    key: "single",
    mainText: (c) => String(c.audio ?? ""),
    validate: (c, a) => [...threeOptions(c.options), ...singleKey(a), ...(str(c.question) ? [] : ["missing question"]), ...range("audio", words(c.audio), 10, 60)],
    maxAudioSeconds: 30,
  },
  lc_listen_reply: {
    brief: "One thing a speaker says (a question or remark, 3-20 words) and 3 possible replies. Exactly one reply is natural and appropriate.",
    content: { type: "object", properties: { audio: { type: "string" }, options: opts3 }, required: ["audio", "options"] },
    key: "single",
    mainText: (c) => String(c.audio ?? ""),
    validate: (c, a) => [...threeOptions(c.options), ...singleKey(a), ...range("audio", words(c.audio), 2, 25)],
    maxAudioSeconds: 12,
  },
  lc_listen_dialogue: {
    brief:
      'A short dialogue of 2-4 turns written as "A: ...\\nB: ...", ending where the next speaker should reply, and 3 options for that next turn. Exactly one option completes the dialogue naturally.',
    content: { type: "object", properties: { audio: { type: "string" }, options: opts3 }, required: ["audio", "options"] },
    key: "single",
    mainText: (c) => String(c.audio ?? ""),
    validate: (c, a) => [
      ...threeOptions(c.options),
      ...singleKey(a),
      ...(String(c.audio ?? "").includes("A:") ? [] : ['dialogue should use "A:" and "B:"']),
      ...range("audio", words(c.audio), 8, 60),
    ],
    maxAudioSeconds: 30,
  },
  lc_listen_conversation: {
    brief:
      'A conversation between two people (80-150 words, "A: ...\\nB: ..." turns) and 2 questions about it, each with a stem and 3 options. Answers must depend on details or attitudes in the conversation, not on general knowledge.',
    content: {
      type: "object",
      properties: { audio: { type: "string" }, questions: { type: "array", items: question(true), minItems: 2, maxItems: 2 } },
      required: ["audio", "questions"],
    },
    key: "group",
    groupSize: 2,
    mainText: (c) => String(c.audio ?? ""),
    validate: (c, a) => [...groupQuestions(c, 2, true), ...groupKey(a, 2), ...range("conversation", words(c.audio), 70, 170)],
    maxAudioSeconds: 75,
  },
  lc_listen_long: {
    brief:
      "A longer recording (250-400 words: a talk, an interview written as A:/B: turns, or a radio piece) and 5 questions in the order the information comes, each with a stem and 3 options.",
    content: {
      type: "object",
      properties: { audio: { type: "string" }, questions: { type: "array", items: question(true), minItems: 5, maxItems: 5 } },
      required: ["audio", "questions"],
    },
    key: "group",
    groupSize: 5,
    mainText: (c) => String(c.audio ?? ""),
    validate: (c, a) => [...groupQuestions(c, 5, true), ...groupKey(a, 5), ...range("recording", words(c.audio), 230, 430)],
    maxAudioSeconds: 210,
  },
  lc_read_short: {
    brief: "A short real-world text (a sign, notice, label, text message or short email, 8-60 words), one question about it and 3 options.",
    content: { type: "object", properties: { text: { type: "string" }, question: { type: "string" }, options: opts3 }, required: ["text", "question", "options"] },
    key: "single",
    mainText: (c) => String(c.text ?? ""),
    validate: (c, a) => [...threeOptions(c.options), ...singleKey(a), ...(str(c.question) ? [] : ["missing question"]), ...range("text", words(c.text), 4, 70)],
  },
  lc_read_cloze: {
    brief:
      'A text of 80-150 words (email, article, story) with exactly 5 gaps written "(1) ____" to "(5) ____", and for each gap 3 options (words or short phrases). Each gap tests grammar or vocabulary; only one option fits.',
    content: {
      type: "object",
      properties: { passage: { type: "string" }, questions: { type: "array", items: question(false), minItems: 5, maxItems: 5 } },
      required: ["passage", "questions"],
    },
    key: "group",
    groupSize: 5,
    mainText: (c) => String(c.passage ?? ""),
    validate: (c, a) => {
      const p = String(c.passage ?? "");
      const gaps = [1, 2, 3, 4, 5].filter((g) => !p.includes(`(${g}) ____`)).map((g) => `passage missing gap (${g}) ____`);
      return [...groupQuestions(c, 5, false), ...groupKey(a, 5), ...gaps, ...range("passage", words(p), 70, 200)];
    },
  },
  lc_read_gap: {
    brief: "One sentence with one gap written ____ and 3 options (a word or short phrase). Only one option is grammatically and logically right.",
    content: { type: "object", properties: { sentence: { type: "string" }, options: opts3 }, required: ["sentence", "options"] },
    key: "single",
    mainText: (c) => String(c.sentence ?? ""),
    validate: (c, a) => [
      ...threeOptions(c.options),
      ...singleKey(a),
      ...(String(c.sentence ?? "").split("____").length === 2 ? [] : ["sentence needs exactly one ____"]),
    ],
  },
  lc_read_long: {
    brief:
      "A text of 300-550 words (article, blog post, report, story) with a title on the first line, and 5 questions in text order, each with a stem and 3 options. Include questions on detail, opinion and the main idea.",
    content: {
      type: "object",
      properties: { passage: { type: "string" }, questions: { type: "array", items: question(true), minItems: 5, maxItems: 5 } },
      required: ["passage", "questions"],
    },
    key: "group",
    groupSize: 5,
    mainText: (c) => String(c.passage ?? ""),
    validate: (c, a) => [...groupQuestions(c, 5, true), ...groupKey(a, 5), ...range("passage", words(c.passage), 280, 600)],
  },
  lc_write_task2: {
    brief:
      'A writing task: a realistic situation and a request to write a report, an article or a review, ending with "(200-250 words)" and 3 bullet points ("- ...") of what to include.',
    content: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    key: "free",
    mainText: (c) => String(c.prompt ?? ""),
    validate: (c) => [...(str(c.prompt) ? [] : ["missing prompt"]), ...(String(c.prompt ?? "").includes("200-250 words") ? [] : ["prompt must say (200-250 words)"])],
  },
  lc_speak_personal: {
    brief: "A personal question an examiner asks (about home, work, study, free time, plans), answerable in 30-45 seconds.",
    content: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    key: "free",
    mainText: (c) => String(c.prompt ?? ""),
    validate: (c) => (str(c.prompt) && String(c.prompt).length >= 10 ? [] : ["missing prompt"]),
  },
  lc_speak_discussion: {
    brief: "A discussion task: a situation and a decision to reach, with exactly 5 ideas to talk about.",
    content: {
      type: "object",
      properties: { prompt: { type: "string" }, ideas: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } },
      required: ["prompt", "ideas"],
    },
    key: "free",
    mainText: (c) => String(c.prompt ?? ""),
    validate: (c) => [...(str(c.prompt) ? [] : ["missing prompt"]), ...(Array.isArray(c.ideas) && c.ideas.length === 5 && c.ideas.every(str) ? [] : ["needs 5 ideas"])],
  },
  lc_speak_presentation: {
    brief: "A topic for a short talk (a short title) with 2-3 points to cover, each a question.",
    content: {
      type: "object",
      properties: { prompt: { type: "string" }, points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 } },
      required: ["prompt", "points"],
    },
    key: "free",
    mainText: (c) => String(c.prompt ?? ""),
    validate: (c) => [...(str(c.prompt) ? [] : ["missing prompt"]), ...(Array.isArray(c.points) && c.points.length >= 2 && c.points.length <= 3 && c.points.every(str) ? [] : ["needs 2-3 points"])],
  },
  lc_speak_followup: {
    brief: "A follow-up question asking for an opinion on a wider issue, answerable in 30-45 seconds.",
    content: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] },
    key: "free",
    mainText: (c) => String(c.prompt ?? ""),
    validate: (c) => (str(c.prompt) && String(c.prompt).length >= 10 ? [] : ["missing prompt"]),
  },
};

export const GENERATABLE_TYPES = Object.keys(SPECS);

// The JSON schema the generator must follow for a batch of this type.
export function batchSchema(itemTypeId: string): Json {
  const s = SPECS[itemTypeId];
  const answer =
    s.key === "single"
      ? { type: "object", properties: { correctIndex: { type: "integer", minimum: 0, maximum: 2 } }, required: ["correctIndex"] }
      : s.key === "group"
        ? { type: "object", properties: { correct: { type: "array", items: { type: "integer", minimum: 0, maximum: 2 } } }, required: ["correct"] }
        : { type: "object", properties: {} };
  const item: Json = {
    type: "object",
    properties: {
      topic: { type: "string", description: "Two or three words, e.g. 'booking a hotel'." },
      content: s.content,
      answer_set: answer,
      ...(s.key === "free" ? {} : { explanation: s.key === "group" ? groupExplanation : singleExplanation }),
    },
    required: ["topic", "content", "answer_set", ...(s.key === "free" ? [] : ["explanation"])],
  };
  return { type: "object", properties: { items: { type: "array", items: item } }, required: ["items"] };
}

// The questions of an item with options, uniformly, for the answer check.
export function mcqQuestions(itemTypeId: string, c: Json): { stem: string; options: string[] }[] {
  const s = SPECS[itemTypeId];
  if (s?.key === "single") return [{ stem: String(c.question ?? (itemTypeId === "lc_read_gap" ? "Choose the word or phrase for the gap." : "Choose the best option.")), options: (c.options as string[]) ?? [] }];
  if (s?.key === "group") {
    return ((c.questions as Json[]) ?? []).map((q, i) => ({ stem: String(q.stem ?? `Gap (${i + 1})`), options: (q.options as string[]) ?? [] }));
  }
  return [];
}

export function answerIndexes(itemTypeId: string, a: Json): number[] {
  const s = SPECS[itemTypeId];
  if (s?.key === "single") return [a.correctIndex as number];
  if (s?.key === "group") return (a.correct as number[]) ?? [];
  return [];
}

// Everything a learner sees or hears, as plain text (for embeddings).
export function itemText(c: Json): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(c);
  return out.join("\n");
}

export function wordCount(s: string): number {
  return words(s);
}
