import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, BarChart3, BookOpen, Headphones, Mic, PenLine, Sparkles } from "lucide-react";
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
  const { pathname } = useLocation();
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
  const stepShown = step ? stepView(step, (s) => t(`skills.${s}`), modulesOn) : null;
  // A step that only leads to this page ("Take a practice test" on Practice Tests) isn't shown.
  const view = stepShown && stepShown.href.split("?")[0] !== pathname ? stepShown : null;

  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm px-5 py-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ink flex items-center gap-2.5">
          <span className="h-7 w-7 rounded-lg bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
            <BarChart3 size={15} />
          </span>
          {title ?? tr("Your level in each module")}
        </h2>
        {data.currentLevel && (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-paper-warm border border-rule text-ink">{tr("Overall: {{level}}", { level: data.currentLevel })}</span>
        )}
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
              title={at >= 5 ? tr("Top level") : tr("Next: {{level}}", { level: LEVELS[at + 1] })}
              className={`relative text-left rounded-input border px-3 py-1.5 flex flex-col gap-1 transition-all ${modulesOn ? "cursor-pointer hover:shadow-md" : "cursor-default"} ${
                next ? "border-accent bg-accent/5 ring-2 ring-accent/30" : "border-rule bg-paper-warm/50"
              }`}
            >
              {next && (
                <span className="absolute -top-2 right-2 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-pill bg-accent text-white">
                  {tr("Practise next")}
                </span>
              )}
              <div className="flex items-center gap-1.5">
                <Icon size={15} className={SKILL_RING_COLOR[skill]} />
                <span className="text-xs font-semibold text-ink flex-1">{t(`skills.${skill}`)}</span>
                <span className="font-display font-bold text-base text-ink leading-none">{level}</span>
              </div>
              {/* Where the level sits on A1-C2. */}
              <div className="flex gap-0.5" aria-label={tr("{{level}} of A1 to C2", { level })}>
                {LEVELS.map((l, i) => (
                  <span key={l} className={`h-1 flex-1 rounded-full ${i <= at ? "bg-navy" : "bg-rule"}`} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {view && (
        <div className="rounded-input bg-accent/10 border border-accent/30 px-3 py-1.5 flex flex-col sm:flex-row sm:items-center gap-2">
          <Sparkles size={15} className="text-accent shrink-0" />
          <p className="flex-1 min-w-0 text-xs text-muted truncate" title={view.why}>
            <span className="font-semibold uppercase tracking-wide">{tr("Recommended next")}:</span> <span className="text-sm font-semibold text-ink">{view.title}</span> · {view.why}
          </p>
          <button onClick={() => navigate(view.href)} className="shrink-0 flex items-center gap-1 text-sm font-semibold text-navy-deep hover:underline cursor-pointer">
            {view.cta} <ArrowRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
