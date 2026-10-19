// Question-type definitions ("tracks") for the Versant Practice Modules
// questions written in Claude Code sessions: what each question looks like,
// its length per level, and how a written question becomes an item row.
// Used by loadVersantPractice.ts. No AI calls, no audio.
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_NOTES: Record<Level, string> = {
  A1: "very common everyday words, present simple, short simple sentences",
  A2: "familiar everyday and routine topics, simple past and future, short linked sentences",
  B1: "work, travel, study and news topics, some subordinate clauses, common phrasal verbs",
  B2: "abstract and professional topics, passive voice, conditionals, a wider vocabulary",
  C1: "complex professional and academic topics, nuanced vocabulary, idiomatic and formal register",
  C2: "sophisticated, dense, precise language with subtle meaning and rare but natural vocabulary",
};

export const TOPICS = [
  "workplace and meetings", "travel and transport", "health and fitness", "shopping and money", "food and restaurants",
  "education and training", "technology", "housing and neighbourhood", "environment", "customer service",
  "hobbies and free time", "family and friends", "science and research", "local news and events", "sport",
  "banking and finance", "job applications", "public services", "weather and seasons", "culture and the arts",
];

// --- Tracks ---------------------------------------------------------------

export interface Item {
  content: Record<string, unknown>;
  answerSet: Record<string, unknown> | null;
  topic: string;
}

