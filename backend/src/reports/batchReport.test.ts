import { describe, expect, it } from "vitest";
import { fromReading, periodRange, snapshot } from "./batchReport.js";

const now = new Date("2026-10-21T10:00:00Z");

describe("periodRange", () => {
  it("since the batch started runs to today", () => {
    expect(periodRange("since_start", "2026-09-01", now)).toEqual({ from: "2026-09-01", to: "2026-10-21" });
  });
  it("a batch starting later than today is just today", () => {
    expect(periodRange("since_start", "2026-11-01", now)).toEqual({ from: "2026-10-21", to: "2026-10-21" });
  });
  it("last 30 days includes today", () => {
    expect(periodRange("last_30", "2026-01-01", now)).toEqual({ from: "2026-09-22", to: "2026-10-21" });
  });
  it("this quarter starts on its first day", () => {
    expect(periodRange("quarter", "2026-01-01", now)).toEqual({ from: "2026-10-01", to: "2026-10-21" });
  });
  it("custom dates in either order; missing dates fall back to the batch start", () => {
    expect(periodRange("custom", "2026-01-01", now, { from: "2026-10-10", to: "2026-09-10" })).toEqual({ from: "2026-09-10", to: "2026-10-10" });
    expect(periodRange("custom", "2026-09-01", now, { from: "2026-10-10" })).toEqual({ from: "2026-09-01", to: "2026-10-21" });
  });
});

describe("snapshot", () => {
  it("scores each skill from its level and share right; the overall is their mean", () => {
    const s = snapshot({ speaking: "B1", listening: "B2", reading: "B2", writing: "B1" }, { speaking: 50, listening: 0, reading: 100, writing: 100 }, 60, "B2");
    expect(s.skills.speaking).toEqual({ level: "B1", score: 47 });
    expect(s.skills.listening).toEqual({ level: "B2", score: 55 });
    expect(s.skills.reading).toEqual({ level: "B2", score: 69 });
    expect(s.skills.writing).toEqual({ level: "B1", score: 54 });
    expect(s.score).toBe(56);
    expect(s.level).toBe("B2");
  });
  it("uses the overall share when a skill's own isn't known", () => {
    const s = snapshot({ writing: "B1" }, null, 100, "B1");
    expect(s.skills.writing?.score).toBe(54);
    expect(s.score).toBe(54);
  });
  it("falls back to the overall level when no skill has one", () => {
    const s = snapshot({}, null, 50, "A2");
    expect(s.score).toBe(35);
    expect(s.level).toBe("A2");
  });
});

describe("fromReading", () => {
  const base = { at: "2026-10-01T00:00:00.000Z", skillPercents: null, overallPercent: null, score: null, skillScores: null, sessionId: null };
  it("keeps a final assessment certificate's own scores", () => {
    const s = fromReading({ ...base, source: "final_assessment", level: "B2", skills: { speaking: "B2" }, score: 61, skillScores: { speaking: { level: "B2", score: 61 } } });
    expect(s).toEqual({ level: "B2", score: 61, skills: { speaking: { level: "B2", score: 61 } } });
  });
  it("scores other results from their levels, keeping the current level itself", () => {
    const s = fromReading({ ...base, source: "mock", level: "B2", skills: { speaking: "B1", listening: "B1" }, skillPercents: { speaking: 50, listening: 50 } });
    expect(s.score).toBe(47);
    expect(s.level).toBe("B2");
  });
});
