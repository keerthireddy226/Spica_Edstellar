import { describe, expect, it } from "vitest";
import { scheduleTests } from "./testSchedule.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const kinds = (slots: ReturnType<typeof scheduleTests>) => slots.map((x) => (x.kind === "mock" ? "M" : "P") + (x.onReset ? "*" : "")).join(" ");

describe("scheduleTests", () => {
  it("two mocks a month: practice and mock take turns", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: null, lastPractice: null, lastMock: null, mocksPerMonth: 2, mocksLeft: 2, resetsOn: d("2026-11-14") });
    expect(kinds(s).startsWith("M P M P")).toBe(true);
  });
  it("one mock a month: three practice tests between mocks", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: null, lastPractice: d("2026-10-10"), lastMock: d("2026-10-01"), mocksPerMonth: 1, mocksLeft: 0, resetsOn: d("2026-11-01") });
    expect(kinds(s)).toMatch(/^P P M\*/);
  });
  it("no mocks left: the next mock waits for the reset day", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: null, lastPractice: d("2026-10-17"), lastMock: d("2026-10-12"), mocksPerMonth: 2, mocksLeft: 0, resetsOn: d("2026-11-14") });
    const firstMock = s.find((x) => x.kind === "mock")!;
    expect(firstMock.date >= d("2026-11-14")).toBe(true);
  });
  it("ends with a mock about a week before the exam, no tests in the last two days", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: d("2026-11-08"), lastPractice: null, lastMock: null, mocksPerMonth: null, mocksLeft: null, resetsOn: null });
    expect(s[s.length - 1].kind).toBe("mock");
    expect(s.every((x) => x.date <= d("2026-11-06"))).toBe(true);
  });
});

describe("scheduleTests limits", () => {
  it("no final mock before the exam when none are left until after it", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: d("2026-11-08"), lastPractice: d("2026-10-19"), lastMock: d("2026-10-16"), mocksPerMonth: 2, mocksLeft: 0, resetsOn: d("2026-11-14") });
    expect(s.some((x) => x.kind === "mock")).toBe(false);
  });
  it("never two tests on the same day", () => {
    const s = scheduleTests({ today: d("2026-10-19"), examDate: null, lastPractice: d("2026-10-16"), lastMock: d("2026-10-19"), mocksPerMonth: 2, mocksLeft: 0, resetsOn: d("2026-11-14") });
    const days = s.map((x) => x.date.toISOString().slice(0, 10));
    expect(new Set(days).size).toBe(days.length);
  });
});
