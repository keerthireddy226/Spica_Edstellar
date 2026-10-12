import type { TestItem } from "@/api/testSession";

// Heard, not read — showing the source text would let a learner read it back instead of listening.
export const AUDIO_FIRST_TYPES = new Set([
  "repeats",
  "short_answer",
  "sentence_builds",
  "story_retelling",
  "dictation",
  "conversations",
  "passage_comprehension",
  "response_selection",
]);

// Tailwind can't resolve a dynamic `text-${skill}` class at build time — spelled out directly.
export const SKILL_BADGE_CLASS: Record<string, string> = {
  listening: "bg-listening/15 border-listening/40 text-listening",
  speaking: "bg-speaking/15 border-speaking/40 text-speaking",
  reading: "bg-reading/15 border-reading/40 text-reading",
  writing: "bg-writing/15 border-writing/40 text-writing",
};

export const ITEM_TYPE_META: Record<string, { name: string; skills: ("listening" | "speaking" | "reading" | "writing")[] }> = {
  reading: { name: "Read Aloud", skills: ["speaking", "reading"] },
  repeats: { name: "Repeat", skills: ["listening", "speaking"] },
  sentence_builds: { name: "Sentence Builds", skills: ["listening", "speaking"] },
  conversations: { name: "Conversations", skills: ["listening", "speaking"] },
  reading_selective: { name: "Reading (Selective)", skills: ["listening", "speaking", "reading"] },
  short_answer: { name: "Questions (Simple)", skills: ["listening", "speaking"] },
  passage_comprehension: { name: "Passage Comprehension", skills: ["listening", "speaking"] },
  speaking_situations: { name: "Speaking Situations", skills: ["speaking", "reading"] },
  story_retelling: { name: "Story Retellings", skills: ["listening", "speaking"] },
  open_questions: { name: "Open Questions", skills: ["listening", "speaking"] },
  dictation: { name: "Dictation", skills: ["listening", "writing"] },
  response_selection: { name: "Response Selection", skills: ["listening"] },
  passage_reconstruction: { name: "Passage Reconstruction", skills: ["reading", "writing"] },
  summary_and_opinion: { name: "Summary and Opinion", skills: ["reading", "writing"] },
  reading_comprehension: { name: "Reading Comprehension", skills: ["reading"] },
  sentence_completion: { name: "Sentence Completion", skills: ["writing"] },
  typing: { name: "Typing", skills: ["writing"] },
  email_writing: { name: "E-Mail Writing", skills: ["writing"] },
};

// Authored dialogue content is literal "A: ... B: ..." — read aloud as-is
// that's "A, colon" spoken awkwardly. Spelling out "Speaker A:"/"Speaker B:"
// makes the turn-taking structure actually audible. KEEP IN SYNC with
// formatSpeakers in backend/src/voice/spokenText.ts (used at TTS-generation
// time) — same transform, same reason.
export function formatSpeakers(dialogue: string): string {
  return dialogue.replace(/\b([A-Z]):/g, "Speaker $1:");
}

export function getSpokenSegments(item: TestItem): string[] {
  const c = item.content as Record<string, unknown>;
  if (item.itemTypeId === "sentence_builds" && Array.isArray(c.groups)) return c.groups as string[];
  // Types with a heard passage/dialogue AND a follow-up question — both get
  // spoken, in order, not just whichever field a generic fallback finds first.
  if (typeof c.dialogue === "string" && typeof c.question === "string") return [formatSpeakers(c.dialogue), c.question];
  if (typeof c.story === "string" && typeof c.question === "string") return [c.story, c.question];
  if (typeof c.text === "string") return [c.text];
  if (typeof c.question === "string") return [c.question];
  if (typeof c.story === "string") return [c.story];
  return [];
}

export function getVisibleText(item: TestItem): string {
  const c = item.content as Record<string, unknown>;
  return (c.text ?? c.question ?? c.sentence ?? c.passage ?? c.prompt ?? c.situation ?? "") as string;
}

// Types showing a passage plus a separate question, not one field — read silently, then answer.
export function getPassageAndQuestion(item: TestItem): { passage: string; question: string } | null {
  const c = item.content as Record<string, unknown>;
  if (item.itemTypeId === "reading_selective" && typeof c.text === "string" && typeof c.question === "string") {
    return { passage: c.text, question: c.question };
  }
  if (item.itemTypeId === "reading_comprehension" && typeof c.passage === "string" && typeof c.question === "string") {
    return { passage: c.passage, question: c.question };
  }
  return null;
}

// Multiple-choice option labels for "radio" input-method items
// (response_selection, reading_comprehension) — empty for every other type.
export function getOptions(item: TestItem): string[] {
  const c = item.content as Record<string, unknown>;
  return Array.isArray(c.options) ? (c.options as string[]) : [];
}
