import { describe, expect, it } from "vitest";
import { CEFR_LEVELS, cefrRank, percentToCefr, passThresholdForLevel, stepLevel, assessSkillLevel } from "./cefr.js";

describe("cefrRank", () => {
  it("ranks levels in scale order", () => {
    expect(cefrRank("A1")).toBe(0);
    expect(cefrRank("C2")).toBe(CEFR_LEVELS.length - 1);
  });
});

describe("percentToCefr", () => {
  it("maps percent bands to the documented levels", () => {
    expect(percentToCefr(0)).toBe("A1");
    expect(percentToCefr(19)).toBe("A1");
    expect(percentToCefr(20)).toBe("A2");
    expect(percentToCefr(39)).toBe("A2");
    expect(percentToCefr(40)).toBe("B1");
    expect(percentToCefr(59)).toBe("B1");
    expect(percentToCefr(60)).toBe("B2");
    expect(percentToCefr(74)).toBe("B2");
    expect(percentToCefr(75)).toBe("C1");
    expect(percentToCefr(89)).toBe("C1");
    expect(percentToCefr(90)).toBe("C2");
    expect(percentToCefr(100)).toBe("C2");
  });
});

describe("passThresholdForLevel", () => {
  it("returns the per-level bar, stricter at the top than the bottom", () => {
    expect(passThresholdForLevel("A1")).toBe(0.6);
    expect(passThresholdForLevel("B1")).toBe(0.65);
    expect(passThresholdForLevel("C2")).toBe(0.95);
  });

  it("falls back to the B1 bar for null or an unrecognized level", () => {
    expect(passThresholdForLevel(null)).toBe(0.65);
    expect(passThresholdForLevel("not-a-level")).toBe(0.65);
  });
});

describe("stepLevel", () => {
  it("steps one level harder on correct, one easier on wrong", () => {
    expect(stepLevel("B1", true)).toBe("B2");
    expect(stepLevel("B1", false)).toBe("A2");
  });

  it("clamps at the ends of the scale instead of going out of range", () => {
    expect(stepLevel("C2", true)).toBe("C2");
    expect(stepLevel("A1", false)).toBe("A1");
  });
});

describe("assessSkillLevel", () => {
  it("returns a null, non-capped result when nothing is tagged with a real CEFR level", () => {
    expect(assessSkillLevel([])).toEqual({ level: null, cappedByGap: false });
    expect(assessSkillLevel([{ cefrLevel: null, correct: true }])).toEqual({ level: null, cappedByGap: false });
  });

  it("certifies the highest level with enough sample and accuracy at or above its own bar", () => {
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "A2", correct: true },
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "A2", cappedByGap: false });
  });

  it("stops the walk at a true 0% level (a real ceiling, not noise)", () => {
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A2", correct: false },
      { cefrLevel: "A2", correct: false },
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "A1", cappedByGap: false });
  });

  it("treats a single shaky level (below bar, not 0%) as noise and keeps walking", () => {
    // B1 alone is 1 of 2 (50%, below its 0.65), but with A2 below it 3 of 4
    // (75%) clears it, and B2 with B1 is 3 of 4 too, so B2 is the level.
    // (A2 needs its own real evidence too, or the walk stops on that gap
    // before ever reaching B1.)
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "B1", correct: true },
      { cefrLevel: "B1", correct: false },
      { cefrLevel: "B2", correct: true },
      { cefrLevel: "B2", correct: true },
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "B2", cappedByGap: false });
  });

  it("judges each level with the level below, and stops at the first level that misses its bar", () => {
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "A2", correct: false }, // A1+A2: 3 of 4 = 75%, clears A2's 0.6
      { cefrLevel: "B1", correct: true },
      { cefrLevel: "B1", correct: false }, // A2+B1: 2 of 4 = 50%, below B1's 0.65: stop
      { cefrLevel: "B2", correct: true },
      { cefrLevel: "B2", correct: true }, // never reached
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "A2", cappedByGap: false });
  });

  // Two real candidates with the same 21 of 36 speaking answers right got B2
  // and A2 under the old rule (a failed B1 was skipped for one, a 3-of-5 B1
  // just missed for the other). Judged with the level below, both are B1.
  const answers = (counts: Record<string, [number, number]>) =>
    Object.entries(counts).flatMap(([level, [right, total]]) => Array.from({ length: total }, (_, i) => ({ cefrLevel: level, correct: i < right })));
  it("a failed level can't be skipped: 3 of 9 at B1, then 6 of 8 at B2, is B1", () => {
    expect(assessSkillLevel(answers({ A1: [2, 2], A2: [10, 10], B1: [3, 9], B2: [6, 8], C1: [0, 7] }))).toEqual({ level: "B1", cappedByGap: false });
  });
  it("one answer doesn't decide a level: 3 of 5 at B1, after 12 of 12 at A2, is B1", () => {
    expect(assessSkillLevel(answers({ A1: [3, 3], A2: [12, 12], B1: [3, 5], B2: [3, 12], C1: [0, 4] }))).toEqual({ level: "B1", cappedByGap: false });
  });

  it("a level with fewer than MIN_LEVEL_SAMPLE items counts as untested, not passed or failed", () => {
    // Only one A2 item (below the 2-item minimum sample) — treated as a gap.
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "B1", correct: true },
      { cefrLevel: "B1", correct: true },
    ];
    // Gap at A2 with nothing tested beyond it in this input? No — B1 IS
    // tested beyond the gap, so this should be flagged as capped by gap.
    expect(assessSkillLevel(items)).toEqual({ level: "A1", cappedByGap: true });
  });

  it("does not flag cappedByGap when nothing beyond the gap was tested", () => {
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: true },
      // A2 never tested at all — a trailing gap, not a confusing one.
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "A1", cappedByGap: false });
  });

  it("does not penalize untested levels before the first real evidence", () => {
    // Sample starts at B1 (A1/A2 never tested) — that's just where the
    // evidence begins, not a gap.
    const items = [
      { cefrLevel: "B1", correct: true },
      { cefrLevel: "B1", correct: true },
    ];
    expect(assessSkillLevel(items)).toEqual({ level: "B1", cappedByGap: false });
  });

  it("is below A1 when the A1 questions were tested and not passed", () => {
    const items = [
      { cefrLevel: "A1", correct: true },
      { cefrLevel: "A1", correct: false },
      { cefrLevel: "A1", correct: false },
      { cefrLevel: "A2", correct: false },
      { cefrLevel: "A2", correct: false },
    ];
    expect(assessSkillLevel(items)).toEqual({ level: null, cappedByGap: false, belowA1: true });
  });

  it("is below A1 when a test starting at A2 fails A2", () => {
    const items = [
      { cefrLevel: "A1", correct: false },
      { cefrLevel: "A2", correct: false },
      { cefrLevel: "A2", correct: false },
    ];
    expect(assessSkillLevel(items).belowA1).toBe(true);
  });

  it("is not below A1 when a level was passed", () => {
    const items = [
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "A2", correct: true },
      { cefrLevel: "B1", correct: false },
      { cefrLevel: "B1", correct: false },
    ];
    expect(assessSkillLevel(items).belowA1).toBeUndefined();
  });
});
