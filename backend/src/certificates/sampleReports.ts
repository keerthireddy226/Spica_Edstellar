import QRCode from "qrcode";
import { APP_URL } from "../auth/mailer.js";

// Public sample score reports, one for each test, with made-up results. The
// website's Demo page and the sales documents show them (launch plan 8.8).
// Question counts follow each test's Test Description.

type Skill = "speaking" | "listening" | "reading" | "writing";
interface TypeResult {
  itemTypeId: string;
  typeName: string;
  right: number;
  total: number;
}
const T = (itemTypeId: string, typeName: string, right: number, total: number): TypeResult => ({ itemTypeId, typeName, right, total });
const share = (t: TypeResult) => t.right / t.total;

interface SkillSpec {
  level: string;
  score: number;
  percent: number;
  types: TypeResult[];
}

interface SampleSpec {
  name: string;
  levelTest?: string;
  levelPassed?: boolean;
  overall: { score: number; level: string };
  skills: Partial<Record<Skill, SkillSpec>>;
  answers: { answered: number; total: number };
  analysis: string;
  speaking?: { answers: number; wordsPerMinute: number; fillers: number; fluency: number; clarity: number; grammar: number; vocabulary: number; example: { typeName: string; transcript: string; comment: string } };
  writing?: { answers: number; grammar: number; vocabulary: number; spelling: number; task: number; errors: Record<string, number>; example: { text: string; correction: string; reason: string } };
  profile: Record<string, number>;
}

// Shared question types, by test (right / total).
const FOUR = {
  rep: T("repeats", "Repeats", 10, 12),
  sb: T("sentence_builds", "Sentence Builds", 5, 6),
  conv: T("conversations", "Conversations", 10, 11),
  ra: T("reading", "Read Aloud", 5, 6),
  sc: T("sentence_completion", "Sentence Completion", 16, 25),
  dic: T("dictation", "Dictation", 3, 6),
  pr: T("passage_reconstruction", "Passage Reconstruction", 2, 4),
};
const SL = {
  sa: T("short_answer", "Questions (Simple)", 8, 9),
  rep: T("repeats", "Repeats", 12, 16),
  conv: T("conversations", "Conversations", 4, 6),
  pc: T("passage_comprehension", "Passage Comprehension", 4, 6),
  sr: T("story_retelling", "Story Retelling", 2, 3),
  oq: T("open_questions", "Open Questions", 1, 2),
};
const WR = {
  sc: T("sentence_completion", "Sentence Completion", 14, 19),
  dic: T("dictation", "Dictation", 9, 14),
  pr: T("passage_reconstruction", "Passage Reconstruction", 3, 4),
  em: T("email_writing", "E-Mail Writing", 1, 2),
  rs: T("response_selection", "Response Selection", 6, 9),
};
const PRO = {
  sc: T("sentence_completion", "Sentence Completion", 13, 18),
  pr: T("passage_reconstruction", "Passage Reconstruction", 3, 4),
  rc: T("reading_comprehension", "Reading Comprehension", 2, 3),
  em: T("email_writing", "E-Mail Writing", 1, 2),
  dic: T("dictation", "Dictation", 2, 3),
  rs: T("response_selection", "Response Selection", 2, 3),
  pc: T("passage_comprehension", "Passage Comprehension", 4, 6),
  rep: T("repeats", "Repeats", 10, 13),
  ss: T("speaking_situations", "Speaking Situations", 3, 4),
  sr: T("story_retelling", "Story Retelling", 2, 3),
};
const PL = {
  ra: T("reading", "Read Aloud", 4, 6),
  rep: T("repeats", "Repeats", 8, 13),
  sb: T("sentence_builds", "Sentence Builds", 5, 9),
  conv: T("conversations", "Conversations", 6, 11),
  sc: T("sentence_completion", "Sentence Completion", 12, 28),
  dic: T("dictation", "Dictation", 3, 6),
  pr: T("passage_reconstruction", "Passage Reconstruction", 2, 5),
  so: T("summary_and_opinion", "Summary and Opinion", 0, 1),
};
const LV = {
  ra: T("reading", "Read Aloud", 3, 3),
  rep: T("repeats", "Repeats", 3, 4),
  sa: T("short_answer", "Questions (Simple)", 3, 3),
  rs: T("response_selection", "Response Selection", 3, 4),
  rc: T("reading_comprehension", "Reading Comprehension", 3, 4),
  sc: T("sentence_completion", "Sentence Completion", 4, 5),
  dic: T("dictation", "Dictation", 3, 4),
  em: T("email_writing", "E-Mail Writing", 0, 1),
};

