import { describe, expect, it } from "vitest";
import { needsConsent, needsSecureProctoringPlan, normalizePolicy, presetPolicy, usesBiometrics } from "./policy.js";

describe("presetPolicy", () => {
  it("turns everything off in off mode", () => {
    const p = presetPolicy("off", "global");
    expect(needsConsent(p)).toBe(false);
    expect(p.lockdown || p.randomizedForms || p.webcamMonitoring).toBe(false);
  });

  it("keeps the standard preset free of biometrics", () => {
    const p = presetPolicy("standard", "us");
    expect(usesBiometrics(p)).toBe(false);
    expect(p.lockdown && p.randomizedForms).toBe(true);
    expect(needsSecureProctoringPlan(p)).toBe(false);
  });

  it("leaves biometrics off by default for EU recruitment, on elsewhere", () => {
    const eu = presetPolicy("strict", "eu");
    expect(eu.faceMatch || eu.voiceMatch).toBe(false);
    expect(eu.idVerification).toBe(true);
    expect(eu.retentionDays).toBe(30);
    const global = presetPolicy("strict", "global");
    expect(global.faceMatch && global.voiceMatch).toBe(true);
    expect(needsSecureProctoringPlan(global)).toBe(true);
  });
});

describe("normalizePolicy", () => {
  it("gives an organization that never saved a policy no camera", () => {
    const p = normalizePolicy(null);
    expect(p.mode).toBe("standard");
    expect(p.webcamMonitoring).toBe(false);
    expect(needsConsent(p)).toBe(false);
  });

  it("fills missing fields from the matching preset", () => {
    const p = normalizePolicy({ mode: "strict", region: "eu", roomScan: false });
    expect(p.roomScan).toBe(false);
    expect(p.idVerification).toBe(true);
    expect(p.faceMatch).toBe(false);
  });

  it("falls back to the standard preset for garbage", () => {
    const p = normalizePolicy({ mode: "nonsense", retentionDays: "x" });
    expect(p.mode).toBe("standard");
    expect(p.retentionDays).toBe(90);
  });
});
