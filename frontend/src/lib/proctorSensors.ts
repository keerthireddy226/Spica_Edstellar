// Building blocks for proctoring in the browser. Each starts watching or
// recording and returns a function that stops it.
import { isAudioBusy } from "@/lib/audioBusy";

// The data URL's type can itself contain a comma ("codecs=vp8,opus"), so
// cut after "base64," rather than at the first comma.
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const at = url.indexOf("base64,");
      resolve(at === -1 ? "" : url.slice(at + "base64,".length));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function pickMime(kind: "video" | "audio"): string {
  const options =
    kind === "video" ? ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm", "video/mp4"] : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

// Records a stream in back-to-back segments. Each segment is its own
// recorder, so every uploaded file plays on its own.
export function recordSegments(
  stream: MediaStream,
  opts: { kind: "video" | "audio"; segmentMs: number; videoBitsPerSecond?: number; audioBitsPerSecond?: number },
  onSegment: (blob: Blob, mimeType: string, seq: number, durationMs: number) => void,
): () => void {
  const mimeType = pickMime(opts.kind);
  let stopped = false;
  let seq = 0;
  let current: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = () => {
    if (stopped || stream.getTracks().every((t) => t.readyState === "ended")) return;
    const chunks: Blob[] = [];
    const started = Date.now();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: opts.videoBitsPerSecond, audioBitsPerSecond: opts.audioBitsPerSecond });
    } catch {
      return;
    }
    const mySeq = seq++;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (chunks.length) onSegment(new Blob(chunks, { type: rec.mimeType || mimeType }), rec.mimeType || mimeType, mySeq, Date.now() - started);
      next();
    };
    rec.start();
    current = rec;
    timer = setTimeout(() => rec.state !== "inactive" && rec.stop(), opts.segmentMs);
  };
  next();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    // Stopping uploads the last, shorter segment.
    if (current && current.state !== "inactive") current.stop();
  };
}

// Watches the camera picture between snapshots: a covered lens (almost
// black) or a picture that stops changing at all (a frozen or fake feed).
// onUncovered: the picture is lit again after being covered.
export function watchCamera(stream: MediaStream, onCovered: () => void, onFrozen: () => void, onUncovered?: () => void): () => void {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 24;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null;
  let dark = 0;
  let still = 0;
  const timer = setInterval(() => {
    if (!video.videoWidth) return;
    ctx.drawImage(video, 0, 0, 32, 24);
    const px = ctx.getImageData(0, 0, 32, 24).data;
    let lum = 0;
    let diff = 0;
    for (let i = 0; i < px.length; i += 4) {
      lum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (prev) diff += Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]);
    }
    lum /= px.length / 4;
    diff /= px.length / 4;
    prev = new Uint8ClampedArray(px);
    if (lum >= 14 && dark >= 3) onUncovered?.();
    dark = lum < 14 ? dark + 1 : 0;
    // A live camera always has some sensor noise between frames.
    still = lum >= 14 && diff < 0.4 ? still + 1 : 0;
    // Three samples (6 s) of black, six (12 s) of an unchanging picture.
    if (dark === 3) onCovered();
    if (still === 6) onFrozen();
  }, 2000);
  return () => {
    clearInterval(timer);
    video.srcObject = null;
  };
}

// Listens between answers. Sustained speech-level sound while no answer is
// being recorded and no question audio is playing counts as talking; a
// short clip of it is recorded for the reviewer.
export function watchSpeech(stream: MediaStream, onSpeech: (clip: Blob | null, mimeType: string) => void): () => void {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let floor = 0.01;
  let loudMs = 0;
  let cooldownUntil = 0;
  const STEP = 200;
  const mimeType = pickMime("audio");
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    const rms = Math.sqrt(sum / data.length);
    // Slow-moving noise floor: follows quiet rooms down quickly, loud ones up slowly.
    floor = rms < floor ? floor * 0.8 + rms * 0.2 : floor * 0.995 + rms * 0.005;
    const speaking = rms > Math.max(0.015, floor * 3.5);
    if (isAudioBusy() || Date.now() < cooldownUntil) {
      loudMs = 0;
      return;
    }
    loudMs = speaking ? loudMs + STEP : Math.max(0, loudMs - STEP);
    if (loudMs < 1500) return;
    loudMs = 0;
    cooldownUntil = Date.now() + 30_000;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, audioBitsPerSecond: 32_000 });
    } catch {
      onSpeech(null, "");
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => onSpeech(chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeType }) : null, rec.mimeType || mimeType);
    rec.start();
    setTimeout(() => rec.state !== "inactive" && rec.stop(), 8000);
  }, STEP);
  return () => {
    clearInterval(timer);
    ctx.close().catch(() => {});
  };
}

// Common English letter pairs whose timing makes up a typing profile.
const DIGRAPHS = new Set(["th", "he", "in", "er", "an", "re", "on", "at", "en", "nd", "ti", "es", "or", "te", "of", "ed", "is", "it", "al", "ar", "st", "to", "nt", "ng", "se", "ha", "as", "ou", "io", "le", "ve", "co", "me", "de", "hi", "ri", "ro", "ic", "ne", "ea", "ra", "ce"]);

export type TypingProfile = Record<string, number>;

// Timing only: how long keys are held, the gaps between keys, and the gap
// for common letter pairs. Neither the text nor the key order leaves the
// browser. A profile is sent every 80 keys and when the field loses focus.
export function profileTyping(onProfile: (p: TypingProfile) => void): () => void {
  const down = new Map<string, number>();
  let dwell: number[] = [];
  let flight: number[] = [];
  let pairs: Record<string, number[]> = {};
  let lastUp = 0;
  let lastKey = "";
  const isField = (t: EventTarget | null) => t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === "text" || t.type === ""));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const flush = () => {
    if (dwell.length < 20) return;
    const p: TypingProfile = { keys: dwell.length, dwell: Math.round(mean(dwell)) };
    if (flight.length >= 10) p.flight = Math.round(mean(flight));
    for (const [k, xs] of Object.entries(pairs)) if (xs.length >= 2) p[`dg_${k}`] = Math.round(mean(xs));
    onProfile(p);
    dwell = [];
    flight = [];
    pairs = {};
  };
  const onDown = (e: KeyboardEvent) => {
    if (!isField(e.target) || e.repeat || e.key.length !== 1) return;
    const now = performance.now();
    down.set(e.code, now);
    const key = e.key.toLowerCase();
    if (lastUp && now - lastUp < 1500) {
      flight.push(now - lastUp);
      const pair = lastKey + key;
      if (DIGRAPHS.has(pair)) (pairs[pair] ??= []).push(now - lastUp);
    }
    lastKey = /[a-z]/.test(key) ? key : "";
  };
  const onUp = (e: KeyboardEvent) => {
    const start = down.get(e.code);
    if (start === undefined) return;
    down.delete(e.code);
    const now = performance.now();
    const held = now - start;
    if (held < 1000) dwell.push(held);
    lastUp = now;
    if (dwell.length >= 80) flush();
  };
  const onBlur = (e: FocusEvent) => {
    if (isField(e.target)) flush();
  };
  document.addEventListener("keydown", onDown, true);
  document.addEventListener("keyup", onUp, true);
  document.addEventListener("focusout", onBlur, true);
  return () => {
    flush();
    document.removeEventListener("keydown", onDown, true);
    document.removeEventListener("keyup", onUp, true);
    document.removeEventListener("focusout", onBlur, true);
  };
}
