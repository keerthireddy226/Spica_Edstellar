import type { Sample } from "@/components/page/SampleQuestion";

// One real practice-test question per test page (recordings in public/samples,
// copied from Spica's practice bank on 17 Nov 2026). Never use real-test questions here.
export const SAMPLES: Record<string, Sample> = {
  "english-4-skills-essentials": {
    audio: "/samples/english-4-skills-essentials.mp3",
    task: "Conversations",
    instruction: "Listen to the conversation between two people, then answer the question you hear.",
    seconds: 14,
    answerBy: "speak",
    answer: "B will look into the invoice.",
    speakers: true,
  },
  "english-placement": {
    audio: "/samples/english-placement.mp3",
    task: "Sentence Builds",
    instruction: "You hear three groups of words in the wrong order. Say them as one correct sentence.",
    seconds: 20,
    answerBy: "speak",
    answer: "They signed the contract yesterday afternoon.",
  },
  "professional-english": {
    audio: "/samples/professional-english.mp3",
    task: "Repeats",
    instruction: "Repeat the sentence exactly as you hear it.",
    seconds: 15,
    answerBy: "speak",
    answer: "Noor's firm spends a fortune protecting its customer records from hackers.",
  },
  "speaking-and-listening": {
    audio: "/samples/speaking-and-listening.mp3",
    task: "Give a Short Answer",
    instruction: "Listen to the question and answer it in a word or a few words.",
    seconds: 10,
    answerBy: "speak",
    answer: "Luggage (or baggage).",
  },
  writing: {
    audio: "/samples/writing.mp3",
    task: "Dictation",
    instruction: "Type the sentence exactly as you hear it.",
    seconds: 30,
    answerBy: "type",
    answer: "She practices violin every single evening.",
  },
  "level-tests": {
    audio: "/samples/level-tests.mp3",
    task: "Repeats",
    instruction: "Repeat the sentence exactly as you hear it.",
    seconds: 15,
    answerBy: "speak",
    answer: "He's planning to study abroad next year.",
  },
};
