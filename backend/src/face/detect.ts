// Face detection via YuNet (MIT). Predicts at 3 strides (8/16/32), returns
// box + 5 landmarks (eyes, nose, mouth corners) used for alignment downstream.
import { ORT_OPTIONS, oneAtATime } from "../lib/inference.js";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(process.cwd(), "models", "yunet.onnx");

// Fixed input size; boxes scaled back to original image after inference.
const IN_W = 640;
const IN_H = 640;
const STRIDES = [8, 16, 32] as const;

export interface Landmark {
  x: number;
  y: number;
}

export interface FaceBox {
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
  // [rightEye, leftEye, nose, rightMouth, leftMouth]
  landmarks: Landmark[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let session: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(): Promise<any> {
  if (!session) session = await ort.InferenceSession.create(MODEL_PATH, ORT_OPTIONS);
  return session;
}

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function nms(boxes: FaceBox[], thresh = 0.3): FaceBox[] {
  const kept: FaceBox[] = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) {
    if (kept.every((k) => iou(k, b) < thresh)) kept.push(b);
  }
  return kept;
}

// Returns boxes in original image coordinates, most confident first.
export async function detectFaces(imageBuffer: Buffer, scoreThreshold = 0.6): Promise<FaceBox[]> {
  const meta = await sharp(imageBuffer).metadata();
  const origW = meta.width!;
  const origH = meta.height!;

  // YuNet takes BGR planar float32, unnormalised (raw 0-255 values).
  const { data } = await sharp(imageBuffer)
    .removeAlpha()
    .resize(IN_W, IN_H, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const input = new Float32Array(1 * 3 * IN_H * IN_W);
  const plane = IN_H * IN_W;
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 3 + 2]; // B
    input[plane + i] = data[i * 3 + 1]; // G
    input[2 * plane + i] = data[i * 3]; // R
  }

  const s = await getSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = await oneAtATime(() => s.run({ input: new ort.Tensor("float32", input, [1, 3, IN_H, IN_W]) }));

  const sx = origW / IN_W;
  const sy = origH / IN_H;
  const candidates: FaceBox[] = [];

  for (const stride of STRIDES) {
    const cls = out[`cls_${stride}`].data as Float32Array;
    const obj = out[`obj_${stride}`].data as Float32Array;
    const bbox = out[`bbox_${stride}`].data as Float32Array;
    const kps = out[`kps_${stride}`].data as Float32Array;
    const cols = Math.ceil(IN_W / stride);
    const rows = Math.ceil(IN_H / stride);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        // Geometric mean of the two confidence heads.
        const score = Math.sqrt(Math.max(0, cls[idx]) * Math.max(0, obj[idx]));
        if (score < scoreThreshold) continue;

        const cx = (c + bbox[idx * 4 + 0]) * stride;
        const cy = (r + bbox[idx * 4 + 1]) * stride;
        const w = Math.exp(bbox[idx * 4 + 2]) * stride;
        const h = Math.exp(bbox[idx * 4 + 3]) * stride;

        const landmarks: Landmark[] = [];
        for (let k = 0; k < 5; k++) {
          landmarks.push({
            x: (c + kps[idx * 10 + k * 2]) * stride * sx,
            y: (r + kps[idx * 10 + k * 2 + 1]) * stride * sy,
          });
        }

        candidates.push({
          score,
          x: (cx - w / 2) * sx,
          y: (cy - h / 2) * sy,
          w: w * sx,
          h: h * sy,
          landmarks,
        });
      }
    }
  }

  return nms(candidates).map((b) => ({
    ...b,
    x: Math.max(0, b.x),
    y: Math.max(0, b.y),
    w: Math.min(b.w, origW - Math.max(0, b.x)),
    h: Math.min(b.h, origH - Math.max(0, b.y)),
  }));
}

export interface RawCrop {
  data: Buffer;
  info: { width: number; height: number; channels: number };
}

// 2.7x crop gives MiniFASNet context beyond the face (bezels, paper edges).
export async function cropFace(imageBuffer: Buffer, box: FaceBox, scale = 2.7, size = 80): Promise<RawCrop> {
  const meta = await sharp(imageBuffer).metadata();
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const side = Math.round(Math.max(box.w, box.h) * scale);
  const left = Math.round(cx - side / 2);
  const top = Math.round(cy - side / 2);

  // Pad to keep the crop square instead of clamping+squashing — a squashed
  // rectangle dropped one real person's liveness score from 1.0 to 0.02.
  // Pad with edge pixels, not black (a black border reads as a phone bezel).
  const padLeft = Math.max(0, -left);
  const padTop = Math.max(0, -top);
  const padRight = Math.max(0, left + side - meta.width!);
  const padBottom = Math.max(0, top + side - meta.height!);

  let pipeline = sharp(imageBuffer).removeAlpha();
  if (padLeft || padTop || padRight || padBottom) {
    pipeline = sharp(
      await pipeline.extend({ left: padLeft, top: padTop, right: padRight, bottom: padBottom, extendWith: "copy" }).toBuffer(),
    );
  }

  const result = await pipeline
    .extract({ left: left + padLeft, top: top + padTop, width: side, height: side })
    .resize(size, size, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return result as unknown as RawCrop;
}
