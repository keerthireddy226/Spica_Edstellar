import { describe, expect, it } from "vitest";
import { downgradeStillLower } from "./service.js";

describe("downgradeStillLower", () => {
  it("a scheduled move down still applies while the plan is above it", () => {
    expect(downgradeStillLower("starter", "business")).toBe(true);
    expect(downgradeStillLower("business", "enterprise")).toBe(true);
  });
  it("is dropped once the organization is at or below it (bought its way up, or changed directly)", () => {
    expect(downgradeStillLower("business", "business")).toBe(false);
    expect(downgradeStillLower("business", "starter")).toBe(false);
  });
});
