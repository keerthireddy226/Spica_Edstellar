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

  it("can't rank above the weakest skill tested", () => {
    const strongReading = ["A1", "A2", "B1", "B2", "C1"].flatMap((l) => [row(l as "A1", true), row(l as "A1", true)]);
    const weakWriting = [row("A1", true, ["writing"]), row("A1", true, ["writing"]), row("A2", false, ["writing"]), row("A2", false, ["writing"]), row("B1", false, ["writing"]), row("B1", false, ["writing"])];
    const s = levelSummary([...strongReading, ...weakWriting])!;
    expect(s.skillLevels.writing).toBe("A1");
    expect(s.cefrLevel).toBe("A1");
  });

  it("ignores a skill with too few questions for the cap", () => {
    const strongReading = ["A1", "A2", "B1", "B2", "C1"].flatMap((l) => [row(l as "A1", true), row(l as "A1", true)]);
    const shortWriting = [row("A2", false, ["writing"]), row("A2", false, ["writing"])];
    const s = levelSummary([...strongReading, ...shortWriting])!;
    expect(s.skillLevels.writing).toBe("A1");
    expect(s.cefrLevel).not.toBe("A1");
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

  it("makes writing half of the English Writing test", () => {
    expect(skillWeights("writing", ["writing", "reading", "listening"])).toEqual({ writing: 0.5, reading: 0.25, listening: 0.25 });
    expect(weightedSkillMean({ writing: 80, reading: 40, listening: 40, speaking: null }, "writing")).toBe(60);
  });

  it("is null with no skill scored", () => {
    expect(weightedSkillMean({ reading: null }, null)).toBeNull();
  });
});
