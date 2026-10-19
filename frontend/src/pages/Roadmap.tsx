import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ClipboardCheck,
  Flag,
  Check,
  Target,
  Compass,
  Headphones,
  Mic,
  BookOpen,
  PenLine,
  Clock,
  ListChecks,
  ArrowRight,
  ShieldAlert,
  Flame,
  Award,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { MotivationalBar } from "@/components/MotivationalBar";
import { StatCard } from "@/components/staff/StaffKit";
import { LearnerCard, SKILL_COLOR } from "@/components/learner/LearnerHero";
import { getRoadmap, type RoadmapData, type RoadmapMilestone } from "@/api/roadmap";
import { tr } from "@/i18n/tr";
import { getDashboard, getDailyProgress } from "@/api/dashboard";
import { meetsGoal, percentToCefr } from "@/lib/cefr";
import { ApiError } from "@/lib/api";
import { ProgressRing } from "@/components/ProgressRing";
import { SKILL_RING_COLOR, SKILL_TINT_CLASSES } from "@/lib/skillTints";
import { WORD_BANK, IDIOM_BANK, WORD_CHALLENGES } from "@/data/dailyContent";
import type { SkillTag, CefrLevel } from "@/api/testSession";

const SKILL_ICONS: Record<SkillTag, typeof Headphones> = {
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  writing: PenLine,
};

