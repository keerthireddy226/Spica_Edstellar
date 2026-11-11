// How a test question is read out, as SSML (the format the owner approved on
// 2026-10-20, first in scripts/recordVersantAudio.ts):
// - Conversations: "Speaker A" / "Speaker B" before each turn, a pause
//   between turns and a longer pause before the question.
// - Passage Comprehension: the passage, a pause, then the question.
// - Sentence Builds: each word group with a pause between them.
// - Every other type: the text as written.
// null when the question has nothing to read out this way.
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ssml = (body: string) => `<speak>${body}</speak>`;
const pause = (ms: number) => `<break time="${ms}ms"/>`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// "A: Hi. B: Hello. A: Bye." -> [{ speaker: "A", text: "Hi." }, ...]
export function dialogueTurns(dialogue: string): { speaker: string; text: string }[] {
  return dialogue
    .split(/\s*(?=\b[A-Z]:\s)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([A-Z]):\s*([\s\S]*)$/);
      return m ? { speaker: m[1], text: m[2].trim() } : { speaker: "A", text: part };
    })
    .filter((t) => t.text);
}

export function spokenSsml(type: string, content: Record<string, unknown>): string | null {
  if (type === "conversations" && str(content.dialogue)) {
    // A short silence first, so a device waking up doesn't clip "Speaker A".
    const turns = dialogueTurns(str(content.dialogue)).map(
      (t) => `Speaker <say-as interpret-as="characters">${t.speaker}</say-as>.${pause(500)}${escapeXml(t.text)}`,
    );
    return ssml(`${pause(400)}${turns.join(pause(800))}${pause(1200)}${escapeXml(str(content.question))}${pause(300)}`);
  }
  if (type === "passage_comprehension" && str(content.story)) {
    return ssml(`${escapeXml(str(content.story))}${pause(1200)}${escapeXml(str(content.question))}`);
  }
  if (type === "sentence_builds" && Array.isArray(content.groups)) {
    return ssml((content.groups as unknown[]).map((g) => escapeXml(str(g))).join(pause(700)));
  }
  if (type.startsWith("lc_")) return null;
  const text = str(content.text) || str(content.question) || str(content.story);
  return text ? ssml(escapeXml(text)) : null;
}
