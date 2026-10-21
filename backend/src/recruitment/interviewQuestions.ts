// Questions a recruiter can ask in the interview to check what the test
// showed: the candidate's weakest skills, and any skill below the job's
// minimum level, probed at the level the job needs. Written questions, no AI.

type Skill = "speaking" | "listening" | "reading" | "writing";
type Band = "basic" | "independent" | "proficient";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const band = (level: string): Band => (LEVELS.indexOf(level) <= 1 ? "basic" : LEVELS.indexOf(level) <= 3 ? "independent" : "proficient");

// Each question with what a good answer at that band shows.
const BANK: Record<Skill, Record<Band, { question: string; listenFor: string }[]>> = {
  speaking: {
    basic: [
      { question: "Tell me about your current job or studies. What do you do on a normal day?", listenFor: "Short, clear sentences about familiar things; simple present tense used correctly." },
      { question: "How did you travel here today?", listenFor: "Can answer a simple question about routine without long pauses." },
    ],
    independent: [
      { question: "Describe a problem you solved at work. What happened, and what did you do?", listenFor: "A connected story with past tenses, and reasons for what they did." },
      { question: "A customer is unhappy with a late delivery. Show me how you would speak to them.", listenFor: "Polite phrases, a clear explanation and an offer of what happens next." },
    ],
    proficient: [
      { question: "What is one change you would make to how your last team worked, and why?", listenFor: "An argued opinion with advantages and disadvantages, fluent and with few pauses." },
      { question: "Explain a complex part of your work to me as if I were new to the field.", listenFor: "Precise vocabulary, rephrasing to make it clear, and natural fluency." },
    ],
  },
  listening: {
    basic: [
      { question: "Give two short instructions (for example: \"Write your name, then the date\"). Ask them to repeat back what to do.", listenFor: "Both steps understood in the right order." },
      { question: "Ask a simple question at normal speed and see if they answer it without repetition.", listenFor: "Understands everyday questions spoken clearly." },
    ],
    independent: [
      { question: "Describe a short work situation in 4–5 sentences, then ask them to summarise it.", listenFor: "The main points and the key detail, without asking you to repeat." },
      { question: "Give a three-step process at normal speed and ask a question about step two.", listenFor: "Follows connected speech and recalls a specific detail." },
    ],
    proficient: [
      { question: "Talk for a minute about a topic with an implied opinion, then ask what you think about it.", listenFor: "Picks up attitude and implied meaning, not only the facts." },
      { question: "Speak faster and use an idiom or two in a question. Check they answer what you meant.", listenFor: "Copes with natural speed and idiomatic language." },
    ],
  },
  reading: {
    basic: [
      { question: "Show a short notice or email (3–4 lines) and ask what it asks them to do.", listenFor: "Finds the main instruction in a simple text." },
      { question: "Show a short timetable or price list and ask one question about it.", listenFor: "Finds specific information quickly." },
    ],
    independent: [
      { question: "Give a one-paragraph work email and ask: what is the problem, and what does the writer want?", listenFor: "The main point and the request, in their own words." },
      { question: "Show a short policy paragraph and ask what an employee must and must not do.", listenFor: "Understands obligations and conditions." },
    ],
    proficient: [
      { question: "Give a short report extract and ask what the author's conclusion is and whether the evidence supports it.", listenFor: "Reads critically: argument, evidence and tone." },
      { question: "Show a dense paragraph and ask them to explain a key sentence in simpler words.", listenFor: "Precise understanding of complex sentences." },
    ],
  },
  writing: {
    basic: [
      { question: "Ask them to write two or three sentences about themselves.", listenFor: "Simple sentences, correct basic word order and spelling." },
      { question: "Ask them to write a short note to a colleague saying they will be late.", listenFor: "The message is clear even if simple." },
    ],
    independent: [
      { question: "Ask for a short email (5–6 sentences) replying to a customer complaint.", listenFor: "Clear structure, polite tone, linking words, few errors that block meaning." },
      { question: "Ask them to summarise a meeting in a few bullet points.", listenFor: "The important points in clear, correct sentences." },
    ],
    proficient: [
      { question: "Ask for a short proposal (one paragraph) recommending a change, with reasons.", listenFor: "Well-organised argument, varied vocabulary and accurate grammar." },
      { question: "Give a badly written paragraph and ask them to improve it.", listenFor: "Spots and fixes errors, improves clarity and tone." },
    ],
  },
};

export interface InterviewQuestion {
  skill: Skill;
  level: string;
  question: string;
  listenFor: string;
  // Why this skill: below the job's minimum, or the candidate's weakest.
  reason: "below_minimum" | "weakest";
}

// Pure: the skills to probe and the questions for each, at the level the job needs.
export function interviewQuestions(result: { skillLevels?: Record<string, string>; skillPercents?: Record<string, number | null> } | null, minLevel: string | null): InterviewQuestion[] {
  const levels = Object.entries(result?.skillLevels ?? {}).filter(([s, l]) => s in BANK && LEVELS.includes(l)) as [Skill, string][];
  if (!levels.length) return [];
  const rank = (s: Skill, l: string) => LEVELS.indexOf(l) * 1000 + (result?.skillPercents?.[s] ?? 50);
  const below = minLevel ? levels.filter(([, l]) => LEVELS.indexOf(l) < LEVELS.indexOf(minLevel)) : [];
  const weakest = [...levels].sort((a, b) => rank(...a) - rank(...b)).filter(([s]) => !below.some(([b]) => b === s));
  const focus: [Skill, string, InterviewQuestion["reason"]][] = [
    ...below.map(([s, l]) => [s, l, "below_minimum"] as [Skill, string, InterviewQuestion["reason"]]),
    ...weakest.slice(0, Math.max(0, 2 - below.length)).map(([s, l]) => [s, l, "weakest"] as [Skill, string, InterviewQuestion["reason"]]),
  ];
  return focus.flatMap(([skill, level, reason]) => {
    // Probe at the job's level when one is set, else at the level the test showed.
    const at = minLevel && LEVELS.indexOf(minLevel) > LEVELS.indexOf(level) ? minLevel : level;
    return BANK[skill][band(at)].map((q) => ({ skill, level, question: q.question, listenFor: q.listenFor, reason }));
  });
}
