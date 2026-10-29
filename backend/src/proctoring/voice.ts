// Speaker embeddings for the voice-consistency check, computed locally with
// sherpa-onnx-node. Model: NVIDIA NeMo TitaNet-Large (CC-BY-4.0, commercial
// use allowed with attribution), 192 numbers per voice.
//
// The earlier Voice Check compared one short clip against an enrollment with
// a single fixed threshold and blocked the learner on a mismatch. This module
// only produces evidence: it trims silence, joins many answers into longer
// stretches of speech, and lets the caller compare those stretches.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { ensureFile } from "../storage/mirror.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sherpaOnnx = require("sherpa-onnx-node");

const MODEL_PATH = path.join(process.cwd(), "models", "speaker-embedding.onnx");
export const SAMPLE_RATE = 16000;
const FRAME = 400; // 25 ms

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getExtractor(): any {
  if (!extractor) extractor = new sherpaOnnx.SpeakerEmbeddingExtractor({ model: MODEL_PATH, numThreads: 1, debug: false });
  return extractor;
}

export function voiceModelAvailable(): boolean {
  try {
    getExtractor();
    return true;
  } catch {
    return false;
  }
}

// Decodes any browser recording (webm/ogg/mp4) to 16 kHz mono float samples.
// ffmpeg writes to a real file: piping WAV left the header unfinished.
export async function decodeAudio(file: string): Promise<Float32Array> {
  await ensureFile(file);
  const dir = await mkdtemp(path.join(tmpdir(), "voice-"));
  const out = path.join(dir, "out.f32");
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(ffmpegPath as unknown as string, ["-y", "-v", "error", "-i", file, "-ar", String(SAMPLE_RATE), "-ac", "1", "-f", "f32le", out]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.slice(-300)}`))));
    });
    const buf = await readFile(out);
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface SpeechStats {
  speechSeconds: number;
  // Loud speech frames against the quietest frames, in dB. Low = noisy room.
  snrDb: number;
  clippedRatio: number;
}

// Keeps only frames louder than the recording's own noise floor, so pauses
// and room noise don't dilute the voiceprint. Simple energy gate, no model.
export function trimSilence(samples: Float32Array): { speech: Float32Array; stats: SpeechStats } {
  const frames = Math.floor(samples.length / FRAME);
  const energy = new Float32Array(frames);
  let clipped = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
      const s = samples[i];
      sum += s * s;
      if (Math.abs(s) > 0.99) clipped++;
    }
    energy[f] = sum / FRAME;
  }
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const floor = Math.max(pick(0.1), 1e-7);
  const loud = Math.max(pick(0.9), 1e-7);
  const gate = Math.max(floor * 4, loud * 0.05);
  const keep: number[] = [];
  for (let f = 0; f < frames; f++) if (energy[f] >= gate) keep.push(f);
  const speech = new Float32Array(keep.length * FRAME);
  keep.forEach((f, k) => speech.set(samples.subarray(f * FRAME, (f + 1) * FRAME), k * FRAME));
  return {
    speech,
    stats: {
      speechSeconds: speech.length / SAMPLE_RATE,
      snrDb: Math.round(10 * Math.log10(loud / floor)),
      clippedRatio: samples.length ? clipped / samples.length : 0,
    },
  };
}

export function embed(speech: Float32Array): Float32Array {
  const ex = getExtractor();
  const stream = ex.createStream();
  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: speech });
  return ex.compute(stream);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
