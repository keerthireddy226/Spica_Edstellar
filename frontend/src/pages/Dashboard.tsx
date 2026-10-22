import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CalendarCheck,
  ListChecks,
  Clock,
  Flame,
  Map,
  Check,
  Headphones,
  Mic,
  BookOpen,
  PenLine,
  ClipboardCheck,
  ArrowRight,
  Trophy,
  Target,
  Layers,
  Award,
  Star,
  MessageCircle,
  BarChart3,
} from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { FinalAssessmentCard } from "@/components/learner/FinalAssessmentCard";
import { Button } from "@/components/Button";
import { MotivationalBar } from "@/components/MotivationalBar";
import { Mascot } from "@/components/Mascot";
import { ProgressRing } from "@/components/ProgressRing";
import { useAuth } from "@/hooks/useAuth";
import { LearnerHero, LearnerCard, SKILL_COLOR } from "@/components/learner/LearnerHero";
import { NextStepCard } from "@/components/learner/GoalCards";
import { JourneySummary, PACE, PACE_LIGHT } from "@/components/journey/JourneyParts";
import { getJourney, type Journey } from "@/api/roadmap";
import { KeepGoingCard } from "@/components/licenses/KeepGoingCard";
import { GroupBoardCard } from "@/components/learner/GroupBoardCard";
import {
  getDashboard,
  type DashboardData,
  type DashboardModule,
  type ModuleStatus,
  type TodaysTask,
  type InProgressPractice,
  type Badge,
} from "@/api/dashboard";
import { ApiError } from "@/lib/api";
import { PageError, PageLoading } from "@/components/learner/PageStates";
import { SKILL_RING_COLOR } from "@/lib/skillTints";
import type { SkillTag } from "@/api/testSession";

import { tr } from "@/i18n/tr";
import { getGroupBoard, type GroupBoard } from "@/api/me";
import { CEFR_MEANING, levelsToGo } from "@/lib/cefrMeaning";
import { trServer } from "@/i18n/serverText";
const SKILL_ICONS: Record<SkillTag, typeof Headphones> = {
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  writing: PenLine,
};

const MODULE_STATUS_KEY: Record<ModuleStatus, string> = {
  not_started: "dashboardHome.statusNotStarted",
  in_progress: "dashboardHome.statusInProgress",
  completed: "dashboardHome.statusCompleted",
};

