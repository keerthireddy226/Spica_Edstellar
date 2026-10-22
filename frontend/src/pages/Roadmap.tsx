import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, ShieldAlert } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { MotivationalBar } from "@/components/MotivationalBar";
import { getJourney, getRoadmap, type Journey, type RoadmapData } from "@/api/roadmap";
import { Checkpoints, JourneyHero, PathToGoal, SkillProgress, ThisWeek } from "@/components/journey/JourneyParts";
import { NextStepCard } from "@/components/learner/GoalCards";
import { GroupBoardCard } from "@/components/learner/GroupBoardCard";
import { FinalAssessmentCard } from "@/components/learner/FinalAssessmentCard";
import { ApiError } from "@/lib/api";
import { PageError, PageLoading } from "@/components/learner/PageStates";
import { WORD_BANK, IDIOM_BANK, WORD_CHALLENGES } from "@/data/dailyContent";

// "My journey" (the Roadmap page): progress to the goal, the levels still to
// reach, this week's tasks and the checkpoints up to the exam, plus the
// daily vocabulary challenge.
function WordOfDayTab() {
  const { t } = useTranslation();
  const [entry] = useState(() => WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)]);
  const [revealed, setRevealed] = useState(false);

  return (
    <button onClick={() => setRevealed((v) => !v)} className="text-left w-full cursor-pointer">
      <p className="text-xs text-muted mb-3">{t("dailyChallenge.wordOfDay", { action: t(revealed ? "dailyChallenge.hide" : "dailyChallenge.reveal") })}</p>
      <div className="font-display font-bold text-2xl text-ink mb-1">{entry.word}</div>
      {!revealed ? (
        <div className="text-xs text-muted italic">
          {entry.partOfSpeech} &middot; {entry.phonetic}
        </div>
      ) : (
        <>
          <p className="text-sm text-ink leading-relaxed">{t(entry.definitionKey)}</p>
          <p className="text-xs italic px-4 py-3 rounded-xl bg-paper text-muted mt-2">&ldquo;{entry.example}&rdquo;</p>
        </>
      )}
    </button>
  );
}

function IdiomTab() {
  const { t } = useTranslation();
  const [entry] = useState(() => IDIOM_BANK[Math.floor(Math.random() * IDIOM_BANK.length)]);
  return (
    <div>
      <p className="text-xs text-muted mb-3">{t("dailyChallenge.idiomOfDay")}</p>
      <div className="font-display font-bold text-lg text-ink mb-1">{entry.phrase}</div>
      <p className="text-sm text-muted">{t(entry.meaningKey)}</p>
    </div>
  );
}

