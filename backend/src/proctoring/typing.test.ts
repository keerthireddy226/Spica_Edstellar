import { describe, expect, it } from "vitest";
import { profileDistance } from "./typing.js";

describe("profileDistance", () => {
  it("is zero for the same rhythm", () => {
    expect(profileDistance({ dwell: 100, flight: 160, dg_th: 140 }, { dwell: 100, flight: 160, dg_th: 140 })).toBe(0);
  });

  it("grows with a different rhythm", () => {
    const d = profileDistance({ dwell: 95, flight: 160, dg_th: 140, dg_he: 150 }, { dwell: 150, flight: 320, dg_th: 300, dg_he: 310 })!;
    expect(d).toBeGreaterThan(0.35);
  });

  it("needs at least three shared features", () => {
    expect(profileDistance({ dwell: 100, flight: 160 }, { dwell: 100, flight: 160 })).toBeNull();
  });
});