const SPEAKING_EXAMPLE = { typeName: "Conversations", transcript: "The meeting was moved to Thursday because the manager was travelling.", comment: "Clear and well paced; the answer was complete." };
const WRITING_EXAMPLE = { text: "he go to office", correction: "he goes to the office", reason: "Use 'goes' after he, she or it." };

export const SAMPLE_TESTS: Record<string, SampleSpec> = {
  fourSkills: {
    name: "English 4 Skills Essentials",
    overall: { score: 58, level: "B2" },
    skills: {
      speaking: { level: "B2", score: 67, percent: 86, types: [FOUR.rep, FOUR.sb, FOUR.conv, FOUR.ra] },
      listening: { level: "B2", score: 66, percent: 76, types: [FOUR.rep, FOUR.sb, FOUR.conv, FOUR.dic] },
      reading: { level: "B1", score: 49, percent: 62, types: [FOUR.ra, FOUR.sc, FOUR.pr] },
      writing: { level: "B1", score: 48, percent: 56, types: [FOUR.sc, FOUR.dic, FOUR.pr] },
    },
    answers: { answered: 62, total: 70 },
    analysis:
      "You reached B2 overall. Speaking (B2) is your strongest skill: you repeat and build sentences accurately and speak at a natural pace. Writing (B1) needs the most work: Dictation and Passage Reconstruction lost the most marks.",
    speaking: { answers: 35, wordsPerMinute: 128, fillers: 3, fluency: 82, clarity: 85, grammar: 88, vocabulary: 64, example: SPEAKING_EXAMPLE },
    writing: { answers: 35, grammar: 58, vocabulary: 66, spelling: 61, task: 55, errors: { grammar: 4, spelling: 3, punctuation: 1 }, example: WRITING_EXAMPLE },
    profile: { listening: 76, reading: 62, fluency: 82, pronunciation: 85, spokenGrammar: 88, vocabulary: 64, writtenGrammar: 58, spelling: 61 },
  },
  speakingListening: {
    name: "English Speaking & Listening",
    overall: { score: 60, level: "B2" },
    skills: {
      speaking: { level: "B2", score: 67, percent: 74, types: [SL.sa, SL.rep, SL.conv, SL.pc, SL.sr, SL.oq] },
      listening: { level: "B1", score: 52, percent: 71, types: [SL.sa, SL.rep, SL.conv, SL.pc, SL.sr] },
    },
    answers: { answered: 40, total: 42 },
    analysis:
      "You reached B2 overall. Speaking (B2) is your stronger skill: short answers and repeats were quick and accurate. Listening (B1) needs more work: practise listening for the reason or result a question asks about. In Open Questions, give a reason and an example to make your opinion complete.",
    speaking: { answers: 42, wordsPerMinute: 124, fillers: 4, fluency: 78, clarity: 83, grammar: 80, vocabulary: 66, example: { typeName: "Story Retelling", transcript: "A woman lost her keys on the way to work, so her neighbour drove her to the office and she arrived on time.", comment: "Covered who, what and why; good linking words." } },
    profile: { listening: 71, fluency: 78, pronunciation: 83, spokenGrammar: 80, vocabulary: 66 },
  },
  writing: {
    name: "English Writing",
    overall: { score: 54, level: "B1" },
    skills: {
      listening: { level: "B1", score: 50, percent: 65, types: [WR.dic, WR.rs] },
      reading: { level: "B1", score: 52, percent: 74, types: [WR.sc, WR.pr] },
      writing: { level: "B2", score: 61, percent: 69, types: [WR.sc, WR.dic, WR.pr, WR.em] },
    },
    answers: { answered: 47, total: 49 },
    analysis:
      "You reached B1 overall. Writing (B2) is your strongest skill: your emails covered every point in a polite, clear tone. Listening (B1) needs the most work: Dictation and Response Selection lost the most marks, so practise typing exactly what you hear.",
    writing: { answers: 39, grammar: 66, vocabulary: 70, spelling: 64, task: 72, errors: { grammar: 3, spelling: 4, punctuation: 2 }, example: { text: "I am writing to informed you about the delay.", correction: "I am writing to inform you about the delay.", reason: "Use the base form after 'to'." } },
    profile: { listening: 65, reading: 74, vocabulary: 70, writtenGrammar: 66, spelling: 64 },
  },
  professional: {
    name: "Professional English",
    overall: { score: 57, level: "B2" },
    skills: {
      speaking: { level: "B2", score: 66, percent: 73, types: [PRO.pc, PRO.rep, PRO.ss, PRO.sr] },
      listening: { level: "B1", score: 53, percent: 71, types: [PRO.dic, PRO.rs, PRO.pc, PRO.rep, PRO.sr] },
      reading: { level: "B1", score: 50, percent: 71, types: [PRO.sc, PRO.pr, PRO.rc, PRO.ss] },
      writing: { level: "B2", score: 58, percent: 70, types: [PRO.sc, PRO.pr, PRO.em, PRO.dic] },
    },
    answers: { answered: 57, total: 59 },
    analysis:
      "You reached B2 overall. Speaking (B2) is your strongest skill: you handled workplace situations politely and clearly. Reading (B1) needs the most work: Reading Comprehension and Sentence Completion lost the most marks, so practise reading reports and emails for detail.",
    speaking: { answers: 26, wordsPerMinute: 126, fillers: 3, fluency: 80, clarity: 84, grammar: 82, vocabulary: 68, example: { typeName: "Speaking Situations", transcript: "I'm sorry, I can't make the call at three. Could we move it to four o'clock instead?", comment: "Polite and clear; it answers the situation fully." } },
    writing: { answers: 27, grammar: 62, vocabulary: 68, spelling: 66, task: 70, errors: { grammar: 3, spelling: 2, punctuation: 2 }, example: { text: "Please find attach the report.", correction: "Please find attached the report.", reason: "Use 'attached' (the past participle) in this phrase." } },
    profile: { listening: 71, reading: 71, fluency: 80, pronunciation: 84, spokenGrammar: 82, vocabulary: 68, writtenGrammar: 62, spelling: 66 },
  },
  placement: {
    name: "English Placement",
    overall: { score: 44, level: "B1" },
    skills: {
      speaking: { level: "B1", score: 52, percent: 59, types: [PL.ra, PL.rep, PL.sb, PL.conv] },
      listening: { level: "B1", score: 48, percent: 56, types: [PL.rep, PL.sb, PL.conv, PL.dic] },
      reading: { level: "A2", score: 38, percent: 46, types: [PL.ra, PL.sc, PL.pr, PL.so] },
      writing: { level: "A2", score: 37, percent: 42, types: [PL.sc, PL.dic, PL.pr, PL.so] },
    },
    answers: { answered: 75, total: 80 },
    analysis:
      "You reached B1 overall. Speaking and Listening (B1) are your stronger skills. Writing (A2) needs the most work: Sentence Completion and Summary and Opinion lost the most marks, so practise grammar in short sentences and writing a few connected sentences about a text.",
    speaking: { answers: 39, wordsPerMinute: 104, fillers: 6, fluency: 64, clarity: 72, grammar: 66, vocabulary: 52, example: SPEAKING_EXAMPLE },
    writing: { answers: 40, grammar: 44, vocabulary: 50, spelling: 52, task: 40, errors: { grammar: 7, spelling: 5, punctuation: 3 }, example: WRITING_EXAMPLE },
    profile: { listening: 56, reading: 46, fluency: 64, pronunciation: 72, spokenGrammar: 66, vocabulary: 52, writtenGrammar: 44, spelling: 52 },
  },
  level: {
    name: "Spica Level Tests",
    levelTest: "B1",
    levelPassed: true,
    overall: { score: 52, level: "B1" },
    skills: {
      speaking: { level: "B1", score: 54, percent: 90, types: [LV.ra, LV.rep, LV.sa] },
      listening: { level: "B1", score: 52, percent: 80, types: [LV.rep, LV.sa, LV.rs, LV.dic] },
      reading: { level: "B1", score: 51, percent: 83, types: [LV.ra, LV.rc, LV.sc] },
      writing: { level: "B1", score: 48, percent: 70, types: [LV.sc, LV.dic, LV.em] },
    },
    answers: { answered: 28, total: 28 },
    analysis:
      "You passed the B1 level test: 79% of answers were right, and every skill was above 50%. Speaking was your strongest skill. Writing was the weakest: the email did not cover every point, so practise answering each point the task asks for.",
    speaking: { answers: 10, wordsPerMinute: 112, fillers: 4, fluency: 72, clarity: 78, grammar: 74, vocabulary: 58, example: SPEAKING_EXAMPLE },
    writing: { answers: 10, grammar: 60, vocabulary: 58, spelling: 66, task: 45, errors: { grammar: 4, spelling: 2, punctuation: 2 }, example: WRITING_EXAMPLE },
    profile: { listening: 80, reading: 83, fluency: 72, pronunciation: 78, spokenGrammar: 74, vocabulary: 58, writtenGrammar: 60, spelling: 66 },
  },
};

