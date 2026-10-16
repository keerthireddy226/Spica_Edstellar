// Server-side port of frontend/src/lib/testItemDisplay.ts's getSpokenSegments. KEEP IN SYNC.

// Authored dialogue content is literal "A: ... B: ..." — spelling out
// "Speaker A:"/"Speaker B:" before TTS synthesis makes it audible as actual
// turn-taking instead of "A, colon, ...". KEEP IN SYNC with formatSpeakers
// in frontend/src/lib/testItemDisplay.ts.
function formatSpeakers(dialogue: string): string {
  return dialogue.replace(/\b([A-Z]):/g, "Speaker $1:");
}

export function getSpokenSegments(itemTypeId: string, content: Record<string, unknown>): string[] {
  // LanguageCert-style listening: the recording's script (a dialogue uses "A:"/"B:").
  if (typeof content.audio === "string") return [formatSpeakers(content.audio)];
  if (itemTypeId === "sentence_builds" && Array.isArray(content.groups)) return content.groups as string[];
  if (typeof content.dialogue === "string" && typeof content.question === "string") {
    return [formatSpeakers(content.dialogue), content.question];
  }
  if (typeof content.story === "string" && typeof content.question === "string") {
    return [content.story, content.question];
  }
  if (typeof content.text === "string") return [content.text];
  if (typeof content.question === "string") return [content.question];
  if (typeof content.story === "string") return [content.story];
  return [];
}

// Items whose type needs spoken audio at all — mirrors AUDIO_FIRST_TYPES in
// frontend/src/lib/testItemDisplay.ts exactly. KEEP IN SYNC with that set.
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
