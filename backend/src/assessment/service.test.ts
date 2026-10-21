import { describe, expect, it } from "vitest";
import { samplePick, unlockOf } from "./service.js";

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
  it("assessment only: opens after the free sample", () => {
    expect(unlockOf({ kind: "assessment", attemptsLeft: 1, endsAt }, { mocks: 3, samples: 0 }, now)).toEqual({ state: "sample_needed" });
    expect(unlockOf({ kind: "assessment", attemptsLeft: 1, endsAt }, { mocks: 0, samples: 1 }, now)).toEqual({ state: "open" });
  });
  it("used up or expired attempts can't start", () => {
    expect(unlockOf({ kind: "assessment", attemptsLeft: 0, endsAt }, { mocks: 0, samples: 1 }, now)).toEqual({ state: "used" });
    expect(unlockOf({ kind: "prep", attemptsLeft: 1, endsAt: "2026-10-20T00:00:00Z" }, { mocks: 1, samples: 0 }, now)).toEqual({ state: "expired" });
  });
});

describe("samplePick", () => {
  it("keeps the first questions of each part", () => {
    const rows = [1, 1, 1, 2, 3, 3, 3].map((part, i) => ({ part, i }));
    expect(samplePick(rows, (r) => r.part, 2).map((r) => r.i)).toEqual([0, 1, 3, 4, 5]);
  });
});
