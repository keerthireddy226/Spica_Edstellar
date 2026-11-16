// The six Spica tests, from each test's Test Description (16 Nov 2026).

export type Skill = "Speaking" | "Listening" | "Reading" | "Writing";

export interface Part {
  task: string;
  items: number;
  answer: "Spoken" | "Typed" | "Chosen";
  time: string;
}

export interface TestInfo {
  slug: string;
  id: string; // the app's test id (sample report)
  name: string;
  short: string;
  forWho: string;
  purpose: string;
  skills: Skill[];
  questions: number;
  minutes: string;
  result: string;
  parts: Part[];
  priceKey: string; // key in prices.ts
  prepKey?: string;
  credits: number; // for organisations
}

export const TESTS: TestInfo[] = [
  {
    slug: "english-4-skills-essentials",
    id: "fourSkills",
    name: "English 4 Skills Essentials",
    short: "An overall English level for work and study, in about 30 minutes.",
    forWho: "Companies, recruiters, universities and individuals who need one reliable level for all four skills.",
    purpose: "Measures everyday and workplace English across speaking, listening, reading and writing, from beginner (A1) to proficient (C2).",
    skills: ["Speaking", "Listening", "Reading", "Writing"],
    questions: 70,
    minutes: "About 30 minutes",
    result: "A Spica score from 10 to 90 and a CEFR level, overall and for each skill.",
    parts: [
      { task: "Repeats", items: 12, answer: "Spoken", time: "15 seconds" },
      { task: "Sentence Builds", items: 6, answer: "Spoken", time: "20 seconds" },
      { task: "Conversations", items: 11, answer: "Spoken", time: "Short answer" },
      { task: "Read Aloud", items: 6, answer: "Spoken", time: "30 seconds" },
      { task: "Sentence Completion", items: 25, answer: "Typed", time: "20 seconds" },
      { task: "Dictation", items: 6, answer: "Typed", time: "30 seconds" },
      { task: "Passage Reconstruction", items: 4, answer: "Typed", time: "30 s reading, 90 s writing" },
    ],
    priceKey: "assessment:fourSkills",
    prepKey: "prep:fourSkills",
    credits: 3,
  },
  {
    slug: "english-placement",
    id: "placement",
    name: "English Placement",
    short: "Places learners at the right level, from beginner to advanced.",
    forWho: "Training companies, language schools and universities placing learners in the right class.",
    purpose: "A broad test that starts easy and becomes harder, so learners at every level can show what they can do.",
    skills: ["Speaking", "Listening", "Reading", "Writing"],
    questions: 80,
    minutes: "About 50 minutes",
    result: "A Spica score from 10 to 90 and a CEFR level, overall and for each skill.",
    parts: [
      { task: "Read Aloud", items: 6, answer: "Spoken", time: "30 seconds" },
      { task: "Repeats", items: 13, answer: "Spoken", time: "15 seconds" },
      { task: "Sentence Builds", items: 9, answer: "Spoken", time: "20 seconds" },
      { task: "Conversations", items: 11, answer: "Spoken", time: "Short answer" },
      { task: "Typing", items: 1, answer: "Typed", time: "60 seconds" },
      { task: "Sentence Completion", items: 28, answer: "Typed", time: "20 seconds" },
      { task: "Dictation", items: 6, answer: "Typed", time: "30 seconds" },
      { task: "Passage Reconstruction", items: 5, answer: "Typed", time: "30 s reading, 90 s writing" },
      { task: "Summary and Opinion", items: 1, answer: "Typed", time: "18 minutes" },
    ],
    priceKey: "assessment:placement",
    prepKey: "prep:placement",
    credits: 1,
  },
  {
    slug: "professional-english",
    id: "professional",
    name: "Professional English",
    short: "Workplace English for professional and client-facing roles.",
    forWho: "Professionals, client-facing staff and managers who use English for emails, meetings and calls.",
    purpose: "Tests the English of real work: reading reports and emails, writing emails, handling spoken situations and following what people say.",
    skills: ["Speaking", "Listening", "Reading", "Writing"],
    questions: 59,
    minutes: "About 60 minutes",
    result: "A Spica score from 10 to 90 and a CEFR level, overall and for each skill.",
    parts: [
      { task: "Sentence Completion", items: 18, answer: "Typed", time: "20 seconds" },
      { task: "Passage Reconstruction", items: 4, answer: "Typed", time: "30 s reading, 90 s writing" },
      { task: "Reading Comprehension", items: 3, answer: "Chosen", time: "3 minutes" },
      { task: "Email Writing", items: 2, answer: "Typed", time: "9 minutes" },
      { task: "Dictation", items: 3, answer: "Typed", time: "30 seconds" },
      { task: "Response Selection", items: 3, answer: "Chosen", time: "8 seconds" },
      { task: "Answer Questions About a Passage", items: 6, answer: "Spoken", time: "Short answer" },
      { task: "Repeats", items: 13, answer: "Spoken", time: "15 seconds" },
      { task: "Speaking Situations", items: 4, answer: "Spoken", time: "60 seconds" },
      { task: "Retell a Passage", items: 3, answer: "Spoken", time: "60 seconds" },
    ],
    priceKey: "assessment:professional",
    prepKey: "prep:professional",
    credits: 4,
  },
  {
    slug: "speaking-and-listening",
    id: "speakingListening",
    name: "English Speaking & Listening",
    short: "Spoken English in about 17 minutes.",
    forWho: "Call centres, customer service and any role that depends on speaking and understanding English.",
    purpose: "Measures how well a person understands spoken English and answers clearly, from short answers to retelling a story and giving an opinion.",
    skills: ["Speaking", "Listening"],
    questions: 42,
    minutes: "About 17 minutes",
    result: "A Spica score from 10 to 90 and a CEFR level for speaking and for listening.",
    parts: [
      { task: "Give a Short Answer", items: 9, answer: "Spoken", time: "10 seconds" },
      { task: "Repeats", items: 16, answer: "Spoken", time: "15 seconds" },
      { task: "Answer a Question About a Conversation", items: 6, answer: "Spoken", time: "Short answer" },
      { task: "Answer Questions About a Passage", items: 6, answer: "Spoken", time: "Short answer" },
      { task: "Retell a Passage", items: 3, answer: "Spoken", time: "60 seconds" },
      { task: "Give Your Opinion", items: 2, answer: "Spoken", time: "45 seconds" },
    ],
    priceKey: "assessment:speakingListening",
    prepKey: "prep:speakingListening",
    credits: 2,
  },
  {
    slug: "writing",
    id: "writing",
    name: "English Writing",
    short: "Written English for office, email and support roles.",
    forWho: "Roles that depend on written English: office, email and chat support, administration.",
    purpose: "Measures typing, grammar in context, careful listening and writing, and real emails, with reading and listening as support skills.",
    skills: ["Writing", "Reading", "Listening"],
    questions: 49,
    minutes: "About 35 minutes",
    result: "A Spica score from 10 to 90 and a CEFR level for writing, reading and listening.",
    parts: [
      { task: "Typing", items: 1, answer: "Typed", time: "60 seconds" },
      { task: "Sentence Completion", items: 19, answer: "Typed", time: "20 seconds" },
      { task: "Dictation", items: 14, answer: "Typed", time: "30 seconds" },
      { task: "Passage Reconstruction", items: 4, answer: "Typed", time: "30 s reading, 90 s writing" },
      { task: "Email Writing", items: 2, answer: "Typed", time: "9 minutes" },
      { task: "Response Selection", items: 9, answer: "Chosen", time: "8 seconds" },
    ],
    priceKey: "assessment:writing",
    prepKey: "prep:writing",
    credits: 2,
  },
  {
    slug: "level-tests",
    id: "level",
    name: "Level Tests (A1–C2)",
    short: "Confirms whether someone has reached one chosen level.",
    forWho: "Companies checking a level after training, or a minimum level for a role; learners checking they are ready to move up.",
    purpose: "Every question is set at the one CEFR level chosen before the test. The result is a clear passed or not passed for that level.",
    skills: ["Speaking", "Listening", "Reading", "Writing"],
    questions: 28,
    minutes: "About 35 minutes",
    result: "Passed or not passed at the chosen level, with results for each skill. To pass: at least 70% overall and 50% in every skill. No certificate.",
    parts: [
      { task: "Read Aloud", items: 3, answer: "Spoken", time: "30 seconds" },
      { task: "Repeats", items: 4, answer: "Spoken", time: "15 seconds" },
      { task: "Give a Short Answer", items: 3, answer: "Spoken", time: "10 seconds" },
      { task: "Response Selection", items: 4, answer: "Chosen", time: "8 seconds" },
      { task: "Reading Comprehension", items: 4, answer: "Chosen", time: "3 minutes" },
      { task: "Sentence Completion", items: 5, answer: "Typed", time: "20 seconds" },
      { task: "Dictation", items: 4, answer: "Typed", time: "30 seconds" },
      { task: "Email Writing", items: 1, answer: "Typed", time: "9 minutes" },
    ],
    priceKey: "level",
    credits: 1,
  },
];

