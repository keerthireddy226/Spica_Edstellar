// AuraFace-v1 (Apache-2.0): 512-dim face embedding, cosine similarity.
// Measures geometry, not describable attributes — beat Gemini 0.37 vs 0.89 on a lookalike pair.
import { ORT_OPTIONS, oneAtATime } from "../lib/inference.js";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import type { FaceBox } from "./detect.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(process.cwd(), "models", "auraface.onnx");

// ArcFace reference landmarks (right eye, left eye, nose, mouth corners).
const REFERENCE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];
const SIZE = 112;

// Measured: genuine 0.631-0.977, impostor ceiling 0.426 (31 people, 0 false accepts).
export const MATCH_THRESHOLD = 0.6;
export const UNCERTAIN_FLOOR = 0.45;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let session: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(): Promise<any> {
  if (!session) session = await ort.InferenceSession.create(MODEL_PATH, ORT_OPTIONS);
  return session;
}

// Least-squares transform mapping detected landmarks onto reference pose.
function similarityTransform(src: [number, number][], dst: [number, number][]) {
  const n = src.length;
  const mean = (pts: [number, number][], i: 0 | 1) => pts.reduce((s, p) => s + p[i], 0) / n;
  const sxm = mean(src, 0);
  const sym = mean(src, 1);
  const dxm = mean(dst, 0);
  const dym = mean(dst, 1);

  let a = 0;
  let b = 0;
  let srcVar = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - sxm;
    const sy = src[i][1] - sym;
    const dx = dst[i][0] - dxm;
    const dy = dst[i][1] - dym;
    a += sx * dx + sy * dy;
    b += sx * dy - sy * dx;
    srcVar += sx * sx + sy * sy;
  }
  const scale = Math.hypot(a, b) / srcVar;
  const cos = (a / Math.hypot(a, b)) * scale;
  const sin = (b / Math.hypot(a, b)) * scale;
  return {
    a: cos,
    b: -sin,
    c: dxm - (cos * sxm - sin * sym),
    d: sin,
    e: cos,
    f: dym - (sin * sxm + cos * sym),
  };
}

// 512-dim embedding for one detected face; null if transform is degenerate.
export async function embedFace(imageBuffer: Buffer, box: FaceBox): Promise<Float32Array | null> {
  if (!box?.landmarks || box.landmarks.length !== 5) return null;
  const src: [number, number][] = box.landmarks.map((p) => [p.x, p.y]);
  const t = similarityTransform(src, REFERENCE);

  // Inverse-mapped warp (not sharp's .affine(), which silently mis-sized).
  const { data: src8, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;

  const det = t.a * t.e - t.b * t.d;
  if (!det) return null;
  const ia = t.e / det;
  const ib = -t.b / det;
  const id = -t.d / det;
  const ie = t.a / det;

  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  const at = (px: number, py: number, ch: number): number => {
    const cx = Math.min(W - 1, Math.max(0, px));
    const cy = Math.min(H - 1, Math.max(0, py));
    return src8[(cy * W + cx) * 3 + ch];
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ox = x - t.c;
      const oy = y - t.f;
      // Bilinear sample avoids aliasing the network would read as texture.
      const sx = ia * ox + ib * oy;
      const sy = id * ox + ie * oy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = y * SIZE + x;
      for (let ch = 0; ch < 3; ch++) {
        const v =
          at(x0, y0, ch) * (1 - fx) * (1 - fy) +
          at(x0 + 1, y0, ch) * fx * (1 - fy) +
          at(x0, y0 + 1, ch) * (1 - fx) * fy +
          at(x0 + 1, y0 + 1, ch) * fx * fy;
        input[ch * plane + o] = (v - 127.5) / 127.5;
      }
    }
  }

  const s = await getSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await oneAtATime(() => s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) }));
  return Float32Array.from(out[s.outputNames[0]].data as Float32Array);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