// Four tinted skill tiles, each in its own skill color with a progress bar.
// wide: a full-width row of four; otherwise two by two.
function SkillProgressGrid({ modules, wide = false }: { modules: DashboardModule[]; wide?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();

  return (
    <div className={`grid grid-cols-2 gap-3 ${wide ? "lg:grid-cols-4" : ""}`}>
      {modules.map((m) => {
        const Icon = SKILL_ICONS[m.skill];
        const color = SKILL_COLOR[m.skill];
        return (
          <button
            key={m.skill}
            onClick={() => navigate(modulesOn ? `${ROUTES.MODULES}?skill=${m.skill}` : ROUTES.PRACTICE_TESTS)}
            className="group text-left rounded-card p-3.5 flex flex-col gap-2.5 border transition-all cursor-pointer hover:-translate-y-0.5 hover:shadow-md"
            style={{ background: `color-mix(in srgb, ${color} 10%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 28%, transparent)` }}
          >
            <div className="flex items-center justify-between">
              <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ background: color }}>
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="font-display font-bold text-xl" style={{ color: `color-mix(in srgb, ${color} 80%, black)` }}>
                {m.progressPercent}%
              </span>
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">{t(`skills.${m.skill}`)}</div>
              <div className="text-xs text-muted">{t(MODULE_STATUS_KEY[m.status])}</div>
            </div>
            <div className="h-2 rounded-full bg-white/70 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${m.progressPercent}%`, background: color }} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Daily habit checklist (practiced today?), distinct from Roadmap's all-time "Recommended Practice".
function TodaysTasksList({ tasks }: { tasks: TodaysTask[] }) {
  const modulesOn = useModulesEnabled();
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-2.5">
      {tasks.map((task) => {
        const Icon = SKILL_ICONS[task.skill];
        const color = SKILL_COLOR[task.skill];
        const pct = task.itemTarget > 0 ? Math.min(100, Math.round((task.itemsCompletedToday / task.itemTarget) * 100)) : 0;
        return (
          <div key={task.skill} className="flex items-center gap-3 rounded-input border border-rule px-4 py-3 bg-surface">
            <span
              className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
              style={task.done ? { background: "var(--color-success)", color: "white" } : { background: `color-mix(in srgb, ${color} 16%, var(--color-surface))`, color }}
            >
              {task.done ? <Check size={18} strokeWidth={2.4} /> : <Icon size={18} strokeWidth={1.8} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold truncate ${task.done ? "text-muted line-through" : "text-ink"}`}>{t(`skills.${task.skill}`)}</div>
              <div className="flex items-center gap-2 mt-1">
                <div className="h-1.5 flex-1 rounded-full bg-rule overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: task.done ? "var(--color-success)" : color }} />
                </div>
                <span className="text-[11px] text-muted shrink-0">
                  {t("dashboardHome.taskProgress", { done: Math.min(task.itemsCompletedToday, task.itemTarget), target: task.itemTarget })}
                </span>
              </div>
            </div>
            {!task.done && (
              <Button
                variant="secondary"
                onClick={() =>
                  navigate(modulesOn ? `${ROUTES.MODULES}?skill=${task.skill}&count=${Math.max(1, task.itemTarget - task.itemsCompletedToday)}` : ROUTES.PRACTICE_TESTS)
                }
                className="shrink-0"
              >
                <span className="flex items-center gap-1.5">
                  {t("dashboardHome.practiceAction")}
                  <ArrowRight size={16} strokeWidth={2.2} className="nudge-arrow" />
                </span>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Surfaces an unfinished practice session so the learner doesn't have to remember which skill they left off on.
// The learner's English level from their level test, what it means, and the
// distance to their goal: always visible, so "which level am I?" has an answer.
// With the journey: the progress to the goal, the pace and this week's tasks
// sit in the same card (they used to be a second card saying the same levels).
function EnglishLevelCard({
  level,
  currentLevel,
  pathLevels,
  journey,
}: {
  level: NonNullable<DashboardData["englishLevel"]>;
  currentLevel: string | null;
  pathLevels?: Record<SkillTag, string>;
  journey?: Journey | null;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // The level now (Practice Modules path, which starts at the level test).
  const cefr = currentLevel ?? level.cefr!;
  const toGo = level.goal ? levelsToGo(cefr, level.goal) : null;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <div className="h-16 w-16 rounded-2xl bg-navy/10 text-navy-deep flex flex-col items-center justify-center">
            <span className="font-display font-bold text-2xl leading-none">{cefr}</span>
            <span className="text-[9px] uppercase tracking-wide mt-1">CEFR</span>
          </div>
          {level.goal && (
            <>
              <ArrowRight size={18} className="text-muted" />
              <div className="h-16 w-16 rounded-2xl border-2 border-dashed border-accent/50 text-accent flex flex-col items-center justify-center">
                <span className="font-display font-bold text-2xl leading-none">{level.goal}</span>
                <span className="text-[9px] uppercase tracking-wide mt-1">{tr("Goal")}</span>
              </div>
            </>
          )}
        </div>
        <div className="flex-1 min-w-[220px]">
          <p className="font-display font-bold text-lg text-ink">{tr("Your English level: {{level}}", { level: cefr })}</p>
          <p className="text-sm text-muted">{CEFR_MEANING[cefr]?.() ?? ""}</p>
          <p className="text-xs text-muted mt-1">
            {level.testedAt
              ? tr("Level test on {{date}}: {{level}}. Updated by your practice since.", {
                  date: new Date(level.testedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
                  level: level.cefr,
                })
              : ""}{" "}
            {level.goal
              ? toGo
                ? tr("Your goal is {{goal}}: {{n}} level(s) to go.", { goal: level.goal, n: toGo })
                : tr("You've reached your goal of {{goal}}.", { goal: level.goal })
              : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(ROUTES.ROADMAP)} className="shrink-0">
          {tr("Your plan to the next level")}
        </Button>
      </div>
      {journey && (
        <div className="flex flex-col gap-2 rounded-input bg-paper-warm/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-ink">{tr("{{n}}% of the way to your goal", { n: journey.progressPercent })}</span>
            {journey.daysLeft !== null && <span className="text-muted">· {tr("{{n}} days to your exam", { n: journey.daysLeft })}</span>}
            {!journey.goalReached && (
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill ${PACE_LIGHT[journey.pace]}`}>{PACE[journey.pace].label()}</span>
            )}
          </div>
          <div className="h-2 rounded-pill bg-rule overflow-hidden">
            <div className="h-full rounded-pill bg-navy" style={{ width: `${journey.progressPercent}%` }} />
          </div>
          <span className="text-xs text-muted">
            {tr("This week: {{done}} of {{total}} tasks done", { done: journey.week.filter((x) => x.done).length, total: journey.week.length })}
            {!journey.examDate && (
              <>
                {" · "}
                <button onClick={() => navigate("/profile")} className="text-navy-deep font-semibold hover:underline cursor-pointer">
                  {tr("Add your exam date")}
                </button>
              </>
            )}
          </span>
        </div>
      )}
      {pathLevels && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(["listening", "speaking", "reading", "writing"] as SkillTag[]).map((skill) => {
            const Icon = SKILL_ICONS[skill];
            return (
              <button
                key={skill}
                onClick={() => navigate(`${ROUTES.MODULES}?skill=${skill}`)}
                className="flex items-center gap-2.5 rounded-input border border-rule bg-paper-warm/60 px-3 py-2 text-left hover:border-navy cursor-pointer"
              >
                <Icon size={16} className={SKILL_RING_COLOR[skill]} />
                <span className="text-xs text-muted flex-1">{t(`skills.${skill}`)}</span>
                <span className="font-display font-bold text-ink">{pathLevels[skill]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContinuePracticeCard({ practice }: { practice: InProgressPractice }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();
  const Icon = SKILL_ICONS[practice.skill];
  const color = SKILL_COLOR[practice.skill];
  const pct = practice.total > 0 ? Math.round((practice.answered / practice.total) * 100) : 0;
  if (!modulesOn) return null;

  return (
    <button
      onClick={() => navigate(`${ROUTES.MODULES}?skill=${practice.skill}`)}
      className="group w-full flex items-center gap-4 rounded-card px-5 py-4 text-left cursor-pointer border shadow-sm hover:shadow-md transition-all"
      style={{ background: `linear-gradient(100deg, color-mix(in srgb, ${color} 16%, var(--color-surface)), var(--color-surface) 70%)`, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` }}
    >
      <ProgressRing percent={pct} size={52} strokeWidth={4} colorClass={SKILL_RING_COLOR[practice.skill]}>
        <Icon size={22} strokeWidth={1.8} className={SKILL_RING_COLOR[practice.skill]} />
      </ProgressRing>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-ink">{t("dashboardHome.continuePracticeTitle")}</div>
        <div className="text-xs text-muted">
          {t("dashboardHome.continuePracticeBody", { skill: t(`skills.${practice.skill}`), answered: practice.answered, total: practice.total })}
        </div>
      </div>
      <span className="h-10 w-10 rounded-full flex items-center justify-center text-white shrink-0 transition-transform group-hover:translate-x-1" style={{ background: color }}>
        <ArrowRight size={18} strokeWidth={2} />
      </span>
    </button>
  );
}

// Big colored shortcuts to the other learner pages.
function QuickLinks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();
  const all = [
    { to: ROUTES.MODULES, label: t("nav.modules"), hint: tr("Practise one skill at a time"), icon: Layers, color: "#b5653f" },
    { to: ROUTES.PRACTICE_TESTS, label: t("nav.practiceTests"), hint: tr("Full practice tests with a report"), icon: ClipboardCheck, color: "#c9965c" },
    { to: ROUTES.TUTOR, label: t("nav.tutor"), hint: tr("Chat in English with your coach"), icon: MessageCircle, color: "#6e9660" },
    { to: ROUTES.PROGRESS, label: t("nav.progress"), hint: tr("Your skills, streaks and badges"), icon: BarChart3, color: "#a8613f" },
    { to: ROUTES.MY_TESTS, label: tr("Assessment"), hint: tr("Your final assessment and certificate"), icon: Award, color: "#8a5a3c" },
  ];
  const links = modulesOn ? all : all.filter((l) => l.to !== ROUTES.MODULES);
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 gap-4 ${links.length === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
      {links.map((l) => (
        <button
          key={l.to}
          onClick={() => navigate(l.to)}
          className="group relative overflow-hidden text-left rounded-card p-5 text-white shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer"
          style={{ background: `linear-gradient(135deg, ${l.color}, color-mix(in srgb, ${l.color} 65%, black))` }}
        >
          <span className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/12" style={{ background: "rgba(255,255,255,0.12)" }} />
          <span className="relative h-11 w-11 rounded-2xl bg-white/20 flex items-center justify-center mb-3" style={{ background: "rgba(255,255,255,0.2)" }}>
            <l.icon size={22} strokeWidth={1.8} />
          </span>
          <p className="relative font-display font-bold text-lg flex items-center gap-1.5">
            {l.label} <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </p>
          <p className="relative text-xs text-white/80">{l.hint}</p>
        </button>
      ))}
    </div>
  );
}

const BADGE_ICONS: Record<Badge["icon"], typeof Trophy> = {
  flag: ClipboardCheck,
  target: Target,
  flame: Flame,
  layers: Layers,
  award: Award,
  "list-checks": ListChecks,
  trophy: Trophy,
  star: Star,
};

// Real, persisted unlocks from the backend (achievements/user_achievements)
// — earned once, on session completion, not recomputed from live stats on
// every page load, so a badge's earned date is genuine.
function AchievementBadges({ badges }: { badges: Badge[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {badges.map((b, i) => {
        const Icon = BADGE_ICONS[b.icon];
        const color = ["#b5653f", "#c9965c", "#6e9660", "#a8613f"][i % 4];
        return (
          <div
            key={b.id}
            className={`flex flex-col items-center text-center gap-2 rounded-card border p-4 ${b.unlocked ? "" : "bg-surface border-dashed border-rule-strong"}`}
            style={b.unlocked ? { background: `color-mix(in srgb, ${color} 12%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 35%, transparent)` } : undefined}
          >
            <span
              className={`h-12 w-12 rounded-full flex items-center justify-center ${b.unlocked ? "text-white shadow-sm" : "bg-paper-warm text-muted"}`}
              style={b.unlocked ? { background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 65%, black))` } : undefined}
            >
              <Icon size={22} strokeWidth={1.8} />
            </span>
            <div className={`text-xs font-bold ${b.unlocked ? "text-ink" : "text-muted"}`}>{trServer(b.title)}</div>
            {b.unlocked ? (
              b.unlockedAt && <div className="text-[11px] text-muted">{new Date(b.unlockedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
            ) : (
              <div className="text-[11px] text-muted leading-snug">{trServer(b.description)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LearnerDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();
  const [data, setData] = useState<DashboardData | null>(null);
  // The plan in short (full page: My journey).
  const [journey, setJourney] = useState<Journey | null>(null);
  useEffect(() => {
    getJourney()
      .then(setJourney)
      .catch(() => setJourney(null));
  }, []);
  // The group board, when the learner's batch has one: it decides the layout.
  const [board, setBoard] = useState<GroupBoard | null>(null);
  useEffect(() => {
    getGroupBoard()
      .then(setBoard)
      .catch(() => setBoard(null));
  }, []);
  const [notReady, setNotReady] = useState<{ scheduledFor: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.message === "no_placement_yet") {
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

  const { firstName, startSkill, modules, todaysTasks, stats, badges, inProgressPractice } = data;
  const remainingToday = todaysTasks.filter((task) => !task.done).length;
  const heroSubtitleKey =
    stats.sessions === 0
      ? "dashboardHome.subtitleFirstTime"
      : remainingToday === 0
        ? "dashboardHome.subtitleAllDoneToday"
        : "dashboardHome.subtitleContinue";
  const showStartNudge = stats.sessions === 0 || remainingToday > 0;

  const doneToday = todaysTasks.filter((task) => task.done).length;
  const hasGroup = !!board?.enabled;
  const tasksCard = (
          <LearnerCard
          title={t(remainingToday === 0 ? "dashboardHome.todaysTasksAllDone" : "dashboardHome.todaysTasksTitleGo")}
          icon={CalendarCheck}
          color="var(--color-accent)"
          action={
            <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success">
              {tr("{{doneToday}}/{{length}} done", { doneToday: doneToday, length: todaysTasks.length })}</span>
          }
        >
            <TodaysTasksList tasks={todaysTasks} />
          </LearnerCard>
  );
  const unlocked = badges.filter((b) => b.unlocked).length;

  return (
    <div className="flex flex-col gap-6 w-full">
      <LearnerHero
        eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        title={t("dashboardHome.welcomeBack", { name: firstName ?? "" })}
        subtitle={t(heroSubtitleKey, { count: remainingToday })}
        art={
          <div className="w-24 h-24 mascot-breathe">
            <Mascot variant="hero" size={96} />
          </div>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(ROUTES.ROADMAP)}>
              <span className="flex items-center gap-1.5">
                <Map size={18} strokeWidth={1.8} /> {tr("My journey")}
              </span>
            </Button>
            <Button onClick={() => navigate(modulesOn ? `${ROUTES.MODULES}?skill=${startSkill}` : ROUTES.PRACTICE_TESTS)}>
              <span className="flex items-center gap-1.5">
                {t("dashboardHome.startPractice")}
                {showStartNudge && <ArrowRight size={18} strokeWidth={2.2} className="nudge-arrow" />}
              </span>
            </Button>
          </>
        }
        stats={[
          { label: t("dashboardHome.statsSessions"), value: stats.sessions, icon: CalendarCheck },
          { label: t("dashboardHome.statsQuestions"), value: stats.questionsCompleted, icon: ListChecks },
          { label: t("dashboardHome.statsTime"), value: t("dashboardHome.statsTimeValue", { minutes: stats.practiceMinutes }), icon: Clock },
          { label: t("dashboardHome.statsStreak"), value: t("dashboardHome.statsStreakValue", { count: stats.streakDays }), icon: Flame },
        ]}
      />

      {/* The day's encouragement, right under the banner. */}
      <MotivationalBar />

      <KeepGoingCard />

      {/* What to do and where you stand, then the final assessment, the group
          (or today's tasks) and a nudge: two balanced columns, so whichever
          cards a learner has, neither side ends long before the other. */}
      <div className="xl:columns-2 gap-6 [&>*]:break-inside-avoid [&>*]:mb-6">
        {inProgressPractice && <ContinuePracticeCard practice={inProgressPractice} />}
        <NextStepCard />
        {data.englishLevel?.cefr ? (
          <EnglishLevelCard level={data.englishLevel} currentLevel={data.currentLevel ?? null} pathLevels={data.pathLevels} journey={journey} />
        ) : (
          journey && <JourneySummary j={journey} />
        )}
        <FinalAssessmentCard compact />
        {hasGroup ? <GroupBoardCard board={board} /> : tasksCard}
      </div>

      {/* Below both columns: today's tasks beside the Practice Modules progress
          (with a group board), or the progress alone (the tasks sit in the side
          column instead), so no column runs long beside an empty one. */}
      <div className={`grid grid-cols-1 gap-6 items-stretch ${hasGroup ? "lg:grid-cols-2" : ""}`}>
        {hasGroup && tasksCard}
          <LearnerCard
            title={t("dashboardHome.overallProgressTitle")}
            icon={Target}
            action={
              <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-navy/10 text-navy-deep">
                {t("dashboardHome.statsLevelValue", { level: stats.level, xp: stats.totalXp })}
              </span>
            }
          >
            <p className="text-xs text-muted -mt-1">{tr("Practice Modules: sets done at your current level in each skill.")}</p>
            <SkillProgressGrid modules={modules} wide={!hasGroup} />
          </LearnerCard>
      </div>

      <QuickLinks />

      <LearnerCard
        title={t("dashboardHome.achievementsTitle")}
        icon={Trophy}
        color="#c9965c"
        action={<span className="text-xs text-muted">{tr("{{unlocked}} of {{length}} earned", { unlocked: unlocked, length: badges.length })}</span>}
      >
        <AchievementBadges badges={badges} />
      </LearnerCard>
    </div>
  );
}

export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();

  if (user?.role === "learner") {
    return <LearnerDashboard />;
  }

  return (
    <div className="max-w-2xl mx-auto bg-surface border border-rule rounded-card p-6 flex flex-col gap-4">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{t("dashboard.welcome", { email: user?.email })}</h1>
        <p className="text-sm text-muted mt-1">{t("dashboard.role", { role: user?.role })}</p>
      </div>
      <p className="text-sm text-muted">{t("dashboard.placeholder")}</p>
    </div>
  );
}