const ORDER: Skill[] = ["speaking", "listening", "reading", "writing"];

export async function sampleReport(testId: string) {
  const spec = SAMPLE_TESTS[testId] ?? SAMPLE_TESTS.fourSkills;
  const url = `${APP_URL}/certificate/SAMPLE`;
  const skills = ORDER.filter((s) => spec.skills[s]).map((s) => {
    const k = spec.skills[s]!;
    return {
      skill: s,
      level: k.level,
      score: k.score,
      percent: k.percent,
      status: null,
      types: k.types,
      strengths: k.types.filter((t) => share(t) >= 0.75).sort((x, y) => share(y) - share(x)).slice(0, 2),
      focus: k.types.filter((t) => share(t) < 0.6).sort((x, y) => share(x) - share(y)).slice(0, 2),
    };
  });
  return {
    sample: true,
    test: { id: SAMPLE_TESTS[testId] ? testId : "fourSkills", name: spec.name, levelTest: spec.levelTest ?? null, levelPassed: spec.levelPassed ?? null },
    analysis: spec.analysis,
    score: {
      learner: { name: "Sample Candidate", learnerId: "SPC-26-000123" },
      reportId: "SAMPLE",
      completedAt: `${new Date().getFullYear()}-01-15T10:00:00Z`,
      check: { url, qr: await QRCode.toDataURL(url, { margin: 0, width: 160, color: { dark: "#1f3a5f", light: "#ffffff" } }) },
      overall: spec.overall,
      goal: null,
      skills,
      missingSkills: [],
      answers: spec.answers,
      profile: Object.entries(spec.profile).map(([key, value]) => ({ key, value })),
      speaking: spec.speaking ? { silent: 0, ...spec.speaking } : null,
      writing: spec.writing ? { marked: true, ...spec.writing } : null,
    },
  };
}
