import { describe, expect, it } from "vitest";
import { addMonths, demoStatus, newPartnerCode } from "./staffRoutes.js";

describe("channel partners", () => {
  it("makes readable unique-looking codes", () => {
    const c = newPartnerCode();
    expect(c).toMatch(/^CP-[A-HJKMNP-Z2-9]{6}$/);
  });
  it("demo window status", () => {
    const now = new Date("2026-11-18T10:00:00Z");
    expect(demoStatus({ demo_starts_at: null, demo_ends_at: null, demo_ended_at: null }, now)).toBe("not_started");
    const start = new Date("2026-11-01T00:00:00Z");
    expect(demoStatus({ demo_starts_at: start, demo_ends_at: addMonths(start, 3), demo_ended_at: null }, now)).toBe("active");
    expect(demoStatus({ demo_starts_at: start, demo_ends_at: addMonths(start, 3), demo_ended_at: now }, now)).toBe("ended");
    expect(demoStatus({ demo_starts_at: start, demo_ends_at: new Date("2026-11-10T00:00:00Z"), demo_ended_at: null }, now)).toBe("ended");
  });
  it("3 months from a date", () => {
    expect(addMonths(new Date("2026-11-18T00:00:00Z"), 3).toISOString().slice(0, 10)).toBe("2027-02-18");
  });
});
