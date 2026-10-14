import { useEffect, useState } from "react";
import { useBranding } from "@/components/AppShell/useBranding";
import { useTranslation } from "react-i18next";
import { Camera, CheckCircle2, ArrowLeft } from "lucide-react";
import { useCamera } from "@/hooks/useCamera";
import { enrollFace, verifyFace, requestFaceFallbackOtp, verifyFaceFallbackOtp, type FaceCheckPurpose } from "@/api/faceCheck";
import { Button } from "@/components/Button";

interface FaceCheckProps {
  mode: "enroll" | "verify";
  purpose?: FaceCheckPurpose;
  onComplete: (result: { faceCheckId?: string }) => void;
  onBack?: () => void;
}

// onComplete fires on a match or an OTP pass. No other fallback — an emailed
// one-time code is the only path past a failed check.
// An organization can switch face checks off for its learners; then this
// step completes on its own without opening the camera.
export function FaceCheck(props: FaceCheckProps) {
  const branding = useBranding();
  const skip = branding?.faceCheckRequired === false;
  const { onComplete } = props;
  useEffect(() => {
    if (skip) onComplete({});
  }, [skip, onComplete]);
  if (!branding || skip) return null;
  return <FaceCheckInner {...props} />;
}

function FaceCheckInner({ mode, purpose, onComplete, onBack }: FaceCheckProps) {
  const { t } = useTranslation();
  const { active, videoRef, start, stop, capture } = useCamera();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [verifiedViaOtp, setVerifiedViaOtp] = useState(false);
  const [pendingFaceCheckId, setPendingFaceCheckId] = useState<string | undefined>(undefined);
  const [failedResultId, setFailedResultId] = useState<string | null>(null);
  const [fallbackEligible, setFallbackEligible] = useState(false);
  const [requestingOtp, setRequestingOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");

  useEffect(() => {
    start().catch(() => setError(t("faceCheck.record.cameraError")));
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stops the camera the instant verification succeeds — not just on unmount,
  // which otherwise leaves it running through the whole success screen.
  useEffect(() => {
    if (verified) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified]);

  async function submitVerify() {
    const imageBase64 = capture();
    if (!imageBase64) {
      setError(t("faceCheck.record.error"));
      return;
    }
    setSubmitting(true);
    setError(null);
    setBlocked(null);
    try {
      const result = await verifyFace(purpose!, imageBase64);
      if (!result.allowed) {
        setBlocked(result.reason ?? t("faceCheck.verify.mismatchError"));
        setFailedResultId(result.fallbackEligible ? result.faceCheckId : null);
        setFallbackEligible(Boolean(result.fallbackEligible));
        setSubmitting(false);
        return;
      }
      setVerified(true);
      setSubmitting(false);
      setPendingFaceCheckId(result.faceCheckId);
    } catch {
      setError(t("faceCheck.record.error"));
      setSubmitting(false);
    }
  }

  async function submitEnrollment() {
    const imageBase64 = capture();
    if (!imageBase64) {
      setError(t("faceCheck.record.error"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await enrollFace(imageBase64);
      if (result.status !== "enrolled") {
        setBlocked(result.reasons?.[0] ?? t("faceCheck.record.tooShort"));
        setSubmitting(false);
        return;
      }
      setVerified(true);
      setSubmitting(false);
    } catch {
      setError(t("faceCheck.record.error"));
      setSubmitting(false);
    }
  }

  async function sendOtp() {
    if (!failedResultId) return;
    setRequestingOtp(true);
    setError(null);
    try {
      await requestFaceFallbackOtp(failedResultId);
      setOtpSent(true);
    } catch {
      setError(t("faceCheck.fallback.otpSendError"));
    } finally {
      setRequestingOtp(false);
    }
  }

  async function submitOtp() {
    if (!failedResultId || !otpCode.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyFaceFallbackOtp(failedResultId, otpCode.trim());
      if (result.allowed) {
        setVerified(true);
        setVerifiedViaOtp(true);
        setPendingFaceCheckId(result.faceCheckId);
      } else {
        setError(t("faceCheck.fallback.otpInvalidError"));
      }
    } catch {
      setError(t("faceCheck.fallback.otpInvalidError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (verified) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4">
        <div className="bg-surface border border-rule rounded-card p-6 max-w-sm w-full flex flex-col items-center gap-4 text-center">
          <CheckCircle2 size={40} className="text-success" />
          <p className="font-semibold text-ink">
            {mode === "enroll" ? t("faceCheck.enroll.success") : verifiedViaOtp ? t("faceCheck.fallback.otpSuccess") : t("faceCheck.verify.success")}
          </p>
          <p className="text-sm text-muted -mt-2">
            {mode === "enroll" ? t("faceCheck.enroll.successSubtitle") : t("faceCheck.verify.successSubtitle")}
          </p>
          <Button onClick={() => onComplete({ faceCheckId: pendingFaceCheckId })}>
            {mode === "enroll" ? t("faceCheck.enroll.proceed") : t("faceCheck.verify.proceed")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4">
      <div className="bg-surface border border-rule rounded-card p-6 max-w-sm w-full flex flex-col items-center gap-4 text-center">
        {onBack && (
          <button onClick={onBack} className="self-start flex items-center gap-1 text-sm text-muted hover:text-ink cursor-pointer">
            <ArrowLeft size={16} /> {t("faceCheck.back")}
          </button>
        )}
        <h2 className="font-display font-bold text-xl text-ink">
          {mode === "enroll" ? t("faceCheck.enroll.title") : t("faceCheck.verify.title")}
        </h2>
        <p className="text-sm text-muted -mt-2">
          {mode === "enroll" ? t("faceCheck.enroll.subtitle") : t(`faceCheck.verify.subtitle.${purpose ?? "placement"}`)}
        </p>
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-card bg-ink aspect-[4/3] object-cover" />
        {error && <p className="text-sm text-error">{error}</p>}
        {blocked && (
          <div className="flex flex-col gap-2 w-full">
            <p className="text-sm text-error">{blocked}</p>
            {fallbackEligible && !otpSent && (
              <Button variant="secondary" onClick={sendOtp} disabled={requestingOtp}>
                {requestingOtp ? t("faceCheck.fallback.otpSending") : t("faceCheck.fallback.otpButton")}
              </Button>
            )}
            {otpSent && (
              <div className="flex flex-col gap-2 items-center">
                <p className="text-xs text-muted">{t("faceCheck.fallback.otpSentNotice")}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder={t("faceCheck.fallback.otpPlaceholder")}
                  className="w-full rounded-card border border-rule bg-surface px-3 py-2 text-sm text-ink text-center tracking-widest focus:border-navy focus:outline-none"
                />
                <Button onClick={submitOtp} disabled={submitting || !otpCode.trim()} className="w-full">
                  {submitting ? t("faceCheck.fallback.otpVerifying") : t("faceCheck.fallback.otpVerify")}
                </Button>
                <button
                  type="button"
                  onClick={sendOtp}
                  disabled={requestingOtp}
                  className="text-xs text-muted hover:text-ink cursor-pointer disabled:opacity-50"
                >
                  {t("faceCheck.fallback.otpResend")}
                </button>
              </div>
            )}
          </div>
        )}
        <Button onClick={mode === "enroll" ? submitEnrollment : submitVerify} disabled={!active || submitting}>
          <Camera size={16} className="inline mr-1.5" />
          {submitting ? t("faceCheck.record.checking") : t("faceCheck.record.capture")}
        </Button>
      </div>
    </div>
  );
}
