import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
import { getDailyProgress, type DailyProgress, type DailyStat } from "@/api/dashboard";
import { ApiError } from "@/lib/api";
import { MotivationalBar } from "@/components/MotivationalBar";
import { ProgressExtras } from "@/components/progress/ProgressExtras";

import { tr } from "@/i18n/tr";
function isToday(dateStr: string): boolean {
  return dateStr === new Date().toISOString().slice(0, 10);
}

// A rest-day yesterday gets neutral phrasing instead of a misleading "you did more!" trend.
function TodayVsYesterday({ today, yesterday }: { today: DailyStat; yesterday: DailyStat | undefined }) {
  const { t } = useTranslation();
  const prevQuestions = yesterday?.questionsCompleted ?? 0;

  if (prevQuestions === 0) {
    if (today.questionsCompleted === 0) return null;
    return (
      <span className="flex items-center gap-1.5 rounded-pill bg-success/15 px-4 py-2 text-sm font-bold text-success shrink-0">
        <TrendingUp size={16} strokeWidth={2.4} /> {t("progressPage.firstDayBack")}
      </span>
    );
  }

  const delta = today.questionsCompleted - prevQuestions;
  if (delta > 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-pill bg-success/15 px-4 py-2 text-sm font-bold text-success shrink-0">
        <TrendingUp size={16} strokeWidth={2.4} /> {t("progressPage.moreThanYesterday", { count: delta })}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="flex items-center gap-1.5 rounded-pill bg-paper-warm px-4 py-2 text-sm font-bold text-muted shrink-0">
        <TrendingDown size={16} strokeWidth={2.4} /> {t("progressPage.lessThanYesterday", { count: Math.abs(delta) })}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-pill bg-paper-warm px-4 py-2 text-sm font-bold text-muted shrink-0">
      <Minus size={16} strokeWidth={2.4} /> {t("progressPage.sameAsYesterday")}
    </span>
  );
}

function TodayReport({ days, isBestDay }: { days: DailyStat[]; isBestDay: boolean }) {
  const { t } = useTranslation();
  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];

  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-wrap items-center justify-between gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-mono text-[11px] font-medium tracking-[.24em] uppercase text-muted">{t("progressPage.todaysReport")}</h3>
          {isBestDay && (
            <span className="flex items-center gap-1 rounded-pill bg-warning/20 px-2.5 py-0.5 text-[11px] font-bold text-navy-deep">
              <Trophy size={11} strokeWidth={2.6} /> {t("progressPage.bestDayBadge")}
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-7 flex-wrap">
          <div>
            <span className="font-display font-extrabold text-4xl text-ink">{today.questionsCompleted}</span>
            <span className="text-xs text-muted ml-2">{t("progressPage.questions")}</span>
          </div>
          <div>
            <span className="font-display font-extrabold text-4xl text-success">
              {today.accuracyPercent === null ? "—" : `${today.accuracyPercent}%`}
            </span>
            <span className="text-xs text-muted ml-2">{t("progressPage.accuracy")}</span>
          </div>
          <div>
            <span className="font-display font-extrabold text-4xl text-navy">{today.practiceMinutes}</span>
            <span className="text-xs text-muted ml-2">{t("progressPage.minutes")}</span>
          </div>
        </div>
      </div>
      <TodayVsYesterday today={today} yesterday={yesterday} />
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
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-mono text-[11px] font-medium tracking-[.24em] uppercase text-muted">{t("progressPage.dailyChartTitle")}</h3>
          <p className="text-xs text-muted mt-1">{t("progressPage.questionsThisWeek", { count: totalQuestions })}</p>
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

      <svg viewBox={`0 0 ${W} 300`} className="w-full h-[260px]" style={{ overflow: "visible" }}>
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
  );
}

export function Progress() {
  const { t } = useTranslation();
  const [data, setData] = useState<DailyProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDailyProgress()
      .then(setData)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : t("progressPage.loadError"));
      })
      .finally(() => setLoading(false));
  }, [t]);

  if (loading) return <p className="text-sm text-muted">{t("progressPage.loading")}</p>;
  if (error || !data) return <p className="text-sm text-error">{error ?? t("progressPage.loadError")}</p>;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{t("progressPage.title")}</h1>
        <p className="text-sm text-muted mt-0.5">{t("progressPage.subtitle")}</p>
      </div>

      <ProgressExtras part="banner" />
      <MotivationalBar />

      <TodayReport days={data.days} isBestDay={isToday(data.bestDay.date) && data.bestDay.questionsCompleted > 0} />
      <DailyLineChart days={data.days} bestDay={data.bestDay} totalQuestions={data.totalQuestions} />
      <ProgressExtras part="details" />
    </div>
  );
}
