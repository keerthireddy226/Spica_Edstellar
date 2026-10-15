import { useEffect, useRef } from "react";
import { captureSilentFrame } from "@/lib/silentFaceCapture";
import { verifyFace, type FaceCheckPurpose } from "@/api/faceCheck";
import { useBranding } from "@/components/AppShell/useBranding";

// Checks happen at random moments, so a learner can't time stepping away or
// letting someone else in: about once a minute in a test, about every three
// minutes in practice modules.
const RANGE_MS: Record<FaceCheckPurpose, [number, number]> = {
  placement: [30_000, 90_000],
  practice_test: [30_000, 90_000],
  practice: [120_000, 240_000],
};

export type FaceCheckOutcome = "no_face" | "multiple_faces" | "mismatch" | "uncertain" | "camera_unavailable";

// spoof (a live attack signal) calls onSpoofDetected, which re-shows the face
// check. Everything else is reported to onOutcome so the learner can be told
// and the moment recorded; the server also records it and alerts reviewers.
export function usePeriodicFaceCheck(
  active: boolean,
  purpose: FaceCheckPurpose,
  sessionId: string | null,
  onSpoofDetected: () => void,
  onOutcome?: (outcome: FaceCheckOutcome) => void,
) {
  const onSpoofRef = useRef(onSpoofDetected);
  onSpoofRef.current = onSpoofDetected;
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  const required = useBranding()?.faceCheckRequired !== false;

  useEffect(() => {
    if (!active || !sessionId || !required) return;
    const [min, max] = RANGE_MS[purpose];
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const imageBase64 = await captureSilentFrame().catch(() => null);
      if (stopped) return;
      if (!imageBase64) {
        onOutcomeRef.current?.("camera_unavailable");
        return;
      }
      const result = await verifyFace(purpose, imageBase64, sessionId).catch(() => null);
      if (stopped || !result) return;
      if (result.decision === "spoof") onSpoofRef.current();
      else if (result.decision === "no_face" || result.decision === "multiple_faces" || result.decision === "mismatch" || result.decision === "uncertain") {
        onOutcomeRef.current?.(result.decision);
      }
    };
    const schedule = () => {
      timer = setTimeout(async () => {
        await check();
        if (!stopped) schedule();
      }, min + Math.random() * (max - min));
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, purpose, sessionId, required]);
}
