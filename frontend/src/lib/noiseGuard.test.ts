import { describe, expect, it } from "vitest";
import { quietLevel, voiceInRoom } from "./noiseGuard";

// Speech-band levels in dB, every 200 ms for 3 s.
const steady = (level: number) => Array.from({ length: 15 }, (_, i) => level + (i % 2 ? 0.5 : -0.5));
// Words and short pauses: loud, then near the room's level.
const talking = (room: number) => Array.from({ length: 15 }, (_, i) => (i % 3 === 2 ? room + 2 : room + 22 + (i % 2) * 4));

describe("voiceInRoom", () => {
  it("ignores a quiet room", () => {
    expect(voiceInRoom(steady(-90), -90)).toBe(false);
  });

  it("ignores a steady hiss or fan, even a loud one", () => {
    // A boosted laptop microphone in a silent room, or a fan: flat, whatever its level.
    expect(voiceInRoom(steady(-50), -90)).toBe(false);
    expect(voiceInRoom(steady(-50), -50)).toBe(false);
  });

  it("hears someone talking", () => {
    expect(voiceInRoom(talking(-90), -90)).toBe(true);
  });

  it("ignores a single word or a cough", () => {
    const once = steady(-90).map((d, i) => (i === 4 || i === 5 ? -65 : d));
    expect(voiceInRoom(once, -90)).toBe(false);
  });

  it("ignores quiet talking far away", () => {
    expect(voiceInRoom(talking(-90).map((d) => d - 12), -90)).toBe(false);
  });

  it("needs a few seconds of readings", () => {
    expect(voiceInRoom(talking(-90).slice(0, 5), -90)).toBe(false);
  });
});

describe("quietLevel", () => {
  it("is the room between words, not the voice", () => {
    expect(quietLevel(talking(-90))).toBeLessThan(-80);
  });
});
