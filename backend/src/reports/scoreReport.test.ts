import { describe, expect, it } from "vitest";
import { levelOfScore, spicaScore } from "./scoreReport.js";

describe("Spica score", () => {
  it("puts a level in its band, placed by the share right", () => {
    expect(spicaScore("B2", 0)).toBe(55);
    expect(spicaScore("B2", 100)).toBe(69);
    expect(spicaScore("B1", 50)).toBe(47);
    expect(spicaScore("C2", 100)).toBe(90);
    expect(spicaScore("A1", null)).toBe(25);
    expect(spicaScore(null, 80)).toBeNull();
  });
  it("maps a score back to its level", () => {
    expect(levelOfScore(10)).toBe("Pre-A1");
    expect(levelOfScore(54)).toBe("B1");
    expect(levelOfScore(55)).toBe("B2");
    expect(levelOfScore(79)).toBe("C1");
    expect(levelOfScore(90)).toBe("C2");
  });
  it("a skill's score always lands in its own level", () => {
    for (const level of ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"])
      for (const p of [0, 33, 50, 99, 100]) expect(levelOfScore(spicaScore(level, p)!)).toBe(level);
  });
});
