import { useEffect, useRef } from "react";
import { VolumeX, X } from "lucide-react";
import { tr } from "@/i18n/tr";

const SHOW_MS = 15_000;

// Told right after a spoken answer whose recording had loud background noise
// (measured on the server, see backend/src/proctoring/answerAudio.ts), so the
// learner can move somewhere quieter before the next one. `at` is when the
// noisy answer went in: a new one shows the notice again.
// kind "silent": the last recording picked up nothing at all (a muted or
// wrong microphone), so the answer can't score.
export function NoisyAnswerAlert({ at, onDismiss, kind = "noisy" }: { at: number | null; onDismiss: () => void; kind?: "noisy" | "silent" }) {
  // The page re-renders every second (question timers): the hide timer
  // restarts only for a new noisy answer, not for a new onDismiss.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (at === null) return;
    const timer = setTimeout(() => dismissRef.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [at]);

  if (at === null) return null;
  return (
    <div
      role="alert"
      className="fixed top-16 inset-x-3 z-[54] mx-auto max-w-xl bg-warning/95 text-navy-deep rounded-card shadow-md px-4 py-3 flex items-start gap-3"
    >
      <VolumeX size={18} className="shrink-0 mt-0.5" />
      <p className="text-sm font-medium flex-1">
        {kind === "silent"
          ? tr("We couldn't hear anything in your last spoken answer. Check that your microphone is on, not muted, and is the one selected in your browser, then speak clearly.")
          : tr("There was loud background noise in your last spoken answer. It can cover your words and lower your speaking score. Move somewhere quieter before you speak again.")}
      </p>
      <button onClick={onDismiss} aria-label={tr("Dismiss")} className="shrink-0 cursor-pointer">
        <X size={16} />
      </button>
    </div>
  );
}
