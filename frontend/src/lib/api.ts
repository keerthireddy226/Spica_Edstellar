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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
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
