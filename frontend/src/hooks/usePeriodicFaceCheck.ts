import { useEffect, useRef } from "react";
import { captureSilentFrame } from "@/lib/silentFaceCapture";
import { verifyFace, type FaceCheckPurpose } from "@/api/faceCheck";
import { useBranding } from "@/components/AppShell/useBranding";

const RECHECK_INTERVAL_MS = 3 * 60 * 1000;

// mismatch/uncertain are just logged; only spoof (a live attack signal) calls onSpoofDetected.
export function usePeriodicFaceCheck(active: boolean, purpose: FaceCheckPurpose, sessionId: string | null, onSpoofDetected: () => void) {
  const onSpoofRef = useRef(onSpoofDetected);
  onSpoofRef.current = onSpoofDetected;
  const required = useBranding()?.faceCheckRequired !== false;

  useEffect(() => {
    if (!active || !sessionId || !required) return;
    const interval = setInterval(async () => {
      const imageBase64 = await captureSilentFrame().catch(() => null);
      if (!imageBase64) return;
      const result = await verifyFace(purpose, imageBase64, sessionId).catch(() => null);
      if (result?.decision === "spoof") onSpoofRef.current();
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, purpose, sessionId, required]);
}
