import { describe, expect, it } from "vitest";
import { saidWordForWord } from "./wordDiff.js";

describe("saidWordForWord", () => {
  it("a Repeat said back exactly matches, ignoring case and punctuation", () => {
    expect(saidWordForWord("repeats", { exact: "It often rains in April." }, {}, "it often rains in april")).toBe(true);
  });
  it("a missing, different or added word doesn't match", () => {
    expect(saidWordForWord("repeats", { exact: "It often rains in April." }, {}, "It rains in April")).toBe(false);
    expect(saidWordForWord("repeats", { exact: "Kemal bakes bread every morning." }, {}, "Komal bakes bakes bread every morning")).toBe(false);
  });
  it("a Sentence Build matches any accepted order", () => {
    const set = { correct: "The shop closes early on Sundays.", alternates: ["On Sundays the shop closes early."] };
    expect(saidWordForWord("sentence_builds", set, {}, "on sundays the shop closes early")).toBe(true);
    expect(saidWordForWord("sentence_builds", set, {}, "the shop on sundays closes early")).toBe(false);
  });
  it("other tasks and empty answers never match", () => {
    expect(saidWordForWord("conversations", { exact: "x" }, {}, "x")).toBe(false);
    expect(saidWordForWord("repeats", { exact: "Hello there." }, {}, "")).toBe(false);
  });
});