function MeaningChallengeTab() {
  const { t } = useTranslation();
  const [challenge] = useState(() => WORD_CHALLENGES[Math.floor(Math.random() * WORD_CHALLENGES.length)]);
  const [picked, setPicked] = useState<number | null>(null);
  const isCorrectPick = picked !== null && picked === challenge.correctIndex;

  return (
    <div>
      <p className="text-xs text-muted mb-3">{t("dailyChallenge.pickClosestMeaning")}</p>
      <div className="font-display font-bold text-xl text-ink mb-3">{challenge.word}</div>
      <div className="grid grid-cols-2 gap-2">
        {challenge.options.map((option, i) => {
          const isPicked = picked === i;
          const showResult = picked !== null;
          const isCorrect = i === challenge.correctIndex;
          return (
            <button
              key={i}
              disabled={showResult}
              onClick={() => setPicked(i)}
              className={`text-center rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                showResult && isCorrect
                  ? "border-success bg-success/10 text-ink"
                  : showResult && isPicked
                    ? "border-error bg-error/10 text-ink"
                    : "border-rule hover:border-rule-strong cursor-pointer"
              } ${showResult ? "cursor-default" : ""}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className={`text-xs font-semibold mt-3 ${isCorrectPick ? "text-success" : "text-error"}`}>
          {isCorrectPick ? t("dailyChallenge.correctFeedback") : t("dailyChallenge.incorrectFeedback", { answer: challenge.options[challenge.correctIndex] })}
        </p>
      )}
    </div>
  );
}

function DailyChallenge() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"word" | "idiom" | "meaning">("word");
  return (
    <div className="relative overflow-hidden bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
      <span className="absolute inset-x-0 top-0 h-1.5" style={{ background: "linear-gradient(90deg, var(--color-navy), #c9965c, var(--color-success))" }} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.18em] text-muted mb-1">{t("dailyChallenge.title")}</div>
          <h3 className="font-display font-bold text-lg text-ink">{t("dailyChallenge.subtitle")}</h3>
        </div>
        <div className="flex gap-1 p-1 rounded-pill bg-paper">
          {(["word", "idiom", "meaning"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors cursor-pointer ${
                tab === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {t(id === "word" ? "dailyChallenge.wordTab" : id === "idiom" ? "dailyChallenge.idiomTab" : "dailyChallenge.meaningTab")}
            </button>
          ))}
        </div>
      </div>
      {tab === "word" ? <WordOfDayTab /> : tab === "idiom" ? <IdiomTab /> : <MeaningChallengeTab />}
    </div>
  );
}

function CoachModePromo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="rounded-card p-7 flex flex-col sm:flex-row items-center gap-6 border border-writing/25 shadow-sm bg-gradient-to-r from-writing/20 via-writing/8 to-surface">
      <div className="w-16 h-16 shrink-0 mascot-breathe">
        <Mascot variant="coach" size={64} />
      </div>
      <div className="flex-1 text-center sm:text-left">
        <span className="inline-block font-mono text-[10px] uppercase tracking-widest bg-surface text-navy px-2.5 py-1 rounded-pill mb-2">
          {t("coachPromo.badge")}
        </span>
        <h3 className="font-display font-bold text-lg text-ink mb-1">{t("coachPromo.title")}</h3>
        <p className="text-sm text-ink/70">{t("coachPromo.body")}</p>
      </div>
      <Button onClick={() => navigate(ROUTES.TUTOR)} className="shrink-0">
        {t("coachPromo.cta")}
      </Button>
    </div>
  );
}

export function Roadmap() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState<RoadmapData | null>(null);
  const [journeyData, setJourney] = useState<Journey | null>(null);
  const [notReady, setNotReady] = useState<{ scheduledFor: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getRoadmap(), getJourney()])
      .then(([r, j]) => {
        setData(r);
        setJourney(j);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.message === "no_placement_yet" || err.message === "no_roadmap_yet")) {
          const body = err.body as { assessmentScheduledFor?: string | null };
          setNotReady({ scheduledFor: body.assessmentScheduledFor ?? null });
        } else {
          setError(t("roadmap.loadError"));
        }
      })
      .finally(() => setLoading(false));
  }, [t, attempt]);

  if (loading) return <PageLoading label={t("roadmap.loading")} />;
  if (error) return <PageError message={error} onRetry={() => setAttempt((n) => n + 1)} />;

  if (notReady || !data || !journeyData) {
    return (
      <div className="flex flex-col items-center text-center gap-4 bg-surface border border-rule rounded-card p-10 max-w-lg mx-auto mt-10">
        <span className="h-14 w-14 rounded-full bg-paper-warm border-2 border-navy flex items-center justify-center">
          <ClipboardCheck size={32} strokeWidth={1.8} className="text-navy" />
        </span>
        <h2 className="font-display font-bold text-xl text-ink">{t("roadmap.notReadyTitle")}</h2>
        <p className="text-sm text-muted max-w-sm">
          {notReady?.scheduledFor
            ? t("roadmap.notReadyBodyScheduled", { date: new Date(notReady.scheduledFor).toLocaleDateString() })
            : t("roadmap.notReadyBody")}
        </p>
        <Button onClick={() => navigate(ROUTES.PLACEMENT)}>{t("roadmap.takeTestNow")}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 w-full">
      {data.placement.reviewStatus === "pending_review" && (
        <div className="flex items-center gap-2.5 bg-warning/15 border border-warning/40 rounded-card px-4 py-3 text-sm text-ink">
          <ShieldAlert size={18} className="text-warning shrink-0" />
          {t("roadmap.pendingReviewBanner")}
        </div>
      )}

      <JourneyHero j={journeyData} firstName={data.firstName ?? ""} />

      <NextStepCard />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 flex flex-col gap-5 min-w-0">
          <PathToGoal j={journeyData} />
        </div>
        <div className="lg:col-span-2 flex flex-col gap-5 min-w-0">
          <ThisWeek j={journeyData} />
          <FinalAssessmentCard compact />
        </div>
      </div>

      <Checkpoints j={journeyData} />

      {/* Without a group board (individual learners), the skills take the full width. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start lg:[&>*:only-child]:col-span-2">
        <SkillProgress j={journeyData} />
        <GroupBoardCard />
      </div>

      <MotivationalBar />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        <DailyChallenge />
        <CoachModePromo />
      </div>
    </div>
  );
}
