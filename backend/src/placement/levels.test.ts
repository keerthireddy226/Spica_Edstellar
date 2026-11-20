import { describe, expect, it } from "vitest";
import { levelSummary, skillWeights, weightedSkillMean, type ScoredAttemptRow } from "./levels.js";

// A typed answer at a CEFR level, right (score 1) or wrong (score 0).
function row(level: "A1" | "A2" | "B1" | "B2" | "C1", correct: boolean, skills = ["reading"]): ScoredAttemptRow {
  return { status: "scored", content_score: correct ? 1 : 0, manner_scores: null, skills, input_method: "text", cefr_level: level };
}

describe("levelSummary", () => {
  it("gives the highest level the answers sustain", () => {
    const rows = [
      ...["A1", "A2", "B1", "B2"].flatMap((l) => [row(l as "A1", true), row(l as "A1", true), row(l as "A1", true)]),
      row("C1", false),
      row("C1", false),
      row("C1", true),
    ];
    const s = levelSummary(rows)!;
    expect(s.cefrLevel).toBe("B2");
    expect(s.skillLevels.reading).toBe("B2");
  });

  // One rule everywhere (19 Nov 2026): the overall level is the band of the
  // mean of the skills' Spica scores, not capped at the weakest skill.
  it("averages the skills' Spica scores for the overall level", () => {
    const strongReading = ["A1", "A2", "B1", "B2", "C1"].flatMap((l) => [row(l as "A1", true), row(l as "A1", true)]);
    const weakWriting = [row("A1", true, ["writing"]), row("A1", true, ["writing"]), row("A2", false, ["writing"]), row("A2", false, ["writing"]), row("B1", false, ["writing"]), row("B1", false, ["writing"])];
    const s = levelSummary([...strongReading, ...weakWriting])!;
    // Reading C1 at 100% = 79; writing A1 at 33% = 23; mean 51 = B1.
    expect(s.skillLevels.reading).toBe("C1");
    expect(s.skillLevels.writing).toBe("A1");
    expect(s.cefrLevel).toBe("B1");
  });

  it("gives Below A1 when no level is passed", () => {
    const s = levelSummary([row("A1", false), row("A1", false), row("A2", false), row("A2", false)])!;
    // 0% right used to show A1 (score 20); now Below A1 (score 10).
    expect(s.skillLevels.reading).toBe("Pre-A1");
    expect(s.cefrLevel).toBe("Pre-A1");
  });

  it("gives Below A1 when the first level tested is failed", () => {
    const strongReading = ["A1", "A2", "B1", "B2", "C1"].flatMap((l) => [row(l as "A1", true), row(l as "A1", true)]);
    const shortWriting = [row("A2", false, ["writing"]), row("A2", false, ["writing"])];
    const s = levelSummary([...strongReading, ...shortWriting])!;
    expect(s.skillLevels.writing).toBe("Pre-A1");
    // Reading 79, writing 10: mean 45 = B1.
    expect(s.cefrLevel).toBe("B1");
  });

  it("is null when nothing could be scored", () => {
    expect(levelSummary([{ ...row("B1", true), status: "pending" }])).toBeNull();
  });
});

describe("skill weights", () => {
  it("counts each skill the same", () => {
    expect(skillWeights("essentials", ["speaking", "listening", "reading", "writing"])).toEqual({ speaking: 0.25, listening: 0.25, reading: 0.25, writing: 0.25 });
    expect(weightedSkillMean({ speaking: 80, listening: 40 }, "speaking-listening")).toBe(60);
  });

  it("counts each skill the same in the English Writing test too", () => {
    expect(skillWeights("writing", ["writing", "reading", "listening"])).toEqual({ writing: 1 / 3, reading: 1 / 3, listening: 1 / 3 });
    expect(weightedSkillMean({ writing: 80, reading: 50, listening: 50, speaking: null }, "writing")).toBeCloseTo(60);
  });

  it("is null with no skill scored", () => {
    expect(weightedSkillMean({ reading: null }, null)).toBeNull();
  });
});
