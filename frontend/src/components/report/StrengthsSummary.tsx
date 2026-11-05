import { tr } from "@/i18n/tr";

export interface SkillMark {
  skill: string;
  name: string;
  level: string | null;
  // A Spica score (10-90) or a percent, as `unit` says; 0 when not attempted.
  value: number;
  attempted: boolean;
}
export interface PartMark {
  label: string;
  right: number;
  total: number;
}

// The strongest and the weakest attempted skill; none when every skill is level.
export function rankSkills(skills: SkillMark[]): { best: SkillMark | null; worst: SkillMark | null } {
  const done = skills.filter((s) => s.attempted);
  if (done.length < 2) return { best: null, worst: null };
  const sorted = [...done].sort((a, b) => b.value - a.value);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return best.value > worst.value ? { best, worst } : { best: null, worst: null };
}

// Question types that went well (75%+ of at least 2) and the ones to work on (under 60%).
export function rankParts(parts: PartMark[]): { good: PartMark[]; weak: PartMark[] } {
  const share = (p: PartMark) => p.right / Math.max(1, p.total);
  return {
    good: parts.filter((p) => p.total >= 2 && share(p) >= 0.75).sort((a, b) => share(b) - share(a)).slice(0, 3),
    weak: parts.filter((p) => p.total > 0 && share(p) < 0.6).sort((a, b) => share(a) - share(b)).slice(0, 3),
  };
}

const partLine = (p: PartMark) => tr("{{type}}: {{right}} of {{total}} right", { type: p.label, right: p.right, total: p.total });

// What the test showed the person is good at and what needs work, in words.
export function StrengthsSummary({ skills, parts, unit, print = false }: { skills: SkillMark[]; parts: PartMark[]; unit: "score" | "percent"; print?: boolean }) {
  const { best, worst } = rankSkills(skills);
  const { good, weak } = rankParts(parts);
  const missing = skills.filter((s) => !s.attempted);
  const mark = (s: SkillMark) => (unit === "score" ? tr("{{level}}, score {{value}}", { level: s.level ?? "—", value: s.value }) : tr("{{level}}, {{value}}%", { level: s.level ?? "—", value: s.value }));
  const goodLines = [best && tr("Strongest skill: {{skill}} ({{mark}}).", { skill: best.name, mark: mark(best) }), good.length > 0 && tr("Did well in {{list}}.", { list: good.map(partLine).join("; ") })].filter(Boolean) as string[];
  const weakLines = [
    worst && tr("Weakest skill: {{skill}} ({{mark}}).", { skill: worst.name, mark: mark(worst) }),
    weak.length > 0 && tr("Lost the most marks in {{list}}.", { list: weak.map(partLine).join("; ") }),
    missing.length > 0 && tr("Not attempted, so scored 0: {{skills}}.", { skills: missing.map((s) => s.name).join(", ") }),
  ].filter(Boolean) as string[];
  if (!goodLines.length && !weakLines.length) return null;
  const box = print ? "rounded-xl p-3" : "rounded-input p-3";
  return (
    <div className="grid sm:grid-cols-2 print:grid-cols-2 gap-3 break-inside-avoid">
      <div className={`${box} border border-success/40 bg-success/10`}>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 text-success">{tr("Good at")}</p>
        {goodLines.length ? goodLines.map((l) => <p key={l} className="text-sm leading-relaxed text-ink">{l}</p>) : <p className="text-sm text-muted">{tr("No clear strength yet.")}</p>}
      </div>
      <div className={`${box} border border-warning/50 bg-warning/10`}>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 text-ink">{tr("Needs work")}</p>
        {weakLines.length ? weakLines.map((l) => <p key={l} className="text-sm leading-relaxed text-ink">{l}</p>) : <p className="text-sm text-muted">{tr("Nothing stands out as weak.")}</p>}
      </div>
    </div>
  );
}
