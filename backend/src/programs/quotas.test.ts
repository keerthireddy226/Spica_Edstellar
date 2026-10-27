import { describe, expect, it } from "vitest";
import { mockAllowance, mocksUsedIn, type QuotaUsage } from "./quotas.js";

const usage = (over: Partial<QuotaUsage>): QuotaUsage => ({
  segment: "individual",
  tier: "plus",
  practicePerMonth: null,
  mocksPerMonth: 2,
  reportLevel: "full",
  mockEveryDays: null,
  mocksPerTestType: false,
  practiceUsed: 0,
  mocksUsed: 0,
  mocksUsedByTest: {},
  resetsOn: "2026-11-20",
  ...over,
});

describe("mocksUsedIn", () => {
  it("counts all mocks when the limit is shared", () => {
    expect(mocksUsedIn(usage({ mocksUsed: 2, mocksUsedByTest: { writing: 1, professional: 1 } }), "writing")).toBe(2);
  });
  it("counts only that test's mocks when the limit is per test type", () => {
    const u = usage({ mocksPerTestType: true, mocksUsed: 3, mocksUsedByTest: { writing: 2, professional: 1 } });
    expect(mocksUsedIn(u, "writing")).toBe(2);
    expect(mocksUsedIn(u, "professional")).toBe(1);
    expect(mocksUsedIn(u, "fourSkills")).toBe(0);
  });
});

describe("mockAllowance", () => {
  it("is the shared limit and what's left of it", () => {
    expect(mockAllowance(usage({ mocksUsed: 1 }))).toEqual({ perMonth: 2, left: 1 });
  });
  it("is unlimited without a limit, and 2 a month without a plan row", () => {
    expect(mockAllowance(usage({ mocksPerMonth: null }))).toEqual({ perMonth: null, left: null });
    expect(mockAllowance(null)).toEqual({ perMonth: 2, left: null });
  });
  it("gives the limit in each test type being prepared for", () => {
    const u = usage({ mocksPerTestType: true, mocksUsed: 2, mocksUsedByTest: { writing: 2 } });
    expect(mockAllowance(u, ["writing", "professional"])).toEqual({ perMonth: 4, left: 2 });
  });
  it("counts one test type when the learner hasn't started any yet", () => {
    expect(mockAllowance(usage({ mocksPerTestType: true }), [])).toEqual({ perMonth: 2, left: 2 });
  });
});
