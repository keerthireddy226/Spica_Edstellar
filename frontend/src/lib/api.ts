// Thrown on any non-ok response. `.message` is the stable error code; `.body` carries the full JSON.
export class ApiError extends Error {
  body: unknown;
  status?: number;
  constructor(message: string, body: unknown, status?: number) {
    super(message);
    this.body = body;
    this.status = status;
  }
}

// A failure worth trying again: no answer from the server (a dropped or
// timed-out connection) or a server error, never a refusal like
// "already_answered".
export function isTransientError(err: unknown): boolean {
  // A server error or "too many requests" (a busy moment) counts too.
  if (err instanceof ApiError) return err.message === "unknown_error" || (err.status !== undefined && (err.status >= 500 || err.status === 429));
  // A request given up on after its time limit (no answer at all) is tried again too.
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) return true;
  return err instanceof TypeError;
}

// Tries a request again after a short wait when the server didn't answer:
// a busy moment shouldn't lose a test answer or strand a page.
export async function withRetry<T>(run: () => Promise<T>, waitsMs = [1500, 3000, 6000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= waitsMs.length || !isTransientError(err)) throw err;
      await new Promise((r) => setTimeout(r, waitsMs[i]));
    }
  }
}

// timeoutMs: give up on a request that gets no answer at all (a server
// restarting mid-request), so withRetry can send it again instead of the page
// waiting forever.
export async function api<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown_error" }));
    // Policy answers that apply to every page, handled once here.
    if (body.error === "mfa_setup_required" && !window.location.pathname.startsWith("/security/two-step")) {
      window.location.assign("/security/two-step");
    } else if (body.error === "session_expired") {
      // The session is gone; reloading lands on the right login page.
      window.location.reload();
    }
    throw new ApiError(body.error ?? "request_failed", body, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
