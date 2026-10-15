// Object detection on proctoring snapshots: SSD-MobileNet v1 trained on COCO
// (ONNX model zoo, Apache-2.0). Only the few classes that matter during a
// test are reported — a phone, a book or a second screen in view.
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(process.cwd(), "models", "object-detection.onnx");
const IN_SIZE = 300;

// COCO class ids as this model numbers them (1-based).
const WATCHED: Record<number, string> = {
  1: "person",
  73: "laptop",
  72: "tv",
  77: "cell_phone",
  84: "book",
};
// Phones are small in a webcam frame, so they get a lower bar than the rest.
const MIN_SCORE: Record<string, number> = { cell_phone: 0.4, book: 0.5, laptop: 0.5, tv: 0.5, person: 0.6 };

export interface DetectedObject {
  label: string;
  score: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let session: any = null;
let unavailable = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(): Promise<any> {
  if (!session) session = await ort.InferenceSession.create(MODEL_PATH);
  return session;
}

// Returns null when the model can't be loaded, so a missing model file
// skips this signal instead of failing the snapshot.
export async function detectObjects(image: Buffer): Promise<DetectedObject[] | null> {
  if (unavailable) return null;
  let s;
  try {
    s = await getSession();
  } catch (err) {
    unavailable = true;
    console.error("object detection model unavailable, skipping:", err instanceof Error ? err.message : err);
    return null;
  }
  const { data } = await sharp(image).rotate().resize(IN_SIZE, IN_SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const input = new ort.Tensor("uint8", new Uint8Array(data), [1, IN_SIZE, IN_SIZE, 3]);
  const out = await s.run({ inputs: input });
  const n = Math.round(out.num_detections.data[0]);
  const classes = out.detection_classes.data as Float32Array;
  const scores = out.detection_scores.data as Float32Array;
  const found: DetectedObject[] = [];
  for (let i = 0; i < n; i++) {
    const label = WATCHED[Math.round(classes[i])];
    if (!label || scores[i] < MIN_SCORE[label]) continue;
    found.push({ label, score: Math.round(scores[i] * 100) / 100 });
  }
  return found;
}
