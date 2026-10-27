import { useEffect, useRef, useState } from "react";
import { watchRoomNoise } from "@/lib/noiseGuard";
import { IssueGuard, type IssueKind } from "@/lib/issueGuard";
import { holdTest } from "@/api/practiceTests";
import type { RoomState } from "@/hooks/useProctoring";

// Problems in the room during a test (someone else talking nearby, another person on
// camera, no face, a covered camera): three warnings, spaced out, then the test
// pauses until the problem is fixed (see lib/issueGuard.ts). In a timed test
// the server stops the clock while paused, up to a total per test; past that
// the learner is only warned. A practice test's timer waits in the browser.
const STEP_MS = 1000;
// A warning stays on screen this long.
const WARNING_MS = 12_000;
const FACE_KINDS: IssueKind[] = ["extra_person", "no_face", "camera_covered"];

// Kept for the browser tab's life, per test session.
const savedKey = (sessionId: string) => `spica-room-warnings:${sessionId}`;
function readSaved(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(savedKey(sessionId));
  } catch {
    return null;
  }
}
function writeSaved(sessionId: string, value: string) {
  try {
    sessionStorage.setItem(savedKey(sessionId), value);
  } catch {
    // Storage blocked: warnings start over after a reload, nothing else changes.
  }
}

export interface HoldWarning {
  kind: IssueKind;
  n: number;
  at: number;
}

export function useTestHold({
  enabled,
  sessionId,
  itemId,
  timed,
  watchNoise,
  room,
  setFastChecks,
  logEvent,
  onHold,
  onRelease,
}: {
  enabled: boolean;
  sessionId: string | null;
  itemId: string | null;
  timed: boolean;
  // Listen for background noise (tests with spoken answers).
  watchNoise: boolean;
  // What the proctoring camera shows (all false when there's no camera).
  room: RoomState;
  setFastChecks: (fast: boolean) => void;
  logEvent: (type: string, detail?: Record<string, string | number | boolean | null>) => void;
  onHold: () => void;
  // secondsLeft: the question's time after the pause, from the server (timed tests).
  onRelease: (secondsLeft: number | null) => void;
}) {
  const [held, setHeld] = useState<IssueKind | null>(null);
  const [warning, setWarning] = useState<HoldWarning | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  // The test's pause allowance is used up: problems are only warned about now.
  const [capReached, setCapReached] = useState(false);
  // Seconds the test can still be paused, while paused.
  const [allowanceLeft, setAllowanceLeft] = useState<number | null>(null);

  const guardRef = useRef(new IssueGuard());
  const noisyRef = useRef(false);
  const capRef = useRef(false);
  const busyRef = useRef(false);
  const heldRef = useRef<IssueKind | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ sessionId, itemId, timed, room, setFastChecks, logEvent, onHold, onRelease });
  live.current = { sessionId, itemId, timed, room, setFastChecks, logEvent, onHold, onRelease };

  // A new test starts with no warnings; the same test after a reload keeps them.
  useEffect(() => {
    guardRef.current = IssueGuard.restore(sessionId ? readSaved(sessionId) : null);
    capRef.current = false;
    setCapReached(false);
  }, [sessionId]);

  // Someone else talking, from the raw microphone, between answers.
  useEffect(() => {
    if (!enabled || !watchNoise) return;
    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        stop = watchRoomNoise(s, (state) => (noisyRef.current = state === "noisy"), setLevel);
      })
      // No microphone (denied or busy): nothing to listen to.
      .catch(() => {});
    return () => {
      stopped = true;
      noisyRef.current = false;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [enabled, watchNoise]);

  useEffect(() => {
    if (!enabled) return;

    const release = async () => {
      const kind = heldRef.current;
      if (!kind) return;
      heldRef.current = null;
      clearTimeout(capTimerRef.current);
      const { sessionId: sid, itemId: iid, timed: isTimed } = live.current;
      let left: number | null = null;
      if (isTimed && sid && iid) {
        const r = await holdTest(sid, iid, "end", kind).catch(() => null);
        left = r?.secondsLeft ?? null;
        if (r?.capReached) {
          capRef.current = true;
          setCapReached(true);
        }
      }
      setHeld(null);
      setAllowanceLeft(null);
      live.current.onRelease(left);
    };

    const pause = async (kind: IssueKind) => {
      const { sessionId: sid, itemId: iid, timed: isTimed } = live.current;
      if (!sid || !iid) return guardRef.current.cancelPause();
      if (isTimed) {
        const r = await holdTest(sid, iid, "start", kind).catch(() => null);
        if (!r?.held) {
          // No pausing left (or no connection): warn instead.
          guardRef.current.cancelPause();
          capRef.current = true;
          setCapReached(true);
          setWarning({ kind, n: 3, at: Date.now() });
          return;
        }
        // The clock runs again once the allowance is used up.
        const left = (r.capSeconds ?? 0) - r.pausedSeconds;
        setAllowanceLeft(left);
        capTimerRef.current = setTimeout(() => {
          capRef.current = true;
          guardRef.current.cancelPause();
          void release();
        }, left * 1000);
      }
      heldRef.current = kind;
      setHeld(kind);
      setWarning(null);
      live.current.onHold();
    };

    const timer = setInterval(async () => {
      if (busyRef.current) return;
      const r = live.current.room;
      const present: Partial<Record<IssueKind, boolean>> = {
        noise: noisyRef.current,
        extra_person: r.extraPerson,
        no_face: r.noFace,
        camera_covered: r.covered,
      };
      // Look at the camera every few seconds while a camera problem is warned about or paused for.
      live.current.setFastChecks(FACE_KINDS.some((k) => present[k]) || (heldRef.current !== null && FACE_KINDS.includes(heldRef.current)));
      const action = guardRef.current.step(present, Date.now(), !capRef.current);
      if (!action) return;
      busyRef.current = true;
      try {
        if (live.current.sessionId) writeSaved(live.current.sessionId, guardRef.current.save());
        if (action.type === "warn") {
          setWarning({ kind: action.kind, n: action.n, at: Date.now() });
          live.current.logEvent("hold_warning", { reason: action.kind, n: action.n });
        } else if (action.type === "pause") await pause(action.kind);
        else await release();
      } finally {
        busyRef.current = false;
      }
    }, STEP_MS);

    return () => {
      clearInterval(timer);
      live.current.setFastChecks(false);
      // Leaving the question or the test while paused: the clock runs again.
      guardRef.current.cancelPause();
      void release();
    };
  }, [enabled]);

  // A warning goes away after a while.
  useEffect(() => {
    if (!warning) return;
    const t = setTimeout(() => setWarning((w) => (w?.at === warning.at ? null : w)), WARNING_MS);
    return () => clearTimeout(t);
  }, [warning]);

  // The allowance shown while paused counts down.
  useEffect(() => {
    if (!held || allowanceLeft === null) return;
    const t = setInterval(() => setAllowanceLeft((s) => (s === null ? null : Math.max(0, s - 1))), 1000);
    return () => clearInterval(t);
  }, [held, allowanceLeft === null]);

  return { held, warning, level, capReached, allowanceLeft, dismissWarning: () => setWarning(null) };
}
