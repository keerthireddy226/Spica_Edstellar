import { useEffect, useRef, useState } from "react";
import { useBranding } from "@/components/AppShell/useBranding";
import { ApiError } from "@/lib/api";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardCheck,
  Volume2,
  ArrowLeft,
  Clock,
  CheckCircle2,
  ChevronRight,
  Headphones,
  BookOpen,
  PenLine,
  Briefcase,
  RotateCcw,
  MessageSquare,
  ListChecks,
  Layers,
  Award,
  PlayCircle,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { AnswerInputControl } from "@/components/AnswerInputControl";
import {
  getExamsForProduct,
  startExamSession,
  getExamSession,
  submitExamAttempt,
  completeExamSession,
  type ExamSummary,
  type PartBoundary,
  type ExamCompleteResult,
} from "@/api/practiceTests";
import type { TestItem } from "@/api/testSession";
import { useVoiceRecorder, blobToBase64 } from "@/hooks/useVoiceRecorder";
import { playSpokenAudio } from "@/lib/playSpokenAudio";
import { getFaceEnrollmentStatus } from "@/api/faceCheck";
import { FaceCheck } from "@/components/FaceCheck";
import { usePeriodicFaceCheck } from "@/hooks/usePeriodicFaceCheck";
import { showFaceCheckOutcome } from "@/hooks/faceCheckWarning";
import { useProctoring } from "@/hooks/useProctoring";
import { useAuth } from "@/hooks/useAuth";
import { CandidateFinished } from "@/components/recruitment/CandidateShell";
import { TestIdTag } from "@/components/TestIdTag";
import { ProctoringGate } from "@/components/proctoring/ProctoringGate";
import { ProctoringOverlay } from "@/components/proctoring/ProctoringOverlay";
import { PreTestFlow } from "@/components/pretest/PreTestFlow";
import { IntegrityResultNote } from "@/components/proctoring/IntegrityResultNote";
import { TestDemo } from "@/components/pretest/TestDemo";
import { deviceNeedsFor, reportHeldCheck } from "@/lib/systemCheck";
import type { PreTestKind } from "@/api/proctoring";
import {
  AUDIO_FIRST_TYPES,
  SKILL_BADGE_CLASS,
  ITEM_TYPE_META,
  getSpokenSegments,
  getVisibleText,
  getPassageAndQuestion,
} from "@/lib/testItemDisplay";

import { tr } from "@/i18n/tr";
// Fallback reading time for a two-phase item with no server-set duration.
const DEFAULT_TWO_PHASE_READ_SECONDS = 30;

interface CachedAnswer {
  responseText: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioBlobUrl?: string;
  durationMs?: number;
}

// "Written English — 35 minutes." -> "35": the last number in the product
// description, in any language ("35 Minuten", "35 मिनट", "35分").
function productMinutes(description: string): string | null {
  return description.match(/(\d+)\D*$/)?.[1] ?? null;
}

// The real Versant exam products. Durations/skills sourced directly from
// Pearson's own product pages.
const VERSANT_PRODUCTS = ["speakingListening", "fourSkills", "writing", "professional", "placement"] as const;

const PRODUCT_ICON: Record<(typeof VERSANT_PRODUCTS)[number], typeof Headphones> = {
  speakingListening: Headphones,
  fourSkills: BookOpen,
  writing: PenLine,
  professional: Briefcase,
  placement: ClipboardCheck,
};

// Five genuinely distinct hues (checked against the actual CSS values, not
// just token names — `listening` and `accent` are the same moss green, so
// reusing both here made two cards look identical). Solid, not a pale tint —
// a 15% wash of these warm/earthy tones reads as near-identical pastel; full
// saturation is what actually makes five cards look five different colors.
const PRODUCT_SOLID: Record<(typeof VERSANT_PRODUCTS)[number], string> = {
  speakingListening: "bg-speaking", // terracotta
  fourSkills: "bg-reading", // wheat/amber
  writing: "bg-writing", // clay pink
  professional: "bg-navy", // clay brown
  placement: "bg-accent", // moss green
};

