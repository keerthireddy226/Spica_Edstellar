import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUp, Gauge, Check } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import type { PathCompare } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

const SKILLS = ["listening", "speaking", "reading", "writing"] as const;

// A test's level per skill next to the learner's Practice Modules path:
// moved up, the same, or lower (with a level check to confirm). A lower
// result never lowers the path by itself.
export function SkillLevelCompare({ compare, percents }: { compare: PathCompare; percents?: Partial<Record<(typeof SKILLS)[number], number>> | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const skills = SKILLS.filter((s) => compare[s]);
  if (!skills.length) return null;
  return (
    <div className="w-full flex flex-col gap-2 text-left">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Your level in each skill")}</span>
      <div className="grid sm:grid-cols-2 gap-2">
        {skills.map((skill) => {
          const c = compare[skill]!;
          const name = t(`skills.${skill}`);
          return (
            <div key={skill} className="rounded-card border border-rule bg-paper-warm/60 px-4 py-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink">{name}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="font-display font-bold text-xl text-ink">{c.test}</span>
                  {percents?.[skill] !== undefined && <span className="text-[11px] text-muted">{percents[skill]}%</span>}
                </span>
              </div>
              {c.action === "raised" ? (
                <p className="text-xs text-success flex items-center gap-1">
                  <ArrowUp size={13} /> {tr("Your {{skill}} path moved up from {{from}} to {{to}}.", { skill: name.toLowerCase(), from: c.path, to: c.test })}
                </p>
              ) : c.action === "same" ? (
                <p className="text-xs text-muted flex items-center gap-1">
                  <Check size={13} /> {tr("Matches your path level ({{level}}).", { level: c.path })}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-warning">
                    {tr("{{test}} here, lower than your path level ({{path}}). Your path stays at {{path}}; take a level check to confirm.", { test: c.test, path: c.path })}
                  </p>
                  <button
                    onClick={() => navigate(`${ROUTES.MODULES}?skill=${skill}&check=1`)}
                    className="self-start text-xs font-semibold text-navy-deep flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <Gauge size={13} /> {tr("Take the {{skill}} level check", { skill: name.toLowerCase() })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
