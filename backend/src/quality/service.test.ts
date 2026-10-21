import { describe, expect, it } from "vitest";
import { cronbachAlpha } from "./service.js";

describe("cronbachAlpha", () => {
  it("is high when parts rise and fall together, low when they don't", () => {
    const together = [
      [20, 22, 19, 21],
      [40, 41, 43, 39],
      [60, 58, 61, 62],
      [80, 79, 82, 81],
    ];
    expect(cronbachAlpha(together)!).toBeGreaterThan(0.95);
    const apart = [
      [20, 80, 50, 40],
      [80, 20, 40, 60],
      [50, 50, 90, 10],
      [40, 60, 10, 90],
    ];
    expect(cronbachAlpha(apart)!).toBeLessThan(0.3);
  });
  it("needs three people and two parts", () => {
    expect(cronbachAlpha([[1, 2]])).toBeNull();
    expect(cronbachAlpha([[1], [2], [3]])).toBeNull();
  });
});
