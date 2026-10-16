import { describe, expect, it } from "vitest";
import { allowedSeconds, answerKey, answerTooLate, bandForLevel, mockDeadline, secondsLeft, MOCK_GRACE_SECONDS } from "./modes.js";

const LANGUAGECERT = {
  min: 0,
  max: 100,
  bands: [
    { from: 90, level: "C2" },
    { from: 75, level: "C1" },
    { from: 60, level: "B2" },
    { from: 40, level: "B1" },
    { from: 20, level: "A2" },
    { from: 10, level: "A1" },
  ],
};

describe("allowedSeconds", () => {
  const base = { content: {}, timer_seconds: 45, estimated_seconds: 60, two_phase_read_seconds: null, prep_seconds: null, audio_ms: null };

  it("is the answer time for a question without audio", () => {
    expect(allowedSeconds(base)).toBe(45);
  });

  it("adds one play of the recording and a few seconds", () => {
    expect(allowedSeconds({ ...base, timer_seconds: 30, audio_ms: 20_000 })).toBe(30 + 20 + 5);
  });

  it("estimates the recording from the script when none is generated", () => {
    // 25 words at 2.5 words a second = 10 s.
    const script = Array.from({ length: 25 }, () => "word").join(" ");
    expect(allowedSeconds({ ...base, timer_seconds: 30, content: { audio: script } })).toBe(30 + 10 + 5);
  });

  it("adds reading and preparation time", () => {
    expect(allowedSeconds({ ...base, timer_seconds: 150, prep_seconds: 30 })).toBe(180);
    expect(allowedSeconds({ ...base, timer_seconds: 60, two_phase_read_seconds: 30 })).toBe(90);
  });

  it("falls back to the estimate, then a minute", () => {
    expect(allowedSeconds({ ...base, timer_seconds: null })).toBe(60);
    expect(allowedSeconds({ ...base, timer_seconds: null, estimated_seconds: null })).toBe(60);
  });
});

describe("mock timing", () => {
  const shownAt = new Date("2026-10-16T10:00:00Z");
  const comp = { limits: { a: 60 }, deadlineAt: "2026-10-16T11:00:00Z" };

  it("counts down from when the question was first shown", () => {
    expect(secondsLeft(comp, "a", shownAt, new Date("2026-10-16T10:00:20Z"))).toBe(40);
    expect(secondsLeft(comp, "a", shownAt, new Date("2026-10-16T10:05:00Z"))).toBe(0);
    expect(secondsLeft(comp, "a", undefined)).toBeNull();
  });

  it("never runs past the mock's deadline", () => {
    const late = { ...comp, deadlineAt: "2026-10-16T10:00:30Z" };
    expect(secondsLeft(late, "a", shownAt, new Date("2026-10-16T10:00:10Z"))).toBe(20);
  });

  it("accepts an answer within the grace and refuses one after it", () => {
    const at = (s: number) => new Date(shownAt.getTime() + s * 1000);
    expect(answerTooLate(comp, "a", shownAt, at(60 + MOCK_GRACE_SECONDS))).toBe(false);
    expect(answerTooLate(comp, "a", shownAt, at(60 + MOCK_GRACE_SECONDS + 1))).toBe(true);
  });

  it("refuses any answer after the mock's deadline", () => {
    const comp2 = { limits: { a: 600 }, deadlineAt: "2026-10-16T10:01:00Z" };
    expect(answerTooLate(comp2, "a", shownAt, new Date("2026-10-16T10:02:00Z"))).toBe(true);
  });

  it("sets the deadline from the questions, part intros and slack", () => {
    const start = new Date("2026-10-16T10:00:00Z");
    expect(mockDeadline({ a: 60, b: 120 }, 2, start).toISOString()).toBe("2026-10-16T10:14:00.000Z");
  });
});

describe("bandForLevel", () => {
  it("gives the family's published range for a level", () => {
    expect(bandForLevel(LANGUAGECERT, "B2")).toEqual({ level: "B2", from: 60, to: 74 });
    expect(bandForLevel(LANGUAGECERT, "C2")).toEqual({ level: "C2", from: 90, to: 100 });
    expect(bandForLevel(LANGUAGECERT, "A1")).toEqual({ level: "A1", from: 10, to: 19 });
  });

  it("is null without a scale or a level", () => {
    expect(bandForLevel(null, "B2")).toBeNull();
    expect(bandForLevel(LANGUAGECERT, null)).toBeNull();
    expect(bandForLevel(LANGUAGECERT, "Pre-A1")).toBeNull();
  });
});

describe("answerKey", () => {
  it("reads each kind of answer set", () => {
    expect(answerKey({ correctIndex: 2 })).toEqual({ index: 2 });
    expect(answerKey({ correct: [0, 2, 1] })).toEqual({ indexes: [0, 2, 1] });
    expect(answerKey({ exact: "The train leaves at six." })).toEqual({ text: "The train leaves at six." });
    expect(answerKey({ acceptable_answers: ["arrive", "come"] })).toEqual({ text: "arrive" });
    expect(answerKey({ key_points: ["late train", "missed meeting"] })).toEqual({ points: ["late train", "missed meeting"] });
    expect(answerKey(null)).toBeNull();
  });
});
