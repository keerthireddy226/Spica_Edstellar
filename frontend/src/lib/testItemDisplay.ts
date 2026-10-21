import { tr } from "@/i18n/tr";
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
  "lc_listen_mcq",
  "lc_listen_reply",
  "lc_listen_dialogue",
  "lc_listen_conversation",
  "lc_listen_long",
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
  lc_listen_mcq: { name: "Short Utterances", skills: ["listening"] },
  lc_listen_reply: { name: "Best Reply", skills: ["listening"] },
  lc_listen_dialogue: { name: "Complete the Dialogue", skills: ["listening"] },
  lc_listen_conversation: { name: "Short Conversations", skills: ["listening"] },
  lc_listen_long: { name: "Longer Listening", skills: ["listening"] },
  lc_read_short: { name: "Short Texts", skills: ["reading"] },
  lc_read_cloze: { name: "Gapped Text", skills: ["reading"] },
  lc_read_gap: { name: "Gapped Sentences", skills: ["reading"] },
  lc_read_long: { name: "Longer Texts", skills: ["reading"] },
  lc_write_task1: { name: "Writing Task 1", skills: ["writing"] },
  lc_write_task2: { name: "Writing Task 2", skills: ["writing"] },
  lc_speak_personal: { name: "Personal Questions", skills: ["speaking"] },
  lc_speak_discussion: { name: "Discussion", skills: ["speaking"] },
  lc_speak_presentation: { name: "Presenting a Topic", skills: ["speaking"] },
  lc_speak_followup: { name: "Follow-up Questions", skills: ["speaking"] },
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
  // LanguageCert-style listening: the recording's script. KEEP IN SYNC with backend spokenText.ts.
  if (typeof c.audio === "string") return [formatSpeakers(c.audio)];
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
  const text = (c.text ?? c.question ?? c.sentence ?? c.passage ?? c.prompt ?? c.situation ?? "") as string;
  // Sentence Completion: the word to put in the right form, when there is one,
  // and how many words the gap takes when it's more than one.
  const hint = typeof c.hint_word === "string" ? c.hint_word.trim() : "";
  const words = typeof c.blank_words === "number" && c.blank_words > 1 ? tr("{{n}} words", { n: c.blank_words }) : "";
  const extra = [hint, words].filter(Boolean).join(" · ");
  return extra ? `${text}  (${extra})` : text;
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
  if (item.itemTypeId === "lc_read_short" && typeof c.text === "string" && typeof c.question === "string") {
    return { passage: c.text, question: c.question };
  }
  return null;
}

// Multiple-choice option labels for "radio" input-method items
// (response_selection, reading_comprehension) — empty for every other type.
// Grouped questions (one recording or text, several questions).
export interface GroupQuestion {
  stem?: string;
  options: string[];
}

export function getGroupQuestions(item: TestItem): GroupQuestion[] {
  const c = item.content as Record<string, unknown>;
  return Array.isArray(c.questions) ? (c.questions as GroupQuestion[]) : [];
}

// The answer to a grouped item is a JSON array of chosen option indexes.
export function parseGroupAnswer(answerText: string, count: number): (number | null)[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(answerText);
  } catch {
    // Nothing chosen yet.
  }
  return Array.from({ length: count }, (_, i) => (Array.isArray(parsed) && Number.isInteger(parsed[i]) ? (parsed[i] as number) : null));
}

export function getOptions(item: TestItem): string[] {
  const c = item.content as Record<string, unknown>;
  return Array.isArray(c.options) ? (c.options as string[]) : [];
}
