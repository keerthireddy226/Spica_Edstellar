import { describe, expect, it } from "vitest";
import { diffSummary, wordDiff } from "./wordDiff.js";

describe("wordDiff", () => {
  it("marks a different word as one substitution", () => {
    const ops = wordDiff("I walk to work.", "I work to work");
    expect(ops.filter((o) => o.op !== "same")).toEqual([{ op: "sub", word: "walk", said: "work" }]);
  });

  it("finds missing and added words", () => {
    const ops = wordDiff("She wanted to know the time", "She want know the time now");
    expect(ops.filter((o) => o.op === "missing").map((o) => o.word)).toContain("to");
    expect(ops.filter((o) => o.op === "extra").map((o) => o.said)).toEqual(["now"]);
  });

  it("treats British and American spellings and case as the same word", () => {
    const ops = wordDiff("The colour of the organisation", "the color of the organization");
    expect(ops.every((o) => o.op === "same")).toBe(true);
    expect(diffSummary(ops).accuracy).toBe(1);
  });

  it("scores accuracy against the target's words", () => {
    expect(diffSummary(wordDiff("one two three four", "one two")).accuracy).toBe(0.5);
  });
});
