import { describe, expect, it } from "vitest";
import { gradeAttempt } from "./grading.js";

// Only exact-match/text-diff types covered here — AI-graded types call out to Gemini, not pure functions.

describe("gradeAttempt", () => {
  it("returns pending when there's no response text at all", async () => {
    const result = await gradeAttempt("dictation", { exact: "hello" }, {}, "A1", null, undefined);
    expect(result).toEqual({ status: "pending", correct: null, score: null, method: null });
  });

  describe("dictation (exact text match)", () => {
    it("matches ignoring case, trailing punctuation, and extra whitespace", async () => {
      const result = await gradeAttempt("dictation", { exact: "The cat sat." }, {}, "A1", null, "the   cat sat");
      expect(result).toEqual({ status: "scored", correct: true, score: 1, method: "exact-match" });
    });

    it("marks a genuinely different answer wrong", async () => {
      const result = await gradeAttempt("dictation", { exact: "The cat sat." }, {}, "A1", null, "the dog ran");
      expect(result.correct).toBe(false);
      expect(result.score).toBe(0);
    });

    it("is pending if the answer set has no exact text configured", async () => {
      const result = await gradeAttempt("dictation", {}, {}, "A1", null, "anything");
      expect(result.status).toBe("pending");
    });
  });

  describe("sentence_completion (any of several accepted answers)", () => {
    it("accepts any listed acceptable answer, normalized", async () => {
      const result = await gradeAttempt(
        "sentence_completion",
        { acceptable_answers: ["against", "Against!"] },
        {},
        "A1",
        null,
        "AGAINST",
      );
      expect(result).toEqual({ status: "scored", correct: true, score: 1, method: "exact-match" });
    });

    it("rejects an answer not in the accepted list", async () => {
      const result = await gradeAttempt("sentence_completion", { acceptable_answers: ["against"] }, {}, "A1", null, "for");
      expect(result.correct).toBe(false);
    });

    it("is pending if there are no acceptable answers configured", async () => {
      const result = await gradeAttempt("sentence_completion", { acceptable_answers: [] }, {}, "A1", null, "for");
      expect(result.status).toBe("pending");
    });
  });

  describe("response_selection / reading_comprehension (multiple choice by index)", () => {
    it("compares the submitted option index to the correct index", async () => {
      const right = await gradeAttempt("response_selection", { correctIndex: 2 }, {}, "A1", null, "2");
      expect(right.correct).toBe(true);
      const wrong = await gradeAttempt("reading_comprehension", { correctIndex: 2 }, {}, "A1", null, "0");
      expect(wrong.correct).toBe(false);
    });

    it("is pending for a non-integer response (never a false 'wrong')", async () => {
      const result = await gradeAttempt("response_selection", { correctIndex: 2 }, {}, "A1", null, "not-a-number");
      expect(result.status).toBe("pending");
    });
  });

  describe("typing (word-level diff against target text)", () => {
    it("scores an exact retype at 1", async () => {
      const result = await gradeAttempt("typing", {}, { text: "The quick brown fox" }, "B1", null, "The quick brown fox");
      expect(result.method).toBe("text-diff");
      expect(result.score).toBe(1);
      // B1's pass bar is 0.65 — a perfect score clears it.
      expect(result.correct).toBe(true);
    });

    it("scores a partial retype proportionally below 1", async () => {
      const result = await gradeAttempt("typing", {}, { text: "The quick brown fox" }, "B1", null, "The quick brown");
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(1);
    });

    it("is pending if the item has no target text", async () => {
      const result = await gradeAttempt("typing", {}, {}, "B1", null, "anything");
      expect(result.status).toBe("pending");
    });
  });

  // Real answer keys from the item bank, which are spelt the American way.
  describe("British, Indian and American spellings", () => {
    it.each([
      ["My neighbor walks to school.", "My neighbour walks to school"],
      ["My colleague likes the color blue.", "my colleague likes the colour blue"],
      ["She apologized for the late delivery.", "She apologised for the late delivery."],
      ["She was criticized for the vagueness of the proposal.", "She was criticised for the vagueness of the proposal"],
      ["The tribunal ruled in the plaintiff's favor, though damages were reduced.", "The tribunal ruled in the plaintiff's favour, though damages were reduced."],
      ["My neighbor negotiated a better price for the flat.", "My neighbour negotiated a better price for the flat"],
    ])("dictation key %j accepts %j", async (key, answer) => {
      const result = await gradeAttempt("dictation", { exact: key }, {}, "B1", null, answer);
      expect(result.correct).toBe(true);
    });

    it("accepts the American spelling against a British key", async () => {
      const result = await gradeAttempt("dictation", { exact: "The organisation travelled to the centre." }, {}, "B1", null, "the organization traveled to the center");
      expect(result.correct).toBe(true);
    });

    it("still marks a different word wrong", async () => {
      const result = await gradeAttempt("dictation", { exact: "I have four meetings." }, {}, "B1", null, "I have for meetings");
      expect(result.correct).toBe(false);
    });

    it("accepts a spelling variant in sentence completion", async () => {
      const result = await gradeAttempt("sentence_completion", { acceptable_answers: ["organize"] }, {}, "B1", null, "organise");
      expect(result.correct).toBe(true);
    });

    it("doesn't count a spelling variant as a typing mistake", async () => {
      const result = await gradeAttempt(
        "typing",
        {},
        { text: "The organization analyzed the program and canceled the meeting." },
        "B1",
        null,
        "The organisation analysed the programme and cancelled the meeting.",
      );
      expect(result.score).toBe(1);
    });
  });

  describe("LanguageCert-style multiple choice", () => {
    it("grades a single question by option index", async () => {
      expect((await gradeAttempt("lc_read_gap", { correctIndex: 2 }, {}, "B1", null, "2")).correct).toBe(true);
      expect((await gradeAttempt("lc_listen_mcq", { correctIndex: 2 }, {}, "B1", null, "0")).correct).toBe(false);
    });

    it("scores a grouped question by the share answered correctly", async () => {
      const result = await gradeAttempt("lc_read_long", { correct: [0, 1, 2, 0, 1] }, {}, "B1", null, "[0,1,2,0,2]");
      expect(result).toMatchObject({ status: "scored", score: 0.8, correct: true, method: "exact-match" });
    });

    it("counts an unanswered question in a group as wrong", async () => {
      const result = await gradeAttempt("lc_listen_conversation", { correct: [1, 2] }, {}, "B1", null, "[1,null]");
      expect(result.score).toBe(0.5);
    });

    it("is pending when the group answer isn't readable", async () => {
      expect((await gradeAttempt("lc_read_cloze", { correct: [0, 1] }, {}, "B1", null, "not json")).status).toBe("pending");
    });
  });

  it("falls back to pending for an item type with no grading rule at all", async () => {
    const result = await gradeAttempt("some_unhandled_type", {}, {}, "A1", null, "anything");
    expect(result).toEqual({ status: "pending", correct: null, score: null, method: null });
  });
});
