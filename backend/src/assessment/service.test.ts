import { describe, expect, it } from "vitest";
import { samplePick, unlockOf } from "./service.js";
import { levelTestPassed } from "../practiceTests/modes.js";
import { paidSwitchGoesAhead, switchChargeOf, switchOpen } from "./service.js";

const now = new Date("2026-10-21T10:00:00Z");
const endsAt = "2026-11-20T10:00:00Z";

describe("unlockOf", () => {
  it("preparation: opens after the first mock test", () => {
    expect(unlockOf({ kind: "prep", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0 }, now)).toEqual({ state: "mock_needed", opensOn: "2026-11-13T10:00:00.000Z" });
    expect(unlockOf({ kind: "prep", attemptsLeft: 1, endsAt }, { mocks: 1, samples: 0 }, now)).toEqual({ state: "open" });
  });
  it("preparation: opens anyway in the last 7 days", () => {
    expect(unlockOf({ kind: "prep", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0 }, new Date("2026-11-14T00:00:00Z"))).toEqual({ state: "open" });
  });
  it("assessment only: opens at once; the free sample is optional", () => {
    // The free sample is optional: open with or without it.
    expect(unlockOf({ kind: "assessment", attemptsLeft: 1, endsAt }, { mocks: 3, samples: 0 }, now)).toEqual({ state: "open" });
    expect(unlockOf({ kind: "assessment", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 1 }, now)).toEqual({ state: "open" });
  });
  it("final assessment with Full access: opens after a mock test, or 7 days before access ends (14 days before it expires)", () => {
    expect(unlockOf({ kind: "final", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0 }, now)).toEqual({ state: "mock_needed", opensOn: "2026-10-30T10:00:00.000Z" });
    expect(unlockOf({ kind: "final", attemptsLeft: 1, endsAt }, { mocks: 1, samples: 0 }, now)).toEqual({ state: "open" });
    expect(unlockOf({ kind: "final", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0 }, new Date("2026-10-31T00:00:00Z"))).toEqual({ state: "open" });
  });
  it("used up or expired attempts can't start", () => {
    expect(unlockOf({ kind: "assessment", attemptsLeft: 0, endsAt }, { mocks: 0, samples: 1 }, now)).toEqual({ state: "used" });
    expect(unlockOf({ kind: "prep", attemptsLeft: 1, endsAt: "2026-10-20T00:00:00Z" }, { mocks: 1, samples: 0 }, now)).toEqual({ state: "expired" });
  });
});

describe("after a real test below the goal", () => {
  it("the next real test waits 30 days; a level test doesn't", () => {
    const last = "2026-10-10T10:00:00Z";
    expect(unlockOf({ kind: "final", attemptsLeft: 1, endsAt }, { mocks: 1, samples: 0, lastBelowGoal: last }, now)).toEqual({
      state: "retake_wait",
      opensOn: "2026-11-09T10:00:00.000Z",
    });
    expect(unlockOf({ kind: "assessment", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 1, lastBelowGoal: last }, new Date("2026-11-10T00:00:00Z"))).toEqual({ state: "open" });
    expect(unlockOf({ kind: "level", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0, lastBelowGoal: last }, now)).toEqual({ state: "open" });
  });
});

describe("samplePick", () => {
  it("keeps the first questions of each part", () => {
    const rows = [1, 1, 1, 2, 3, 3, 3].map((part, i) => ({ part, i }));
    expect(samplePick(rows, (r) => r.part, 2).map((r) => r.i)).toEqual([0, 1, 3, 4, 5]);
  });
});

