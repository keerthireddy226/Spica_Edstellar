import { describe, expect, it } from "vitest";
import { compare, type Baseline } from "./modelCheck.js";

const base = (scores: number[]): Baseline => ({
  model: "m",
  createdAt: "",
  cases: scores.map((b, i) => ({ itemId: String(i), itemTypeId: "repeats", cefrLevel: "B1", minWords: null, content: {}, answerSet: {}, variant: "key", response: "", baseline: b })),
});

describe("model check compare", () => {
  it("passes when scores barely move", () => {
    const r = compare(base([0.9, 0.5, 0.1, 0.95]), [0.92, 0.48, 0.1, 0.95]);
    expect(r.drift).toBe(false);
    expect(r.flips).toHaveLength(0);
  });
  it("flags drift when answers change between right and wrong", () => {
    // B1 bar is 0.65: 0.9 -> 0.6 and 0.7 -> 0.5 both flip
    const r = compare(base([0.9, 0.7, 0.1, 0.95]), [0.6, 0.5, 0.1, 0.95]);
    expect(r.flips).toHaveLength(2);
    expect(r.drift).toBe(true);
  });
  it("flags drift when many answers can't be graded", () => {
    const r = compare(base([0.9, 0.7, 0.1, 0.95]), [null, null, 0.1, 0.95]);
    expect(r.failed).toBe(2);
    expect(r.drift).toBe(true);
  });
});
