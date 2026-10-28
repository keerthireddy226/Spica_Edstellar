import type { PartBoundary } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

export type QuestionState = "answered" | "missed" | "current" | "upcoming";

const DOT: Record<QuestionState, string> = {
  answered: "bg-success text-white border-success",
  missed: "bg-error/15 text-error border-error/40",
  current: "bg-surface text-navy-deep border-navy ring-2 ring-navy/30 font-bold",
  upcoming: "bg-surface text-muted border-rule",
};

// The test's questions as numbers, by section, coloured by where the learner
// is: answered, passed without an answer, the current one, still to come. It
// only shows progress; questions are taken in order.
export function QuestionNav({ parts, total, stateOf }: { parts: PartBoundary[]; total: number; stateOf: (i: number) => QuestionState }) {
  const sections = parts.length ? parts : [{ partId: "all", label: "", startIndex: 0, count: total }];
  const counts = { answered: 0, missed: 0 };
  for (let i = 0; i < total; i++) {
    const s = stateOf(i);
    if (s === "answered" || s === "missed") counts[s]++;
  }
  return (
    <aside className="hidden lg:flex w-64 shrink-0 sticky top-4 self-start h-[calc(100vh-7rem)] flex-col gap-4 bg-surface border border-rule rounded-card shadow-sm p-4 overflow-y-auto" aria-label={tr("Questions")}>
      <div className="flex items-baseline justify-between">
        <p className="font-display font-bold text-sm text-ink">{tr("Questions")}</p>
        <p className="text-[11px] text-muted tabular-nums">{tr("{{n}} of {{total}} answered", { n: counts.answered, total })}</p>
      </div>
      {sections.map((p, si) => (
        <div key={p.partId} className="flex flex-col gap-1.5">
          {p.label && (
            <p className="text-[11px] font-semibold text-muted truncate" title={p.label}>
              {String.fromCharCode(65 + si)} · {p.label}
            </p>
          )}
          <div className="grid grid-cols-6 gap-1">
            {Array.from({ length: p.count }, (_, k) => {
              const i = p.startIndex + k;
              const s = stateOf(i);
              return (
                <span
                  key={i}
                  aria-current={s === "current" ? "step" : undefined}
                  title={s === "answered" ? tr("Answered") : s === "missed" ? tr("Not answered") : s === "current" ? tr("Current question") : tr("Still to come")}
                  className={`h-7 rounded-md border text-[11px] flex items-center justify-center tabular-nums ${DOT[s]}`}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-col gap-1 border-t border-rule pt-3 text-[11px] text-muted">
        {(
          [
            ["answered", tr("Answered")],
            ["current", tr("Current question")],
            ["missed", tr("Not answered")],
            ["upcoming", tr("Still to come")],
          ] as const
        ).map(([s, label]) => (
          <span key={s} className="flex items-center gap-2">
            <span className={`h-3 w-3 rounded-sm border ${DOT[s]}`} /> {label}
          </span>
        ))}
      </div>
    </aside>
  );
}