export interface Track {
  type: string;
  tag: string | null;
  label: string;
  task: string; // what the learner does, for the writer and checker
  words: Record<Level, string>; // length of the main text per level
  schema: Record<string, unknown>; // JSON schema of one question as Claude returns it
  toItem: (q: Record<string, unknown>) => Item | string; // string = reason it's invalid
  mainText: (c: Record<string, unknown>) => string;
  checkFor: string; // what the checker must confirm on top of level and clarity
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
export const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const W = (a: string, b: string, c: string, d: string, e: string, f: string): Record<Level, string> => ({ A1: a, A2: b, B1: c, B2: d, C1: e, C2: f });
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const S = { type: "string" };
const SA = { type: "array", items: S };
const TOPIC = { type: "string", description: "one or two words naming the topic" };

const prompt1 = (field: string, note: string): Pick<Track, "schema" | "toItem" | "mainText"> => ({
  schema: obj({ [field]: { type: "string", description: note }, topic: TOPIC }),
  toItem: (q) => (str(q[field]) ? { content: { [field]: str(q[field]) }, answerSet: null, topic: str(q.topic) } : `missing ${field}`),
  mainText: (c) => str(c[field]),
});

const passageWithPoints = (): Pick<Track, "schema" | "toItem" | "mainText"> => ({
  schema: obj({ passage: S, key_points: { ...SA, description: "2 to 4 short phrases: the main ideas a good answer must keep" }, topic: TOPIC }),
  toItem: (q) => {
    const points = strList(q.key_points);
    if (!str(q.passage)) return "missing passage";
    if (points.length < 2) return "fewer than 2 key points";
    return { content: { passage: str(q.passage) }, answerSet: { key_points: points }, topic: str(q.topic) };
  },
  mainText: (c) => str(c.passage),
});

const readAloud = (tag: string): Track => ({
  type: "reading",
  tag,
  label: `Read Aloud (${tag})`,
  task: "The learner reads the text aloud. It must be natural, easy to pronounce as written, with no abbreviations, symbols, digits or lists.",
  words: tag === "reading" ? W("4-7", "6-9", "7-10", "7-11", "8-12", "8-13") : W("5-8", "8-12", "11-15", "13-17", "15-19", "16-21"),
  ...prompt1("text", "the sentence(s) to read aloud"),
  checkFor: "It reads naturally aloud; no digits, symbols or abbreviations.",
});

const selective = (tag: string): Track => ({
  type: "reading_selective",
  tag,
  label: `Reading (Selective) (${tag})`,
  task: "The learner reads a short notice, message or statement, then answers one question about it in a few words. The answer must be stated in or follow directly from the text, and be short (1 to 4 words).",
  words: tag === "reading" ? W("4-7", "6-10", "9-13", "10-14", "10-15", "10-15") : W("5-8", "8-12", "12-18", "12-18", "13-18", "14-20"),
  schema: obj({ text: S, question: S, acceptable_answers: { ...SA, description: "every short correct answer a learner might give, lower case, most natural first" }, topic: TOPIC }),
  toItem: (q) => {
    const answers = strList(q.acceptable_answers).map((a) => a.toLowerCase());
    if (!str(q.text) || !str(q.question)) return "missing text or question";
    if (!answers.length) return "no answers";
    return { content: { text: str(q.text), question: str(q.question) }, answerSet: { acceptable_answers: answers }, topic: str(q.topic) };
  },
  mainText: (c) => `${str(c.text)} Q: ${str(c.question)}`,
  checkFor: "The question has exactly one correct answer, found in the text; the acceptable answers are all correct and cover the natural ways to say it.",
});

const situations = (tag: string): Track => ({
  type: "speaking_situations",
  tag,
  label: `Speaking Situations (${tag})`,
  task: "The learner reads an everyday or work situation and says what they would say. Write it in the second person and end with a question such as 'What do you say?'.",
  words: tag === "reading" ? W("8-12", "11-15", "13-17", "13-18", "15-20", "17-22") : W("10-14", "12-17", "16-22", "14-19", "16-21", "18-24"),
  ...prompt1("situation", "the situation, ending with a question to the learner"),
  checkFor: "The situation is clear, realistic and the learner knows who they speak to and why.",
});

export const TRACKS: Track[] = [
  {
    type: "sentence_completion",
    tag: null,
    label: "Sentence Completion",
    task: "The learner reads one sentence with a single blank written as ___ and types the ONE missing word. Context must make the word clear. List every single word that fits correctly.",
    words: W("4-7", "7-10", "9-13", "9-13", "10-14", "10-15"),
    schema: obj({ sentence: { type: "string", description: "the sentence with exactly one ___" }, acceptable_answers: { ...SA, description: "every one-word answer that is correct, lower case" }, topic: TOPIC }),
    toItem: (q) => {
      const sentence = str(q.sentence);
      const answers = strList(q.acceptable_answers).map((a) => a.toLowerCase());
      if ((sentence.match(/___/g) ?? []).length !== 1) return "sentence must have exactly one ___";
      if (!answers.length || answers.some((a) => /\s/.test(a))) return "answers must be single words";
      return { content: { sentence }, answerSet: { acceptable_answers: answers }, topic: str(q.topic) };
    },
    mainText: (c) => str(c.sentence),
    checkFor: "Exactly one blank; every listed answer is correct and no other common word fits equally well.",
  },
  {
    type: "typing",
    tag: null,
    label: "Typing",
    task: "The learner copies the text exactly by typing it. Natural, well-punctuated prose; no lists, URLs or unusual symbols.",
    words: W("6-9", "10-13", "12-16", "14-18", "16-20", "17-22"),
    ...prompt1("text", "the text to type"),
    checkFor: "Natural prose with ordinary punctuation, nothing hard to type.",
  },
  {
    type: "email_writing",
    tag: null,
    label: "Email Writing",
    task: "A writing prompt asking the learner to write an email: say who it is to and what it must do (for example ask, explain, apologise, propose, complain).",
    words: W("9-13", "10-14", "13-18", "13-18", "14-20", "18-25"),
    ...prompt1("prompt", "the email task, beginning 'Write an email to'"),
    checkFor: "The reader and the purpose of the email are clear.",
  },
  {
    type: "free_writing",
    tag: null,
    label: "Free Writing",
    task: "A short writing prompt asking for one paragraph: describe, explain, compare or give an opinion.",
    words: W("6-10", "8-12", "10-14", "12-16", "13-18", "15-22"),
    ...prompt1("prompt", "the writing task, beginning 'Write a paragraph'"),
    checkFor: "The prompt is clear and can be answered in one paragraph.",
  },
  {
    type: "reading_comprehension",
    tag: null,
    label: "Reading Comprehension",
    task: "A short passage (notice, email extract, report line or news item) and one question with four options, exactly one correct. Wrong options must be plausible but clearly wrong from the passage.",
    words: W("8-12", "12-16", "18-25", "16-24", "18-26", "24-32"),
    schema: obj({ passage: S, question: S, options: { ...SA, description: "exactly 4 options" }, correct_index: { type: "integer", description: "0-based index of the correct option" }, topic: TOPIC }),
    toItem: (q) => {
      const options = strList(q.options);
      const i = q.correct_index;
      if (!str(q.passage) || !str(q.question)) return "missing passage or question";
      if (options.length !== 4 || new Set(options).size !== 4) return "need 4 different options";
      if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i > 3) return "bad correct_index";
      return { content: { passage: str(q.passage), question: str(q.question), options }, answerSet: { correctIndex: i }, topic: str(q.topic) };
    },
    mainText: (c) => `${str(c.passage)} Q: ${str(c.question)}`,
    checkFor: "Exactly one option is correct from the passage and it is the one marked correct.",
  },
  ...["reading", "writing"].map<Track>((tag) => ({
    type: "passage_reconstruction",
    tag,
    label: `Passage Reconstruction (${tag})`,
    task: "The learner reads a short passage for a limited time, it disappears, and they rewrite it in their own words. It needs a clear sequence of ideas that can be remembered.",
    words: tag === "reading" ? W("8-12", "14-20", "20-28", "18-26", "20-28", "26-34") : W("14-18", "16-22", "20-28", "24-30", "24-30", "24-30"),
    ...passageWithPoints(),
    checkFor: "The passage has a clear, memorable sequence of ideas and the key points match it.",
  })),
  ...["reading", "writing"].map<Track>((tag) => ({
    type: "summary_and_opinion",
    tag,
    label: `Summary & Opinion (${tag})`,
    task: "The learner reads a short passage that presents an issue (ideally with two sides), then summarises it and gives their opinion.",
    words: tag === "reading" ? W("14-20", "22-30", "30-38", "30-40", "45-55", "38-48") : W("8-12", "14-20", "22-28", "22-30", "30-38", "32-40"),
    ...passageWithPoints(),
    checkFor: "The passage presents an issue a learner can summarise and give an opinion on; the key points match it.",
  })),
  readAloud("reading"),
  readAloud("speaking"),
  selective("reading"),
  selective("speaking"),
  situations("reading"),
  situations("speaking"),
];

// --- Duplicate check (plain word overlap, no AI) -------------------------------

export const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2));
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}
export const DUPLICATE_OVERLAP = 0.75;


export function trackKey(t: Track) {
  return t.tag ? `${t.type}/${t.tag}` : t.type;
}
