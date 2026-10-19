import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CalendarClock, ArrowRight, RotateCcw, Timer, ClipboardList, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { getNextStep, type GoalStatus, type NextStep, type PaceStatus } from "@/api/dashboard";
import type { SkillTag } from "@/api/testSession";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { tr } from "@/i18n/tr";

const PACE: Record<PaceStatus, { label: () => string; cls: string }> = {
  new: { label: () => tr("Just started"), cls: "bg-navy/10 text-navy-deep" },
  on_track: { label: () => tr("On track"), cls: "bg-success/15 text-success" },
  slightly_behind: { label: () => tr("Slightly behind"), cls: "bg-warning/15 text-warning" },
  behind: { label: () => tr("Behind plan"), cls: "bg-error/10 text-error" },
};

// Days to the exam (or a prompt to set the date), the goal level, and whether
// this week's practice keeps pace with the daily plan.
export function GoalCountdownCard({ goal, level }: { goal: GoalStatus; level: string | null }) {
  const navigate = useNavigate();
  const pace = PACE[goal.pace];
  const weekTarget = (goal.minutesPerDay ?? 0) * 7;
  const weekPct = weekTarget ? Math.min(100, Math.round((goal.minutesLast7Days / weekTarget) * 100)) : 0;
  const urgent = goal.daysLeft !== null && goal.daysLeft <= 14;
  const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const reached = !!level && !!goal.goalLevel && LEVELS.indexOf(level) >= LEVELS.indexOf(goal.goalLevel);
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col sm:flex-row gap-5">
      <div
        className={`sm:w-40 shrink-0 rounded-2xl flex flex-col items-center justify-center text-center px-4 py-4 ${urgent ? "bg-error/10 text-error" : "bg-navy/10 text-navy-deep"}`}
      >
        {goal.daysLeft !== null ? (
          <>
            <span className="font-display font-bold text-4xl leading-none">{goal.daysLeft}</span>
            <span className="text-xs font-semibold mt-1">{goal.daysLeft === 1 ? tr("day to your exam") : tr("days to your exam")}</span>
          </>
        ) : (
          <>
            <CalendarClock size={28} />
            <span className="text-xs font-semibold mt-2">{tr("No exam date yet")}</span>
          </>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display font-bold text-lg text-ink">
            {goal.goalLevel
              ? goal.examDate
                ? tr("Goal: {{goal}} by {{date}}", { goal: goal.goalLevel, date: new Date(goal.examDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) })
                : tr("Goal: {{goal}}", { goal: goal.goalLevel })
              : tr("Set your goal")}
          </p>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill ${pace.cls}`}>{pace.label()}</span>
        </div>
        <p className="text-sm text-muted">
          {reached
            ? tr("You've reached {{goal}}. Keep practising so it holds on exam day.", { goal: goal.goalLevel }) + " "
            : level && goal.goalLevel
              ? tr("You're at {{level}} now.", { level }) + " "
              : ""}
          {goal.daysLeft === null
            ? tr("Add your exam date so your plan counts down to it.")
            : goal.pace === "behind" || goal.pace === "slightly_behind"
              ? tr("Practise a little every day to catch up before the exam.")
              : tr("Keep your daily practice going to arrive ready.")}
        </p>
        {goal.minutesPerDay ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted">
              <span>{tr("This week: {{done}} of {{target}} minutes", { done: goal.minutesLast7Days, target: weekTarget })}</span>
              <span>{tr("{{n}} min a day", { n: goal.minutesPerDay })}</span>
            </div>
            <div className="h-2 rounded-pill bg-rule overflow-hidden">
              <div className="h-full rounded-pill bg-success" style={{ width: `${weekPct}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      {(goal.daysLeft === null || !goal.goalLevel) && (
        <Button variant="secondary" onClick={() => navigate(ROUTES.PROFILE)} className="self-start sm:self-center shrink-0">
          {goal.goalLevel ? tr("Add exam date") : tr("Set goal")}
        </Button>
      )}
    </div>
  );
}

function stepView(step: NextStep, skillName: (s: SkillTag) => string, modulesOn: boolean): { icon: typeof Timer; title: string; why: string; cta: string; href: string } | null {
  switch (step.kind) {
    case "mock":
      return {
        icon: Timer,
        title: tr("Take a mock exam"),
        why: tr("{{n}} days to your exam. A full timed mock now shows where you stand.", { n: step.daysLeft }),
        cta: tr("Go to mock exams"),
        href: ROUTES.MOCK_EXAMS,
      };
    case "practice_test":
      return {
        icon: ClipboardList,
        title: tr("Take a practice test"),
        why: step.daysSince === null ? tr("You've done several sets. A practice test checks your progress.") : tr("Your last practice test was {{n}} days ago. Check your progress.", { n: step.daysSince }),
        cta: tr("Go to practice tests"),
        href: ROUTES.PRACTICE_TESTS,
      };
    case "retry":
      if (!modulesOn) return null;
      return {
        icon: RotateCcw,
        title: tr("Retry your mistakes"),
        why: tr("{{n}} {{skill}} questions you got wrong earlier are waiting. Getting them right now makes them stick.", { n: step.count, skill: skillName(step.skill).toLowerCase() }),
        cta: tr("Retry 5 questions"),
        href: `${ROUTES.MODULES}?skill=${step.skill}&retry=1`,
      };
    case "set":
      if (!modulesOn) return null;
      return {
        icon: Sparkles,
        title: tr("{{type}} · {{level}} · {{set}}", { type: step.typeName, level: step.unitName.split(" ")[0], set: step.setName }),
        why:
          step.why === "weak_type"
            ? tr("{{skill}} is your weakest skill, and you get {{pct}}% right in {{type}}. This set targets it.", { skill: skillName(step.skill), pct: step.accuracy ?? 0, type: step.typeName })
            : step.why === "untried_type"
              ? tr("{{skill}} is your weakest skill. You haven't tried {{type}} yet.", { skill: skillName(step.skill), type: step.typeName })
              : tr("{{skill}} is your weakest skill. Keep going with {{type}}.", { skill: skillName(step.skill), type: step.typeName }),
        cta: tr("Start this set"),
        href: `${ROUTES.MODULES}?skill=${step.skill}&set=${step.setId}`,
      };
  }
}

// "Your next step": one recommendation from the learner's own results, plus
// the wrong answers waiting for a retry in each skill.
export function NextStepCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();
  const [data, setData] = useState<Awaited<ReturnType<typeof getNextStep>> | null>(null);
  useEffect(() => {
    getNextStep().then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const skillName = (s: SkillTag) => t(`skills.${s}`);
  const view = data.nextStep ? stepView(data.nextStep, skillName, modulesOn) : null;
  const retrySkills = (Object.entries(data.retry) as [SkillTag, number][]).filter(([, n]) => n > 0);
  if (!view && !retrySkills.length) return null;
  const Icon = view?.icon ?? RotateCcw;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      {view && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="h-12 w-12 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <Icon size={22} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Your next step")}</p>
            <p className="font-display font-bold text-lg text-ink">{view.title}</p>
            <p className="text-sm text-muted">{view.why}</p>
          </div>
          <Button onClick={() => navigate(view.href)} className="shrink-0">
            <span className="flex items-center gap-1.5">
              {view.cta} <ArrowRight size={16} />
            </span>
          </Button>
        </div>
      )}
      {modulesOn && retrySkills.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 ${view ? "border-t border-rule pt-3" : ""}`}>
          <span className="text-sm text-ink font-semibold mr-1 flex items-center gap-1.5">
            <RotateCcw size={15} /> {tr("Mistakes to retry")}
          </span>
          {retrySkills.map(([skill, n]) => (
            <button
              key={skill}
              onClick={() => navigate(`${ROUTES.MODULES}?skill=${skill}&retry=1`)}
              className="text-xs font-semibold px-3 py-1.5 rounded-pill border border-rule bg-paper-warm hover:border-navy text-ink cursor-pointer"
            >
              {tr("{{skill}} · {{n}}", { skill: skillName(skill), n })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
