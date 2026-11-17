import { useEffect, useState } from "react";
import { tr } from "@/i18n/tr";

// Animated bars shown while a question's recording is playing.
export function PlayingBars({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[3px] h-4 ${className}`} aria-hidden="true">
      {[0, 0.15, 0.3, 0.45].map((d) => (
        <span key={d} className="audio-bar w-[3px] h-full rounded-full bg-current" style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

// A clear "recording" banner: pulsing red dot, seconds recorded and the live
// microphone level, so the person can see their voice is being picked up.
export function RecordingIndicator({ level }: { level: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  return (
    <div role="status" aria-live="polite" className="w-full max-w-xs flex flex-col gap-1.5 rounded-input border-2 border-error/40 bg-error/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-error">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-error opacity-60 animate-ping" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-error" />
          </span>
          {tr("Recording… speak now")}
        </span>
        <span className="font-mono text-xs font-semibold text-error">{tr("{{s}} s", { s: seconds })}</span>
      </div>
      <div className="h-1.5 rounded-pill bg-error/15 overflow-hidden" aria-label={tr("Microphone level")}>
        <div className="h-full bg-error rounded-pill transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Two speaker circles for Conversations questions (Speaker A and Speaker B).
export function SpeakerAvatars({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-4" aria-label={tr("Two speakers: Speaker A and Speaker B")}>
      {(["A", "B"] as const).map((s, i) => (
        <span key={s} className="flex flex-col items-center gap-1">
          <span
            className={`h-11 w-11 rounded-full flex items-center justify-center font-display font-bold text-lg border-2 ${
              i === 0 ? "bg-lime text-navy-deep border-lime" : "bg-warning text-ink border-warning"
            } ${active ? "shadow-md" : "opacity-90"}`}
          >
            {s}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-lime/90">{s === "A" ? tr("Speaker A") : tr("Speaker B")}</span>
        </span>
      ))}
    </div>
  );
}
