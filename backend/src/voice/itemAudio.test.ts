import { describe, expect, it } from "vitest";
import { voiceForQuestion } from "./itemAudio.js";
import { allowedSeconds } from "../practiceTests/modes.js";

describe("real-test voices and plays", () => {
  it("gives each question a fixed voice, mixing female and male across questions", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const voices = ids.map(voiceForQuestion);
    expect(new Set(voices)).toEqual(new Set(["female", "male"]));
    expect(ids.map(voiceForQuestion)).toEqual(voices);
    const female = voices.filter((v) => v === "female").length;
    expect(female).toBeGreaterThan(60);
    expect(female).toBeLessThan(140);
  });

  it("keeps the time limit allowing two listens (real tests play once but get the same time)", () => {
    const row = { content: null, timer_seconds: 15, estimated_seconds: null, two_phase_read_seconds: null, prep_seconds: null, audio_ms: 4000 } as never;
    expect(allowedSeconds(row)).toBe(15 + 8 + 5);
  });
});
