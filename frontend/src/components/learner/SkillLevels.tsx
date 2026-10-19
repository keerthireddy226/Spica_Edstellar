import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BookOpen, Headphones, Mic, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { getNextStep } from "@/api/dashboard";
import type { SkillTag } from "@/api/testSession";
import { SKILL_RING_COLOR } from "@/lib/skillTints";
import { stepView } from "@/lib/nextStepView";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { tr } from "@/i18n/tr";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILLS: SkillTag[] = ["listening", "speaking", "reading", "writing"];
const ICONS: Record<SkillTag, typeof Headphones> = { listening: Headphones, speaking: Mic, reading: BookOpen, writing: PenLine };

// The learner's level now in each module (skill), on an A1-C2 scale, with
// the module to practise next marked and a single recommended action.
export function SkillLevelsPanel({ title }: { title?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const modulesOn = useModulesEnabled();
  const [data, setData] = useState<Awaited<ReturnType<typeof getNextStep>> | null>(null);
  useEffect(() => {
    getNextStep()
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data?.pathLevels) return null;
  const levels = data.pathLevels;
  const step = data.nextStep;
  const nextSkill = step && (step.kind === "set" || step.kind === "retry") ? step.skill : null;
  const view = step ? stepView(step, (s) => t(`skills.${s}`), modulesOn) : null;

  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display font-bold text-lg text-ink">{title ?? tr("Your level in each module")}</h2>
        {data.currentLevel && <span className="text-sm text-muted">{tr("Overall: {{level}}", { level: data.currentLevel })}</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SKILLS.map((skill) => {
          const Icon = ICONS[skill];
          const level = levels[skill];
          const at = LEVELS.indexOf(level);
          const next = skill === nextSkill;
          return (
            <button
              key={skill}
              onClick={() => modulesOn && navigate(`${ROUTES.MODULES}?skill=${skill}`)}
              className={`relative text-left rounded-card border p-4 flex flex-col gap-2 transition-all ${modulesOn ? "cursor-pointer hover:shadow-md" : "cursor-default"} ${
                next ? "border-accent bg-accent/5 ring-2 ring-accent/30" : "border-rule bg-paper-warm/50"
              }`}
            >
              {next && (
                <span className="absolute -top-2.5 right-3 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-pill bg-accent text-white">
                  {tr("Practise next")}
                </span>
              )}
              <div className="flex items-center gap-2">
                <Icon size={18} className={SKILL_RING_COLOR[skill]} />
                <span className="text-sm font-semibold text-ink">{t(`skills.${skill}`)}</span>
              </div>
              <span className="font-display font-bold text-3xl text-ink leading-none">{level}</span>
              {/* Where the level sits on A1-C2. */}
              <div className="flex gap-1" aria-label={tr("{{level}} of A1 to C2", { level })}>
                {LEVELS.map((l, i) => (
                  <span key={l} className={`h-1.5 flex-1 rounded-full ${i <= at ? "bg-navy" : "bg-rule"}`} />
                ))}
              </div>
              <span className="text-[11px] text-muted">{at >= 5 ? tr("Top level") : tr("Next: {{level}}", { level: LEVELS[at + 1] })}</span>
            </button>
          );
        })}
      </div>

      {view && (
        <div className="rounded-card bg-accent/10 border border-accent/30 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <Sparkles size={20} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Recommended next")}</p>
            <p className="font-semibold text-ink">{view.title}</p>
            <p className="text-sm text-muted">{view.why}</p>
          </div>
          <Button onClick={() => navigate(view.href)} className="shrink-0">
            <span className="flex items-center gap-1.5">
              {view.cta} <ArrowRight size={16} />
            </span>
          </Button>
        </div>
      )}
    </section>
  );
}
