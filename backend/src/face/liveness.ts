// MiniFASNet V2 (Apache-2.0). Looks at texture/context, not the face. Verified vs real spoofs: scores 0.001-0.024 vs 0.5 cutoff.
import { ORT_OPTIONS, oneAtATime } from "../lib/inference.js";
import path from "node:path";
import { createRequire } from "node:module";
import type { RawCrop } from "./detect.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(process.cwd(), "models", "minifasnet_v2.onnx");

export interface LivenessResult {
  live: number;
  spoof: number;
  isLive: boolean;
  // [attack, live, attack] — kept raw for threshold calibration.
  probs: number[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let session: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(): Promise<any> {
  if (!session) session = await ort.InferenceSession.create(MODEL_PATH, ORT_OPTIONS);
  return session;
}

// Score an 80x80 raw RGB crop (from cropFace) for liveness.
export async function scoreLiveness(rawCrop: RawCrop): Promise<LivenessResult> {
  const { data, info } = rawCrop;
  const plane = info.width * info.height;
  // RAW 0-255, not [0,1] as the HF card claims — [0,1] silently collapses
  // every input (noise, faces, blanks) to the same class. Verified by sweep.
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 3 + 2];
    input[plane + i] = data[i * 3 + 1];
    input[2 * plane + i] = data[i * 3];
  }

  const s = await getSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await oneAtATime(() => s.run({ input: new ort.Tensor("float32", input, [1, 3, info.height, info.width]) }));
  const logits = Array.from(out[s.outputNames[0]].data as Float32Array);
  const max = Math.max(...logits);
  const exp = logits.map((v) => Math.exp(v - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  const probs = exp.map((v) => v / sum);

  // Index 1 = live, 0 and 2 = attack (verified against reference test.py,
  // not assumed — backwards inverts the whole gate).
  const argmax = probs.indexOf(Math.max(...probs));
  return {
    live: probs[1],
    spoof: probs[0] + probs[2],
    isLive: argmax === 1,
    probs,
  };
}
