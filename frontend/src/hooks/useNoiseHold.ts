import { useEffect, useRef, useState } from "react";
import { watchRoomNoise } from "@/lib/noiseGuard";
import { noisePause } from "@/api/practiceTests";

// Holds a test while the room is too noisy, and lets it continue once it's
// quiet. In a timed test the server stops the clock while it's held, up to a
// total per test; past that the test can't be held again and the learner
// only sees a warning. A practice test's timer is held in the browser.
export function useNoiseHold({
  enabled,
  sessionId,
  itemId,
  timed,
  onHold,
  onRelease,
}: {
  enabled: boolean;
  sessionId: string | null;
  itemId: string | null;
  timed: boolean;
  onHold: () => void;
  // secondsLeft: the question's time after the hold, from the server (timed tests).
  onRelease: (secondsLeft: number | null) => void;
}) {
  const [held, setHeld] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  // The test's allowance for holding is used up: noise only warns now.
  const [capReached, setCapReached] = useState(false);
  const [noisyUnheld, setNoisyUnheld] = useState(false);
  // Seconds the test can still be held, while held.
  const [allowanceLeft, setAllowanceLeft] = useState<number | null>(null);

  const heldRef = useRef(false);
  const capRef = useRef(false);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ sessionId, itemId, timed, onHold, onRelease });
  live.current = { sessionId, itemId, timed, onHold, onRelease };

  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    let stopped = false;

    const release = async () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      clearTimeout(capTimerRef.current);
      const { sessionId: sid, itemId: iid, timed: isTimed } = live.current;
      let left: number | null = null;
      if (isTimed && sid && iid) {
        const r = await noisePause(sid, iid, "end").catch(() => null);
        left = r?.secondsLeft ?? null;
        if (r?.capReached) {
          capRef.current = true;
          setCapReached(true);
        }
      }
      setHeld(false);
      setAllowanceLeft(null);
      live.current.onRelease(left);
    };

    const hold = async () => {
      if (heldRef.current) return;
      if (capRef.current) {
        setNoisyUnheld(true);
        return;
      }
      const { sessionId: sid, itemId: iid, timed: isTimed } = live.current;
      if (!sid || !iid) return;
      heldRef.current = true;
      if (isTimed) {
        const r = await noisePause(sid, iid, "start").catch(() => null);
        if (!r?.held) {
          heldRef.current = false;
          capRef.current = !!r?.capReached || (r?.capSeconds != null && r.pausedSeconds >= r.capSeconds);
          setCapReached(capRef.current);
          setNoisyUnheld(true);
          return;
        }
        // The clock runs again once the test's allowance is used up.
        const left = (r.capSeconds ?? 0) - r.pausedSeconds;
        setAllowanceLeft(left);
        capTimerRef.current = setTimeout(() => {
          capRef.current = true;
          void release();
        }, left * 1000);
      }
      setHeld(true);
      live.current.onHold();
    };

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        stop = watchRoomNoise(
          s,
          (state) => {
            if (state === "noisy") void hold();
            else {
              setNoisyUnheld(false);
              void release();
            }
          },
          setLevel,
        );
      })
      // No microphone (denied or busy): nothing to watch.
      .catch(() => {});
    return () => {
      stopped = true;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
      // Leaving the question or the test while held: let the clock run again.
      void release();
    };
  }, [enabled]);

  // The allowance shown while held counts down.
  useEffect(() => {
    if (!held || allowanceLeft === null) return;
    const t = setInterval(() => setAllowanceLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [held, allowanceLeft === null]);

  return { held, level, capReached, noisyUnheld, allowanceLeft };
}
