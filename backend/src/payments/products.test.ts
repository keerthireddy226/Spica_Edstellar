import { describe, expect, it } from "vitest";
import { levelDiscountOf } from "./products.js";

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
