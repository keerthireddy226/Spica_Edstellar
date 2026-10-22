import { describe, expect, it } from "vitest";
import { canPrepare, narrows, resolveAccess, type EntitlementRow } from "./entitlements.js";
import { individualTier } from "../programs/quotas.js";

const now = new Date("2026-10-21T10:00:00Z");
const row = (over: Partial<EntitlementRow>): EntitlementRow => ({
  id: "e1",
  product_id: "prep_writing",
  kind: "prep",
  name: "Writing prep",
  test_type_id: "writing",
  level: null,
  attempts_total: 1,
  attempts_used: 0,
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-10-31T00:00:00Z",
  ...over,
});

describe("resolveAccess", () => {
  it("a live licence is Full access", () => {
    const a = resolveAccess({ status: "active", accessEndsAt: "2026-12-01T00:00:00Z", graceEndsAt: null }, [], now);
    expect(a.full).toEqual({ endsAt: "2026-12-01T00:00:00Z" });
    expect(canPrepare(a, "professional")).toBe(true);
  });

  it("preparation opens only its test", () => {
    const a = resolveAccess({ status: "none", accessEndsAt: null, graceEndsAt: null }, [row({})], now);
    expect(a.full).toBeNull();
    expect(a.prepTests).toEqual(["writing"]);
    expect(canPrepare(a, "writing")).toBe(true);
    expect(canPrepare(a, "fourSkills")).toBe(false);
    // Its certified attempt can still be started.
    expect(a.attempts.map((x) => x.productId)).toEqual(["prep_writing"]);
  });

  it("an expired or not-yet-started purchase gives nothing", () => {
    const a = resolveAccess(null, [row({ ends_at: "2026-10-20T00:00:00Z" }), row({ id: "e2", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" })], now);
    expect(a.owned).toEqual([]);
    expect(canPrepare(a, "writing")).toBe(false);
  });

  it("a used attempt stays owned (report, certificate) but can't be started again", () => {
    const a = resolveAccess(null, [row({ product_id: "level_test", kind: "level", test_type_id: null, level: "B1", attempts_used: 1 })], now);
    expect(a.owned).toHaveLength(1);
    expect(a.owned[0].attemptsLeft).toBe(0);
    expect(a.attempts).toEqual([]);
  });
});

describe("narrows (what owning something takes away)", () => {
  const none = { status: "none" as const, accessEndsAt: null, graceEndsAt: null };
  const level = row({ product_id: "level_test", kind: "level", test_type_id: null, level: "B1" });

  it("a level test alone leaves an individual on the free plan's rules", () => {
    const a = resolveAccess(none, [level], now);
    expect(narrows(a, "individual")).toBe(false);
  });

  it("an organization learner with no licence gets only what they were given", () => {
    const a = resolveAccess(none, [level], now);
    expect(narrows(a, "org")).toBe(true);
  });

  it("a preparation or a practice pack narrows practice to what it opens", () => {
    expect(narrows(resolveAccess(none, [row({})], now), "individual")).toBe(true);
    expect(narrows(resolveAccess(none, [row({ product_id: "practice_pack", kind: "pack", test_type_id: null, level: "B1" })], now), "individual")).toBe(true);
  });

  it("Full access, as a licence or as a product, narrows nothing", () => {
    expect(narrows(resolveAccess({ status: "active", accessEndsAt: "2026-12-01T00:00:00Z", graceEndsAt: null }, [row({})], now), "org")).toBe(false);
    expect(narrows(resolveAccess(none, [row({ product_id: "full_access", kind: "full", test_type_id: null })], now), "individual")).toBe(false);
  });
});

describe("individualTier (which monthly limits apply)", () => {
  const none = { status: "none" as const, accessEndsAt: null, graceEndsAt: null };
  it("Free with nothing, or with only a level test", () => {
    expect(individualTier(resolveAccess(none, [], now))).toBe("free");
    expect(individualTier(resolveAccess(none, [row({ kind: "level", test_type_id: null, level: "B1" })], now))).toBe("free");
  });
  it("Plus with a live plan, Full access given by staff, or a preparation", () => {
    expect(individualTier(resolveAccess({ status: "active", accessEndsAt: "2026-12-01T00:00:00Z", graceEndsAt: null }, [], now))).toBe("plus");
    expect(individualTier(resolveAccess(none, [row({ product_id: "full_access", kind: "full", test_type_id: null })], now))).toBe("plus");
    expect(individualTier(resolveAccess(none, [row({})], now))).toBe("plus");
  });
});
