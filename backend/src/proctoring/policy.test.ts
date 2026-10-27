import { describe, expect, it } from "vitest";
import { mockPolicy, needsConsent, needsSecureProctoringPlan, normalizePolicy, practicePolicy, presetPolicy, usesBiometrics } from "./policy.js";

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
  it("gives an organization that never saved a policy no camera, but listens to the microphone", () => {
    const p = normalizePolicy(null);
    expect(p.mode).toBe("standard");
    expect(p.webcamMonitoring).toBe(false);
    expect(p.audioMonitoring).toBe(true);
    // Listening needs the learner's agreement, but no paid plan.
    expect(needsConsent(p)).toBe(true);
    expect(needsSecureProctoringPlan(p)).toBe(false);
  });

  it("keeps listening off for a policy saved before it existed", () => {
    const p = normalizePolicy({ mode: "standard", region: "global", webcamMonitoring: true });
    expect(p.audioMonitoring).toBe(false);
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

describe("practicePolicy", () => {
  it("keeps the background checks but nothing that adds a screen or a prompt", () => {
    const p = practicePolicy(presetPolicy("strict", "eu"));
    expect(p.mode).toBe("strict");
    expect(p.lockdown).toBe(true);
    expect(p.webcamMonitoring).toBe(true);
    expect(p.audioMonitoring).toBe(true);
    expect(p.requireFullscreen || p.screenRecording || p.videoRecording || p.liveMonitoring || p.secureBrowser).toBe(false);
    expect(p.idVerification || p.roomScan || p.voiceMatch).toBe(false);
    expect(p.retentionDays).toBe(30);
  });

  it("stays off when the organization turned proctoring off", () => {
    const p = practicePolicy(presetPolicy("off", "eu"));
    expect(p.mode).toBe("off");
    expect(needsConsent(p)).toBe(false);
  });
});

describe("mockPolicy", () => {
  it("drops the ID photo, room scan and voice sample but keeps the monitoring", () => {
    const strict = presetPolicy("strict", "eu");
    const p = mockPolicy(strict);
    expect(p.idVerification).toBe(false);
    expect(p.roomScan).toBe(false);
    expect(p.voiceMatch).toBe(false);
    expect(p.webcamMonitoring).toBe(strict.webcamMonitoring);
    expect(p.screenRecording).toBe(strict.screenRecording);
    expect(p.mode).toBe(strict.mode);
  });
});
