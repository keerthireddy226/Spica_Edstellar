import { describe, expect, it } from "vitest";
import { pickCurrentLevel, skillLevelsOf, type LevelReading, type LevelSource } from "./currentLevel.js";

const reading = (source: LevelSource, level: string): LevelReading => ({
  source,
  at: "2026-10-01T00:00:00.000Z",
  level,
  skills: {},
  skillPercents: null,
  overallPercent: null,
  score: null,
  skillScores: null,
  sessionId: null,
});

describe("pickCurrentLevel", () => {
  const all = {
    final_assessment: reading("final_assessment", "B2"),
    level_test: reading("level_test", "B1"),
    mock: reading("mock", "A2"),
    placement: reading("placement", "A1"),
  };
  it("prefers the final assessment, then a passed level test, then a mock, then the placement test", () => {
    expect(pickCurrentLevel(all)?.source).toBe("final_assessment");
    expect(pickCurrentLevel({ ...all, final_assessment: null })?.source).toBe("level_test");
    expect(pickCurrentLevel({ mock: all.mock, placement: all.placement })?.source).toBe("mock");
    expect(pickCurrentLevel({ placement: all.placement })?.level).toBe("A1");
  });
  it("is null with no result, and skips a result without a level", () => {
    expect(pickCurrentLevel({})).toBeNull();
    expect(pickCurrentLevel({ mock: reading("mock", ""), placement: all.placement })?.source).toBe("placement");
  });
});

describe("skillLevelsOf", () => {
  it("reads both the old { level } and the plain level form", () => {
    expect(skillLevelsOf({ listening: { level: "B1", cappedByGap: true }, speaking: "A2", other: "C1" })).toEqual({ listening: "B1", speaking: "A2" });
    expect(skillLevelsOf(null)).toEqual({});
  });
});