function daysUntil(isoDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const LADDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function Hero({
  firstName,
  currentLevel,
  goalLevel,
  daysAccessLeft,
  daysToExam,
  progressPercent,
  goalMet,
}: {
  firstName: string;
  currentLevel: string;
  goalLevel: string;
  daysAccessLeft: number | null;
  daysToExam: number | null;
  progressPercent: number;
  goalMet: boolean;
}) {
  const { t } = useTranslation();
  const taglineKey = progressPercent >= 70 ? "heroTagline.high" : progressPercent >= 30 ? "heroTagline.mid" : "heroTagline.low";

  return (
    <div className="rounded-card p-8 relative overflow-hidden shadow-sm border border-rule bg-gradient-to-br from-navy-soft/45 via-paper-warm to-warning/30">
      <span className="pointer-events-none absolute -left-10 -bottom-16 h-48 w-48 rounded-full bg-white/25" />
      <div className="hidden md:block absolute right-8 top-1/2 -translate-y-1/2 w-40 h-40 mascot-breathe">
        <Mascot variant="hero" size={160} />
      </div>
      <div className="relative z-10 max-w-2xl">
        <p className="font-mono text-[11px] uppercase tracking-widest text-navy-deep font-medium">{t("roadmap.welcomeBack")}</p>
        <h2 className="font-display font-bold text-3xl text-ink mt-1">{t("roadmap.greeting", { name: firstName || "" })}</h2>
        <p className="text-sm text-ink/70 mt-1">{t(taglineKey)}</p>

        <div className="mt-6 flex items-end gap-1.5 sm:gap-2">
          {LADDER.map((lvl, i) => {
            const cur = LADDER.indexOf(currentLevel as (typeof LADDER)[number]);
            const goal = LADDER.indexOf(goalLevel as (typeof LADDER)[number]);
            const reached = i <= cur;
            const isGoal = i === goal && !goalMet;
            return (
              <div key={lvl} className="flex flex-col items-center gap-1.5">
                <span className={`text-[10px] font-semibold uppercase ${i === cur ? "text-navy-deep" : isGoal ? "text-accent" : "text-transparent"}`}>
                  {i === cur ? t("roadmap.currentLevel") : isGoal ? t("roadmap.goalLevel") : "·"}
                </span>
                <span
                  className={`h-11 w-12 sm:w-14 rounded-xl flex items-center justify-center font-display font-bold text-sm transition-all ${
                    i === cur
                      ? "bg-navy text-white shadow-md scale-110"
                      : isGoal
                        ? "bg-surface text-accent ring-2 ring-accent"
                        : reached
                          ? "bg-navy/35 text-white"
                          : i < goal
                            ? "bg-surface/80 text-navy-deep border border-dashed border-navy/40"
                            : "bg-surface/50 text-muted"
                  }`}
                  style={{ height: `${2.25 + i * 0.35}rem` }}
                >
                  {lvl}
                </span>
              </div>
            );
          })}
          {daysToExam !== null ? (
            <div className="ml-3 sm:ml-5 bg-surface/80 rounded-2xl px-4 py-2.5 text-center">
              <div className="text-[9px] font-mono uppercase text-muted">{tr("Days to exam")}</div>
              <div className={`font-display font-bold text-xl ${daysToExam <= 14 ? "text-error" : "text-ink"}`}>{daysToExam}</div>
            </div>
          ) : daysAccessLeft !== null ? (
            <div className="ml-3 sm:ml-5 bg-surface/80 rounded-2xl px-4 py-2.5 text-center">
              <div className="text-[9px] font-mono uppercase text-muted">{t("roadmap.daysLeftLabel")}</div>
              <div className="font-display font-bold text-xl text-ink">{daysAccessLeft}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// "Goal Setter" is always true here (onboarding requires it) — an honest static banner, not a real achievement system.
function AchievementBanner() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-warning/10 via-surface to-surface border border-warning/20 rounded-card px-4 py-3">
      <span className="h-9 w-9 rounded-input bg-warning text-white flex items-center justify-center shrink-0 shadow-sm">
        <Target size={22} strokeWidth={1.8} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-ink">{t("achievement.goalSetterTitle")}</div>
        <div className="text-xs text-muted truncate">{t("achievement.goalSetterBody")}</div>
      </div>
    </div>
  );
}

function StatsRow({
  progressPercent,
  accuracyPercent,
  streakDays,
  todayMinutes,
}: {
  progressPercent: number;
  accuracyPercent: number | null;
  streakDays: number;
  todayMinutes: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard index={0} variant="pastel" palette="terracotta" icon={Target} label={t("roadmap.goalProgress")} value={`${progressPercent}%`} sub={t("roadmap.ofYourRoadmap")} />
      <StatCard
        index={2}
        variant="pastel"
        palette="sand"
        icon={Flame}
        label={t("roadmap.streak")}
        value={t("roadmap.streakDays", { count: streakDays })}
        sub={streakDays > 0 ? t("roadmap.keepStreakGoing") : t("roadmap.startStreakToday")}
      />
      <StatCard index={0} variant="pastel" palette="moss" icon={Clock} label={t("roadmap.today")} value={`${todayMinutes}m`} sub={t("roadmap.practicedSoFar")} />
      <StatCard
        index={1}
        variant="pastel"
        palette="rose"
        icon={Award}
        label={t("roadmap.accuracy")}
        value={accuracyPercent === null ? "—" : `${accuracyPercent}%`}
        sub={accuracyPercent === null ? t("roadmap.practiceToUnlock") : t("roadmap.practiceAccuracy")}
      />
    </div>
  );
}

function SkillBreakdown({
  skillPercents,
  skillLevels,
}: {
  skillPercents: Record<SkillTag, number | null>;
  skillLevels: Record<SkillTag, { level: CefrLevel; cappedByGap: boolean } | null> | null;
}) {
  const { t } = useTranslation();
  const entries = Object.entries(skillPercents) as [SkillTag, number | null][];
  // Only rank actually-tested skills against each other — an untested one
  // (null) has no score to compare and should never be labeled "strongest."
  const tested = entries.filter((e): e is [SkillTag, number] => e[1] !== null);
  const strongest = tested.length > 0 ? tested.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0] : null;

  return (
    <LearnerCard title={t("roadmap.skillBreakdownTitle")} icon={Target} color="var(--color-accent)">
      <div className="grid grid-cols-2 gap-3">
        {entries.map(([skill, pct]) => {
          const Icon = SKILL_ICONS[skill];
          const color = SKILL_RING_COLOR[skill];
          const entry = skillLevels?.[skill];
          return (
            <div
              key={skill}
              className="flex flex-col items-center text-center rounded-input py-3 px-2"
              style={{ background: pct === null ? "var(--color-paper)" : `color-mix(in srgb, ${SKILL_COLOR[skill]} 10%, var(--color-surface))` }}
            >
              <ProgressRing percent={pct ?? 0} size={56} strokeWidth={5} colorClass={pct === null ? "text-muted" : color}>
                <Icon size={20} strokeWidth={2} className={pct === null ? "text-muted" : color} />
              </ProgressRing>
              <div className="text-xs font-semibold text-ink mt-2">{t(`skills.${skill}`)}</div>
              <div className="text-[10px] text-muted">
                {pct === null ? (
                  <span className="italic">{t("roadmap.notTested")}</span>
                ) : (
                  <>
                    {entry?.level ?? percentToCefr(pct)}
                    {skill === strongest ? ` · ${t("roadmap.strongest")}` : ""}
                  </>
                )}
              </div>
              {pct !== null && entry?.cappedByGap && (
                <div className="text-[9px] text-muted italic leading-snug mt-0.5">{t("roadmap.gapCappedNote")}</div>
              )}
            </div>
          );
        })}
      </div>
    </LearnerCard>
  );
}

function buildJourneyPath(steps: number): { d: string; viewBoxHeight: number } {
  const LEFT_X = 16;
  const RIGHT_X = 52;
  const RUN = 60;
  const BEND = 20;
  let x = LEFT_X;
  let y = 0;
  let d = `M${x} ${y}`;
  for (let i = 0; i < steps; i++) {
    const downTo = y + RUN;
    d += ` L${x} ${downTo}`;
    const nextX = x === LEFT_X ? RIGHT_X : LEFT_X;
    const bendEndY = downTo + BEND;
    d += ` Q${x} ${downTo + BEND / 2} ${nextX} ${bendEndY}`;
    x = nextX;
    y = bendEndY;
  }
  d += ` L${x} ${y + RUN * 0.6}`;
  return { d, viewBoxHeight: y + RUN * 0.6 };
}

function RoadmapTimeline({ milestones, daysSinceStart }: { milestones: RoadmapMilestone[]; daysSinceStart: number }) {
  const { t } = useTranslation();
  const currentIndex = Math.max(0, milestones.findIndex((m) => m.targetDayOffset >= daysSinceStart));
  const { d: pathD, viewBoxHeight } = useMemo(() => buildJourneyPath(Math.max(0, milestones.length - 1)), [milestones.length]);

  return (
    <div className="relative">
      {milestones.length > 1 && (
        <svg
          className="absolute left-1 top-4 w-16"
          style={{ height: "calc(100% - 2rem)" }}
          viewBox={`0 0 64 ${viewBoxHeight}`}
          preserveAspectRatio="none"
          fill="none"
        >
          <path d={pathD} stroke="var(--color-rule-strong)" strokeWidth={3} strokeDasharray="1 9" strokeLinecap="round" />
        </svg>
      )}
      <div className="flex flex-col gap-8 relative z-10">
        {milestones.map((m, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          const isOffset = i % 2 === 1;
          return (
            <div key={i} className={`flex gap-3.5 items-start transition-all ${isOffset ? "ml-9" : ""}`}>
              <span
                className={`relative h-9 w-9 rounded-full border-2 flex items-center justify-center shrink-0 font-display font-bold text-xs ${
                  isDone
                    ? "bg-success border-success text-white"
                    : isCurrent
                      ? "bg-accent border-accent text-white shadow-[0_0_0_5px_var(--color-accent-soft)]"
                      : "bg-surface border-rule text-muted-soft"
                }`}
              >
                {isDone ? <Check size={20} strokeWidth={3} /> : isCurrent ? <Flag size={18} strokeWidth={2.2} /> : <span className="text-xs leading-none">🔒</span>}
              </span>
              <div className="flex-1 pt-1">
                <div className="text-sm font-bold text-ink">
                  {m.labelType === "reach" ? t("roadmap.milestoneReach", { level: m.level }) : t("roadmap.milestoneMaintain")}
                </div>
                <div className="text-xs text-muted">{t("roadmap.dayOffset", { day: m.targetDayOffset })} &middot; {t("roadmap.focusOn", { skill: t(`skills.${m.focusSkill}`) })}</div>
                <span className={`inline-block mt-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SKILL_TINT_CLASSES[m.focusSkill]}`}>
                  {t(`skills.${m.focusSkill}`)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendedPractice({ practice, hasPracticed }: { practice: RoadmapData["recommendedPractice"]; hasPracticed: boolean }) {
  // Module recommendations, so none when the organization switched Modules off.
  const modulesOn = useModulesEnabled();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (!modulesOn) return null;
  return (
    <LearnerCard title={t("recommendedPractice.title")} icon={ListChecks} color="var(--color-success)" className="!gap-2">
      {practice.items.map((item) => (
        <div key={item.itemTypeId} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-input ${item.completed ? "bg-success/10" : "bg-paper/60"}`}>
          <span
            className={`h-5 w-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
              item.completed ? "bg-success border-success text-paper" : "border-rule-strong"
            }`}
          >
            {item.completed && <Check size={13} strokeWidth={3} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink truncate">{item.name}</div>
            <div className="text-xs text-muted line-clamp-2 leading-snug">
              {t("recommendedPractice.estimatedMinutes", { minutes: Math.max(1, Math.round(item.estimatedSeconds / 60)) })} &middot; {item.questionInstruction}
            </div>
          </div>
        </div>
      ))}
      <Button onClick={() => navigate(ROUTES.MODULES)} className="mt-2 w-full">
        <span className="flex items-center justify-center gap-1.5">
          {t("recommendedPractice.startPractice")}
          {!hasPracticed && <ArrowRight size={16} strokeWidth={2.2} className="nudge-arrow" />}
        </span>
      </Button>
    </LearnerCard>
  );
}

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
          <div className="font-mono text-[10px] uppercase tracking-wider text-warning mb-1">{t("dailyChallenge.title")}</div>
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
  const [notReady, setNotReady] = useState<{ scheduledFor: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Practice-derived, not placement-derived — kept separate from `data` so
  // a hiccup fetching it never blocks the rest of the page. Null both
  // before this resolves and once it has if there's no graded practice
  // yet; StatsRow can't tell those apart and doesn't need to (both show
  // the same "not unlocked yet" state).
  const [accuracyPercent, setAccuracyPercent] = useState<number | null>(null);
  // Same source of truth Overview's stat tile reads (GET /dashboard),
  // previously fetched here too but silently discarded — this page's
  // streak card was hardcoded to 0 regardless of the real value.
  const [streakDays, setStreakDays] = useState(0);
  // Same "hardcoded instead of wired up" bug the streak card above already
  // had — this tile showed a literal "0m" regardless of real practice time.
  const [todayMinutes, setTodayMinutes] = useState(0);

  useEffect(() => {
    getRoadmap()
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.message === "no_placement_yet" || err.message === "no_roadmap_yet")) {
          const body = err.body as { assessmentScheduledFor?: string | null };
          setNotReady({ scheduledFor: body.assessmentScheduledFor ?? null });
        } else {
          setError(t("roadmap.loadError"));
        }
      })
      .finally(() => setLoading(false));
    getDashboard()
      .then((res) => {
        setAccuracyPercent(res.stats.accuracyPercent);
        setStreakDays(res.stats.streakDays);
      })
      .catch(() => {});
    // Days are oldest-first, today last — see dashboard/routes.ts GET /daily.
    getDailyProgress()
      .then((res) => setTodayMinutes(res.days[res.days.length - 1]?.practiceMinutes ?? 0))
      .catch(() => {});
  }, [t]);

  if (loading) return <p className="text-sm text-muted">{t("roadmap.loading")}</p>;
  if (error) return <p className="text-sm text-error">{error}</p>;

  if (notReady || !data) {
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

  const { placement, roadmap, goalLevel, accessWindow, firstName, recommendedPractice } = data;
  const goalMet = meetsGoal(placement.cefrLevel, goalLevel);
  const daysAccessLeft = accessWindow ? Math.max(0, accessWindow.durationDays + daysUntil(accessWindow.startDate)) : null;
  const examDays = data.examDate ? daysUntil(data.examDate) : null;
  const daysToExam = examDays !== null && examDays >= 0 ? examDays : null;
  const daysSinceStart = accessWindow ? -daysUntil(accessWindow.startDate) : 0;
  // How many of the plan's milestones should already be reached by today,
  // given their scheduled day-offset — the same time-driven logic the
  // dashboard already uses to pick "today's focus skill" (see
  // dashboard/routes.ts), just expressed as a fraction here instead of
  // picking one current milestone.
  const milestonesReached = roadmap.milestones.filter((m) => m.targetDayOffset <= daysSinceStart).length;
  const progressPercent = roadmap.milestones.length > 0 ? Math.round((milestonesReached / roadmap.milestones.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-5 w-full">
      {placement.reviewStatus === "pending_review" && (
        <div className="flex items-center gap-2.5 bg-warning/15 border border-warning/40 rounded-card px-4 py-3 text-sm text-ink">
          <ShieldAlert size={18} className="text-warning shrink-0" />
          {t("roadmap.pendingReviewBanner")}
        </div>
      )}

      <Hero
        firstName={firstName ?? ""}
        currentLevel={placement.cefrLevel}
        goalLevel={goalLevel}
        daysAccessLeft={daysAccessLeft}
        daysToExam={daysToExam}
        progressPercent={progressPercent}
        goalMet={goalMet}
      />

      <AchievementBanner />

      <StatsRow progressPercent={progressPercent} accuracyPercent={accuracyPercent} streakDays={streakDays} todayMinutes={todayMinutes} />

      <MotivationalBar />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <SkillBreakdown skillPercents={placement.skillPercents} skillLevels={placement.skillLevels} />

        <LearnerCard title={t("roadmap.timelineTitle")} icon={Compass} color="#c9965c">
          <RoadmapTimeline milestones={roadmap.milestones} daysSinceStart={daysSinceStart} />
        </LearnerCard>

        <RecommendedPractice practice={recommendedPractice} hasPracticed={accuracyPercent !== null} />
      </div>

      <DailyChallenge />

      <CoachModePromo />
    </div>
  );
}
