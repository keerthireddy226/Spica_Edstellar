import { describe, expect, it } from "vitest";
import { SPECS, batchSchema, answerIndexes, mcqQuestions } from "./specs.js";
import { statsProblem } from "./stats.js";
import { splitTurns } from "../voice/scriptAudio.js";

describe("specs", () => {
  it("accepts a well-formed gapped sentence and rejects broken ones", () => {
    const v = SPECS.lc_read_gap.validate;
    expect(v({ sentence: "She ____ to work by bus.", options: ["go", "goes", "going"] }, { correctIndex: 1 })).toEqual([]);
    expect(v({ sentence: "No gap here.", options: ["a", "b", "c"] }, { correctIndex: 1 })).toContain("sentence needs exactly one ____");
    expect(v({ sentence: "She ____ well.", options: ["a", "a", "b"] }, { correctIndex: 3 })).toEqual(["duplicate options", "correctIndex must be 0-2"]);
  });

  it("checks a cloze text's five gaps and its key", () => {
    const passage = `${"word ".repeat(80)}(1) ____ (2) ____ (3) ____ (4) ____`;
    const questions = Array.from({ length: 5 }, () => ({ options: ["a", "b", "c"] }));
    const problems = SPECS.lc_read_cloze.validate({ passage, questions }, { correct: [0, 1, 2, 0, 1] });
    expect(problems).toEqual(["passage missing gap (5) ____"]);
  });

  it("requires the word range in a writing task", () => {
    expect(SPECS.lc_write_task2.validate({ prompt: "Write a review of a cafe." }, {})).toContain("prompt must say (200-250 words)");
  });

  it("builds a schema with an explanation for questions with a key, none for open tasks", () => {
    const withKey = batchSchema("lc_listen_mcq") as { properties: { items: { items: { required: string[] } } } };
    const free = batchSchema("lc_speak_personal") as typeof withKey;
    expect(withKey.properties.items.items.required).toContain("explanation");
    expect(free.properties.items.items.required).not.toContain("explanation");
  });

  it("lists a group's questions and key in order", () => {
    const c = { audio: "x", questions: [{ stem: "Q1", options: ["a", "b", "c"] }, { stem: "Q2", options: ["d", "e", "f"] }] };
    expect(mcqQuestions("lc_listen_conversation", c).map((q) => q.stem)).toEqual(["Q1", "Q2"]);
    expect(answerIndexes("lc_listen_conversation", { correct: [2, 0] })).toEqual([2, 0]);
  });
});

describe("statsProblem", () => {
  it("waits for enough answers", () => {
    expect(statsProblem({ n: 10, mean: 1, discrimination: null })).toBeNull();
  });
  it("flags questions almost everyone gets right or wrong, or that strong learners fail", () => {
    expect(statsProblem({ n: 40, mean: 0.97, discrimination: 0.2 })).toMatch(/right/);
    expect(statsProblem({ n: 40, mean: 0.05, discrimination: 0.2 })).toMatch(/wrong/);
    expect(statsProblem({ n: 40, mean: 0.5, discrimination: -0.1 })).toMatch(/stronger learners/);
    expect(statsProblem({ n: 40, mean: 0.6, discrimination: 0.3 })).toBeNull();
  });
});

describe("splitTurns", () => {
  it("splits a dialogue into speakers and keeps a monologue whole", () => {
    expect(splitTurns("A: Hi.\nB: Hello.\nA: Bye.")).toEqual([
      { speaker: "A", text: "Hi." },
      { speaker: "B", text: "Hello." },
      { speaker: "A", text: "Bye." },
    ]);
    expect(splitTurns("Welcome to the museum.\nPlease keep your bags with you.")).toEqual([{ speaker: null, text: "Welcome to the museum.\nPlease keep your bags with you." }]);
  });
});
