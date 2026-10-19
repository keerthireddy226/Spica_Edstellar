import { describe, expect, it } from "vitest";
import { levelProgress } from "./path.js";

const sets = (scores: (number | null)[], total = 10) =>
  Array.from({ length: total }, (_, i) => ({ sessionId: scores[i] === undefined || scores[i] === null ? null : `s${i}`, accuracy: scores[i] ?? null }));

describe("levelProgress", () => {
  it("passes a level after 7 finished sets averaging 70% or more", () => {
    expect(levelProgress(sets([0.8, 0.8, 0.6, 0.8, 0.8, 0.6, 0.8])).passed).toBe(true);
  });
  it("needs 7 sets, not just a good average", () => {
    expect(levelProgress(sets([1, 1, 1, 1, 1, 1])).passed).toBe(false);
  });
  it("needs the average, not just 7 sets", () => {
    const p = levelProgress(sets([0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6]));
    expect(p.passed).toBe(false);
    expect(p.setsDone).toBe(7);
  });
  it("a level with fewer than 7 sets passes when all are done well", () => {
    expect(levelProgress(sets([0.8, 0.8, 0.8], 3)).passed).toBe(true);
  });
});
