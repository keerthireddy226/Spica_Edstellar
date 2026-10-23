import { isAudioBusy } from "@/lib/audioBusy";
import { NOISY_ROOM_DBFS, rmsToDbfs } from "@/lib/roomNoise";

// Watches the room's background noise during a test, from the raw microphone
// signal. Only between answers: while the learner is recording, or a
// question's audio is playing, the sound is expected and isn't judged.
//
// The noise floor is the quieter end of the last few seconds (a low
// percentile of short readings), so a cough or a passing word doesn't count
// but a steady noise (traffic, a fan close to the mic, a TV, a crowd) does.
// "noisy" once the floor stays at NOISY_ROOM_DBFS or louder for HOLD_MS;
// "quiet" again once it stays clearly under it for HOLD_MS.

const STEP_MS = 200;
const WINDOW = 15; // 3 s of readings
const HOLD_MS = 3000;
// Quiet again only this far under the noisy level, so the hold doesn't flicker.
const QUIET_MARGIN_DB = 3;

export type NoiseState = "quiet" | "noisy";

// The 20th percentile: the room between words and sounds, not the peaks.
export function noiseFloorDbfs(rmsReadings: number[]): number | null {
  const valid = rmsReadings.filter((r) => Number.isFinite(r) && r >= 0).sort((a, b) => a - b);
  if (valid.length < 5) return null;
  return rmsToDbfs(valid[Math.floor(valid.length * 0.2)]);
}

export function watchRoomNoise(
  stream: MediaStream,
  onChange: (state: NoiseState) => void,
  onLevel?: (dbfs: number | null) => void,
): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const readings: number[] = [];
  let state: NoiseState = "quiet";
  let towardMs = 0;
  const timer = setInterval(() => {
    // The learner's own voice and the question's audio aren't background noise.
    if (isAudioBusy()) {
      readings.length = 0;
      towardMs = 0;
      onLevel?.(null);
      return;
    }
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    readings.push(Math.sqrt(sum / data.length));
    if (readings.length > WINDOW) readings.shift();
    const floor = noiseFloorDbfs(readings);
    onLevel?.(floor);
    if (floor === null) return;
    const goingNoisy = state === "quiet" && floor >= NOISY_ROOM_DBFS;
    const goingQuiet = state === "noisy" && floor < NOISY_ROOM_DBFS - QUIET_MARGIN_DB;
    towardMs = goingNoisy || goingQuiet ? towardMs + STEP_MS : 0;
    if (towardMs >= HOLD_MS) {
      towardMs = 0;
      state = goingNoisy ? "noisy" : "quiet";
      onChange(state);
    }
  }, STEP_MS);
  return () => {
    clearInterval(timer);
    ctx.close().catch(() => {});
  };
}
