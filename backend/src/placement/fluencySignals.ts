// Free heuristic fluency signals (transcript/duration only) — supplement content_score, never replace it.

// Unambiguous filler interjections only — words like "like" are also normal
// ("I like apples"), so including them would be a noisy signal.
const FILLER_WORDS = ["um", "umm", "uh", "uhh", "erm", "hmm"];
const FILLER_REGEX = new RegExp(`\\b(${FILLER_WORDS.join("|")})\\b`, "gi");

export interface FluencySignals {
  wordCount: number;
  wordsPerMinute: number | null;
  fillerCount: number;
}

export function computeFluencySignals(responseText: string, durationMs: number | null | undefined): FluencySignals {
  const words = responseText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const fillerCount = (responseText.match(FILLER_REGEX) ?? []).length;

  // Under 1.5s is likely a false start, not a real rate — report unknown
  // rather than a wild number (e.g. "3 words in 0.2s = 900 WPM").
  const wordsPerMinute =
    durationMs && durationMs >= 1500 ? Math.round((wordCount / durationMs) * 60000) : null;

  return { wordCount, wordsPerMinute, fillerCount };
}

// Shape stored in scores.manner_scores (see routes.ts/geminiFluency.ts) —
// both pieces are optional independently.
export interface StoredMannerScores {
  // Recording length, kept while a spoken answer waits for background grading.
  durationMs?: number | null;
  wordCount?: number;
  wordsPerMinute?: number | null;
  fillerCount?: number;
  gemini?: { pronunciation: number; fluency: number; comment: string; model?: string; rubric?: string } | null;
}

// Delivery fails an otherwise correct spoken answer only when it's genuinely
// hard to follow. Holding it to the level's pass mark (0.95 at C2) failed
// clear speakers for not sounding native; the level comes from content
// (structure and vocabulary), not accent.
export const DELIVERY_FLOOR = 0.4;

// Rough, unvalidated "reasonable pace" band (same caveat as cefr.ts) —
// generous, just catches unintelligibly fast/slow, not normal variation.
const MIN_ACCEPTABLE_WPM = 70;
const MAX_ACCEPTABLE_WPM = 220;
// Below this many words, wordsPerMinute is dominated by fixed latency
// (breath, button-press delay) rather than actual speaking rate — e.g. a
// correct 2-word answer ("You cannot") can compute as ~38 WPM. Too noisy to
// gate on below this length.
const MIN_WORD_COUNT_FOR_PACE_CHECK = 4;

// Single definition of "correct" everywhere. Typed: content only. Mic: content must clear the level's bar, pace must be in range, and
// intelligibility and fluency must clear DELIVERY_FLOOR; a missing signal never counts against the learner.
export function isTrulyCorrect(
  contentScore: number | null,
  cefrLevel: string | null,
  inputMethod: string,
  mannerScores: StoredMannerScores | null | undefined,
  passThresholdForLevel: (level: string | null) => number,
): boolean {
  if (contentScore == null) return false;
  const bar = passThresholdForLevel(cefrLevel);
  const contentOk = contentScore >= bar;
  if (inputMethod !== "mic" || !contentOk) return contentOk;

  const wpm = mannerScores?.wordsPerMinute;
  const wordCount = mannerScores?.wordCount;
  const paceIsMeaningful = typeof wordCount !== "number" || wordCount >= MIN_WORD_COUNT_FOR_PACE_CHECK;
  if (paceIsMeaningful && typeof wpm === "number" && (wpm < MIN_ACCEPTABLE_WPM || wpm > MAX_ACCEPTABLE_WPM)) return false;

  const gemini = mannerScores?.gemini;
  if (gemini && (gemini.pronunciation < DELIVERY_FLOOR || gemini.fluency < DELIVERY_FLOOR)) return false;

  return true;
}

