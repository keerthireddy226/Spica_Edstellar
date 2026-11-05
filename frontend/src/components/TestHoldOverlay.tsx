import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CameraOff, MicOff, ScanFace, Users, VolumeX, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { VOICE_ABOVE_ROOM_DB } from "@/lib/noiseGuard";
import { MAX_WARNINGS, type IssueKind } from "@/lib/issueGuard";
import type { HoldWarning } from "@/hooks/useTestHold";
import { tr } from "@/i18n/tr";

const TEXT: Record<IssueKind, { icon: LucideIcon; title: () => string; warn: () => string; fix: () => string }> = {
  noise: {
    icon: VolumeX,
    title: () => tr("Someone is talking near you"),
    warn: () => tr("We can hear someone talking near you. Ask them to stop, move somewhere quiet, or turn off the TV or music."),
    fix: () => tr("Ask the person to stop talking, move somewhere quiet, or turn off the TV or music. The test continues by itself once it has been quiet for 3 seconds."),
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
  mic_silent: {
    icon: MicOff,
    title: () => tr("We can't hear your microphone"),
    warn: () => tr("We couldn't hear anything in your last two spoken answers. Check that your microphone is on and not muted."),
    fix: () => tr("Your last two spoken answers were silent. Check that your microphone is on, not muted, and is the one selected in your browser. Then say a few words: the test continues once we hear you."),
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
export function TestHoldOverlay({ kind, level, timed, allowanceLeft, onMicWorks }: { kind: IssueKind; level: number | null; timed: boolean; allowanceLeft: number | null; onMicWorks?: () => void }) {
  const t = TEXT[kind];
  const Icon = t.icon;
  // Sound above the room's own quiet level: 0 dB (quiet) to 30 dB (a voice close by), as 0–100%.
  const pct = (db: number) => Math.min(100, Math.max(0, (db / 30) * 100));
  const loud = level !== null && level >= VOICE_ABOVE_ROOM_DB - 3;
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
              <div className="absolute top-0 bottom-0 w-0.5 bg-ink/60" style={{ left: `${pct(VOICE_ABOVE_ROOM_DB)}%` }} />
            </div>
            <p className="text-xs text-muted">{loud ? tr("Still hearing a voice") : tr("Getting quieter…")}</p>
          </div>
        )}
        {kind === "mic_silent" && onMicWorks && <MicRecheck onWorks={onMicWorks} />}
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

// The microphone, live, while the test is paused for silent answers: the test
// continues on its own once a voice is heard for about half a second, or when
// the learner chooses to go on anyway (a microphone that can't be fixed).
function MicRecheck({ onWorks }: { onWorks: () => void }) {
  const [level, setLevel] = useState(0);
  const [failed, setFailed] = useState(false);
  const doneRef = useRef(false);
  const finish = useRef(onWorks);
  finish.current = onWorks;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let heardMs = 0;
    let last = performance.now();
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          const peak = buf.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
          const now = performance.now();
          heardMs = peak > 0.05 ? heardMs + (now - last) : Math.max(0, heardMs - (now - last) / 2);
          last = now;
          setLevel(Math.min(1, peak * 4));
          if (heardMs > 500 && !doneRef.current) {
            doneRef.current = true;
            finish.current();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, []);
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="h-3 rounded-pill bg-paper-warm overflow-hidden" aria-label={tr("Microphone level")}>
        <div className={`h-full transition-[width] duration-75 ${level > 0.2 ? "bg-success" : "bg-muted"}`} style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <p className="text-xs text-muted">{failed ? tr("The browser can't open your microphone. Allow it in the address bar, then reload the page.") : tr("Say a few words now…")}</p>
      <button
        onClick={() => {
          if (doneRef.current) return;
          doneRef.current = true;
          finish.current();
        }}
        className="self-center text-xs font-semibold text-navy-deep underline cursor-pointer"
      >
        {tr("Continue anyway")}
      </button>
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
