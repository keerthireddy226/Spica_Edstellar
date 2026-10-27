import { isAudioBusy } from "@/lib/audioBusy";

// Listens for another person's voice in the room during a test, from the raw
// microphone signal. Only between answers: while the learner is recording, or
// a question's audio is playing, sound is expected and isn't judged.
//
// It used to compare the overall level with a fixed -42 dBFS. Many laptop
// microphones (with a high built-in boost) hiss above that in a silent room,
// so learners alone in a quiet room were warned again and again. Now it
// listens in the speech band (300-3400 Hz), against this microphone's own
// quiet level, and only counts sound that comes and goes like speech: a
// voice in the room, a TV or a phone call. A steady hiss, a fan or the
// microphone's own noise stays flat and is ignored.

const STEP_MS = 200;
const WINDOW = 15; // 3 s of readings
const HOLD_MS = 3000;
const VOICE_LOW_HZ = 300;
const VOICE_HIGH_HZ = 3400;
// A reading with a voice in it: this much louder than the room's quiet level.
export const VOICE_ABOVE_ROOM_DB = 15;
// Voice in at least this share of the last 3 s ...
const VOICE_SHARE = 0.4;
// ... rising and falling like speech (steady noise varies far less).
const SPEECH_SWING_DB = 4;
// The quiet level follows the room down at once, and up only slowly (0.5 dB a
// second), so a voice doesn't become the new "quiet" while it lasts.
const ROOM_RISE_DB_PER_STEP = 0.1;

export type NoiseState = "quiet" | "noisy";

// Is someone talking? bandDb: the last few seconds of speech-band levels;
// roomDb: the room's quiet level on the same scale.
export function voiceInRoom(bandDb: number[], roomDb: number): boolean {
  const valid = bandDb.filter(Number.isFinite);
  if (valid.length < 10) return false;
  const loud = valid.filter((d) => d >= roomDb + VOICE_ABOVE_ROOM_DB).length;
  if (loud / valid.length < VOICE_SHARE) return false;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sd = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
  return sd >= SPEECH_SWING_DB;
}

// The quieter end of recent readings (20th percentile): the room between words.
export function quietLevel(bandDb: number[]): number | null {
  const valid = bandDb.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length < 5) return null;
  return valid[Math.floor(valid.length * 0.2)];
}

// Reads the speech band's level (dB) from an analyser on the raw microphone.
export function speechBandReader(analyser: AnalyserNode, sampleRate: number): () => number {
  analyser.smoothingTimeConstant = 0;
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const hzPerBin = sampleRate / analyser.fftSize;
  const lo = Math.max(1, Math.floor(VOICE_LOW_HZ / hzPerBin));
  const hi = Math.min(spectrum.length - 1, Math.ceil(VOICE_HIGH_HZ / hzPerBin));
  return () => {
    analyser.getFloatFrequencyData(spectrum);
    let power = 0;
    for (let i = lo; i <= hi; i++) power += 10 ** (spectrum[i] / 10);
    return 10 * Math.log10(Math.max(power, 1e-12));
  };
}

// A few seconds of the room (the device check): did it hear someone talking?
export function voiceInReadings(bandDb: number[]): boolean {
  const room = quietLevel(bandDb);
  return room !== null && voiceInRoom(bandDb, room);
}

// onLevel: how far the speech band is above the room's quiet level, in dB
// (null while sound is expected), for the meter on the paused screen.
export function watchRoomNoise(
  stream: MediaStream,
  onChange: (state: NoiseState) => void,
  onLevel?: (aboveRoomDb: number | null) => void,
): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const readBand = speechBandReader(analyser, ctx.sampleRate);
  const readings: number[] = [];
  let room: number | null = null;
  let state: NoiseState = "quiet";
  let towardMs = 0;
  const timer = setInterval(() => {
    // The learner's own voice and the question's audio aren't someone else talking.
    if (isAudioBusy()) {
      readings.length = 0;
      towardMs = 0;
      onLevel?.(null);
      return;
    }
    const band = readBand();
    readings.push(band);
    if (readings.length > WINDOW) readings.shift();
    const q = quietLevel(readings);
    if (q === null) return;
    room = room === null ? q : Math.min(room + ROOM_RISE_DB_PER_STEP, q);
    onLevel?.(band - room);
    const voice = readings.length >= 10 && voiceInRoom(readings, room);
    const changing = (state === "quiet" && voice) || (state === "noisy" && !voice);
    towardMs = changing ? towardMs + STEP_MS : 0;
    if (towardMs >= HOLD_MS) {
      towardMs = 0;
      state = state === "quiet" ? "noisy" : "quiet";
      onChange(state);
    }
  }, STEP_MS);
  return () => {
    clearInterval(timer);
    ctx.close().catch(() => {});
  };
}
