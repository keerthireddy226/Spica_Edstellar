import { describe, expect, it } from "vitest";
import { IssueGuard, WARN_GAP_MS } from "./issueGuard";

describe("IssueGuard", () => {
  it("warns three times, spaced out, then pauses if the problem is still there", () => {
    const g = new IssueGuard();
    let t = 0;
    expect(g.step({ extra_person: true }, t)).toEqual({ type: "warn", kind: "extra_person", n: 1 });
    expect(g.step({ extra_person: true }, (t += 1000))).toBeNull();
    expect(g.step({ extra_person: true }, (t = WARN_GAP_MS))).toEqual({ type: "warn", kind: "extra_person", n: 2 });
    expect(g.step({ extra_person: true }, (t += WARN_GAP_MS))).toEqual({ type: "warn", kind: "extra_person", n: 3 });
    expect(g.step({ extra_person: true }, (t += 5000))).toBeNull();
    expect(g.step({ extra_person: true }, (t += WARN_GAP_MS))).toEqual({ type: "pause", kind: "extra_person" });
    expect(g.step({ extra_person: true }, (t += 1000))).toBeNull();
    expect(g.step({ extra_person: false }, (t += 1000))).toEqual({ type: "resume", kind: "extra_person" });
  });

  it("a problem that paused the test pauses it straight away if it comes back", () => {
    const g = new IssueGuard();
    let t = 0;
    for (let i = 0; i < 3; i++) g.step({ noise: true }, (t += WARN_GAP_MS));
    expect(g.step({ noise: true }, (t += WARN_GAP_MS))).toEqual({ type: "pause", kind: "noise" });
    g.step({ noise: false }, (t += 1000));
    expect(g.step({ noise: true }, (t += 1000))).toEqual({ type: "pause", kind: "noise" });
  });

  it("a problem that goes away between warnings keeps its count", () => {
    const g = new IssueGuard();
    expect(g.step({ no_face: true }, 0)).toEqual({ type: "warn", kind: "no_face", n: 1 });
    expect(g.step({ no_face: false }, 5000)).toBeNull();
    expect(g.step({ no_face: true }, 60_000)).toEqual({ type: "warn", kind: "no_face", n: 2 });
  });

  it("with no pausing left, it keeps warning instead", () => {
    const g = new IssueGuard();
    let t = 0;
    for (let i = 0; i < 3; i++) g.step({ noise: true }, (t += WARN_GAP_MS));
    expect(g.step({ noise: true }, (t += WARN_GAP_MS), false)).toEqual({ type: "warn", kind: "noise", n: 3 });
  });

  it("another person comes before noise when both are present", () => {
    const g = new IssueGuard();
    expect(g.step({ noise: true, extra_person: true }, 0)).toEqual({ type: "warn", kind: "extra_person", n: 1 });
  });
});

describe("IssueGuard after a page reload", () => {
  it("keeps the warnings given, and a problem that paused pauses straight away", () => {
    const g = new IssueGuard();
    let t = 0;
    for (let i = 0; i < 2; i++) g.step({ extra_person: true }, (t += WARN_GAP_MS));
    for (let i = 0; i < 4; i++) g.step({ noise: true, extra_person: false }, (t += WARN_GAP_MS));
    const again = IssueGuard.restore(g.save());
    expect(again.paused).toBeNull();
    expect(again.step({ noise: true }, (t += 1000))).toEqual({ type: "pause", kind: "noise" });
    const again2 = IssueGuard.restore(g.save());
    expect(again2.step({ extra_person: true }, (t += WARN_GAP_MS))).toEqual({ type: "warn", kind: "extra_person", n: 3 });
    expect(IssueGuard.restore("not json").step({ noise: true }, 0)).toEqual({ type: "warn", kind: "noise", n: 1 });
  });
});
