import { describe, expect, it } from "vitest";
import { buildSchedule, intervals, levelGap, programGap } from "./schedule.js";
import { nextMonthStart } from "./quotas.js";

const count = (items: { kind: string }[], kind: string) => items.filter((i) => i.kind === kind).length;

describe("levelGap", () => {
  it("counts CEFR steps to the target, never below 0", () => {
    expect(levelGap("B2", "A2")).toBe(2);
    expect(levelGap("B2", "C1")).toBe(0);
    expect(levelGap("B2", null)).toBeNull();
  });
});

describe("intervals", () => {
  it("plans more often for a bigger gap", () => {
    expect(intervals(3)).toEqual({ practiceDays: 3, mockDays: 14 });
    expect(intervals(1)).toEqual({ practiceDays: 4, mockDays: 21 });
    expect(intervals(0)).toEqual({ practiceDays: 7, mockDays: 28 });
  });
});

describe("buildSchedule", () => {
  const base = { from: "2026-11-01", targetDate: "2027-01-31", practicePerMonth: null, mocksPerMonth: null };

  it("starts with a baseline mock when the level isn't known and ends with a final mock", () => {
    const s = buildSchedule({ ...base, gap: null });
    const mocks = s.filter((i) => i.kind === "mock").map((i) => i.dueOn);
    expect(mocks[0]).toBe("2026-11-04");
    expect(mocks[mocks.length - 1]).toBe("2027-01-28");
  });

  it("never puts a practice test on a mock day", () => {
    const s = buildSchedule({ ...base, gap: 2 });
    const mockDates = new Set(s.filter((i) => i.kind === "mock").map((i) => i.dueOn));
    expect(s.some((i) => i.kind === "practice" && mockDates.has(i.dueOn))).toBe(false);
  });

  it("keeps each month within the quota", () => {
    const s = buildSchedule({ ...base, gap: 3, practicePerMonth: 4, mocksPerMonth: 1 });
    for (const m of ["2026-11", "2026-12", "2027-01"]) {
      const inMonth = s.filter((i) => i.dueOn.startsWith(m));
      expect(count(inMonth, "practice")).toBeLessThanOrEqual(4);
      expect(count(inMonth, "mock")).toBeLessThanOrEqual(1);
    }
    // The final mock before the target is the one January keeps.
    expect(s.filter((i) => i.kind === "mock" && i.dueOn.startsWith("2027-01")).map((i) => i.dueOn)).toEqual(["2027-01-28"]);
  });

  it("plans fewer tests for a learner already at the target", () => {
    const near = buildSchedule({ ...base, gap: 0 });
    const far = buildSchedule({ ...base, gap: 3 });
    expect(near.length).toBeLessThan(far.length);
  });

  it("is empty when the target date has passed", () => {
    expect(buildSchedule({ ...base, from: "2027-02-01", gap: 1 })).toEqual([]);
  });

  it("stays in date order", () => {
    const s = buildSchedule({ ...base, gap: 1 });
    expect(s.map((i) => i.dueOn)).toEqual([...s.map((i) => i.dueOn)].sort());
  });
});

describe("programGap", () => {
  it("takes the biggest gap of overall and skill targets", () => {
    const p = { target_level: "B2", target_skills: { speaking: "C1" } };
    expect(programGap(p, { overall: "B2", skills: { speaking: "B1" } })).toBe(2);
    expect(programGap(p, { overall: "B1", skills: {} })).toBe(1);
    expect(programGap(p, { overall: null, skills: { speaking: "A2" } })).toBeNull();
  });
});

describe("nextMonthStart", () => {
  it("is the first day of next month in UTC, across a year end", () => {
    expect(nextMonthStart(new Date("2026-10-16T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(nextMonthStart(new Date("2026-12-31T23:59:00Z")).toISOString().slice(0, 10)).toBe("2027-01-01");
  });
});
