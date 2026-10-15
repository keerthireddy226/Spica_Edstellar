import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Volume2, CheckCircle2, Clock, X } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import {
  startSession,
  getCurrentSession,
  submitAttempt,
  completeSession,
  type TestItem,
  type SessionSummary,
} from "@/api/testSession";
import { useVoiceRecorder, blobToBase64 } from "@/hooks/useVoiceRecorder";
import { usePeriodicFaceCheck } from "@/hooks/usePeriodicFaceCheck";
import { useProctoring } from "@/hooks/useProctoring";
import { useAuth } from "@/hooks/useAuth";
import { CandidateFinished } from "@/components/recruitment/CandidateShell";
import { TestIdTag } from "@/components/TestIdTag";
import { ProctoringGate } from "@/components/proctoring/ProctoringGate";
import { ProctoringOverlay } from "@/components/proctoring/ProctoringOverlay";
import { FaceCheck } from "@/components/FaceCheck";
import { playSpokenAudio } from "@/lib/playSpokenAudio";
import { AnswerInputControl } from "@/components/AnswerInputControl";
import {
  AUDIO_FIRST_TYPES,
  SKILL_BADGE_CLASS,
  ITEM_TYPE_META,
  getSpokenSegments,
  getVisibleText,
  getPassageAndQuestion,
} from "@/lib/testItemDisplay";

import { tr } from "@/i18n/tr";
// Matches backend ITEMS_PER_TYPE sum — for the progress bar only.
const TOTAL_QUESTIONS = 20;

