import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUp, Gauge, Check } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import type { PathCompare } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

const SKILLS = ["listening", "speaking", "reading", "writing"] as const;
type Skill = (typeof SKILLS)[number];

// A test's level per skill next to the learner's level. Higher moves the
// level up; a lower result never lowers it: one calm note says what the test
// showed, that the level stays, and offers a level check to confirm.
export function SkillLevelCompare({
  compare,
  percents,
  kind = "test",
}: {
  compare: PathCompare;
  percents?: Partial<Record<Skill, number>> | null;
  kind?: "practice" | "mock" | "test";
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const skills = SKILLS.filter((s) => compare[s]);
  if (!skills.length) return null;
  const lower = skills.filter((s) => compare[s]!.action === "below");
  const name = (s: Skill) => t(`skills.${s}`).toLowerCase();
  const testName = kind === "practice" ? tr("Your practice test") : kind === "mock" ? tr("Your mock exam") : tr("This test");
  const check = (s: Skill) => navigate(`${ROUTES.MODULES}?skill=${s}&check=1`);

  return (
    <div className="w-full flex flex-col gap-3 text-left">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Your level in each skill")}</span>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {skills.map((skill) => {
          const c = compare[skill]!;
          return (
            <div key={skill} className="rounded-card border border-rule bg-paper-warm/60 px-3 py-2.5 flex flex-col items-center text-center gap-0.5">
              <span className="text-[11px] text-muted">{t(`skills.${skill}`)}</span>
              <span className="font-display font-bold text-xl text-ink leading-tight">{c.test}</span>
              {percents?.[skill] !== undefined && <span className="text-[11px] text-muted">{percents[skill]}%</span>}
              {c.action === "raised" ? (
                <span className="text-[11px] text-success flex items-center gap-0.5">
                  <ArrowUp size={11} /> {tr("Level up from {{from}}", { from: c.path })}
                </span>
              ) : c.action === "same" ? (
                <span className="text-[11px] text-muted flex items-center gap-0.5">
                  <Check size={11} /> {tr("Your level")}
                </span>
              ) : (
                <span className="text-[11px] text-muted">{tr("Your level stays {{level}}", { level: c.path })}</span>
              )}
            </div>
          );
        })}
      </div>

      {lower.length > 0 && (
        <div className="rounded-card border border-rule bg-surface px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <Gauge size={20} className="text-navy-deep shrink-0" />
          <p className="text-sm text-ink flex-1">
            {lower.length === 1
              ? tr("{{test}} says {{level}} in {{skill}}. Your level stays at {{path}} for now. Take a 5-minute {{skill}} level check to confirm.", {
                  test: testName,
                  level: compare[lower[0]]!.test,
                  skill: name(lower[0]),
                  path: compare[lower[0]]!.path,
                })
              : tr("{{skills}} came out lower in this test. Your levels stay as they are for now. A 5-minute level check for each will confirm.", {
                  skills: lower.map((s) => t(`skills.${s}`)).join(lower.length === 2 ? tr(" and ") : ", "),
                })}
          </p>
          <div className="flex flex-wrap gap-2 shrink-0">
            {lower.map((s) => (
              <Button key={s} variant="secondary" onClick={() => check(s)}>
                {tr("Check my {{skill}} level", { skill: name(s) })}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
