import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterAll, describe, expect, it } from "vitest";
import { measureAnswerNoise } from "./answerAudio.js";

const dir = mkdtempSync(path.join(tmpdir(), "answer-noise-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Two seconds of tone bursts (speech stand-in) with gaps, plus pink noise at the given amplitude.
function makeAnswer(name: string, noiseAmplitude: number): string {
  const file = path.join(dir, `${name}.wav`);
  const bursts = "sine=frequency=220:sample_rate=16000:duration=4,volume='if(lt(mod(t,1),0.6),0.5,0)':eval=frame";
  const filter =
    noiseAmplitude > 0
      ? `${bursts}[s];anoisesrc=color=pink:amplitude=${noiseAmplitude}:sample_rate=16000:duration=4:seed=7[n];[s][n]amix=inputs=2:normalize=0`
      : bursts;
  spawnSync(ffmpegPath as unknown as string, ["-y", "-v", "error", "-f", "lavfi", "-i", filter, "-ac", "1", file]);
  return file;
}

describe("measureAnswerNoise", () => {
  it("doesn't flag a quiet recording", async () => {
    const r = await measureAnswerNoise(makeAnswer("quiet", 0.002));
    expect(r.noisy).toBe(false);
    expect(r.snrDb).toBeGreaterThan(20);
  });

  it("flags noise loud enough to cover the speech", async () => {
    const r = await measureAnswerNoise(makeAnswer("noisy", 0.3));
    expect(r.noisy).toBe(true);
  });

  it("has no measurement for a file it can't read", async () => {
    expect(await measureAnswerNoise(path.join(dir, "missing.webm"))).toEqual({ snrDb: null, noisy: false });
  });
});
