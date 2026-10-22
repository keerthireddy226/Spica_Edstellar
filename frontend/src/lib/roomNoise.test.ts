import { describe, expect, it } from "vitest";
import { NOISY_ROOM_DBFS, rmsToDbfs, roomLevelDbfs, roomNoiseFrom } from "./roomNoise";

// RMS that reads as the given dBFS.
const at = (dbfs: number) => 10 ** (dbfs / 20);

describe("room noise", () => {
  it("converts RMS to dBFS", () => {
    expect(rmsToDbfs(1)).toBeCloseTo(0);
    expect(rmsToDbfs(0.01)).toBeCloseTo(-40);
    expect(rmsToDbfs(0)).toBeCloseTo(-120);
  });

  it("calls a quiet room quiet", () => {
    expect(roomNoiseFrom(Array(30).fill(at(-68)))).toBe("quiet");
    expect(roomNoiseFrom(Array(30).fill(at(-45)))).toBe("quiet");
  });

  it("calls steady loud noise noisy (what the processed signal used to hide)", () => {
    expect(roomNoiseFrom(Array(30).fill(at(-40)))).toBe("noisy");
    expect(roomNoiseFrom(Array(30).fill(at(-31)))).toBe("noisy");
    expect(roomNoiseFrom(Array(30).fill(at(NOISY_ROOM_DBFS)))).toBe("noisy");
  });

  it("counts talking that comes and goes, not only a steady hum", () => {
    // A quiet room with someone talking a quarter of the time.
    const readings = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? at(-30) : at(-65)));
    expect(roomLevelDbfs(readings)!).toBeGreaterThan(NOISY_ROOM_DBFS);
    expect(roomNoiseFrom(readings)).toBe("noisy");
  });

  it("has no reading without samples", () => {
    expect(roomNoiseFrom([])).toBeNull();
    expect(roomNoiseFrom([Number.NaN])).toBeNull();
  });
});
