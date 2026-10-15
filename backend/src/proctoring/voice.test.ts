import { describe, expect, it } from "vitest";
import { concat, cosine, SAMPLE_RATE, trimSilence } from "./voice.js";

// One second of a 200 Hz tone, then one second of near-silence, repeated.
function toneAndSilence(seconds: number): Float32Array {
  const out = new Float32Array(seconds * SAMPLE_RATE);
  for (let i = 0; i < out.length; i++) {
    const loud = Math.floor(i / SAMPLE_RATE) % 2 === 0;
    out[i] = loud ? 0.3 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) : 0.0005 * Math.sin(i);
  }
  return out;
}

describe("trimSilence", () => {
  it("keeps the loud half and drops the quiet half", () => {
    const { speech, stats } = trimSilence(toneAndSilence(10));
    expect(stats.speechSeconds).toBeGreaterThan(4.5);
    expect(stats.speechSeconds).toBeLessThan(5.5);
    expect(speech.length).toBe(Math.round(stats.speechSeconds * SAMPLE_RATE));
    expect(stats.snrDb).toBeGreaterThan(30);
  });

  it("reports no clipping for a clean signal", () => {
    expect(trimSilence(toneAndSilence(4)).stats.clippedRatio).toBe(0);
  });
});

describe("cosine and concat", () => {
  it("scores identical vectors 1 and opposite vectors -1", () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, new Float32Array([-1, -2, -3]))).toBeCloseTo(-1);
    expect(cosine(a, new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("joins arrays in order", () => {
    expect(Array.from(concat([new Float32Array([1]), new Float32Array([2, 3])]))).toEqual([1, 2, 3]);
  });
});