describe("level tests", () => {
  it("open at once, but 7 days after a level test that wasn't passed", () => {
    expect(unlockOf({ kind: "level", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0, lastLevelFail: null }, now)).toEqual({ state: "open" });
    expect(unlockOf({ kind: "level", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0, lastLevelFail: "2026-10-18T10:00:00Z" }, now)).toEqual({
      state: "retake_wait",
      opensOn: "2026-10-25T10:00:00.000Z",
    });
    expect(unlockOf({ kind: "level", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 0, lastLevelFail: "2026-10-10T10:00:00Z" }, now)).toEqual({ state: "open" });
  });
  it("pass at 70% overall and at least 50% in every skill", () => {
    expect(levelTestPassed(72, { speaking: 60, listening: 80, reading: 75, writing: 55 })).toBe(true);
    expect(levelTestPassed(69, { speaking: 60, listening: 80, reading: 75, writing: 55 })).toBe(false);
    expect(levelTestPassed(80, { speaking: 49, listening: 90, reading: 95, writing: 90 })).toBe(false);
    expect(levelTestPassed(null, {})).toBe(false);
  });
});

describe("switching preparation to another test", () => {
  const prep = { kind: "prep", attempts_used: 0, switched_at: null, revoked_at: null, starts_at: "2026-10-18T10:00:00Z", ends_at: "2026-11-17T10:00:00Z" };
  it("is open in the first 7 days, before the real test, once", () => {
    expect(switchOpen(prep, now)).toBe(true);
    expect(switchOpen(prep, new Date("2026-10-25T10:00:01Z"))).toBe(false);
    expect(switchOpen({ ...prep, attempts_used: 1 }, now)).toBe(false);
    expect(switchOpen({ ...prep, switched_at: "2026-10-19T10:00:00Z" }, now)).toBe(false);
    expect(switchOpen({ ...prep, revoked_at: "2026-10-19T10:00:00Z" }, now)).toBe(false);
    expect(switchOpen({ ...prep, kind: "assessment" }, now)).toBe(false);
  });
  it("a dearer test costs the difference in the order's currency; same or cheaper is free", () => {
    expect(switchChargeOf("purchase", "INR", { INR: 99900, USD: 1900 }, { INR: 149900, USD: 2900 })).toEqual({ outcome: "pay", amount: 50000, currency: "INR" });
    expect(switchChargeOf("purchase", "INR", { INR: 149900 }, { INR: 149900 })).toEqual({ outcome: "free" });
    expect(switchChargeOf("purchase", "INR", { INR: 149900 }, { INR: 99900 })).toEqual({ outcome: "free" });
  });
  it("uses USD for both when either has no price in the order's currency", () => {
    expect(switchChargeOf("purchase", "EUR", { EUR: 1800, USD: 1900 }, { USD: 2900 })).toEqual({ outcome: "pay", amount: 1000, currency: "USD" });
    expect(switchChargeOf("purchase", "EUR", { EUR: 1800 }, { USD: 2900 })).toEqual({ outcome: "free" });
  });
  it("staff grants stay free; an organization's credits need its admin for a dearer test", () => {
    expect(switchChargeOf("grant", "USD", { USD: 1900 }, { USD: 2900 })).toEqual({ outcome: "free" });
    expect(switchChargeOf("included", "USD", { USD: 1900 }, { USD: 2900 })).toEqual({ outcome: "free" });
    expect(switchChargeOf("credit", "USD", { USD: 1900 }, { USD: 2900 })).toEqual({ outcome: "org" });
    expect(switchChargeOf("credit", "USD", { USD: 2900 }, { USD: 1900 })).toEqual({ outcome: "free" });
  });
  it("a paid switch goes ahead after the 7 days, but not once used, switched or revoked", () => {
    expect(paidSwitchGoesAhead({ attempts_used: 0, switched_at: null, revoked_at: null })).toBe(true);
    expect(paidSwitchGoesAhead({ attempts_used: 1, switched_at: null, revoked_at: null })).toBe(false);
    expect(paidSwitchGoesAhead({ attempts_used: 0, switched_at: "2026-10-19T10:00:00Z", revoked_at: null })).toBe(false);
    expect(paidSwitchGoesAhead({ attempts_used: 0, switched_at: null, revoked_at: "2026-10-19T10:00:00Z" })).toBe(false);
    expect(paidSwitchGoesAhead(undefined)).toBe(false);
  });
});
