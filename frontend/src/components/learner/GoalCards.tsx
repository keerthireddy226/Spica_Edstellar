import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { getNextStep } from "@/api/dashboard";
import { stepView } from "@/lib/nextStepView";
import type { SkillTag } from "@/api/testSession";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { tr } from "@/i18n/tr";

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
