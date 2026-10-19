import { describe, expect, it } from "vitest";
import { pointsOf, ranks, topPercent, weekStart } from "./leaderboard.js";

describe("leaderboard", () => {
  it("weeks start on Monday (UTC)", () => {
    expect(weekStart(new Date("2026-10-19T15:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(weekStart(new Date("2026-10-25T23:00:00Z")).toISOString().slice(0, 10)).toBe("2026-10-19");
  });
  it("points: sets, right answers, tests and days practised", () => {
    expect(pointsOf({ sets: 3, correct: 10, tests: 1, activeDays: 2 })).toBe(30 + 20 + 25 + 10);
  });
  it("equal points share a rank", () => {
    const r = ranks(new Map([["a", 50], ["b", 80], ["c", 50], ["d", 10]]));
    expect([r.get("b"), r.get("a"), r.get("c"), r.get("d")]).toEqual([1, 2, 2, 4]);
  });
  it("top percent, to the nearest 5", () => {
    expect(topPercent(1, 20)).toBe(5);
    expect(topPercent(4, 20)).toBe(20);
    expect(topPercent(3, 7)).toBe(45);
  });
});
