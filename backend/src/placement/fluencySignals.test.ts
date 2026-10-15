import { describe, expect, it } from "vitest";
import { computeFluencySignals, isTrulyCorrect, DELIVERY_FLOOR } from "./fluencySignals.js";
import { passThresholdForLevel } from "./cefr.js";

describe("computeFluencySignals", () => {
  it("counts words and unambiguous filler interjections", () => {
    const result = computeFluencySignals("Um, I think, uh, this is correct.", 5000);
    expect(result.wordCount).toBe(7);
    expect(result.fillerCount).toBe(2);
  });

  it("does not treat ordinary words like 'like' as fillers", () => {
    const result = computeFluencySignals("I like apples and I like oranges too.", 5000);
    expect(result.fillerCount).toBe(0);
  });

  it("computes words per minute from word count and duration", () => {
    // 10 words in 5000ms = 120 words/minute.
    const result = computeFluencySignals("one two three four five six seven eight nine ten", 5000);
    expect(result.wordsPerMinute).toBe(120);
  });

  it("reports wordsPerMinute as null under the 1.5s false-start threshold", () => {
    expect(computeFluencySignals("hi there", 1000).wordsPerMinute).toBeNull();
    expect(computeFluencySignals("hi there", null).wordsPerMinute).toBeNull();
    expect(computeFluencySignals("hi there", undefined).wordsPerMinute).toBeNull();
  });

  it("handles empty input without crashing", () => {
    // 0 words in 5000ms is still a defined (if meaningless) rate of 0 wpm —
    // only a too-short duration reports wordsPerMinute as null, not an empty transcript.
    expect(computeFluencySignals("", 5000)).toEqual({ wordCount: 0, wordsPerMinute: 0, fillerCount: 0 });
  });
});

describe("isTrulyCorrect", () => {
  it("is false when there's no content score at all", () => {
    expect(isTrulyCorrect(null, "B1", "text", null, passThresholdForLevel)).toBe(false);
  });

  it("for non-mic input, correctness is content score alone against the level's bar", () => {
    expect(isTrulyCorrect(0.65, "B1", "text", null, passThresholdForLevel)).toBe(true);
    expect(isTrulyCorrect(0.64, "B1", "text", null, passThresholdForLevel)).toBe(false);
    // Manner scores present but input isn't mic — ignored entirely.
    expect(isTrulyCorrect(0.65, "B1", "text", { wordsPerMinute: 1000 }, passThresholdForLevel)).toBe(true);
  });

  it("for mic input, content below the bar is wrong regardless of manner scores", () => {
    expect(isTrulyCorrect(0.5, "B1", "mic", { wordsPerMinute: 130 }, passThresholdForLevel)).toBe(false);
  });

  it("for mic input with content passing, a wildly off pace fails it", () => {
    expect(isTrulyCorrect(0.9, "B1", "mic", { wordsPerMinute: 30, wordCount: 10 }, passThresholdForLevel)).toBe(false);
    expect(isTrulyCorrect(0.9, "B1", "mic", { wordsPerMinute: 300, wordCount: 10 }, passThresholdForLevel)).toBe(false);
    expect(isTrulyCorrect(0.9, "B1", "mic", { wordsPerMinute: 130, wordCount: 10 }, passThresholdForLevel)).toBe(true);
  });

  it("for a short answer, a low pace never fails it — wordCount under the bar is too noisy for WPM to mean anything", () => {
    // "You cannot" — 2 words, ~38 WPM purely from fixed response latency, content and pronunciation both fine.
    expect(isTrulyCorrect(0.9, "B1", "mic", { wordsPerMinute: 38, wordCount: 2 }, passThresholdForLevel)).toBe(true);
    expect(isTrulyCorrect(0.9, "B1", "mic", { wordsPerMinute: 300, wordCount: 2 }, passThresholdForLevel)).toBe(true);
  });

  it("a missing pace/gemini signal never counts against the learner", () => {
    expect(isTrulyCorrect(0.9, "B1", "mic", {}, passThresholdForLevel)).toBe(true);
    expect(isTrulyCorrect(0.9, "B1", "mic", null, passThresholdForLevel)).toBe(true);
  });

  it("for mic input with content passing, only hard-to-follow delivery fails it", () => {
    expect(
      isTrulyCorrect(0.9, "B1", "mic", { gemini: { pronunciation: DELIVERY_FLOOR - 0.01, fluency: 0.9, comment: "" } }, passThresholdForLevel),
    ).toBe(false);
    expect(
      isTrulyCorrect(0.9, "B1", "mic", { gemini: { pronunciation: 0.9, fluency: DELIVERY_FLOOR - 0.01, comment: "" } }, passThresholdForLevel),
    ).toBe(false);
    expect(
      isTrulyCorrect(0.9, "B1", "mic", { gemini: { pronunciation: DELIVERY_FLOOR, fluency: DELIVERY_FLOOR, comment: "" } }, passThresholdForLevel),
    ).toBe(true);
  });

  it("a clear speaker with an accent passes even at C2", () => {
    // Clear but not native-sounding: used to fail at C2, whose pass mark is 0.95.
    expect(isTrulyCorrect(0.97, "C2", "mic", { gemini: { pronunciation: 0.75, fluency: 0.8, comment: "" } }, passThresholdForLevel)).toBe(true);
  });
});
