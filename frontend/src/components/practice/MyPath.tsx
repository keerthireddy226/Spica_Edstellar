import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, CheckCircle2, ChevronRight, Route, TrendingUp } from "lucide-react";
import { Button } from "@/components/Button";
import { getSkillPath, type SkillPath } from "@/api/practiceSession";
import type { SkillTag } from "@/api/testSession";
import { tr } from "@/i18n/tr";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// "My path" for a skill: the learner's level, one button for the next set,
// and every question type with its level and progress towards the next one.
export function MyPath({
  skill,
  starting,
  onStartSet,
  onOpenUnit,
}: {
  skill: SkillTag;
  starting: boolean;
  onStartSet: (itemTypeId: string, setId: string) => void;
  onOpenUnit: (itemTypeId: string, unitId: string, unitName: string) => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ skill: SkillTag; path: SkillPath | null } | null>(null);
  useEffect(() => {
    let live = true;
    getSkillPath(skill)
      .then((p) => live && setLoaded({ skill, path: p }))
      .catch(() => live && setLoaded({ skill, path: null }));
    return () => {
      live = false;
    };
  }, [skill]);
  const path = loaded?.skill === skill ? loaded.path : null;
  const failed = loaded?.skill === skill && !loaded.path;

  if (failed) return <p className="text-sm text-error">{tr("Your path couldn't be loaded. Try Browse all.")}</p>;
  if (!path) return <p className="text-sm text-muted">{tr("Loading your path…")}</p>;
  const next = path.next;

  return (
    <div className="flex flex-col gap-5">
      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="h-16 w-16 rounded-2xl bg-navy/10 text-navy-deep flex flex-col items-center justify-center shrink-0">
            <span className="font-display font-bold text-2xl leading-none">{path.level}</span>
            <span className="text-[9px] uppercase tracking-wide mt-1">{tr("Your level")}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display font-bold text-lg text-ink">{tr("Your {{skill}} path", { skill: t(`skills.${skill}`).toLowerCase() })}</p>
            <p className="text-sm text-muted">
              {tr("It starts at your level-test level. Finish 7 sets of a question type at 70% or more to move it up a level.")}
            </p>
            <div className="flex items-center gap-1 mt-2" aria-hidden="true">
              {LEVELS.map((l) => (
                <span
                  key={l}
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    l === path.level ? "bg-navy text-white" : LEVELS.indexOf(l) < LEVELS.indexOf(path.level) ? "bg-success/15 text-success" : "bg-rule/60 text-muted"
                  }`}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
        </div>
        {next && (
          <div className="lg:w-80 shrink-0 rounded-card bg-paper-warm border border-rule p-4 flex flex-col gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{next.retake ? tr("Retake to pass the level") : tr("Up next")}</p>
              <p className="font-semibold text-ink">{next.typeName}</p>
              <p className="text-xs text-muted">{tr("{{level}} · {{set}}", { level: next.unitName, set: next.setName })}</p>
            </div>
            <Button onClick={() => onStartSet(next.itemTypeId, next.setId)} disabled={starting}>
              <span className="flex items-center justify-center gap-1.5">
                <Route size={16} /> {tr("Continue my path")} <ArrowRight size={16} />
              </span>
            </Button>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {path.types.map((tp) => {
          const need = Math.min(7, tp.setsTotal);
          const pct = Math.min(100, Math.round((tp.setsDone / Math.max(1, need)) * 100));
          const ready = tp.setsDone >= need;
          return (
            <button
              key={tp.itemTypeId}
              onClick={() => onOpenUnit(tp.itemTypeId, tp.unitId, tp.unitName)}
              className="group text-left bg-surface border border-rule rounded-card p-4 flex flex-col gap-2 cursor-pointer hover:border-rule-strong hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink truncate">{tp.typeName}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-pill bg-navy/10 text-navy-deep shrink-0">{tp.level}</span>
              </div>
              <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                <div className={`h-full rounded-full ${ready ? "bg-success" : "bg-navy"}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="flex items-center gap-1 text-[11px] text-muted">
                {ready ? (
                  <>
                    <CheckCircle2 size={12} className="text-success" />
                    {(tp.accuracy ?? 0) >= 70
                      ? tr("Level passed")
                      : tr("{{n}} sets done · average {{pct}}%, needs 70% to move up", { n: tp.setsDone, pct: tp.accuracy ?? 0 })}
                  </>
                ) : (
                  <>
                    <TrendingUp size={12} />
                    {tr("{{done}} of {{need}} sets to move up", { done: tp.setsDone, need })}
                    {tp.accuracy !== null ? ` · ${tr("average {{pct}}%", { pct: tp.accuracy })}` : ""}
                  </>
                )}
                <ChevronRight size={14} className="ml-auto transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
