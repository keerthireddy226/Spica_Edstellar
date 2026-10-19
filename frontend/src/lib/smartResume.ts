// "Smart resume": coming back to a test or set doesn't repeat every check.
// A session checked or answered in on this device in the last 30 minutes
// goes straight on; after a longer break, a quick check runs on its own
// (internet, and the microphone when spoken answers are needed) and the full
// check screen only shows if something fails.

const KEY = (sessionId: string) => `spica.checked.${sessionId}`;
const RECENT_MS = 30 * 60 * 1000;

// Call when the device checks pass and on every answer: the session is in use here.
export function markChecked(sessionId: string | null | undefined) {
  if (!sessionId) return;
  try {
    localStorage.setItem(KEY(sessionId), String(Date.now()));
  } catch {
    // Not remembered: the next resume runs the quick check.
  }
}

export function recentlyChecked(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  try {
    const at = Number(localStorage.getItem(KEY(sessionId)));
    return !!at && Date.now() - at < RECENT_MS;
  } catch {
    return false;
  }
}

export type QuickCheckProblem = "internet" | "mic";

// Runs without showing anything. null: all fine.
export async function quickDeviceCheck(needsMic: boolean): Promise<QuickCheckProblem | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "internet";
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (!r.ok) return "internet";
  } catch {
    return "internet";
  }
  if (needsMic) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const live = stream.getAudioTracks().some((t) => t.readyState === "live");
      stream.getTracks().forEach((t) => t.stop());
      if (!live) return "mic";
    } catch {
      return "mic";
    }
  }
  return null;
}

// What a resume needs: nothing (recent), or a quick check that falls back to
// the full check screen when it finds a problem.
export async function resumeNeedsFullCheck(sessionId: string, needsMic: boolean): Promise<QuickCheckProblem | null> {
  if (recentlyChecked(sessionId)) return null;
  const problem = await quickDeviceCheck(needsMic);
  if (!problem) markChecked(sessionId);
  return problem;
}
