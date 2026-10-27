import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Check, Headphones, Mic, PenLine } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { Button } from "@/components/Button";
import { ProgressRing } from "@/components/ProgressRing";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { SKILL_COLOR } from "@/components/learner/LearnerHero";
import type { DashboardData, InProgressPractice, TodaysTask } from "@/api/dashboard";
import { SKILL_RING_COLOR } from "@/lib/skillTints";
import type { SkillTag } from "@/api/testSession";
import { CEFR_MEANING } from "@/lib/cefrMeaning";
import { tr } from "@/i18n/tr";

// Today's practice and the level now (from the old Overview page, now on
// Progress): the level and what it means, the practice set left unfinished,
// and the day's questions per skill.
const SKILL_ICONS: Record<SkillTag, typeof Headphones> = {
  listening: Headphones,
  speaking: Mic,
  reading: BookOpen,
  writing: PenLine,
};

// Daily habit checklist (practiced today?), distinct from Roadmap's all-time "Recommended Practice".
export function TodaysTasksList({ tasks }: { tasks: TodaysTask[] }) {
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

// The learner's English level from their level test and what it means, so
// "which level am I?" has an answer here. The goal, the progress to it and
// each skill's level are on My journey (the button opens it).
export function EnglishLevelCard({ level, currentLevel }: { level: NonNullable<DashboardData["englishLevel"]>; currentLevel: string | null }) {
  const navigate = useNavigate();
  // The level now (Practice Modules path, which starts at the level test).
  const cefr = currentLevel ?? level.cefr!;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-wrap items-center gap-4">
      <div className="h-16 w-16 rounded-2xl bg-navy/10 text-navy-deep flex flex-col items-center justify-center shrink-0">
        <span className="font-display font-bold text-2xl leading-none">{cefr}</span>
        <span className="text-[9px] uppercase tracking-wide mt-1">CEFR</span>
      </div>
      <div className="flex-1 min-w-[220px]">
        <p className="font-display font-bold text-lg text-ink">{tr("Your English level: {{level}}", { level: cefr })}</p>
        <p className="text-sm text-muted">{CEFR_MEANING[cefr]?.() ?? ""}</p>
        {level.testedAt && (
          <p className="text-xs text-muted mt-1">
            {tr("Placement test on {{date}}: {{level}}. Updated by your practice since.", {
              date: new Date(level.testedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
              level: level.cefr,
            })}
          </p>
        )}
      </div>
      <Button variant="secondary" onClick={() => navigate(ROUTES.ROADMAP)} className="shrink-0">
        {tr("Your plan to the next level")}
      </Button>
    </div>
  );
}

// Surfaces an unfinished practice session so the learner doesn't have to remember which skill they left off on.
export function ContinuePracticeCard({ practice }: { practice: InProgressPractice }) {
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