export function PlacementTest() {
  const isCandidate = useAuth().user?.role === "candidate";
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { recording, start: startRecording, stop: stopRecording } = useVoiceRecorder();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [testCode, setTestCode] = useState<string | null>(null);
  // Real time spent on the current question — reset whenever a question
  // first appears (session load/resume, or the next adaptive item), read at
  // submit/skip time. Counts only while actually on a question.
  const questionShownAtRef = useRef(Date.now());
  // Adaptive: this only ever grows by one at a time, appended from each
  // attempt response's `nextItem` — there's no pre-loaded fixed list, and
  // no going back to change an earlier answer (that would invalidate every
  // adaptive choice made after it).
  const [items, setItems] = useState<TestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [hasPlayed, setHasPlayed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingAudio, setPendingAudio] = useState<{ base64: string; mimeType: string } | null>(null);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null);
  const [recordingDurationMs, setRecordingDurationMs] = useState<number | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  // Whether this page load is resuming a session that was already started.
  const [alreadyInProgress, setAlreadyInProgress] = useState<boolean | null>(null);
  // Resuming an in-progress session skips the gate — nobody new could take
  // over mid-test just by reloading the page.
  const [faceChecked, setFaceChecked] = useState(false);
  // Set by a mid-test spoof detection — re-shows the same gate, not a new screen.
  const [requireReverify, setRequireReverify] = useState(false);

  // First time a given item type appears this session, gate it behind a
  // brief "how this task works" card instead of diving straight in.
  const seenTypesRef = useRef(new Set<string>());
  const [showTypeIntro, setShowTypeIntro] = useState(false);

  useEffect(() => {
    getCurrentSession()
      .then((res) => setAlreadyInProgress(res.inProgress))
      .catch(() => setAlreadyInProgress(false));
  }, []);

  const readyToLoadSession = alreadyInProgress === true || faceChecked;
  // Stops once the score report shows — nothing left to verify identity
  // against after the test is already complete.
  usePeriodicFaceCheck(readyToLoadSession && !summary && !requireReverify, "placement", sessionId, () => setRequireReverify(true));
  const proctor = useProctoring(sessionId, Boolean(sessionId) && !summary);

  useEffect(() => {
    if (alreadyInProgress === null || !readyToLoadSession) return;
    startSession()
      .then((res) => {
        setSessionId(res.sessionId);
        setTestCode(res.testCode ?? null);
        setItems(res.items);
        questionShownAtRef.current = Date.now();
        // A resumed session's history already includes every previously
        // answered item — those types have already been introduced.
        res.items.forEach((item) => {
          if (item.attempted) seenTypesRef.current.add(item.itemTypeId);
        });
        const latest = res.items[res.items.length - 1];
        if (latest && !seenTypesRef.current.has(latest.itemTypeId)) {
          seenTypesRef.current.add(latest.itemTypeId);
          setShowTypeIntro(true);
        }
      })
      .catch(() => setError(t("placementTest.loadError")))
      .finally(() => setLoading(false));
  }, [t, alreadyInProgress, readyToLoadSession]);

  const current = items[items.length - 1];
  const needsAudioFirst = current ? AUDIO_FIRST_TYPES.has(current.itemTypeId) : false;
  const visibleText = useMemo(() => (current && !needsAudioFirst ? getVisibleText(current) : ""), [current, needsAudioFirst]);
  const meta = current ? ITEM_TYPE_META[current.itemTypeId] : undefined;

  // Reset the answer inputs whenever a new question arrives.
  useEffect(() => {
    setAnswerText("");
    setPendingAudio(null);
    setAudioBlobUrl(null);
    setRecordingDurationMs(null);
    setHasPlayed(false);
    setError(null);
  }, [current?.id]);

  // Live countdown, display-only — purely a visual sense of urgency, it
  // doesn't gate or auto-submit anything (submission is still driven by
  // canSubmit/handleSubmit below).
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
  }, [current?.id, current?.timerSeconds]);

  function handleExit() {
    if (window.confirm(t("placementTest.exitConfirm"))) {
      navigate(ROUTES.DASHBOARD);
    }
  }

  async function handlePlay() {
    if (!current) return;
    setPlaying(true);
    await playSpokenAudio(current, getSpokenSegments(current));
    setPlaying(false);
    setHasPlayed(true);
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

  // Shared by both Submit and Skip once an attempt has been recorded: append
  // whatever question comes next, or finish if the engine says there's
  // nothing left to ask.
  async function advanceOrFinish(nextItem: TestItem | null) {
    if (nextItem) {
      setItems((prev) => [...prev, nextItem]);
      questionShownAtRef.current = Date.now();
      if (!seenTypesRef.current.has(nextItem.itemTypeId)) {
        seenTypesRef.current.add(nextItem.itemTypeId);
        setShowTypeIntro(true);
      } else {
        setShowTypeIntro(false);
      }
      return;
    }
    const result = await completeSession(sessionId!);
    setSummary(result);
  }

  async function handleSubmit() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitAttempt(sessionId, {
        itemId: current.id,
        responseText: answerText.trim() || undefined,
        audioBase64: pendingAudio?.base64,
        audioMimeType: pendingAudio?.mimeType,
        durationMs: recordingDurationMs ?? undefined,
        activeMs: Date.now() - questionShownAtRef.current,
      });
      await advanceOrFinish(result.nextItem);
    } catch {
      setError(t("placementTest.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!current || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitAttempt(sessionId, { itemId: current.id, activeMs: Date.now() - questionShownAtRef.current });
      await advanceOrFinish(result.nextItem);
    } catch {
      setError(t("placementTest.submitError"));
    } finally {
      setSubmitting(false);
    }
  }

  // Waiting on the in-progress-session peek.
  if (alreadyInProgress === null) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted">{t("placementTest.loading")}</p>
      </div>
    );
  }

  if (!readyToLoadSession || requireReverify) {
    return (
      <FaceCheck
        mode="verify"
        purpose="placement"
        onComplete={() => {
          setFaceChecked(true);
          setRequireReverify(false);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-muted">{t("placementTest.loading")}</p>
      </div>
    );
  }

  // A candidate's result goes to the recruiter, not to a score screen.
  if (summary && isCandidate) return <CandidateFinished />;

  if (summary) {
    if (!summary.cefrLevel || !summary.skillPercents) {
      // Nothing could be scored at all (e.g. the item bank is fully
      // open-ended right now) — no level to show, just the raw tally.
      return (
        <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-4 items-center text-center">
            <h1 className="font-display font-bold text-2xl text-ink">{t("placementTest.resultsTitle")}</h1>
            {(summary.testCode ?? testCode) && <TestIdTag code={(summary.testCode ?? testCode)!} />}
            <p className="text-sm text-muted">
              {t("placementTest.resultsSummary", {
                correct: summary.correctCount,
                graded: summary.gradedCount,
                pending: summary.pendingCount,
              })}
            </p>
            {summary.failedCount > 0 && (
              <p className="text-sm text-error">{t("placementTest.failedNote", { failed: summary.failedCount })}</p>
            )}
            <Button onClick={() => navigate(ROUTES.DASHBOARD)}>{t("placementTest.done")}</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
          <div className="h-14 w-14 rounded-full bg-navy text-lime flex items-center justify-center">
            <CheckCircle2 size={32} />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl text-ink">
              {t("placementTest.yourLevel", { level: summary.cefrLevel })}
            </h1>
            {(summary.testCode ?? testCode) && <TestIdTag code={(summary.testCode ?? testCode)!} className="mt-2" />}
            <p className="text-xs text-muted mt-2">{t("placementTest.levelDisclaimer")}</p>
            {summary.cefrCappedByGap && (
              <p className="text-xs text-muted mt-1 italic">{t("placementTest.gapCappedNote")}</p>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2.5 w-full">
            {(Object.entries(summary.skillPercents) as [string, number | null][]).map(([skill, pct]) => {
              const entry = summary.skillLevels?.[skill as keyof typeof summary.skillLevels];
              return (
                <div key={skill} className="bg-paper-warm rounded-input p-3">
                  <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted mb-1.5">
                    {t(`skills.${skill}`)}
                  </div>
                  {pct === null ? (
                    <div className="text-xs text-muted italic">{t("placementTest.notEnoughAnswered")}</div>
                  ) : (
                    <>
                      {entry?.level && <div className="font-display font-bold text-lg text-ink">{entry.level}</div>}
                      {entry?.cappedByGap ? (
                        <div className="text-[10px] text-muted mt-0.5 italic leading-snug">
                          {t("placementTest.gapCappedNote")}
                        </div>
                      ) : (
                        <div className="text-xs text-muted mt-0.5">{pct}%</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {summary.pendingCount > 0 && (
            <p className="text-xs text-muted">{t("placementTest.pendingNote", { pending: summary.pendingCount })}</p>
          )}
          {summary.failedCount > 0 && (
            <p className="text-xs text-error">{t("placementTest.failedNote", { failed: summary.failedCount })}</p>
          )}

          <Button onClick={() => navigate(ROUTES.ROADMAP)} className="w-full">
            {t("placementTest.goToRoadmap")}
          </Button>
        </div>
      </div>
    );
  }

  if (error && !current) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (!current) return null;

  // Proctoring steps (consent, ID, room scan, voice sample) come before the test.
  if (sessionId && !proctor.ready) {
    if (proctor.loading || !proctor.setup) return null;
    return (
      <div className="app-surface min-h-screen px-4 py-10">
        <ProctoringGate proctor={proctor} sessionId={sessionId} />
      </div>
    );
  }
  // The proctor ended the test: finish it so the result (held for review) shows.
  const finishTerminated = () => {
    if (!sessionId) return;
    completeSession(sessionId)
      .then(setSummary)
      .catch(() => setError(t("placementTest.submitError")));
  };
  const overlay = <ProctoringOverlay proctor={proctor} onFinish={finishTerminated} />;

  if (showTypeIntro) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
        {overlay}
        <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5 items-center text-center">
          <div className="h-14 w-14 rounded-full bg-navy flex items-center justify-center">
            <Volume2 size={24} className="text-lime" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-ink">{meta?.name}</h1>
            <p className="text-sm text-muted mt-2 leading-relaxed">{current.instructionText}</p>
          </div>
          <Button onClick={() => setShowTypeIntro(false)} className="w-full">
            {t("placementTest.typeIntroStart")}
          </Button>
        </div>
      </div>
    );
  }

  // A mic answer is submittable once there's a saved recording, whether or
  // not live transcription (or manual typing) produced any text — an empty
  // transcript just falls through to pending/manual review server-side
  // (grading.ts), rather than blocking submission entirely.
  const canSubmit = current.inputMethod === "mic" ? !recording && !!audioBlobUrl : answerText.trim() !== "";
  const questionNumber = items.length;
  const progressPct = Math.round(((questionNumber - 1) / TOTAL_QUESTIONS) * 100);

  const urgentTimer = remainingSeconds !== null && remainingSeconds <= 5;

  return (
    <div className="fixed inset-0 bg-paper flex flex-col">
      {overlay}
      <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: `var(--color-${current.skills[0]})` }} />

      <div className="relative flex items-center justify-between gap-3 px-5 py-3 shrink-0">
        <div className="flex items-center">
          {remainingSeconds !== null && (
            <span
              className={`flex items-center gap-1.5 text-sm font-mono font-bold rounded-pill px-3 py-1 border transition-colors ${
                urgentTimer ? "text-error border-error/30 bg-error/10" : "text-navy-deep border-navy/20 bg-navy/10"
              }`}
            >
              <Clock size={14} />
              {String(Math.floor(remainingSeconds / 60)).padStart(1, "0")}:{String(remainingSeconds % 60).padStart(2, "0")}
            </span>
          )}
        </div>

        <span className="absolute left-1/2 -translate-x-1/2 font-logo tracking-tight flex items-baseline gap-1.5">
          <span className="font-bold text-base text-logo-primary">{tr("Spica")}</span>
          <span className="italic text-xs text-logo-accent">{tr("by Edstellar")}</span>
        </span>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted">
            {testCode && <span className="hidden sm:inline mr-3">{tr("Test ID")} {testCode}</span>}
            {t("placementTest.progress", { current: questionNumber, total: TOTAL_QUESTIONS })}
          </span>
          <button
            onClick={handleExit}
            aria-label={tr("Exit test")}
            className="h-7 w-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-paper-warm transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="h-1 bg-paper-warm shrink-0 overflow-hidden">
        <div className="h-full bg-navy transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Fixed (not max-) height — the same for every question, regardless
          of content — so the Skip/Next bar below it always lands on the
          exact same pixel position. Content is centered inside this fixed
          box rather than pinned to its top, so a short question doesn't
          read as a big dead gap — the leftover space splits above and
          below it instead of collecting in one place. Only a genuinely
          long passage scrolls, via the overflow-y-auto here. */}
      <div
        className="overflow-y-auto flex flex-col items-center justify-center px-5 py-6"
        style={{ height: "calc(100vh - 220px)" }}
      >
        <div className="w-full max-w-md flex flex-col gap-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-1.5">
              {current.skills.map((skill) => (
                <span
                  key={skill}
                  className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill border ${SKILL_BADGE_CLASS[skill]}`}
                >
                  {t(`skills.${skill}`)}
                </span>
              ))}
            </div>
            <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-muted font-semibold">{meta?.name}</span>
            <h1 className="font-display font-bold text-lg sm:text-xl text-ink leading-snug">
              {current.questionInstruction}
            </h1>
          </div>

          <div className="flex flex-col gap-4">
            {needsAudioFirst ? (
              <div className="flex justify-center">
                <button
                  onClick={handlePlay}
                  disabled={playing || recording}
                  className="h-14 w-14 rounded-full bg-navy text-lime btn-shine flex items-center justify-center shadow-[0_8px_18px_-8px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Volume2 size={22} />
                </button>
              </div>
            ) : getPassageAndQuestion(current) ? (
              <div className="flex flex-col gap-2.5">
                <p
                  className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 whitespace-pre-wrap leading-relaxed shadow-sm"
                  style={{ borderLeftColor: `var(--color-${current.skills[0]})` }}
                >
                  {getPassageAndQuestion(current)!.passage}
                </p>
                <p className="text-sm font-semibold text-ink px-1">{getPassageAndQuestion(current)!.question}</p>
              </div>
            ) : (
              <p
                className="text-sm text-ink bg-paper-warm rounded-card border-l-4 p-4 leading-relaxed shadow-sm"
                style={{ borderLeftColor: `var(--color-${current.skills[0]})` }}
              >
                {visibleText}
              </p>
            )}

            {needsAudioFirst && (
              <p className="text-xs text-muted text-center -mt-1">
                {playing ? t("placementTest.playing") : hasPlayed ? t("placementTest.playAgain") : t("placementTest.play")}
              </p>
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
            />

            {error && <p className="text-sm text-error text-center">{error}</p>}
          </div>
        </div>
      </div>

      {/* Its own fixed-height bar, outside the content box above — since
          that box is now a constant height for every question, this footer
          always sits at the same place on screen too. */}
      <div className="shrink-0 border-t border-rule bg-surface px-5 py-3">
        <div className="max-w-md mx-auto flex items-center justify-center">
          <button
            onClick={handleSkip}
            disabled={submitting || recording}
            className="text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px] px-6 py-2 text-center"
          >
            {t("placementTest.skip")}
          </button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="min-w-[220px]">
            {submitting ? t("placementTest.submitting") : t("placementTest.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