// What each task asks, with a short example in the style of the test.
export const TASKS: Record<string, { does: string; example: string }> = {
  Repeats: { does: "Hear a sentence once and say it back exactly.", example: "“She asked if I could help her.”" },
  "Sentence Builds": { does: "Hear three groups of words in a mixed order and say them as one correct sentence.", example: "“to work” · “the bus” · “I take” → “I take the bus to work.”" },
  Conversations: { does: "Hear a short exchange, then answer a question about it.", example: "A: Shall we walk or take the bus? B: Let's walk, it's not far. — What does B suggest? → “Walking.”" },
  "Read Aloud": { does: "Read a short passage aloud, clearly and naturally.", example: "“Bicycles are a simple and efficient way to travel short distances…”" },
  "Sentence Completion": { does: "Type the missing word that completes the sentence.", example: "“He's been working here ___ five years.” → “for”" },
  Dictation: { does: "Hear a sentence and type exactly what was said.", example: "“He's been studying English for almost two years.”" },
  "Passage Reconstruction": { does: "Read a short passage for 30 seconds, then rewrite it from memory in your own words.", example: "A short notice about a changed meeting time." },
  Typing: { does: "Copy a short text as quickly and accurately as you can.", example: "A few sentences about everyday work." },
  "Summary and Opinion": { does: "Summarise a short article, then give and support your own opinion.", example: "An article on whether schools should give less homework." },
  "Reading Comprehension": { does: "Read a short workplace text and choose the right answer.", example: "A sales summary — “Which region's sales fell?”" },
  "Email Writing": { does: "Write an email that covers every point the situation asks for.", example: "Reply to a customer whose order arrived late: apologise and offer a solution." },
  "E-Mail Writing": { does: "Write an email that covers every point the situation asks for.", example: "Reply to a customer whose order arrived late: apologise and offer a solution." },
  "Response Selection": { does: "Hear a sentence and choose the most natural reply.", example: "“We're over budget this quarter.” → “By how much?”" },
  "Answer Questions About a Passage": { does: "Hear a short story or report, then answer a question about it.", example: "A story about a cancelled flight — “Where did she go next?”" },
  "Speaking Situations": { does: "Read a workplace situation and respond as you would in real life.", example: "Your train is late. Call your manager and explain." },
  "Retell a Passage": { does: "Hear a short story and retell it in your own words.", example: "A short story about a missing package." },
  "Give a Short Answer": { does: "Hear a simple question and answer in a word or a few words.", example: "“Is ice hot or cold?” → “Cold.”" },
  "Answer a Question About a Conversation": { does: "Hear a short conversation and answer a question about it.", example: "A: Is this seat taken? B: No, please sit down. — Is the seat free?" },
  "Give Your Opinion": { does: "Hear a question and give your opinion with reasons.", example: "“Should companies let staff work from home?”" },
};
