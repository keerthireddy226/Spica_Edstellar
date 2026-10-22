// How loud the room is, from the microphone while the learner stays silent.
// Read from the raw signal (no noise suppression, no automatic gain): the
// browser's noise suppression wipes out steady noise before it reaches an
// analyser, so the old reading on the processed signal said "quiet" even for
// loud noise (measured in Chrome: noise at -31 dBFS read as -48 processed).
//
// Speech at a normal distance reaches roughly -30 to -20 dBFS on a raw laptop
// or headset microphone. A room at -42 dBFS or louder is then within about
// 12 dB of the voice, the same margin under which the server marks a recorded
// answer as noisy (NOISY_SNR_DB in backend/src/proctoring/answerAudio.ts).
// Measured in Chrome with recorded noise as the microphone: a quiet room
// -68 dBFS, a fan-like hum -45 (quiet), pink noise -40 and -31 (noisy).
export const NOISY_ROOM_DBFS = -42;

export type RoomNoise = "quiet" | "noisy";

export function rmsToDbfs(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

// Overall level of a run of short RMS readings, in dBFS. Averaged as power,
// so talking or a TV that comes and goes counts, not only a steady hum.
// null when there was nothing to measure.
export function roomLevelDbfs(rmsReadings: number[]): number | null {
  const valid = rmsReadings.filter((r) => Number.isFinite(r) && r >= 0);
  if (!valid.length) return null;
  const meanPower = valid.reduce((sum, r) => sum + r * r, 0) / valid.length;
  return rmsToDbfs(Math.sqrt(meanPower));
}

export function roomNoiseFrom(rmsReadings: number[]): RoomNoise | null {
  const level = roomLevelDbfs(rmsReadings);
  if (level === null) return null;
  return level >= NOISY_ROOM_DBFS ? "noisy" : "quiet";
}
