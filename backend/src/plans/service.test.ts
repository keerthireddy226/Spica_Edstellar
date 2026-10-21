import { describe, expect, it } from "vitest";
import { downgradeDate } from "./service.js";
describe("downgradeDate", () => {
  it("the contract's end while it's ahead", () => {
    expect(downgradeDate("2026-12-31", "2026-10-21")).toBe("2026-12-31");
  });
  it("otherwise the first day of next month", () => {
    expect(downgradeDate(null, "2026-10-21")).toBe("2026-11-01");
    expect(downgradeDate("2026-01-01", "2026-12-15")).toBe("2027-01-01");
  });
});
