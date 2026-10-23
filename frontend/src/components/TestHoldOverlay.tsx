import { VolumeX } from "lucide-react";
import { NOISY_ROOM_DBFS } from "@/lib/roomNoise";
import { tr } from "@/i18n/tr";

// Shown over the test while it's held for background noise (useNoiseHold).
// The meter shows the room's noise against the level that holds the test.
export function NoiseHoldOverlay({ level, timed, allowanceLeft }: { level: number | null; timed: boolean; allowanceLeft: number | null }) {
  // -70 dBFS (silent room) to -20 dBFS (very loud), as 0–100%.
  const pct = (db: number) => Math.min(100, Math.max(0, ((db + 70) / 50) * 100));
  const loud = level !== null && level >= NOISY_ROOM_DBFS - 3;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="noise-hold-title" className="fixed inset-0 z-[70] bg-black/55 flex items-center justify-center p-4">
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md p-6 flex flex-col gap-4 text-center">
        <span className="mx-auto h-14 w-14 rounded-full bg-warning/20 text-warning flex items-center justify-center">
          <VolumeX size={28} />
        </span>
        <h2 id="noise-hold-title" className="font-display font-bold text-xl text-ink">
          {tr("Too much background noise")}
        </h2>
        <p className="text-sm text-ink">
          {tr("Move somewhere quieter, or close windows and turn off fans, music or the TV. The test is paused and continues by itself once it has been quiet for 3 seconds.")}
        </p>
        <div className="flex flex-col gap-1.5 text-left">
          <div className="h-3 rounded-pill bg-paper-warm overflow-hidden relative" aria-hidden>
            <div className={`h-full transition-all duration-200 ${loud ? "bg-warning" : "bg-success"}`} style={{ width: `${level === null ? 0 : pct(level)}%` }} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-ink/60" style={{ left: `${pct(NOISY_ROOM_DBFS)}%` }} />
          </div>
          <p className="text-xs text-muted">{loud ? tr("Still too noisy") : tr("Getting quieter…")}</p>
        </div>
        {timed && (
          <p className="text-xs text-muted">
            {allowanceLeft !== null
              ? tr("Your time is paused. A test can be paused for noise for up to 5 minutes in total ({{left}} left).", { left: mmss(allowanceLeft) })
              : tr("Your time is paused.")}
          </p>
        )}
      </div>
    </div>
  );
}
