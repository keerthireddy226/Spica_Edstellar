// The device check before a test: connection speed, what each test needs,
// and handing the result to the session's integrity timeline once the
// session exists. The check runs before every test; a pass is never reused.
import { sendProctoringEvents } from "@/api/proctoring";

export const MIN_DOWN_MBPS = 1;
export const MIN_UP_MBPS = 0.5;
export const MAX_PING_MS = 500;

export interface DeviceNeeds {
  mic: boolean;
  speaker: boolean;
}

// Every test checks the microphone and room noise as well as the speakers,
// including the Writing test: the microphone is also how a monitored test
// listens for talking.
export function deviceNeedsFor(_kind: string): DeviceNeeds {
  return { mic: true, speaker: true };
}

export interface ConnectionResult {
  downMbps: number;
  upMbps: number;
  pingMs: number;
}

export function connectionPasses(c: ConnectionResult): boolean {
  return c.downMbps >= MIN_DOWN_MBPS && c.upMbps >= MIN_UP_MBPS && c.pingMs <= MAX_PING_MS;
}

const TRANSFER_TIMEOUT_MS = 15_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mbps(bytes: number, ms: number): number {
  return Math.round(((bytes * 8) / (Math.max(ms, 1) / 1000) / 1_000_000) * 10) / 10;
}

async function timedFetch(url: string, init?: RequestInit): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT_MS);
  try {
    const started = performance.now();
    const res = await fetch(url, { credentials: "include", cache: "no-store", signal: controller.signal, ...init });
    await res.arrayBuffer();
    if (!res.ok) throw new Error("system_check_failed");
    return performance.now() - started;
  } catch (err) {
    // A transfer that never finished counts as too slow, not as an error.
    if (controller.signal.aborted) return Infinity;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function randomPayload(bytes: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  // getRandomValues fills at most 64 KB per call.
  for (let i = 0; i < bytes; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(bytes, i + 65_536)));
  return out;
}

// Throws when the server can't be reached at all (offline).
export async function measureConnection(): Promise<ConnectionResult> {
  const pings: number[] = [];
  // The first round trip opens the connection; it isn't counted.
  for (let i = 0; i < 4; i++) {
    const ms = await timedFetch(`/api/system-check/ping?r=${Math.random()}`);
    if (i > 0) pings.push(ms);
  }
  const pingMs = Math.round(median(pings));

  const downBytes = 1_000_000;
  const downs: number[] = [];
  for (let i = 0; i < 2; i++) {
    const ms = await timedFetch(`/api/system-check/download?bytes=${downBytes}&r=${Math.random()}`);
    downs.push(mbps(downBytes, ms - pingMs));
  }

  const upBytes = 500_000;
  const payload = randomPayload(upBytes);
  const ups: number[] = [];
  for (let i = 0; i < 2; i++) {
    const ms = await timedFetch(`/api/system-check/upload?r=${Math.random()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: payload,
    });
    ups.push(mbps(upBytes, ms - pingMs));
  }

  return { pingMs, downMbps: Math.max(...downs), upMbps: Math.max(...ups) };
}

export type NoiseLevel = "quiet" | "noisy";

export interface DeviceCheckResult {
  connection: ConnectionResult;
  mic: "ok" | "not_needed";
  speaker: "ok" | "not_needed";
  noise: NoiseLevel | null;
  at: string;
}

export function summarizeCheck(r: DeviceCheckResult): string {
  const parts = [`Download ${r.connection.downMbps} Mbps`, `upload ${r.connection.upMbps} Mbps`, `delay ${r.connection.pingMs} ms`];
  parts.push(r.speaker === "ok" ? "speakers OK" : "speakers not needed");
  parts.push(r.mic === "ok" ? "microphone OK" : "microphone not needed");
  if (r.noise) parts.push(r.noise === "quiet" ? "quiet room" : "noisy room");
  return parts.join(" · ");
}

// ---- Demo preference ----

const DEMO_HIDDEN_KEY = "spica.testDemoHidden";
const DEMO_SEEN_KEY = "spica.testDemoSeen";

export function demoHidden(): boolean {
  try {
    return localStorage.getItem(DEMO_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoHidden(hidden: boolean) {
  try {
    if (hidden) localStorage.setItem(DEMO_HIDDEN_KEY, "1");
    else localStorage.removeItem(DEMO_HIDDEN_KEY);
  } catch {
    // Storage blocked: the demo shows again next time.
  }
}

export function demoSeen(): boolean {
  try {
    return localStorage.getItem(DEMO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDemoSeen() {
  try {
    localStorage.setItem(DEMO_SEEN_KEY, "1");
  } catch {
    // Storage blocked: nothing to remember.
  }
}

// ---- Report to the session ----

// The check runs before the session exists, so the result waits here (this
// tab only) until the test starts.
const PENDING_KEY = "spica.pendingDeviceCheck";

export function holdForSession(r: DeviceCheckResult) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(r));
  } catch {
    // Storage blocked: the result just isn't attached to the session.
  }
}

// Adds the check to the session's integrity timeline, so a reviewer or
// support can see the learner's setup was fine. Never blocks the test.
export function reportHeldCheck(sessionId: string) {
  let r: DeviceCheckResult | null = null;
  try {
    r = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
  if (!r) return;
  sendProctoringEvents(sessionId, [
    {
      type: "system_check",
      at: new Date().toISOString(),
      detail: {
        reason: summarizeCheck(r),
        downMbps: r.connection.downMbps,
        upMbps: r.connection.upMbps,
        pingMs: r.connection.pingMs,
        mic: r.mic,
        speaker: r.speaker,
        noise: r.noise,
      },
    },
  ]).catch(() => {});
}
