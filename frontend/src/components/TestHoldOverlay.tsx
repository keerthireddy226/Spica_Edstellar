import { AlertTriangle, CameraOff, ScanFace, Users, VolumeX, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NOISY_ROOM_DBFS } from "@/lib/roomNoise";
import { MAX_WARNINGS, type IssueKind } from "@/lib/issueGuard";
import type { HoldWarning } from "@/hooks/useTestHold";
import { tr } from "@/i18n/tr";

const TEXT: Record<IssueKind, { icon: LucideIcon; title: () => string; warn: () => string; fix: () => string }> = {
  noise: {
    icon: VolumeX,
    title: () => tr("Too much background noise"),
    warn: () => tr("There's loud background noise. Move somewhere quieter, or close windows and turn off fans, music or the TV."),
    fix: () => tr("Move somewhere quieter, or close windows and turn off fans, music or the TV. The test continues by itself once it has been quiet for 3 seconds."),
  },
  extra_person: {
    icon: Users,
    title: () => tr("Someone else is in view"),
    warn: () => tr("Someone else is in view. You need to be alone for the test."),
    fix: () => tr("Ask the other person to leave, or move away from them. The test continues by itself once only you are in view."),
  },
  no_face: {
    icon: ScanFace,
    title: () => tr("We can't see your face"),
    warn: () => tr("We can't see your face. Sit in front of the camera, facing it."),
    fix: () => tr("Sit in front of the camera, facing it, with your face clearly lit. The test continues by itself once we can see you."),
  },
  camera_covered: {
    icon: CameraOff,
    title: () => tr("Your camera is covered or too dark"),
    warn: () => tr("Your camera looks covered or too dark. Uncover it or turn on a light."),
    fix: () => tr("Uncover the camera or turn on a light. The test continues by itself once the picture is clear."),
  },
};

// The test paused for a problem in the room (useTestHold). It covers the
// question completely, so nobody can work on it while it's paused.
export function TestHoldOverlay({ kind, level, timed, allowanceLeft }: { kind: IssueKind; level: number | null; timed: boolean; allowanceLeft: number | null }) {
  const t = TEXT[kind];
  const Icon = t.icon;
  // -70 dBFS (silent room) to -20 dBFS (very loud), as 0–100%.
  const pct = (db: number) => Math.min(100, Math.max(0, ((db + 70) / 50) * 100));
  const loud = level !== null && level >= NOISY_ROOM_DBFS - 3;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="test-hold-title" className="fixed inset-0 z-[70] bg-paper flex items-center justify-center p-4">
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md p-6 flex flex-col gap-4 text-center">
        <span className="mx-auto h-14 w-14 rounded-full bg-warning/20 text-warning flex items-center justify-center">
          <Icon size={28} />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Test paused")}</p>
        <h2 id="test-hold-title" className="font-display font-bold text-xl text-ink -mt-2">
          {t.title()}
        </h2>
        <p className="text-sm text-ink">{t.fix()}</p>
        {kind === "noise" && (
          <div className="flex flex-col gap-1.5 text-left">
            <div className="h-3 rounded-pill bg-paper-warm overflow-hidden relative" aria-hidden>
              <div className={`h-full transition-all duration-200 ${loud ? "bg-warning" : "bg-success"}`} style={{ width: `${level === null ? 0 : pct(level)}%` }} />
              <div className="absolute top-0 bottom-0 w-0.5 bg-ink/60" style={{ left: `${pct(NOISY_ROOM_DBFS)}%` }} />
            </div>
            <p className="text-xs text-muted">{loud ? tr("Still too noisy") : tr("Getting quieter…")}</p>
          </div>
        )}
        {timed && (
          <p className="text-xs text-muted">
            {allowanceLeft !== null
              ? tr("Your time is paused. A test can be paused for up to 5 minutes in total ({{left}} left).", { left: mmss(allowanceLeft) })
              : tr("Your time is paused.")}
          </p>
        )}
        <p className="text-xs text-muted">{tr("This pause is recorded for the reviewer. It doesn't fail your test.")}</p>
      </div>
    </div>
  );
}

// "Warning 2 of 3": what's wrong, and that the test pauses if it goes on.
export function TestHoldWarning({ warning, capReached, onDismiss }: { warning: HoldWarning; capReached: boolean; onDismiss: () => void }) {
  const t = TEXT[warning.kind];
  return (
    <div role="alert" className="fixed top-16 inset-x-3 z-[55] mx-auto max-w-xl bg-warning/95 text-navy-deep rounded-card shadow-md px-4 py-3 flex items-start gap-3">
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <p className="font-bold">{tr("Warning {{n}} of {{max}}", { n: warning.n, max: MAX_WARNINGS })}</p>
        <p className="font-medium">{t.warn()}</p>
        <p className="text-xs mt-1">
          {capReached
            ? tr("This test can't be paused again, so your time keeps running.")
            : warning.n >= MAX_WARNINGS
              ? tr("If it goes on, the test will pause until it's fixed.")
              : tr("After {{max}} warnings, the test pauses until it's fixed.", { max: MAX_WARNINGS })}
        </p>
      </div>
      <button onClick={onDismiss} aria-label={tr("Dismiss")} className="shrink-0 cursor-pointer">
        <X size={16} />
      </button>
    </div>
  );
}
