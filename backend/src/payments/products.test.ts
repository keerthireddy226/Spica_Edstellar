import { describe, expect, it } from "vitest";
import { creditFromPreps, levelDiscountOf } from "./products.js";

describe("levelDiscountOf", () => {
  it("half price to retake a level not passed", () => {
    expect(levelDiscountOf("B1", [{ level: "B1", passed: false }])).toEqual({ percent: 50, reason: "level_retake" });
  });
  it("25% off the next level after passing one", () => {
    expect(levelDiscountOf("B2", [{ level: "B1", passed: true }])).toEqual({ percent: 25, reason: "next_level" });
  });
  it("no discount for a first test, a level already passed, or a level two up", () => {
    expect(levelDiscountOf("B1", [])).toBeNull();
    expect(levelDiscountOf("B1", [{ level: "B1", passed: true }])).toBeNull();
    expect(levelDiscountOf("C1", [{ level: "B1", passed: true }])).toBeNull();
  });
  it("the latest result at a level decides", () => {
    expect(levelDiscountOf("B1", [{ level: "B1", passed: true }, { level: "B1", passed: false }])).toBeNull();
  });
});

describe("creditFromPreps (upgrade credit, used once)", () => {
  // A 30-day preparation worth 5900, half its time left.
  const start = Date.parse("2026-10-01T00:00:00Z");
  const end = Date.parse("2026-10-31T00:00:00Z");
  const mid = (start + end) / 2;
  const prep = { entitlementId: "e1", startsAt: new Date(start), endsAt: new Date(end), value: 5900, usedShare: 0 };

  it("credits the unused part and says where it came from", () => {
    const r = creditFromPreps([prep], 10000, mid);
    expect(r.credit).toBe(2950);
    expect(r.sources).toEqual([{ entitlementId: "e1", share: 0.5 }]);
  });

  it("credit already taken by an earlier paid order can't be taken again", () => {
    const first = creditFromPreps([prep], 10000, mid);
    const again = creditFromPreps([{ ...prep, usedShare: first.sources[0].share }], 10000, mid);
    expect(again.credit).toBe(0);
    expect(again.sources).toEqual([]);
    // Nor later, when even less time is left.
    expect(creditFromPreps([{ ...prep, usedShare: 0.5 }], 10000, mid + 86_400_000).credit).toBe(0);
  });

  it("credit capped by the price leaves the rest for later", () => {
    const capped = creditFromPreps([prep], 1000, mid);
    expect(capped.credit).toBe(1000);
    const rest = creditFromPreps([{ ...prep, usedShare: capped.sources[0].share }], 10000, mid);
    expect(rest.credit).toBe(1950);
  });

  it("several preparations fill the credit in turn", () => {
    const r = creditFromPreps([prep, { ...prep, entitlementId: "e2", value: 4700 }], 5000, mid);
    expect(r.credit).toBe(5000);
    expect(r.sources.map((s) => s.entitlementId)).toEqual(["e1", "e2"]);
  });
});
