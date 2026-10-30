import { useEffect } from "react";
import { MailOpen } from "lucide-react";
import { tr } from "@/i18n/tr";

// The test link a job candidate signed in with, kept in this browser so a
// candidate who is signed out (a refresh after their sign-in ran out, or the
// link opened on another device) goes back to it, never to the login page.
const KEY = "spica.candidateLink";
const KEEP_MS = 12 * 3600_000;
const RESUMED_KEY = "spica.candidateResumedAt";

export function rememberCandidateLink(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage blocked: the candidate opens the link from the email instead.
  }
}

export function forgetCandidateLink() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

export function candidateLink(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { path?: string; at?: number } | null;
    if (!v?.path || !v.at || Date.now() - v.at > KEEP_MS) return null;
    return v.path;
  } catch {
    return null;
  }
}

// A signed-out candidate: straight back into their test through the saved
// link (it signs them in again while it is valid), or, without one, asked to
// open the link from their email.
export function CandidateSignedOut() {
  // Sent back to the link at most once a minute, so a link that can't sign
  // the candidate in shows this message instead of going round in a loop.
  const recent = (() => {
    try {
      return Date.now() - Number(sessionStorage.getItem(RESUMED_KEY) ?? 0) < 60_000;
    } catch {
      return false;
    }
  })();
  const link = recent ? null : candidateLink();
  useEffect(() => {
    if (!link) return;
    try {
      sessionStorage.setItem(RESUMED_KEY, String(Date.now()));
    } catch {
      // Storage blocked: go anyway.
    }
    window.location.replace(link.startsWith("/assess/") ? `${link}?resume=1` : link);
  }, [link]);
  if (link) return null;
  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col items-center gap-2 text-center">
        <MailOpen size={26} className="text-navy-deep" />
        <p className="font-display font-bold text-lg text-ink">{tr("Open your test link again")}</p>
        <p className="text-sm text-muted">{tr("To continue your assessment, open the link from your invitation email again. Your answers so far are saved.")}</p>
      </div>
    </div>
  );
}
