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
  RotateCcw,
  ListChecks,
  Layers,
  Award,
  PlayCircle,
  Timer,
  BookOpenCheck,
  Target,
  FileText,
  Lock,
} from "lucide-react";
import { SkillLevelCompare } from "@/components/report/SkillLevelCompare";
import { SkillLevelsPanel } from "@/components/learner/SkillLevels";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { MockExamList } from "@/components/practice/MockExamList";
import { AnswerInputControl } from "@/components/AnswerInputControl";
import { familyHeading, familyNote, testTypeBadgeTime, testTypeColour, testTypeDescription, testTypeIcon, testTypeName } from "@/lib/testTypes";
import {
  getProducts,
  getExamsForProduct,
  startExamSession,
  startMockSession,
  startFormSession,
  getExamSession,
  markItemShown,
  submitExamAttempt,
  getPracticeFeedback,
  completeExamSession,
  getQuota,
  getMyProgram,
  getHistory,
  getReport,
  type HistoryEntry,
  type QuotaUsage,
  type MyProgram,
  type ExamSessionData,
  type PracticeFeedback,
  type CatalogueFamily,
  type CatalogueTestType,
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
import { SystemCheck } from "@/components/pretest/SystemCheck";
import { markChecked, quickDeviceCheck, resumeNeedsFullCheck, type QuickCheckProblem } from "@/lib/smartResume";
import { IntegrityResultNote } from "@/components/proctoring/IntegrityResultNote";
import { TestDemo } from "@/components/pretest/TestDemo";
import { deviceNeedsFor, reportHeldCheck } from "@/lib/systemCheck";
import type { DeliveryMode, PreTestKind } from "@/api/proctoring";
import { AnswerFeedback } from "@/components/AnswerFeedback";
import { FeedbackReportView } from "@/components/report/FeedbackReportView";
import { useMyLicense } from "@/components/licenses/LicenseGate";
import { formatShortDate } from "@/api/licenses";
import {
  AUDIO_FIRST_TYPES,
  SKILL_BADGE_CLASS,
  ITEM_TYPE_META,
  getSpokenSegments,
  getVisibleText,
  getPassageAndQuestion,
  getGroupQuestions,
  parseGroupAnswer,
} from "@/lib/testItemDisplay";

import { tr } from "@/i18n/tr";
// Fallback reading time for a two-phase item with no server-set duration.
const DEFAULT_TWO_PHASE_READ_SECONDS = 30;

// A Start, Retake or mock exam waiting for its pre-test steps. key tells
// one start from another (a set id, or "mock:" and the test type).
interface PendingStart {
  key: string;
  mode: DeliveryMode;
  examId?: string;
  // A practice test built by staff (assessment builder).
  formId?: string;
  testTypeId?: string;
}

// Mock exams: how long the time-up warning shows red.
const MOCK_WARNING_SECONDS = 10;

interface CachedAnswer {
  responseText: string;
  audioBase64?: string;
  audioMimeType?: string;
  audioBlobUrl?: string;
  durationMs?: number;
}

// Practice tests and mock exams are separate sections of the learner app,
// sharing this page: "practice" lists practice sets, "mock" the mock exams.
export function PracticeTests({ section = "practice" }: { section?: "practice" | "mock" }) {
  const isMockSection = section === "mock";
  const license = useMyLicense();
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
  // Set when "Start"/"Retake"/"Start mock exam" is clicked — gates the
  // actual session start behind a face check, same pattern as Modules/Placement.
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  useEffect(() => {
    if (pendingStart && faceEnrolled === false) {
      navigate(ROUTES.FACE_ENROLLMENT, { state: { next: `${location.pathname}${location.search}` } });
    }
  }, [pendingStart, faceEnrolled, navigate, location.pathname, location.search]);
  // Set by a mid-session spoof detection — re-shows the gate, session stays intact.
  const [requireReverify, setRequireReverify] = useState(false);
  // The exam whose device check and demo are done; the face check comes next.
  const [preTestDoneFor, setPreTestDoneFor] = useState<string | null>(null);
  // "Watch the test demo" from the exam list, outside any test.
  const [showDemo, setShowDemo] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  // The exam catalogue: families and their test types.
  const [catalogue, setCatalogue] = useState<CatalogueFamily[] | null>(null);
  // The learner's mock exam in progress, if any (one at a time).
  const [openMock, setOpenMock] = useState<{ sessionId: string; testTypeId: string | null } | null>(null);
  // This month's tests against the learner's limits, and their program.
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  const [myProgram, setMyProgram] = useState<MyProgram | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  function loadProducts() {
    getProducts()
      .then((r) => {
        setCatalogue(r.families);
        setOpenMock(r.openMock);
      })
      .catch(() => setCatalogue([]));
    getQuota()
      .then((r) => setQuota(r.quota))
      .catch(() => {});
    getMyProgram()
      .then((r) => setMyProgram(r.program))
      .catch(() => {});
    getHistory()
      .then((r) => setHistory(r.sessions))
      .catch(() => {});
  }
  const practiceLeft = quota && quota.practicePerMonth !== null ? Math.max(0, quota.practicePerMonth - quota.practiceUsed) : null;
  const mocksLeft = quota && quota.mocksPerMonth !== null ? Math.max(0, quota.mocksPerMonth - quota.mocksUsed) : null;
  useEffect(loadProducts, []);
  const testTypes = catalogue?.flatMap((f) => f.testTypes) ?? [];
  const selectedType = testTypes.find((tt) => tt.id === selectedProduct) ?? null;
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  // Which exam set a running/just-finished session belongs to — shown on
  // the score report so a learner can tell which test they just took.
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [loadingExams, setLoadingExams] = useState(false);
  const activeTestIdOfSet = exams?.find((e) => e.id === activeExamId)?.testId ?? null;

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
  // Practice: go back, results in the report at the end. Mock: exam conditions.
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("practice");
  const isMock = deliveryMode === "mock";
  // A mock mixes questions from every set, so it has no set Test ID.
  const activeTestId = isMock ? null : activeTestIdOfSet;
  // Mock exams: the server's clock minus this computer's, and when the whole
  // exam ends (server time).
  const clockOffsetRef = useRef(0);
  const mockDeadlineRef = useRef<number | null>(null);
  // Mock: when the current question's time runs out (this computer's clock).
  const questionEndsAtRef = useRef<number | null>(null);
  const [mockSecondsLeft, setMockSecondsLeft] = useState<number | null>(null);
  const timeUpFiredRef = useRef(false);
  // Practice: feedback on the answer just submitted.
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
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
  // A mock's time ran out while the learner was away: it was finished on return.
  const [timeRanOut, setTimeRanOut] = useState(false);
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
  function applySessionData(res: ExamSessionData) {
    setSessionId(res.sessionId);
    setTestCode(res.testCode);
    setDeliveryMode(res.deliveryMode ?? "practice");
    clockOffsetRef.current = res.timing ? Date.parse(res.timing.serverNow) - Date.now() : 0;
    mockDeadlineRef.current = res.timing?.deadlineAt ? Date.parse(res.timing.deadlineAt) : null;
    setFeedback(null);
    // A built test is listed with the sets under its own id.
    setActiveExamId(res.formId ?? res.examId);
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

    // A mock question already shown has its clock running: no overview again.
    const isFreshStart = res.items.every((item) => !item.attempted && (item.secondsLeft ?? null) === null);
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

  async function handleStartExam(start: PendingStart) {
    setStarting(true);
    setError(null);
    try {
      const res =
        start.mode === "mock" ? await startMockSession(start.testTypeId!) : start.formId ? await startFormSession(start.formId) : await startExamSession(start.examId!);
      applySessionData(res);
      markChecked(res.sessionId);
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
      setError(
        code === "mock_in_progress"
          ? tr("You have another mock exam in progress. Finish it first.")
          : code === "quota_reached"
            ? tr("You've reached this month's limit. It resets on {{date}}.", { date: quota ? formatShortDate(quota.resetsOn) : "" })
            : t("practiceTests.loadError"),
      );
      loadProducts();
    } finally {
      setStarting(false);
    }
  }

  // A page refresh wipes all React state — resume by the exact session id
  // tagged in the URL (set by applySessionData above) instead of landing
  // back on the product picker mid-test.
  const [resumeChecked, setResumeChecked] = useState(false);
  // A test resumed after a page reload shows the device check before going on.
  const [resumeNeedsCheck, setResumeNeedsCheck] = useState(false);
  const [resumeProblem, setResumeProblem] = useState<QuickCheckProblem | null>(null);
  // Quietly checking the devices before resuming from the set list.
  const [quickChecking, setQuickChecking] = useState(false);
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
        if (!res.completed) {
          applySessionData(res);
          // Resuming after a reload: straight on if this test was in use here
          // in the last 30 minutes, else a quick check on its own; the full
          // device check shows only if that finds a problem.
          return resumeNeedsFullCheck(res.sessionId, deviceNeedsFor(productParam ?? "").mic).then((problem) => {
            setResumeProblem(problem);
            setResumeNeedsCheck(!!problem);
          });
        }
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
    setFeedback(null);
  }, [index]);

  // Practice: a live countdown as a guide — doesn't gate or auto-submit anything.
  useEffect(() => {
    if (isMock || !current?.timerSeconds) {
      setRemainingSeconds(null);
      return;
    }
    setRemainingSeconds(current.timerSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => (prev === null ? null : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, current?.timerSeconds, isMock]);

  // Mock: a question's clock starts on the server the first time it shows
  // (after the overview and section instructions), so a reload or a closed
  // tab doesn't stop it. At 0:00 the answer so far is submitted.
  const questionVisible = Boolean(sessionId && current && !showExamOverview && !showSectionIntro && proctor.ready && !summary && !finishing);
  useEffect(() => {
    if (!isMock || !questionVisible || !sessionId || !current) return;
    questionEndsAtRef.current = null;
    timeUpFiredRef.current = false;
    setMockSecondsLeft(null);
    // The whole exam's time is over (a learner coming back much later): finish it.
    if (mockDeadlineRef.current !== null && Date.now() + clockOffsetRef.current > mockDeadlineRef.current) {
      setTimeRanOut(true);
      finishTest();
      return;
    }
    let cancelled = false;
    const startClock = (seconds: number | null | undefined) => {
      if (cancelled || seconds === null || seconds === undefined) return;
      questionEndsAtRef.current = Date.now() + seconds * 1000;
      setMockSecondsLeft(seconds);
    };
    markItemShown(sessionId, current.id)
      .then((r) => startClock(r.secondsLeft))
      // Offline for a moment: count down locally; the server still enforces its own time.
      .catch(() => startClock(current.secondsLeft ?? current.limitSeconds));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMock, questionVisible, sessionId, current?.id]);

  const timeUpRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isMock) return;
    const timer = setInterval(() => {
      const end = questionEndsAtRef.current;
      if (end === null) return;
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setMockSecondsLeft(left);
      if (left === 0 && !timeUpFiredRef.current) {
        timeUpFiredRef.current = true;
        timeUpRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isMock]);

  // Practice: a recorded answer is scored in the background; check back for its feedback.
  useEffect(() => {
    if (feedback?.status !== "pending" || !sessionId || !current) return;
    const itemId = current.id;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      getPracticeFeedback(sessionId, itemId)
        .then((r) => {
          if (r.feedback.status !== "pending") {
            setFeedback(r.feedback);
            clearInterval(timer);
          }
        })
        .catch(() => {});
      if (tries >= 15) clearInterval(timer);
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback?.status, sessionId, current?.id]);

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
      // Mock exams, like the real exam: stopping the recording hands the
      // answer in and moves to the next question (no Skip or Next buttons).
      if (isMock) return handleSubmit({ audioBase64: base64, audioMimeType: mimeType, durationMs, transcript: transcript ?? "" });
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
    await finishTest();
  }

  async function finishTest() {
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

  // Mock: the question was already answered (a double click, or a reload
  // after the answer went in): carry on with the next one.
  function isAlreadyAnsweredError(err: unknown): boolean {
    return err instanceof ApiError && (err.body as { error?: string } | undefined)?.error === "already_answered";
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

  // recorded: a mock recording just stopped (by the learner or the time-up), not yet in state.
  async function handleSubmit(recorded?: { audioBase64: string; audioMimeType: string; durationMs: number; transcript: string }) {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitExamAttempt(sessionId, {
        itemId: current.id,
        responseText: (recorded ? recorded.transcript : answerText).trim() || undefined,
        audioBase64: recorded?.audioBase64 ?? pendingAudio?.base64,
        audioMimeType: recorded?.audioMimeType ?? pendingAudio?.mimeType,
        durationMs: recorded?.durationMs ?? recordingDurationMs ?? undefined,
        activeMs: Date.now() - questionShownAtRef.current,
      });
      cacheCurrentAnswer();
      markChecked(sessionId);
      // Straight on: right and wrong answers are in the report at the end
      // (feedback after each question is in Practice Modules, not tests).
      await finishOrAdvance();
    } catch (err) {
      if (isAlreadyCompletedError(err)) {
        await recoverAlreadyCompletedSession();
      } else if (isAlreadyAnsweredError(err)) {
        await finishOrAdvance();
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
      } else if (isAlreadyAnsweredError(err)) {
        await finishOrAdvance();
      } else {
        setError(t("placementTest.submitError"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Mock: time's up. A recording in progress is stopped and sent; whatever
  // was typed or chosen is sent; nothing at all counts as unanswered.
  async function handleTimeUp() {
    if (submitting || !current) return;
    if (recording) {
      const r = await stopRecording();
      if (r.blob) {
        return handleSubmit({ audioBase64: await blobToBase64(r.blob), audioMimeType: r.mimeType, durationMs: r.durationMs, transcript: r.transcript ?? "" });
      }
      return handleSkip();
    }
    if (answerText.trim() || pendingAudio) return handleSubmit();
    return handleSkip();
  }
  timeUpRef.current = () => void handleTimeUp();

  function handleBack() {
    if (index === 0 || isMock) return;
    cacheCurrentAnswer();
    setIndex(index - 1);
  }

  // The sidebar link (no ?product or ?session in the URL) always opens the
  // main page, even from a test's set list or a test in progress (which
  // stays saved to resume).
  useEffect(() => {
    if (searchParams.get("product") || searchParams.get("session")) return;
    if (!selectedProduct && !sessionId && !pendingStart && !summary) return;
    setPendingStart(null);
    setPreTestDoneFor(null);
    setResumeNeedsCheck(false);
    setSessionId(null);
    setDeliveryMode("practice");
    setFeedback(null);
    setTestCode(null);
    setItems([]);
    setPartBoundaries([]);
    setSummary(null);
    setSelectedProduct(null);
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  function resetToExamList() {
    setSessionId(null);
    setDeliveryMode("practice");
    setFeedback(null);
    loadProducts();
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
  if (quickChecking) return <p className="text-sm text-muted text-center mt-10">{tr("Getting back to your test…")}</p>;

  if (requireReverify) {
    return <FaceCheck mode="verify" purpose="practice_test" onComplete={() => setRequireReverify(false)} />;
  }

  if (resumeNeedsCheck && sessionId) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
        <p className="text-sm text-warning text-center">
          {resumeProblem === "mic"
            ? tr("Welcome back. Your microphone isn't responding, so let's check it before you go on.")
            : tr("Welcome back. Your connection looks unstable, so let's check it before you go on.")}
        </p>
        <SystemCheck
          needs={deviceNeedsFor(selectedProduct ?? "")}
          onPassed={() => {
            markChecked(sessionId);
            setResumeNeedsCheck(false);
          }}
        />
      </div>
    );
  }

  // A Start/Retake was clicked: the device check and demo come first, then
  // the face check (same pattern as Modules/Placement) gates the session start.
  if (pendingStart && preTestDoneFor !== pendingStart.key && selectedProduct) {
    return (
      <PreTestFlow
        kind={selectedProduct as PreTestKind}
        mode={pendingStart.mode}
        minutes={selectedType ? String(selectedType.durationMinutes) : null}
        onBack={() => setPendingStart(null)}
        onReady={() => setPreTestDoneFor(pendingStart.key)}
      />
    );
  }
  if (pendingStart) {
    if (faceEnrolled === null || faceEnrolled === false) return null; // enrollment redirect effect above handles the false case
    return (
      <FaceCheck
        mode="verify"
        purpose="practice_test"
        onBack={() => setPendingStart(null)}
        onComplete={() => {
          const start = pendingStart;
          setPendingStart(null);
          handleStartExam(start);
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
      <div className="flex flex-col gap-6 w-full">
      <div className="max-w-lg w-full mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
        <div className="h-14 w-14 rounded-full bg-navy text-lime flex items-center justify-center">
          <CheckCircle2 size={32} />
        </div>
        <h1 className="font-display font-bold text-2xl text-ink">{summary.deliveryMode === "mock" ? tr("Mock exam report") : t("practiceTests.scoreReport.title")}</h1>
        {timeRanOut && (
          <p className="text-sm text-warning -mt-2">
            {tr("This mock exam's time ran out while you were away, so it was finished with the answers you'd given. Questions you hadn't answered count as skipped.")}
          </p>
        )}
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
          {summary.scoreBand && (
            <div className="flex-1 max-w-40 flex flex-col items-center gap-1 bg-accent/10 rounded-card py-3">
              <span className="text-3xl font-display font-bold text-ink">
                {summary.scoreBand.from}-{summary.scoreBand.to}
              </span>
              <span className="text-xs text-muted uppercase tracking-wide">{tr("Estimated score")}</span>
            </div>
          )}
        </div>
        {summary.scoreBand && (
          <p className="text-xs text-muted -mt-2">
            {tr("The score range {{family}} publishes for level {{level}}. An estimate from this mock, not an official score.", {
              family: catalogue?.find((f) => f.id === selectedType?.familyId)?.name ?? "",
              level: summary.scoreBand.level,
            })}
          </p>
        )}
        {summary.pathCompare && Object.keys(summary.pathCompare).length > 0 ? (
          <SkillLevelCompare compare={summary.pathCompare} percents={summary.skillPercents} kind={summary.deliveryMode === "mock" ? "mock" : "practice"} />
        ) : summary.skillLevels && Object.keys(summary.skillLevels).length > 0 && (
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
      {/* The feedback report, right under the result: what was wrong or skipped, the right answers and why. */}
      {sessionId && (
        <div className="max-w-4xl w-full mx-auto flex flex-col gap-3">
          <h2 className="font-display font-bold text-xl text-ink">{tr("Your feedback report")}</h2>
          <FeedbackReportView load={() => getReport(sessionId)} upgradeLink={!!license?.individual} />
        </div>
      )}
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
        {isMock && (
          <div className="w-full flex flex-col gap-2 text-left text-sm text-ink bg-navy/10 border border-navy/20 rounded-input px-4 py-3">
            <span className="flex items-center gap-2 font-semibold">
              <Timer size={18} className="text-navy-deep shrink-0" /> {tr("How a mock exam runs")}
            </span>
            <ul className="list-disc pl-5 flex flex-col gap-1">
              <li>{tr("The test moves forward with the timer. There is no Skip and no Back, and spoken answers have no Next button.")}</li>
              <li>{tr("Each question has its own timer at the top right. When it reaches 0:00, your answer so far is handed in and the next question opens by itself.")}</li>
              <li>{tr("Spoken answers: press the microphone, speak, then press it again to stop. Stopping hands your answer in straight away.")}</li>
              <li>{tr("Typed or chosen answers: press Next when you're done, or the test moves on at 0:00.")}</li>
              <li>{tr("The clock keeps running if you leave the page. A question left unanswered counts as wrong.")}</li>
            </ul>
          </div>
        )}
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
          {isMock && (
            <p className="text-sm text-navy-deep mt-2 flex items-start gap-1.5 justify-center">
              <Timer size={15} className="shrink-0 mt-0.5" /> {tr("Timed: each question moves on by itself when its timer reaches 0:00.")}
            </p>
          )}
        </div>
        <Button onClick={() => setShowSectionIntro(false)} className="w-full">
          {t("practiceTests.overview.startSection", { label: currentPart.label })}
        </Button>
      </div>
    );
  }

  // --- Running session ---
  if (sessionId && current) {
    const canSubmit =
      current.inputMethod === "mic"
        ? !recording && !!audioBlobUrl
        : current.inputMethod === "mcq_group"
          ? parseGroupAnswer(answerText, getGroupQuestions(current).length).every((x) => x !== null)
          : answerText.trim() !== "";
    // Save and next needs an answer, except once the question's time has run
    // out with nothing given: then it moves on like Skip. A partly answered
    // group must be finished or skipped, so its answers aren't thrown away.
    const nothingGiven =
      !audioBlobUrl &&
      (current.inputMethod === "mcq_group"
        ? parseGroupAnswer(answerText, getGroupQuestions(current).length).every((x) => x === null)
        : answerText.trim() === "");
    const timeUpEmpty = nothingGiven && (isMock ? mockSecondsLeft : remainingSeconds) === 0;
    const progressPct = Math.round((index / items.length) * 100);
    const shownSeconds = isMock ? mockSecondsLeft : feedback ? null : remainingSeconds;
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-3">
        {overlay}
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          {currentPart ? (
            <div className="flex items-center gap-2.5">
              <span className="h-8 w-8 rounded-full bg-navy text-lime flex items-center justify-center text-sm font-bold shrink-0">
                {String.fromCharCode(65 + currentPartIndex)}
              </span>
              <div className="flex flex-col">
                <span className="font-display font-bold text-base text-ink leading-tight">{currentPart.label}</span>
                <span className="text-[11px] text-muted">
                  {tr("Section {{n}} of {{total}}", { n: currentPartIndex + 1, total: partBoundaries.length })}
                </span>
              </div>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill ${isMock ? "bg-navy text-white" : "bg-success/15 text-success"}`}>
              {isMock ? tr("Mock exam") : tr("Practice")}
            </span>
            <span className="text-sm font-semibold text-ink">{t("placementTest.progress", { current: index + 1, total: items.length })}</span>
          </div>
        </div>
        <p className="text-[11px] font-mono text-muted px-1 -mt-2">
          {[activeTestId ? `${tr("Test ID")} ${activeTestId}` : null, testCode ? `${tr("Attempt ID")} ${testCode}` : null].filter(Boolean).join(" · ")}
        </p>

        {/* Mock: every question says how it moves on, since there are no
            Skip/Next buttons for spoken answers. */}
        {isMock && (
          <div className="flex items-start gap-2 text-sm text-ink bg-navy/10 border border-navy/20 rounded-input px-4 py-2.5" role="note">
            <Timer size={16} className="text-navy-deep shrink-0 mt-0.5" />
            <span>
              {current.inputMethod === "mic"
                ? tr("Timed question, no Skip or Next: answer before the timer reaches 0:00. Your answer is handed in when you stop recording, or when the time runs out, and the next question opens by itself.")
                : tr("Timed question, no Skip: press Next when your answer is ready. When the timer reaches 0:00, your answer so far is handed in and the next question opens by itself.")}
            </span>
          </div>
        )}

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
                {shownSeconds !== null ? (
                  <span
                    title={isMock ? tr("Time left for this question") : tr("Suggested time")}
                    className={`flex items-center gap-1 text-xs font-mono font-bold px-2.5 py-1 rounded-pill border transition-colors ${
                      shownSeconds <= (isMock ? MOCK_WARNING_SECONDS : 5) ? "text-error border-error/30 bg-error/10" : "text-navy-deep border-navy/20 bg-navy/10"
                    }`}
                  >
                    {isMock ? <Timer size={16} /> : <Clock size={16} />}
                    {String(Math.floor(shownSeconds / 60)).padStart(1, "0")}:{String(shownSeconds % 60).padStart(2, "0")}
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

            <h2 className="font-display font-bold text-lg text-ink text-center leading-snug bg-paper-warm/70 border border-rule rounded-card px-4 py-3">
              {current.questionInstruction}
            </h2>

            {/* Practice feedback: the question stays visible, its answer locked. */}
            <div className={feedback ? "pointer-events-none flex flex-col gap-5" : "contents"} aria-disabled={!!feedback}>
            {needsAudioFirst ? (
              // Versant-style two-panel layout: a dark "You hear" box (audio
              // prompt, no text shown — revealing the transcript would give
              // the answer away, unlike Pearson's own public demo which
              // shows it for visitors) paired with a "You say" box holding
              // the actual answer control.
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="relative rounded-card bg-navy text-lime p-5 pt-8 flex flex-col items-center justify-center gap-2 min-h-[160px] overflow-hidden">
                  <span className="absolute top-3 left-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-lime/90">
                    <span className="h-5 w-5 rounded-full bg-lime/20 flex items-center justify-center text-[10px]">1</span>
                    {tr("Listen")} · {t("practiceTests.youHear")}
                  </span>
                  {hasPlayed && !playing && (
                    <span className="absolute top-3 right-4 flex items-center gap-1 text-[11px] font-semibold text-lime">
                      <CheckCircle2 size={13} /> {tr("Played")}
                    </span>
                  )}
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
                <div
                  className={`relative rounded-card border p-5 pt-9 flex flex-col items-center justify-center gap-2 min-h-[160px] overflow-hidden transition-colors ${
                    hasPlayed ? "bg-navy/10 border-navy/30" : "bg-paper-warm/60 border-rule"
                  }`}
                >
                  <span className="absolute top-3 left-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-deep">
                    <span className="h-5 w-5 rounded-full bg-navy/15 flex items-center justify-center text-[10px]">2</span>
                    {tr("Answer")} · {current.inputMethod === "mic" ? t("practiceTests.youSay") : tr("Your answer")}
                  </span>
                  {!hasPlayed && <p className="text-xs text-muted text-center">{tr("Play the question first, then answer here.")}</p>}
                  {hasPlayed && current.inputMethod === "mic" && !recording && !audioBlobUrl && (
                    <p className="text-xs text-navy-deep text-center">{tr("Press the microphone and answer in your own words.")}</p>
                  )}
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
                    className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 whitespace-pre-wrap leading-relaxed shadow-sm"
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
            </div>

            {feedback && <AnswerFeedback item={current} feedback={feedback} />}

            {error && <p className="text-sm text-error text-center">{error}</p>}
          </div>

          <div className="shrink-0 border-t border-rule px-8 py-4 flex items-center gap-3">
            {feedback ? (
              <Button onClick={() => finishOrAdvance()} className="flex-1">
                {index + 1 < items.length ? tr("Next question") : t("placementTest.finish")}
              </Button>
            ) : (
              <>
                {/* Mock exams are forward only. */}
                {!isMock && (
                  <Button variant="secondary" onClick={handleBack} disabled={index === 0 || submitting || recording} className="!px-3.5">
                    <ArrowLeft size={20} />
                  </Button>
                )}
                {/* Mock exams have no Skip: a question left unanswered when its
                    time runs out counts as unanswered, as in the real exam. */}
                {!isMock && (
                  <button
                    onClick={handleSkip}
                    disabled={submitting || recording}
                    className="text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed px-1"
                  >
                    {t("placementTest.skip")}
                  </button>
                )}
                {isMock && current.inputMethod === "mic" ? (
                  // Spoken answers in a mock: stopping the recording hands it in.
                  <p className="flex-1 text-center text-sm text-muted">
                    {submitting ? t("placementTest.submitting") : tr("Moves on by itself: stop recording to hand in your answer.")}
                  </p>
                ) : (
                  <Button
                    onClick={() => (canSubmit ? handleSubmit() : handleSkip())}
                    disabled={submitting || recording || (!canSubmit && !timeUpEmpty)}
                    className="flex-1"
                  >
                    {submitting
                      ? t("placementTest.submitting")
                      : index + 1 < items.length
                        ? isMock
                          ? t("placementTest.next")
                          : t("practiceTests.saveAndNext")
                        : t("placementTest.finish")}
                  </Button>
                )}
              </>
            )}
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
        minutes={selectedType ? String(selectedType.durationMinutes) : null}
        doneLabel={tr("Close the demo")}
        onDone={() => setShowDemo(false)}
      />
    );
  }

  // --- Exam (set) picker for the selected product ---
  if (selectedProduct) {
    const Icon = testTypeIcon(selectedProduct);
    const colour = testTypeColour(selectedProduct);
    return (
      <div className="w-full flex flex-col gap-6">
        <LearnerHero
          onBack={backToProducts}
          backLabel={t("practiceTests.backToProducts")}
          eyebrow={t("nav.practiceTests")}
          // The exam the test is modelled on, e.g. "Versant-style English 4-Skills Essentials Test".
          title={
            selectedType
              ? tr("{{family}}-style {{test}}", {
                  family: catalogue?.find((f) => f.id === selectedType.familyId)?.name ?? "",
                  test: testTypeName(selectedType, t),
                })
              : ""
          }
          subtitle={selectedType ? testTypeDescription(selectedType, t) : ""}
          icon={Icon}
          stats={
            isMockSection && selectedType
              ? [
                  { label: tr("Length"), value: tr("{{m}} min", { m: selectedType.durationMinutes }), icon: Clock },
                  { label: tr("Levels"), value: `${selectedType.cefrMin}-${selectedType.cefrMax}`, icon: Award },
                  {
                    label: tr("Mocks left this month"),
                    value: mocksLeft === null ? tr("No limit") : mocksLeft,
                    icon: Timer,
                  },
                ]
              : exams
              ? [
                  { label: tr("Sets"), value: exams.length, icon: ClipboardCheck },
                  { label: tr("Completed"), value: exams.filter((e) => e.completed).length, icon: CheckCircle2 },
                  { label: tr("Questions per set"), value: exams[0]?.itemCount ?? "—", icon: ListChecks },
                  { label: tr("Timing"), value: selectedType ? testTypeBadgeTime(selectedType) : "—", icon: Clock },
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

        {error && <p className="text-sm text-error">{error}</p>}

        {/* Mock exam: one per test type, built from questions the learner hasn't seen. */}
        {isMockSection && (
        <div className="relative overflow-hidden bg-navy text-white rounded-card p-6 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
          <span className="h-12 w-12 rounded-2xl bg-lime text-navy flex items-center justify-center shrink-0">
            <Timer size={24} />
          </span>
          <div className="flex-1 flex flex-col gap-1">
            <span className="font-display font-bold text-lg">{tr("Mock exam")}</span>
            <span className="text-sm text-white/80 leading-relaxed">
              {tr("Exam conditions: strict timing for each question, no going back, no answers until the end. Questions you haven't seen before. A full report with your estimated level at the end.")}
            </span>
          </div>
          {openMock && openMock.testTypeId && openMock.testTypeId !== selectedProduct ? (
            <span className="text-sm text-white/80 sm:max-w-56">{tr("You have another mock exam in progress. Finish it first.")}</span>
          ) : mocksLeft === 0 && openMock?.testTypeId !== selectedProduct ? (
            <span className="text-sm text-white/80 sm:max-w-64">
              {tr("You've used this month's mock exams. More on {{date}}.", { date: formatShortDate(quota!.resetsOn) })}
            </span>
          ) : (
            <Button
              onClick={() => {
                setPreTestDoneFor(null);
                setPendingStart({ key: `mock:${selectedProduct}`, mode: "mock", testTypeId: selectedProduct });
              }}
              className="shrink-0 !bg-lime !text-navy"
            >
              {openMock?.testTypeId === selectedProduct ? tr("Resume mock exam") : tr("Start mock exam")}
            </Button>
          )}
        </div>
        )}
        {isMockSection && quota && (
          <p className="text-sm text-muted">
            {quota.mocksPerMonth === null
              ? tr("Mock exams this month: {{used}} (no limit)", { used: quota.mocksUsed })
              : tr("Mock exams this month: {{used}} of {{limit}}", { used: Math.min(quota.mocksUsed, quota.mocksPerMonth), limit: quota.mocksPerMonth })}
          </p>
        )}

        {!isMockSection && (
        <>

        {!isMockSection && <SkillLevelsPanel />}

        <div className="flex flex-col gap-1 -mb-2">
          <div className="flex items-center gap-2">
            <BookOpenCheck size={18} className="text-accent shrink-0" />
            <h2 className="font-display font-bold text-base text-ink">{tr("Practice sets")}</h2>
            <span className="text-sm text-muted">{tr("Pause any time and go back. Your report at the end shows every answer with the right one.")}</span>
          </div>
          <span className="text-sm text-muted flex items-center gap-1.5 ml-[26px]">
            <Lock size={13} className="shrink-0" /> {tr("Sets open one at a time: complete a set, answering every question, to unlock the next.")}
          </span>
        </div>
        {practiceLeft === 0 && (
          <p className="text-sm text-muted -mt-2">
            {tr("You've used this month's practice tests. More on {{date}}. You can still finish a set you've started.", { date: formatShortDate(quota!.resetsOn) })}
          </p>
        )}

        {loadingExams ? (
          <p className="text-sm text-muted">{t("modules.starting")}</p>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {(exams ?? []).map((exam, i) => (
              <div
                key={exam.id}
                className="relative overflow-hidden flex flex-col gap-4 bg-surface border border-rule rounded-card p-6 pt-7 shadow-sm hover:shadow-md transition-shadow"
              >
                <span className={`absolute inset-x-0 top-0 h-1.5 ${colour}`} />
                <div className="flex items-start gap-4">
                  <span
                    className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 font-display font-bold text-lg ${
                      exam.completed ? "bg-success text-white" : exam.locked ? "bg-rule text-muted" : `${colour} text-white`
                    }`}
                  >
                    {exam.completed ? <CheckCircle2 size={22} /> : exam.locked ? <Lock size={20} /> : i + 1}
                  </span>
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <span className="font-display font-bold text-base text-ink">{exam.name || `Set ${i + 1}`}</span>
                    <span className="text-sm text-muted">
                      {t("practiceTests.questionsCount", { count: exam.itemCount })}
                      {exam.durationMinutes ? ` · ${tr("{{m}} min", { m: exam.durationMinutes })}` : ""}
                      {exam.shortForm ? ` · ${tr("short form")}` : ""}
                    </span>
                    <span className="self-start text-[11px] font-mono font-semibold text-ink bg-paper-warm border border-rule rounded-pill px-2 py-0.5">
                      {tr("Test ID")} {exam.testId}
                    </span>
                  </div>
                  {exam.completed && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success shrink-0">{t("practiceTests.completed")}</span>
                  )}
                </div>
                {exam.last && (
                  <div className="-mt-1 rounded-input bg-paper-warm/70 border border-rule px-3 py-2 flex items-center gap-3">
                    {exam.last.level || exam.last.percent !== null ? (
                      <>
                        <div className="flex flex-col items-center">
                          <span className="font-display font-bold text-lg text-ink leading-none">{exam.last.level ?? "—"}</span>
                          <span className="text-[10px] text-muted uppercase tracking-wide mt-0.5">{tr("Level")}</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="font-display font-bold text-lg text-ink leading-none">{exam.last.percent !== null ? `${Math.round(exam.last.percent)}%` : "—"}</span>
                          <span className="text-[10px] text-muted uppercase tracking-wide mt-0.5">{tr("Score")}</span>
                        </div>
                      </>
                    ) : null}
                    <div className="flex-1 min-w-0 text-[11px] text-muted leading-snug">
                      {exam.last.level || exam.last.percent !== null ? tr("Last taken {{date}}", { date: new Date(exam.last.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) }) : tr("Taken {{date}}, nothing answered to score", { date: new Date(exam.last.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) })}
                      {exam.last.attempts > 1 ? ` · ${tr("{{n}} attempts", { n: exam.last.attempts })}` : ""}
                    </div>
                    <button
                      onClick={() => navigate(ROUTES.TEST_REPORT.replace(":sessionId", exam.last!.sessionId))}
                      className="text-xs font-semibold text-navy-deep hover:underline cursor-pointer shrink-0"
                    >
                      {tr("Report")}
                    </button>
                  </div>
                )}
                {exam.inProgress && exam.progress && !exam.locked && (
                  <div className="flex flex-col gap-1.5 -mt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink">
                        {exam.progress.seen > 0
                          ? tr("You stopped at question {{n}} of {{total}}", { n: Math.min(exam.progress.seen + 1, exam.progress.total), total: exam.progress.total })
                          : tr("Not started yet · {{total}} questions", { total: exam.progress.total })}
                      </span>
                      <span className="text-muted">{tr("{{n}} of {{total}} answered", { n: exam.progress.answered, total: exam.progress.total })}</span>
                    </div>
                    <div className="h-2 rounded-pill bg-rule overflow-hidden">
                      <div className="h-full rounded-pill bg-navy transition-all" style={{ width: `${Math.round((exam.progress.seen / Math.max(1, exam.progress.total)) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {exam.finished && !exam.completed && !exam.inProgress && exams?.[i + 1]?.locked && (
                  <p className="text-xs text-warning -mt-1">{tr("Finished with questions skipped. Retake it and answer every question to unlock Set {{n}}.", { n: i + 2 })}</p>
                )}
                <Button
                  onClick={async () => {
                    const start: PendingStart = exam.source === "form" ? { key: exam.id, mode: "practice", formId: exam.id } : { key: exam.id, mode: "practice", examId: exam.id };
                    // Resume: a quick check on its own, then straight back to
                    // the question (no demo or face check again). The full
                    // checks show only if the quick check finds a problem.
                    if (exam.inProgress) {
                      setQuickChecking(true);
                      const problem = await quickDeviceCheck(deviceNeedsFor(selectedProduct ?? "").mic).catch(() => "internet" as const);
                      setQuickChecking(false);
                      if (!problem) return handleStartExam(start);
                    }
                    // A Start or Retake gets its full check.
                    setPreTestDoneFor(null);
                    setPendingStart(start);
                  }}
                  // At the monthly limit, only an unfinished set can be resumed;
                  // a locked set opens once the one before is finished.
                  disabled={(practiceLeft === 0 && !exam.inProgress) || !!exam.locked}
                  variant={exam.locked ? "secondary" : undefined}
                  className="w-full"
                >
                  {exam.locked ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Lock size={15} /> {tr("Complete Set {{n}} to unlock", { n: i })}
                    </span>
                  ) : exam.inProgress ? (
                    exam.progress && exam.progress.seen > 0 ? tr("Resume from question {{n}}", { n: Math.min(exam.progress.seen + 1, exam.progress.total) }) : tr("Resume")
                  ) : exam.completed || exam.finished ? (
                    t("practiceTests.retake")
                  ) : (
                    t("practiceTests.startExam")
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>
    );
  }

  // --- Product picker: one group per exam family ---
  // An organization that chose its tests shows only those: tests it didn't
  // turn on (and ones coming soon) are hidden, not greyed out.
  const restricted = !!allowedProducts || testTypes.some((tt) => !tt.allowed);
  const visibleType = (tt: (typeof testTypes)[number]) =>
    !restricted || (tt.status === "live" && tt.allowed && (!allowedProducts || allowedProducts.includes(tt.id)));
  const families = (catalogue ?? []).map((f) => ({ ...f, testTypes: f.testTypes.filter(visibleType) })).filter((f) => f.testTypes.length > 0);
  const live = testTypes.filter((tt) => tt.status === "live" && visibleType(tt));
  const lengths = live.map((tt) => tt.durationMinutes);
  const programCard = myProgram && (
    <ProgramCard
      mine={myProgram}
      testTypes={testTypes}
      onOpen={(id) => {
        const nextIsMock = myProgram.upcoming[0]?.kind === "mock";
        if (nextIsMock !== isMockSection) navigate(`${nextIsMock ? ROUTES.MOCK_EXAMS : ROUTES.PRACTICE_TESTS}?product=${encodeURIComponent(id)}`);
        else openProduct(id);
      }}
    />
  );
  const reportsLink = history.length > 0 && (
    <button onClick={() => navigate(ROUTES.MY_REPORTS)} className="self-start flex items-center gap-1.5 text-sm font-semibold text-navy-deep hover:underline cursor-pointer -mt-2">
      <FileText size={15} /> {tr("Your reports ({{n}})", { n: history.length })}
    </button>
  );
  if (isMockSection) {
    return (
      <div className="w-full flex flex-col gap-6">
        <MockExamList
          families={families}
          quota={quota}
          history={history}
          openMock={openMock}
          onStart={async (id) => {
            openProduct(id);
            const key = `mock:${id}`;
            // Resuming the open mock: a quick check on its own replaces the
            // device check and demo; the identity check still runs.
            if (openMock?.testTypeId === id) {
              setQuickChecking(true);
              const problem = await quickDeviceCheck(deviceNeedsFor(id).mic).catch(() => "internet" as const);
              setQuickChecking(false);
              setPreTestDoneFor(problem ? null : key);
            } else {
              setPreTestDoneFor(null);
            }
            setPendingStart({ key, mode: "mock", testTypeId: id });
          }}
        />
        {programCard}
        {reportsLink}
      </div>
    );
  }
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("Practice at your own pace")}
        title={t("nav.practiceTests")}
        subtitle={tr("Full practice tests in the style of the major English exams: pause, go back, and get a report with every right answer at the end.")}
        icon={ClipboardCheck}
        stats={[
          { label: tr("Exam types"), value: live.length, icon: Layers },
          { label: tr("Full sets to take"), value: live.reduce((n, tt) => n + tt.setCount, 0), icon: ListChecks },
          {
            label: tr("Length"),
            value: lengths.length ? tr("{{from}}-{{to}} min", { from: Math.min(...lengths), to: Math.max(...lengths) }) : "—",
            icon: Clock,
          },
          { label: tr("Scored by section"), value: tr("Instant"), icon: Award },
        ]}
      />

      {programCard}

      <SkillLevelsPanel />

      {quota && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted -mt-2">
          <span>
            {quota.practicePerMonth === null
              ? tr("Practice tests this month: {{used}} (no limit)", { used: quota.practiceUsed })
              : tr("Practice tests this month: {{used}} of {{limit}}", { used: Math.min(quota.practiceUsed, quota.practicePerMonth), limit: quota.practicePerMonth })}
          </span>
          <span>
            {quota.mocksPerMonth === null
              ? tr("Mock exams this month: {{used}} (no limit)", { used: quota.mocksUsed })
              : tr("Mock exams this month: {{used}} of {{limit}}", { used: Math.min(quota.mocksUsed, quota.mocksPerMonth), limit: quota.mocksPerMonth })}
          </span>
          {(quota.practicePerMonth !== null || quota.mocksPerMonth !== null) && (
            <span className="text-xs">{tr("Resets on {{date}}", { date: formatShortDate(quota.resetsOn) })}</span>
          )}
        </div>
      )}

      {reportsLink}

      {families.map((family) => (
        <section key={family.id} className="flex flex-col gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-ink">{familyHeading(family)}</h2>
            <p className="text-xs text-muted">{familyNote(family)}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {family.testTypes.map((tt) => {
              const Icon = testTypeIcon(tt.id);
              const comingSoon = tt.status !== "live";
              // Coming soon (only shown when the organization didn't restrict its tests).
              const enabled = !comingSoon && tt.allowed && (!allowedProducts || allowedProducts.includes(tt.id));
              return (
                <button
                  key={tt.id}
                  onClick={() => enabled && openProduct(tt.id)}
                  disabled={!enabled}
                  className={`group relative text-left bg-surface border border-rule rounded-card p-6 flex flex-col gap-4 overflow-hidden transition-all ${
                    enabled
                      ? "cursor-pointer hover:border-rule-strong hover:shadow-[0_16px_32px_-16px_rgba(0,0,0,0.3)] hover:-translate-y-1"
                      : "opacity-55 cursor-not-allowed"
                  }`}
                >
                  {!enabled && (
                    <span className="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-2 py-1 rounded-pill">
                      {comingSoon ? tr("Coming soon") : t("practiceTests.notEnabled")}
                    </span>
                  )}
                  {/* Oversized, very faint echo of the card's own icon: a
                      decorative watermark, not another color block. */}
                  <Icon
                    size={140}
                    strokeWidth={1.5}
                    className="absolute -right-6 -bottom-6 text-ink/[0.04] group-hover:text-ink/[0.07] transition-colors pointer-events-none"
                  />
                  <span
                    className={`relative h-16 w-16 rounded-2xl flex items-center justify-center text-white shadow-md transition-transform group-hover:scale-110 ${testTypeColour(tt.id)}`}
                  >
                    <Icon size={28} strokeWidth={2} />
                  </span>
                  <div className="relative flex flex-col gap-1.5">
                    <span className="font-display font-bold text-lg text-ink leading-snug">{testTypeName(tt, t)}</span>
                    <span className="text-sm text-muted leading-relaxed">{testTypeDescription(tt, t)}</span>
                  </div>
                  <div className="relative flex items-center gap-2 mt-auto">
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-2.5 py-1 rounded-pill">
                      <Clock size={11} /> {testTypeBadgeTime(tt)}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-paper-warm px-2.5 py-1 rounded-pill">
                      {tt.cefrMin}-{tt.cefrMax}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-xs font-bold text-ink transition-transform group-hover:translate-x-1">
                      <ChevronRight size={16} strokeWidth={2.5} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// The learner's program: target level and date, latest level, and the next
// planned test.
function ProgramCard({ mine, testTypes, onOpen }: { mine: MyProgram; testTypes: CatalogueTestType[]; onOpen: (testTypeId: string) => void }) {
  const { t } = useTranslation();
  const p = mine.program;
  const tt = testTypes.find((x) => x.id === p.testTypeId);
  const next = mine.upcoming[0];
  return (
    <div className="bg-surface border border-rule rounded-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm">
      <span className="h-12 w-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
        <Target size={24} />
      </span>
      <div className="flex-1 flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Your program")}</span>
        <span className="font-display font-bold text-lg text-ink">{p.name}</span>
        <span className="text-sm text-muted">
          {tt ? testTypeName(tt, t) : p.testTypeId} · {tr("Target {{level}} by {{date}}", { level: p.targetLevel, date: formatShortDate(p.targetDate) })}
          {mine.latestLevel ? ` · ${tr("Your latest level: {{level}}", { level: mine.latestLevel })}` : ""}
        </span>
        <span className="text-xs text-muted">
          {tr("{{done}} done, {{missed}} missed", { done: mine.done, missed: mine.missed })}
          {next
            ? ` · ${next.kind === "mock" ? tr("Next: mock exam on {{date}}", { date: formatShortDate(next.dueOn) }) : tr("Next: practice test on {{date}}", { date: formatShortDate(next.dueOn) })}`
            : ""}
        </span>
      </div>
      {tt && tt.status === "live" && (
        <Button onClick={() => onOpen(p.testTypeId)} className="shrink-0">
          {tr("Open the test")}
        </Button>
      )}
    </div>
  );
}