export function PracticeTests() {
  const { t } = useTranslation();
  const isCandidate = useAuth().user?.role === "candidate";
  const allowedProducts = useBranding()?.allowedTestProducts ?? null;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null);
  useEffect(() => {
    getFaceEnrollmentStatus()
      .then((res) => setFaceEnrolled(res.enrolled))
      .catch(() => setFaceEnrolled(true));
  }, []);
  // Set when "Start"/"Retake" is clicked — gates the actual session start
  // behind a face check, same pattern as Modules/Placement.
  const [pendingExamId, setPendingExamId] = useState<string | null>(null);
  useEffect(() => {
    if (pendingExamId && faceEnrolled === false) {
      navigate(ROUTES.FACE_ENROLLMENT, { state: { next: `${location.pathname}${location.search}` } });
    }
  }, [pendingExamId, faceEnrolled, navigate, location.pathname, location.search]);
  // Set by a mid-session spoof detection — re-shows the gate, session stays intact.
  const [requireReverify, setRequireReverify] = useState(false);
  // The exam whose device check and demo are done; the face check comes next.
  const [preTestDoneFor, setPreTestDoneFor] = useState<string | null>(null);
  // "Watch the test demo" from the exam list, outside any test.
  const [showDemo, setShowDemo] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  // Which exam set a running/just-finished session belongs to — shown on
  // the score report so a learner can tell which test they just took.
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [loadingExams, setLoadingExams] = useState(false);
  const activeTestId = exams?.find((e) => e.id === activeExamId)?.testId ?? null;

  function openProduct(productId: string) {
    setSelectedProduct(productId);
    setExams(null);
    setLoadingExams(true);
    getExamsForProduct(productId)
      .then((res) => setExams(res.exams))
      .catch(() => setExams([]))
      .finally(() => setLoadingExams(false));
    // Tagged in the URL so a refresh on this screen restores the exam list
    // instead of dropping back to the bare product picker.
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("product", productId);
        return params;
      },
      { replace: true },
    );
  }

  function backToProducts() {
    setSelectedProduct(null);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("product");
        return params;
      },
      { replace: true },
    );
  }

  function refreshExams() {
    if (!selectedProduct) return;
    getExamsForProduct(selectedProduct)
      .then((res) => setExams(res.exams))
      .catch(() => {});
  }

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [partBoundaries, setPartBoundaries] = useState<PartBoundary[]>([]);
  const [items, setItems] = useState<TestItem[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, CachedAnswer>>({});
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  const questionShownAtRef = useRef(Date.now());

  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Real exam rule: audio plays at most twice per question. Keyed by index
  // (not just a single counter) so navigating Back to an earlier, already
  // fully-used question doesn't hand it two fresh plays.
  const playCountsRef = useRef<Record<number, number>>({});
  const [playCount, setPlayCount] = useState(0);
  const [pendingAudio, setPendingAudio] = useState<{ base64: string; mimeType: string } | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState<number | null>(null);
  const [summary, setSummary] = useState<ExamCompleteResult | null>(null);
  // The last answer is in and the score is being worked out.
  const [finishing, setFinishing] = useState(false);
  // The organization's proctoring for this session: pre-test steps, then
  // monitoring until the score report shows.
  // Monitoring stops as soon as the last answer is in: scoring can take a
  // while, and the learner has finished.
  const proctor = useProctoring(sessionId, Boolean(sessionId) && !summary && !finishing);
  // Stops once the score report shows — nothing left to verify identity
  // against after the test is already complete.
  usePeriodicFaceCheck(
    Boolean(sessionId) && !summary && !finishing && !requireReverify,
    "practice_test",
    sessionId,
    () => setRequireReverify(true),
    (outcome) => showFaceCheckOutcome(proctor, outcome),
  );
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const { recording, start: startRecording, stop: stopRecording } = useVoiceRecorder();

  // Gates question 1 behind a Pearson-style "Overview" of every section —
  // only on a genuinely fresh start, not a resumed session (already seen it).
  const [showExamOverview, setShowExamOverview] = useState(false);
  // Tracks which parts' one-time instructions interstitial has already been
  // dismissed this page load (in-memory only — a refresh mid-exam re-shows
  // the current section's card once, which is an acceptable rough edge for
  // a "nice to have" explainer rather than a safety-critical gate).
  const shownPartsRef = useRef(new Set<string>());
  const [showSectionIntro, setShowSectionIntro] = useState(false);

  // "two-phase" items (Passage Reconstruction): show the passage, then hide
  // it and switch to a blank textarea — testing recall, not copying.
  const [twoPhaseStage, setTwoPhaseStage] = useState<"idle" | "reading" | "writing">("idle");
  const twoPhaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared by a fresh start and a refresh-resume — both hand it the same
  // { sessionId, partBoundaries, items } shape.
  function applySessionData(res: { sessionId: string; testCode: string | null; examId: string; partBoundaries: PartBoundary[]; items: TestItem[] }) {
    setSessionId(res.sessionId);
    setTestCode(res.testCode);
    setActiveExamId(res.examId);
    setPartBoundaries(res.partBoundaries);
    setItems(res.items);
    const firstUnattempted = res.items.findIndex((item) => !item.attempted);
    const startIndex = firstUnattempted === -1 ? 0 : firstUnattempted;
    setIndex(startIndex);
    setAnswers(
      Object.fromEntries(res.items.flatMap((item, i) => (item.attempted ? [[i, { responseText: item.responseText ?? "" }]] : []))),
    );
    setSummary(null);
    reportHeldCheck(res.sessionId);

    const isFreshStart = res.items.every((item) => !item.attempted);
    setShowExamOverview(isFreshStart);
    // Resuming mid-section shouldn't re-interrupt with that section's
    // intro — mark every part up to and including the resumed one as
    // already seen; a fresh start leaves every part unseen, so the
    // index-tracking effect below shows part 0's intro once the overview
    // (if any) is dismissed.
    shownPartsRef.current = isFreshStart
      ? new Set()
      : new Set(res.partBoundaries.filter((b) => b.startIndex <= startIndex).map((b) => b.partId));

    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("session", res.sessionId);
        return params;
      },
      { replace: true },
    );
  }

  async function handleStartExam(examId: string) {
    setStarting(true);
    setError(null);
    try {
      const res = await startExamSession(examId);
      applySessionData(res);
    } catch {
      setError(t("practiceTests.loadError"));
    } finally {
      setStarting(false);
    }
  }

  // A page refresh wipes all React state — resume by the exact session id
  // tagged in the URL (set by applySessionData above) instead of landing
  // back on the product picker mid-test.
  const [resumeChecked, setResumeChecked] = useState(false);
  useEffect(() => {
    // Restores the exam-picker list on a refresh even if there's no active
    // session to resume (e.g. refreshing before starting one) — harmless to
    // also do this when a session does resume below, since the running-
    // session view takes render priority over selectedProduct either way.
    const productParam = searchParams.get("product");
    if (productParam) openProduct(productParam);

    const sessionIdParam = searchParams.get("session");
    if (!sessionIdParam) {
      setResumeChecked(true);
      return;
    }
    getExamSession(sessionIdParam)
      .then((res) => {
        if (!res.completed) applySessionData(res);
      })
      .catch(() => {})
      .finally(() => setResumeChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = items[index];
  const needsAudioFirst = current ? AUDIO_FIRST_TYPES.has(current.itemTypeId) : false;
  const visibleText = current && !needsAudioFirst ? getVisibleText(current) : "";
  const meta = current ? ITEM_TYPE_META[current.itemTypeId] : undefined;
  const currentPartIndex = partBoundaries.findIndex((b) => index >= b.startIndex && index < b.startIndex + b.count);
  const currentPart = currentPartIndex === -1 ? null : partBoundaries[currentPartIndex];

  // First time `index` lands inside a given part this session, show that
  // part's one-time instructions interstitial — crossing back into an
  // already-entered part (via Back) never re-triggers it.
  useEffect(() => {
    if (!sessionId || !currentPart) return;
    if (!shownPartsRef.current.has(currentPart.partId)) {
      shownPartsRef.current.add(currentPart.partId);
      setShowSectionIntro(true);
    } else {
      setShowSectionIntro(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, sessionId]);

  useEffect(() => {
    if (twoPhaseTimeoutRef.current !== null) {
      clearTimeout(twoPhaseTimeoutRef.current);
      twoPhaseTimeoutRef.current = null;
    }
    questionShownAtRef.current = Date.now();
    const cached = answersRef.current[index];
    setAnswerText(cached?.responseText ?? "");
    setPendingAudio(cached?.audioBase64 ? { base64: cached.audioBase64, mimeType: cached.audioMimeType ?? "" } : null);
    setAudioBlobUrl(cached?.audioBlobUrl ?? null);
    setRecordingDurationMs(cached?.durationMs ?? null);
    setHasPlayed(!!cached);
    setPlayCount(playCountsRef.current[index] ?? 0);
    setTwoPhaseStage(cached ? "writing" : "idle");
    setError(null);
  }, [index]);

  // Live countdown, display-only — doesn't gate or auto-submit anything.
  useEffect(() => {
    if (!current?.timerSeconds) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(current.timerSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.timerSeconds]);

  function handleStartReading() {
    if (!current) return;
    setTwoPhaseStage("reading");
    const readSeconds = current.twoPhaseReadSeconds ?? DEFAULT_TWO_PHASE_READ_SECONDS;
    twoPhaseTimeoutRef.current = setTimeout(() => {
      twoPhaseTimeoutRef.current = null;
      setTwoPhaseStage("writing");
    }, readSeconds * 1000);
  }

  const MAX_PLAYS = 2;

  async function handlePlay() {
    if (!current || playCount >= MAX_PLAYS) return;
    setPlaying(true);
    await playSpokenAudio(current, getSpokenSegments(current));
    setPlaying(false);
    setHasPlayed(true);
    const next = (playCountsRef.current[index] ?? 0) + 1;
    playCountsRef.current[index] = next;
    setPlayCount(next);
  }

  async function handleToggleRecord() {
    setError(null);
    if (!recording) {
      try {
        await startRecording();
      } catch {
        setError(t("placementTest.micError"));
      }
      return;
    }
    const { blob, mimeType, transcript, durationMs } = await stopRecording();
    if (transcript) setAnswerText(transcript);
    if (blob) {
      const base64 = await blobToBase64(blob);
      setPendingAudio({ base64, mimeType });
      setAudioBlobUrl(URL.createObjectURL(blob));
      setRecordingDurationMs(durationMs);
    }
  }

  function cacheCurrentAnswer() {
    setAnswers((prev) => ({
      ...prev,
      [index]: {
        responseText: answerText,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        audioBlobUrl: audioBlobUrl ?? undefined,
        durationMs: recordingDurationMs ?? undefined,
      },
    }));
  }

  async function finishOrAdvance() {
    if (index + 1 < items.length) {
      setIndex(index + 1);
      return;
    }
    if (!sessionId) return;
    // Every item was already submitted successfully by this point (this
    // only runs after handleSubmit's own submitExamAttempt succeeded) — a
    // network hiccup calling /complete shouldn't strand the learner on the
    // question screen with a scary error when they've genuinely finished.
    // Show a pending-score fallback instead; the session is marked complete
    // server-side regardless (or will be on a retry from the score screen).
    setFinishing(true);
    try {
      const result = await completeExamSession(sessionId);
      setSummary(result);
    } catch {
      setSummary({ gradedCount: 0, correctCount: 0, pendingCount: items.length, failedCount: 0, skippedCount: 0, overallPercent: 0, partResults: [] });
    } finally {
      setFinishing(false);
    }
  }

  // A prior submit on this same session can have actually succeeded
  // server-side (e.g. a slow grading call made the client give up before
  // the response arrived) while the page never got the memo and stayed on
  // the question screen — every click since then correctly gets rejected
  // as "already completed", which used to just repeat the generic error
  // forever. /complete is idempotent (safe to call again), so on this
  // specific error, fetch the real result instead of erroring again.
  function isAlreadyCompletedError(err: unknown): boolean {
    return err instanceof ApiError && (err.body as { error?: string } | undefined)?.error === "session_already_completed";
  }

  async function recoverAlreadyCompletedSession() {
    if (!sessionId) return;
    try {
      const result = await completeExamSession(sessionId);
      setSummary(result);
    } catch {
      setError(t("placementTest.submitError"));
    }
  }

  async function handleSubmit() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitExamAttempt(sessionId, {
        itemId: current.id,
        responseText: answerText.trim() || undefined,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        durationMs: recordingDurationMs ?? undefined,
        activeMs: Date.now() - questionShownAtRef.current,
      });
      cacheCurrentAnswer();
      await finishOrAdvance();
    } catch (err) {
      if (isAlreadyCompletedError(err)) {
        await recoverAlreadyCompletedSession();
      } else {
        setError(t("placementTest.submitError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitExamAttempt(sessionId, { itemId: current.id, activeMs: Date.now() - questionShownAtRef.current });
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      await finishOrAdvance();
    } catch (err) {
      if (isAlreadyCompletedError(err)) {
        await recoverAlreadyCompletedSession();
      } else {
        setError(t("placementTest.submitError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    if (index === 0) return;
    cacheCurrentAnswer();
    setIndex(index - 1);
  }

  function resetToExamList() {
    setSessionId(null);
    setTestCode(null);
    setItems([]);
    setPartBoundaries([]);
    setSummary(null);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("session");
        return params;
      },
      { replace: true },
    );
    refreshExams();
  }

  if (!resumeChecked) return null;

  if (requireReverify) {
    return <FaceCheck mode="verify" purpose="practice_test" onComplete={() => setRequireReverify(false)} />;
  }

  // A Start/Retake was clicked: the device check and demo come first, then
  // the face check (same pattern as Modules/Placement) gates the session start.
  if (pendingExamId && preTestDoneFor !== pendingExamId && selectedProduct) {
    return (
      <PreTestFlow
        kind={selectedProduct as PreTestKind}
        minutes={productMinutes(t(`practiceTests.versantProduct.${selectedProduct}Desc`))}
        onBack={() => setPendingExamId(null)}
        onReady={() => setPreTestDoneFor(pendingExamId)}
      />
    );
  }
  if (pendingExamId) {
    if (faceEnrolled === null || faceEnrolled === false) return null; // enrollment redirect effect above handles the false case
    return (
      <FaceCheck
        mode="verify"
        purpose="practice_test"
        onBack={() => setPendingExamId(null)}
        onComplete={() => {
          const examId = pendingExamId;
          setPendingExamId(null);
          handleStartExam(examId);
        }}
      />
    );
  }

  // A candidate's result goes to the recruiter, not to a score screen.
  if (summary && isCandidate) return <CandidateFinished sessionId={sessionId} />;

  // Takes priority over the running-session view below — completing a test
  // never clears sessionId/items (Back-to-exams needs them to still be
  // around momentarily), so without this check first, the running-session
  // branch would always win and the score screen could never show at all.
  if (summary) {
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        <div className="h-14 w-14 rounded-full bg-navy text-lime flex items-center justify-center">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="font-display font-bold text-2xl text-ink">{t("practiceTests.scoreReport.title")}</h1>
        <div className="flex flex-wrap justify-center gap-2 -mt-2">
          {activeTestId && <TestIdTag code={activeTestId} />}
          {(summary.testCode ?? testCode) && <TestIdTag code={(summary.testCode ?? testCode)!} label={tr("Attempt ID")} />}
        </div>
        {selectedProduct && (
          <p className="text-sm text-muted -mt-3">
            {t("practiceTests.scoreReport.testType")}:{" "}
            {exams?.find((e) => e.id === activeExamId)?.name || t(`practiceTests.versantProduct.${selectedProduct}`)}
          </p>
        )}
        <div className="flex items-stretch justify-center gap-3 w-full">
          {summary.cefrLevel && (
            <div className="flex-1 max-w-40 flex flex-col items-center gap-1 bg-navy/10 rounded-card py-3">
              <span className="text-4xl font-display font-bold text-navy-deep">{summary.cefrLevel}</span>
              <span className="text-xs text-muted uppercase tracking-wide">{tr("CEFR level")}</span>
            </div>
          )}
          <div className="flex-1 max-w-40 flex flex-col items-center gap-1 bg-paper-warm rounded-card py-3">
            <span className="text-4xl font-display font-bold text-ink">{summary.overallPercent}%</span>
            <span className="text-xs text-muted uppercase tracking-wide">{t("practiceTests.scoreReport.overall")}</span>
          </div>
        </div>
        {summary.skillLevels && Object.keys(summary.skillLevels).length > 0 && (
          <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["listening", "speaking", "reading", "writing"] as const)
              .filter((skill) => summary.skillLevels?.[skill])
              .map((skill) => (
                <div key={skill} className="bg-paper-warm rounded-input px-3 py-2 flex flex-col items-center">
                  <span className="text-[11px] text-muted">{t(`skills.${skill}`)}</span>
                  <span className="font-display font-bold text-lg text-ink">{summary.skillLevels![skill]}</span>
                  {summary.skillPercents?.[skill] !== undefined && <span className="text-[11px] text-muted">{summary.skillPercents[skill]}%</span>}
                </div>
              ))}
          </div>
        )}
        {summary.cefrLevel && <p className="text-xs text-muted -mt-2">{t("placementTest.levelDisclaimer")}</p>}

        <div className="w-full flex flex-col gap-2.5 text-left">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t("practiceTests.scoreReport.sectionResults")}</span>
          {summary.partResults.map((part) => {
            const pct = part.gradedCount > 0 ? Math.round((part.correctCount / part.gradedCount) * 100) : 0;
            return (
              <div key={part.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink font-medium">{part.label}</span>
                  <span className="text-muted font-mono text-xs">
                    {part.correctCount}/{part.gradedCount}
                  </span>
                </div>
                <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
                  <div className="h-full bg-navy rounded-pill transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {summary.pendingCount > 0 && (
          <p className="text-sm text-muted">{t("placementTest.pendingNote", { pending: summary.pendingCount })}</p>
        )}
        {summary.skippedCount > 0 && (
          <p className="text-sm text-muted">{t("practiceTests.scoreReport.skippedNote", { count: summary.skippedCount })}</p>
        )}
        {summary.failedCount > 0 && (
          <p className="text-sm text-error">{t("placementTest.failedNote", { failed: summary.failedCount })}</p>
        )}
        <IntegrityResultNote sessionId={sessionId} />
        <div className="flex items-center gap-3 w-full">
          <Button variant="secondary" onClick={resetToExamList} className="flex-1">
            {t("practiceTests.backToExams")}
          </Button>
          <Button onClick={() => navigate(ROUTES.DASHBOARD)} className="flex-1">
            {t("modules.backToDashboard")}
          </Button>
        </div>
      </div>
    );
  }

  if (finishing) {
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-3 items-center text-center">
        <CheckCircle2 size={32} className="text-success" />
        <h1 className="font-display font-bold text-xl text-ink">{tr("Test finished")}</h1>
        <p className="text-sm text-muted">{tr("Monitoring has stopped. Scoring your answers; this can take up to a minute.")}</p>
      </div>
    );
  }

  // Proctoring steps (consent, ID, room scan, voice sample) come before the test.
  if (sessionId && !proctor.ready) {
    if (proctor.loading || !proctor.setup) return null;
    return <ProctoringGate proctor={proctor} sessionId={sessionId} />;
  }
  const overlay = <ProctoringOverlay proctor={proctor} onFinish={recoverAlreadyCompletedSession} />;

  // --- Exam overview (Pearson-style Part/Task/Questions table), fresh starts only ---
  if (sessionId && current && showExamOverview) {
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        {overlay}
        <span className="h-14 w-14 rounded-2xl bg-accent/15 text-accent flex items-center justify-center">
          <ClipboardCheck size={26} strokeWidth={2} />
        </span>
        <h1 className="font-display font-bold text-xl text-ink">{t("practiceTests.overview.title")}</h1>
        <div className="flex flex-wrap justify-center gap-2">
          {activeTestId && <TestIdTag code={activeTestId} />}
          {testCode && <TestIdTag code={testCode} label={tr("Attempt ID")} />}
        </div>
        <p className="text-sm text-muted -mt-2">{t("practiceTests.overview.subtitle")}</p>
        <div className="w-full flex flex-col gap-2 text-left">
          {partBoundaries.map((part, i) => (
            <div key={part.partId} className="flex items-center gap-3 bg-paper-warm rounded-input px-4 py-2.5">
              <span className="h-7 w-7 rounded-full bg-navy/15 text-navy-deep flex items-center justify-center text-xs font-bold shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1 text-sm font-semibold text-ink">{part.label}</span>
              <span className="text-xs text-muted">{t("practiceTests.questionsCount", { count: part.count })}</span>
            </div>
          ))}
        </div>
        <Button onClick={() => setShowExamOverview(false)} className="w-full">
          {t("practiceTests.overview.begin")}
        </Button>
      </div>
    );
  }

  // --- Per-section instructions, once per part per session ---
  if (sessionId && current && showSectionIntro && currentPart) {
    return (
      <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        {overlay}
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
            {String.fromCharCode(65 + currentPartIndex)}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("practiceTests.sectionLabel", { current: currentPartIndex + 1, total: partBoundaries.length, label: currentPart.label })}
          </span>
        </div>
        <span className="h-14 w-14 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center">
          <ClipboardCheck size={26} strokeWidth={2} />
        </span>
        <div>
          <h1 className="font-display font-bold text-xl text-ink">{currentPart.label}</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">{current.instructionText}</p>
        </div>
        <Button onClick={() => setShowSectionIntro(false)} className="w-full">
          {t("practiceTests.overview.startSection", { label: currentPart.label })}
        </Button>
      </div>
    );
  }

  // --- Running session ---
  if (sessionId && current) {
    const canSubmit = current.inputMethod === "mic" ? !recording && !!audioBlobUrl : answerText.trim() !== "";
    const progressPct = Math.round((index / items.length) * 100);
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-3">
        {overlay}
        <div className="flex items-center justify-between px-1">
          {currentPart ? (
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                {String.fromCharCode(65 + currentPartIndex)}
              </span>
              <span className="text-xs font-semibold text-ink">{currentPart.label}</span>
            </div>
          ) : (
            <span />
          )}
          <span className="text-xs font-mono text-muted">
            {activeTestId && <span className="mr-3">{tr("Test ID")} {activeTestId}</span>}
            {testCode && <span className="hidden sm:inline mr-3">{tr("Attempt ID")} {testCode}</span>}
            {t("placementTest.progress", { current: index + 1, total: items.length })}
          </span>
        </div>

        {/* Height follows the actual content, between a floor (so a short
            mic item doesn't look like a tiny stub) and a ceiling (so the
            card never pushes the footer off-screen) — a fixed number can't
            fit both a two-panel mic item and a long passage+essay item
            (like Summary and Opinion) without either a dead gap or clipped
            content. Only content past the ceiling scrolls internally. */}
        <div
          className="relative w-full bg-surface border border-rule rounded-card shadow-sm overflow-hidden flex flex-col"
          style={{ minHeight: "420px", maxHeight: "min(780px, calc(100vh - 180px))" }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-1.5 pointer-events-none"
            style={{ backgroundColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
          />
          <div className="flex-1 p-8 pt-6 flex flex-col justify-start gap-5 overflow-y-auto">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wide text-ink font-semibold">{meta?.name}</span>
                {remainingSeconds !== null ? (
                  <span
                    className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-pill border transition-colors ${
                      remainingSeconds <= 5 ? "text-error border-error/30 bg-error/10" : "text-navy-deep border-navy/20 bg-navy/10"
                    }`}
                  >
                    <Clock size={16} />
                    {String(Math.floor(remainingSeconds / 60)).padStart(1, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                {(meta?.skills ?? current.skills).map((skill) => (
                  <span
                    key={skill}
                    className={`text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill border ${SKILL_BADGE_CLASS[skill]}`}
                  >
                    {t(`skills.${skill}`)}
                  </span>
                ))}
              </div>
              <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
                <div className="h-full bg-navy rounded-pill transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <h2 className="font-display font-bold text-lg text-ink text-center leading-snug">{current.questionInstruction}</h2>

            {needsAudioFirst ? (
              // Versant-style two-panel layout: a dark "You hear" box (audio
              // prompt, no text shown — revealing the transcript would give
              // the answer away, unlike Pearson's own public demo which
              // shows it for visitors) paired with a "You say" box holding
              // the actual answer control.
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="relative rounded-card bg-navy text-lime p-5 pt-8 flex flex-col items-center justify-center gap-2 min-h-[160px] overflow-hidden">
                  <span className="absolute top-3 left-4 text-[10px] font-mono uppercase tracking-wider text-lime/70">
                    {t("practiceTests.youHear")}
                  </span>
                  <Headphones size={64} strokeWidth={1.5} className="absolute -right-3 -bottom-3 text-lime/10 pointer-events-none" />
                  <button
                    onClick={handlePlay}
                    disabled={playing || recording || playCount >= MAX_PLAYS}
                    className="h-14 w-14 rounded-full bg-lime text-navy flex items-center justify-center shadow-md transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Volume2 size={22} />
                  </button>
                  <span className="text-xs text-lime/80">{playing ? t("placementTest.playing") : t("placementTest.play")}</span>
                  {hasPlayed && (
                    <button
                      onClick={handlePlay}
                      disabled={playing || recording || playCount >= MAX_PLAYS}
                      className="flex items-center gap-1.5 text-xs font-semibold text-lime hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCcw size={13} /> {t("placementTest.replay")}
                    </button>
                  )}
                  <span className="text-[10px] text-lime/60">{t("practiceTests.playsRemaining", { count: Math.max(0, MAX_PLAYS - playCount) })}</span>
                </div>
                <div className="relative rounded-card bg-accent/10 border border-accent/25 p-5 pt-8 flex flex-col items-center justify-center gap-2 min-h-[160px] overflow-hidden">
                  <span className="absolute top-3 left-4 text-[10px] font-mono uppercase tracking-wider text-accent">
                    {t("practiceTests.youSay")}
                  </span>
                  <MessageSquare size={64} strokeWidth={1.5} className="absolute -right-3 -bottom-3 text-accent/10 pointer-events-none" />
                  <AnswerInputControl
                    item={current}
                    answerText={answerText}
                    onAnswerTextChange={setAnswerText}
                    recording={recording}
                    onToggleRecord={handleToggleRecord}
                    audioBlobUrl={audioBlobUrl}
                    needsAudioFirst={needsAudioFirst}
                    hasPlayed={hasPlayed}
                    playing={playing}
                    stopIconSize={18}
                    textareaRows={4}
                  />
                </div>
              </div>
            ) : (
              <>
                {current.inputMethod === "two-phase" ? (
                  twoPhaseStage === "idle" ? (
                    <div className="flex justify-center">
                      <Button variant="secondary" onClick={handleStartReading}>
                        {t("modules.startReading")}
                      </Button>
                    </div>
                  ) : twoPhaseStage === "reading" ? (
                    <p
                      className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 leading-relaxed shadow-sm"
                      style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
                    >
                      {getVisibleText(current)}
                    </p>
                  ) : (
                    <p className="text-sm text-muted italic text-center">{t("modules.passageHidden")}</p>
                  )
                ) : getPassageAndQuestion(current) ? (
                  <div className="flex flex-col gap-2.5">
                    <p
                      className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 whitespace-pre-wrap leading-relaxed shadow-sm"
                      style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
                    >
                      {getPassageAndQuestion(current)!.passage}
                    </p>
                    <p className="text-sm font-semibold text-ink px-1">{getPassageAndQuestion(current)!.question}</p>
                  </div>
                ) : (
                  <p
                    className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 leading-relaxed shadow-sm"
                    style={{ borderLeftColor: `var(--color-${(meta?.skills ?? current.skills)[0]})` }}
                  >
                    {visibleText}
                  </p>
                )}

                {current.inputMethod === "two-phase" ? (
                  twoPhaseStage === "writing" && (
                    <textarea
                      value={answerText}
                      onChange={(e) => setAnswerText(e.target.value)}
                      onPaste={(e) => e.preventDefault()}
                      onDrop={(e) => e.preventDefault()}
                      placeholder={t("placementTest.answerPlaceholder")}
                      className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink shadow-sm focus:border-navy focus:outline-none transition-colors"
                      rows={4}
                    />
                  )
                ) : (
                  <AnswerInputControl
                    item={current}
                    answerText={answerText}
                    onAnswerTextChange={setAnswerText}
                    recording={recording}
                    onToggleRecord={handleToggleRecord}
                    audioBlobUrl={audioBlobUrl}
                    needsAudioFirst={needsAudioFirst}
                    hasPlayed={hasPlayed}
                    playing={playing}
                    stopIconSize={18}
                    textareaRows={4}
                  />
                )}
              </>
            )}

            {error && <p className="text-sm text-error text-center">{error}</p>}
          </div>

          <div className="shrink-0 border-t border-rule px-8 py-4 flex items-center gap-3">
            <Button variant="secondary" onClick={handleBack} disabled={index === 0 || submitting || recording} className="!px-3.5">
              <ArrowLeft size={20} />
            </Button>
            <button
              onClick={handleSkip}
              disabled={submitting || recording}
              className="text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed px-1"
            >
              {t("placementTest.skip")}
            </button>
            <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="flex-1">
              {submitting
                ? t("placementTest.submitting")
                : index + 1 < items.length
                  ? t("practiceTests.saveAndNext")
                  : t("placementTest.finish")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (starting) {
    return <p className="text-sm text-muted">{t("modules.starting")}</p>;
  }

  if (showDemo && selectedProduct) {
    return (
      <TestDemo
        kind={selectedProduct}
        needs={deviceNeedsFor(selectedProduct)}
        minutes={productMinutes(t(`practiceTests.versantProduct.${selectedProduct}Desc`))}
        doneLabel={tr("Close the demo")}
        onDone={() => setShowDemo(false)}
      />
    );
  }

  // --- Exam (set) picker for the selected product ---
  if (selectedProduct) {
    const Icon = PRODUCT_ICON[selectedProduct as (typeof VERSANT_PRODUCTS)[number]];
    const productMins = productMinutes(t(`practiceTests.versantProduct.${selectedProduct}Desc`));
    return (
      <div className="w-full flex flex-col gap-6">
        <LearnerHero
          onBack={backToProducts}
          backLabel={t("practiceTests.backToProducts")}
          eyebrow={t("nav.practiceTests")}
          title={t(`practiceTests.versantProduct.${selectedProduct}`)}
          subtitle={t(`practiceTests.versantProduct.${selectedProduct}Desc`)}
          icon={Icon}
          stats={
            exams
              ? [
                  { label: tr("Sets"), value: exams.length, icon: ClipboardCheck },
                  { label: tr("Completed"), value: exams.filter((e) => e.completed).length, icon: CheckCircle2 },
                  { label: tr("Questions per set"), value: exams[0]?.itemCount ?? "—", icon: ListChecks },
                  { label: tr("Timing"), value: productMins ? tr("{{m}} min", { m: productMins }) : "—", icon: Clock },
                ]
              : undefined
          }
        />

        <button
          onClick={() => setShowDemo(true)}
          className="self-start flex items-center gap-1.5 text-sm font-semibold text-navy-deep hover:underline underline-offset-4 cursor-pointer"
        >
          <PlayCircle size={16} /> {tr("Watch the test demo")}
        </button>

        {loadingExams ? (
          <p className="text-sm text-muted">{t("modules.starting")}</p>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {(exams ?? []).map((exam, i) => (
              <div
                key={exam.id}
                className="relative overflow-hidden flex flex-col gap-4 bg-surface border border-rule rounded-card p-6 pt-7 shadow-sm hover:shadow-md transition-shadow"
              >
                <span className={`absolute inset-x-0 top-0 h-1.5 ${PRODUCT_SOLID[selectedProduct as (typeof VERSANT_PRODUCTS)[number]]}`} />
                <div className="flex items-start gap-4">
                  <span
                    className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 font-display font-bold text-lg ${
                      exam.completed ? "bg-success text-white" : `${PRODUCT_SOLID[selectedProduct as (typeof VERSANT_PRODUCTS)[number]]} text-white`
                    }`}
                  >
                    {exam.completed ? <CheckCircle2 size={22} /> : i + 1}
                  </span>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <span className="font-display font-bold text-base text-ink">{exam.name || `Set ${i + 1}`}</span>
                    <span className="text-sm text-muted">{t("practiceTests.questionsCount", { count: exam.itemCount })}</span>
                    <span className="self-start text-[11px] font-mono font-semibold text-ink bg-paper-warm border border-rule rounded-pill px-2 py-0.5">
                      {tr("Test ID")} {exam.testId}
                    </span>
                  </div>
                  {exam.completed && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success shrink-0">{t("practiceTests.completed")}</span>
                  )}
                </div>
                <Button
                  onClick={() => {
                    // Every Start or Retake gets its own check.
                    setPreTestDoneFor(null);
                    setPendingExamId(exam.id);
                  }}
                  className="w-full"
                >
                  {exam.completed ? t("practiceTests.retake") : t("practiceTests.startExam")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Product picker ---
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("Mock exams")}
        title={t("nav.practiceTests")}
        subtitle={t("practiceTests.subtitle")}
        icon={ClipboardCheck}
        stats={[
          { label: tr("Exam types"), value: VERSANT_PRODUCTS.length, icon: Layers },
          { label: tr("Full sets to take"), value: VERSANT_PRODUCTS.length * 5, icon: ListChecks },
          { label: tr("Length"), value: "17–60 min", icon: Clock },
          { label: tr("Scored by section"), value: "Instant", icon: Award },
        ]}
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-5">
        {VERSANT_PRODUCTS.map((id, i) => {
          const Icon = PRODUCT_ICON[id];
          const minutes = productMinutes(t(`practiceTests.versantProduct.${id}Desc`));
          // Products the learner's organization switched off stay visible but closed.
          const enabled = !allowedProducts || allowedProducts.includes(id);
          return (
            <button
              key={id}
              onClick={() => enabled && openProduct(id)}
              disabled={!enabled}
              className={`group relative text-left bg-surface border border-rule rounded-card p-6 flex flex-col gap-4 overflow-hidden transition-all ${
                // Three across, then two wider ones, so no card sits alone.
                i < 3 ? "lg:col-span-2" : i === VERSANT_PRODUCTS.length - 1 ? "sm:col-span-2 lg:col-span-3" : "lg:col-span-3"
              } ${
                enabled
                  ? "cursor-pointer hover:border-rule-strong hover:shadow-[0_16px_32px_-16px_rgba(0,0,0,0.3)] hover:-translate-y-1"
                  : "opacity-55 cursor-not-allowed"
              }`}
            >
              {!enabled && (
                <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-2 py-1 rounded-pill">
                  {t("practiceTests.notEnabled")}
                </span>
              )}
              {/* Oversized, very faint echo of the card's own icon — a
                  decorative watermark, not another color block, so it adds
                  presence without competing with the readable icon badge. */}
              <Icon
                size={140}
                strokeWidth={1.5}
                className="absolute -right-6 -bottom-6 text-ink/[0.04] group-hover:text-ink/[0.07] transition-colors pointer-events-none"
              />
              <span
                className={`relative h-16 w-16 rounded-2xl flex items-center justify-center text-white shadow-md transition-transform group-hover:scale-110 ${PRODUCT_SOLID[id]}`}
              >
                <Icon size={28} strokeWidth={2} />
              </span>
              <div className="relative flex flex-col gap-1.5">
                <span className="font-display font-bold text-lg text-ink leading-snug">{t(`practiceTests.versantProduct.${id}`)}</span>
                <span className="text-sm text-muted leading-relaxed">{t(`practiceTests.versantProduct.${id}Desc`)}</span>
              </div>
              <div className="relative flex items-center gap-2 mt-auto">
                {minutes && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-2.5 py-1 rounded-pill">
                    <Clock size={11} /> {tr("{{m}} min", { m: minutes })}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-xs font-bold text-ink transition-transform group-hover:translate-x-1">
                  <ChevronRight size={16} strokeWidth={2.5} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
