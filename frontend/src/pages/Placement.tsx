import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock, BookOpen, ShieldCheck, Headphones } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { scheduleLater } from "@/api/placement";
import { getRoadmap } from "@/api/roadmap";
import { getCurrentSession } from "@/api/testSession";
import { getFaceEnrollmentStatus } from "@/api/faceCheck";
import { FaceCheck } from "@/components/FaceCheck";
import { FaceEnrollmentConsent } from "@/components/FaceEnrollmentConsent";
import { VoiceSection } from "@/components/VoiceSection";
import { Button } from "@/components/Button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ROUTES } from "@/constants/routes";
import { PhoneBlockNotice } from "@/components/PhoneBlockNotice";
import { isPhone } from "@/lib/device";

export function Placement() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [instructionsAcknowledged, setInstructionsAcknowledged] = useState(false);
  const [scheduleSent, setScheduleSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingPlacement, setCheckingPlacement] = useState(true);
  // Set once the in-progress check below resolves — null while unknown,
  // then either "not started" or the number of questions already shown in
  // an existing, unfinished session (leaving early doesn't lose it).
  const [resumeQuestionsShown, setResumeQuestionsShown] = useState<number | null>(null);
  // Checked up front so enrollment (with its "face captured" confirmation)
  // happens before the instructions card, not after clicking Begin.
  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null);
  const [faceConsented, setFaceConsented] = useState(false);
  useEffect(() => {
    getFaceEnrollmentStatus()
      .then((res) => setFaceEnrolled(res.enrolled))
      .catch(() => setFaceEnrolled(true));
  }, []);
  function goToPlacementTest() {
    navigate(ROUTES.PLACEMENT_TEST);
  }

  // Landing here after already completing the test (e.g. via browser back,
  // or a direct link) should skip straight to the roadmap rather than offer
  // to retake it.
  useEffect(() => {
    let cancelled = false;
    getRoadmap()
      .then(() => {
        if (!cancelled) navigate(ROUTES.ROADMAP, { replace: true });
      })
      .catch(() => {
        if (cancelled) return;
        setCheckingPlacement(false);
        // Side-effect-free peek (doesn't create a session) — an
        // unfinished placement session means the learner started this
        // before and left partway through, so the intro screen should
        // offer to continue it instead of re-gating on the instructions
        // checkbox as if this were their first time.
        getCurrentSession()
          .then((res) => {
            if (!cancelled) setResumeQuestionsShown(res.inProgress ? (res.questionsShown ?? 0) : 0);
          })
          .catch(() => {
            if (!cancelled) setResumeQuestionsShown(0);
          });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const isResuming = !!resumeQuestionsShown;

  async function handleScheduleLater() {
    setError(null);
    setSubmitting(true);
    try {
      await scheduleLater();
      setScheduleSent(true);
    } catch {
      setError(t("placement.scheduleLaterError"));
    } finally {
      setSubmitting(false);
    }
  }

  const infoRows = [
    { key: "timing", Icon: Clock, text: t("placement.info.timing") },
    { key: "covers", Icon: BookOpen, text: t("placement.info.covers") },
    { key: "graded", Icon: ShieldCheck, text: t("placement.info.graded") },
    { key: "equipment", Icon: Headphones, text: t("placement.info.equipment") },
  ];

  if (checkingPlacement || resumeQuestionsShown === null || faceEnrolled === null) return null;

  // On a phone the level test can't start: say so, and offer the reminder
  // email so it's easy to open on a computer.
  if (isPhone()) {
    return (
      <div className="app-surface min-h-screen overflow-y-auto flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl flex flex-col gap-4">
          <PhoneBlockNotice what="level" />
          <Button variant="secondary" onClick={handleScheduleLater}>
            {submitting ? t("placement.scheduling") : scheduleSent ? t("placement.scheduleSent") : t("placement.scheduleLater")}
          </Button>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center justify-between px-1">
            <button type="button" onClick={() => logout()} className="text-sm font-medium text-muted hover:text-ink">
              {t("onboarding.logout")}
            </button>
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    );
  }

  if (!faceEnrolled) {
    if (!faceConsented) {
      return (
        <div className="app-surface min-h-screen overflow-y-auto flex items-center justify-center px-4 py-10">
          <FaceEnrollmentConsent onAccept={() => setFaceConsented(true)} onDecline={() => setFaceEnrolled(true)} />
        </div>
      );
    }
    return <FaceCheck mode="enroll" onComplete={() => setFaceEnrolled(true)} />;
  }

  return (
    <div className="app-surface min-h-screen overflow-y-auto flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl flex flex-col gap-4">
        <div className="bg-surface border border-rule rounded-card p-8 flex flex-col gap-6 items-center text-center">
          <div className="h-14 w-14 rounded-full bg-navy flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" className="text-lime" stroke="currentColor" />
            </svg>
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl text-ink">
              {isResuming ? t("placement.resume.title") : t("placement.title")}
            </h1>
            <p className="text-sm text-muted mt-1.5">
              {isResuming ? t("placement.resume.subtitle", { count: resumeQuestionsShown }) : t("placement.subtitle")}
            </p>
          </div>

          <div className="w-full bg-paper-warm rounded-input p-4 flex flex-col gap-3 text-left">
            {infoRows.map(({ key, Icon, text }) => (
              <div key={key} className="flex items-start gap-3">
                <Icon size={22} strokeWidth={1.8} className="text-navy shrink-0 mt-0.5" />
                <p className="text-sm text-ink">{text}</p>
              </div>
            ))}
          </div>

          <div className="w-full bg-paper-warm rounded-input p-4 text-left">
            <VoiceSection />
          </div>

          <label className="flex items-start gap-2.5 rounded-input border border-rule p-3.5 w-full text-left cursor-pointer">
            <input
              type="checkbox"
              checked={instructionsAcknowledged}
              onChange={(e) => setInstructionsAcknowledged(e.target.checked)}
              className="mt-0.5 accent-navy"
            />
            <span className="text-sm text-ink">{t("placement.instructions.checkboxLabel")}</span>
          </label>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Button onClick={goToPlacementTest} disabled={!instructionsAcknowledged}>
              {isResuming ? t("placement.resume.continue") : t("placement.instructions.begin")}
            </Button>
            <Button variant="secondary" onClick={handleScheduleLater}>
              {submitting ? t("placement.scheduling") : scheduleSent ? t("placement.scheduleSent") : t("placement.scheduleLater")}
            </Button>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        <div className="flex items-center justify-between px-1">
          <button type="button" onClick={() => logout()} className="text-sm font-medium text-muted hover:text-ink">
            {t("onboarding.logout")}
          </button>
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
