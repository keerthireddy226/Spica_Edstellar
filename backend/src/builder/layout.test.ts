import { describe, expect, it } from "vitest";
import { levelTargets, planCounts } from "./layout.js";

// A1-B1 Listening & Reading's shape: 8 sections, published 70 minutes.
const sections = [
  [8, 55],
  [6, 33],
  [4, 160],
  [2, 450],
  [8, 45],
  [3, 260],
  [7, 30],
  [2, 540],
].map(([officialCount, avgSeconds], i) => ({ sortOrder: i + 1, label: `S${i + 1}`, itemTypeId: "t", templatePartId: "p", officialCount, avgSeconds, levels: [], timerSeconds: null }));
const templateSeconds = sections.reduce((n, s) => n + s.officialCount * s.avgSeconds, 0);
const layout = { officialMinutes: 70, templateSeconds, sections };

describe("planCounts", () => {
  it("keeps the published layout at the published duration", () => {
    const p = planCounts(layout, 70);
    expect(p.sections.map((s) => s.count)).toEqual(sections.map((s) => s.officialCount));
  });

  it("shortens to the chosen duration without going over, keeping every section", () => {
    for (const minutes of [30, 45, 60]) {
      const p = planCounts(layout, minutes);
      expect(p.sections.every((s) => s.count >= 1)).toBe(true);
      const target = minutes * 60 * (templateSeconds / (70 * 60));
      expect(p.plannedSeconds).toBeLessThanOrEqual(target);
      // Short by less than the shortest question.
      expect(target - p.plannedSeconds).toBeLessThan(Math.min(...sections.map((s) => s.avgSeconds)));
    }
  });

  it("lengthens in proportion", () => {
    const p = planCounts(layout, 120);
    expect(p.sections.reduce((n, s) => n + s.count, 0)).toBeGreaterThan(40);
  });

  it("can't go below one question per section", () => {
    const writing = { officialMinutes: 30, templateSeconds: 1800, sections: [{ ...sections[0], officialCount: 1, avgSeconds: 1800 }] };
    expect(planCounts(writing, 10).sections[0].count).toBe(1);
  });
});

describe("levelTargets", () => {
  it("spreads the template's levels over a new count", () => {
    expect(levelTargets(["A1", "A1", "A2", "A2", "B1", "B1"], 3)).toEqual(["A1", "A2", "B1"]);
    expect(levelTargets([], 2)).toEqual([null, null]);
  });
});
