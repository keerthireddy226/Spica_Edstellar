import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, CalendarCheck, LineChart } from "lucide-react";
import { getDailyProgress, getDashboard, type DailyProgress, type DashboardData, type DailyStat } from "@/api/dashboard";
import { ContinuePracticeCard, EnglishLevelCard, TodaysTasksList } from "@/components/learner/TodayParts";
import { LearnerCard } from "@/components/learner/LearnerHero";
import { ProgressExtras } from "@/components/progress/ProgressExtras";
import { PageError, PageLoading } from "@/components/learner/PageStates";

import { tr } from "@/i18n/tr";
function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

function SectionTitle({ icon: Icon, color, title, children }: { icon: typeof Trophy; color: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: color }}>
        <Icon size={18} />
      </span>
      <h2 className="font-display font-bold text-ink">{title}</h2>
      {children}
    </div>
  );
}

function DailyLineChart({ days, bestDay, totalQuestions }: { days: DailyStat[]; bestDay: DailyStat; totalQuestions: number }) {
  const { t, i18n } = useTranslation();
  const W = 860;
  const top = 30;
  const bottom = 240;
  const maxQ = Math.max(1, ...days.map((d) => d.questionsCompleted));
  const step = W / (days.length - 1);

  const points = days.map((d, i) => {
    const x = i * step;
    const y = bottom - (d.questionsCompleted / maxQ) * (bottom - top);
    const today = isToday(d.date);
    return { x, y, day: d, today };
  });
  const linePath = tr("M ") + points.map((p) => `${p.x} ${p.y}`).join(" L ");
  const areaPath = `${linePath} L ${W} ${bottom} L 0 ${bottom} Z`;
  const bestIsToday = isToday(bestDay.date);

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <SectionTitle icon={LineChart} color="var(--color-accent)" title={t("progressPage.dailyChartTitle")} />
          <p className="text-xs text-muted ml-[46px]">{t("progressPage.questionsThisWeek", { count: totalQuestions })}</p>
        </div>
        {bestDay.questionsCompleted > 0 && (
          <span className="flex items-center gap-1.5 rounded-pill bg-navy/12 px-3 py-1.5 text-xs font-bold text-navy-deep">
            <Trophy size={13} strokeWidth={2.4} />
            {t("progressPage.bestDay", {
              day: bestIsToday ? t("progressPage.today") : new Date(bestDay.date).toLocaleDateString(i18n.language, { weekday: "long" }),
            })}
          </span>
        )}
      </div>

      <div className="relative">
      {totalQuestions === 0 && (
        <p className="absolute inset-x-0 top-[22%] text-center pointer-events-none">
          <span className="inline-block bg-surface px-3 text-sm text-muted">{tr("No questions answered in the last 7 days. Practise a set and it shows here.")}</span>
        </p>
      )}
      <svg viewBox={`0 0 ${W} 300`} className="w-full h-auto" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="progressLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: "var(--color-accent-soft)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-accent)" }} />
          </linearGradient>
          <linearGradient id="progressAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0.28 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-accent)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {[30, 100, 170, 240].map((y) => (
          <line key={y} x1={0} y1={y} x2={W} y2={y} className="stroke-rule" strokeWidth={y === 240 ? 1.5 : 1} />
        ))}

        <path d={areaPath} fill="url(#progressAreaGrad)" />
        <path d={linePath} fill="none" stroke="url(#progressLineGrad)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p) => (
          <g key={p.day.date}>
            {p.today && p.day.questionsCompleted > 0 && (
              <circle cx={p.x} cy={p.y} r={9} className="fill-accent pulse-dot" opacity={0.45} />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={p.today ? 7 : 5}
              className={p.today ? "fill-accent" : "fill-surface"}
              stroke="var(--color-accent)"
              strokeWidth={2.5}
            />
            <text x={p.x} y={p.y - 16} textAnchor="middle" fontSize={p.today ? 16 : 13} fontWeight={800} className="fill-ink font-display">
              {p.day.questionsCompleted}
            </text>
            <text x={p.x} y={288} textAnchor="middle" fontSize={12.5} fontWeight={700} className={p.today ? "fill-accent" : "fill-muted"} style={{ fontFamily: "var(--font-mono)" }}>
              {p.today ? t("progressPage.today") : new Date(p.day.date).toLocaleDateString(i18n.language, { weekday: "short" })}
            </text>
          </g>
        ))}
      </svg>
      </div>
    </div>
  );
}

export function Progress() {
  const { t } = useTranslation();
  const [data, setData] = useState<DailyProgress | null>(null);
  // Today's tasks, the level and the unfinished practice set (the old Overview's data).
  const [today, setToday] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Both before the page shows: otherwise the 7-day graph shows alone at full
    // width, then shrinks when today's tasks arrive beside it.
    Promise.all([
      getDailyProgress()
        .then(setData)
        // A server error code isn't a sentence: always the plain message.
        .catch(() => {
          setError(t("progressPage.loadError"));
        }),
      getDashboard()
        .then(setToday)
        .catch(() => setToday(null)),
    ]).finally(() => setLoading(false));
  }, [t, attempt]);

  if (loading) return <PageLoading label={t("progressPage.loading")} />;
  if (error || !data) return <PageError message={error ?? t("progressPage.loadError")} onRetry={() => setAttempt((n) => n + 1)} />;

  const tasks = today?.todaysTasks ?? [];
  const doneToday = tasks.filter((x) => x.done).length;

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* The page title sits in the clay banner with the all-time totals. */}
      <ProgressExtras part="banner" title={t("progressPage.title")} subtitle={t("progressPage.subtitle")} />

      {/* The level now, and the practice set left unfinished (side by side when both show). */}
      {today && (today.englishLevel?.cefr || today.inProgressPractice) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch lg:[&>*:only-child]:col-span-2">
          {today.englishLevel?.cefr && <EnglishLevelCard level={today.englishLevel} currentLevel={today.currentLevel ?? null} />}
          {today.inProgressPractice && <ContinuePracticeCard practice={today.inProgressPractice} />}
        </div>
      )}

      {/* Today's practice beside the last 7 days. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-stretch">
        {tasks.length > 0 && (
          <LearnerCard
            title={t(doneToday === tasks.length ? "dashboardHome.todaysTasksAllDone" : "dashboardHome.todaysTasksTitleGo")}
            icon={CalendarCheck}
            color="var(--color-accent)"
            action={
              <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-success/15 text-success">
                {tr("{{doneToday}}/{{length}} done", { doneToday, length: tasks.length })}
              </span>
            }
          >
            <TodaysTasksList tasks={tasks} />
          </LearnerCard>
        )}
        <div className={`min-w-0 ${tasks.length > 0 ? "" : "xl:col-span-2"}`}>
          <DailyLineChart days={data.days} bestDay={data.bestDay} totalQuestions={data.totalQuestions} />
        </div>
      </div>

      {/* Each skill (accuracy and Practice Modules at the current level), 12 weeks,
          recent sessions, certificate, placement history and badges. */}
      <ProgressExtras part="details" modules={today?.modules} />
    </div>
  );
}
