import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export const HERO_GRADIENT =
  "linear-gradient(120deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 70%, black) 70%, color-mix(in srgb, #c9965c 60%, var(--color-navy)))";

export interface HeroStat {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
}

// The clay banner at the top of every learner page, so Overview, Roadmap,
// Modules, Practice Tests and Tutor read as one product with the consoles.
export function LearnerHero({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  art,
  stats,
  actions,
  onBack,
  backLabel,
  compact,
  statsInline,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  // Shown on the right on wide screens (the mascot, an emoji…).
  art?: ReactNode;
  stats?: HeroStat[];
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  compact?: boolean;
  // The stats as small chips beside the title (a shorter banner), not tiles below it.
  statsInline?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-card shadow-sm text-white" style={{ background: HERO_GRADIENT }}>
      <span className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10" />
      <span className="pointer-events-none absolute right-48 -bottom-28 h-56 w-56 rounded-full bg-white/5" />
      <div className={`relative flex flex-col gap-5 px-6 sm:px-8 ${compact ? "py-5" : "py-7"}`}>
        {onBack && (
          <button
            onClick={onBack}
            className="self-start flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-white transition-colors cursor-pointer -mb-1"
          >
            <ArrowLeft size={16} strokeWidth={1.8} /> {backLabel}
          </button>
        )}
        <div className="flex items-center gap-5">
          {Icon && (
            <span className={`${compact ? "h-12 w-12" : "h-16 w-16"} rounded-2xl bg-white/20 ring-2 ring-white/35 flex items-center justify-center shrink-0`}>
              <Icon size={compact ? 22 : 28} strokeWidth={1.8} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-white/70 mb-1">{eyebrow}</p>}
            <h1 className={`font-display font-bold ${compact ? "text-xl" : "text-2xl sm:text-3xl"} leading-tight`}>{title}</h1>
            {subtitle && <p className="text-sm text-white/85 mt-1 max-w-2xl">{subtitle}</p>}
          </div>
          {actions && (
            <div className="hidden md:flex items-center gap-2 shrink-0 [&_button]:bg-white [&_button]:text-navy-deep [&_button]:border-white [&_button:hover]:bg-white/90">
              {actions}
            </div>
          )}
          {art && <div className="hidden lg:block shrink-0">{art}</div>}
          {statsInline && stats && stats.length > 0 && (
            <div className="hidden lg:flex flex-wrap justify-end gap-2 shrink-0 max-w-[60%]">
              {stats.map((s) => (
                <StatChip key={s.label} stat={s} />
              ))}
            </div>
          )}
        </div>
        {statsInline && stats && stats.length > 0 && (
          <div className="lg:hidden flex flex-wrap gap-2">
            {stats.map((s) => (
              <StatChip key={s.label} stat={s} />
            ))}
          </div>
        )}
        {actions && (
          <div className="md:hidden flex items-center gap-2 flex-wrap [&_button]:bg-white [&_button]:text-navy-deep [&_button]:border-white">{actions}</div>
        )}
        {!statsInline && stats && stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-input px-4 py-3 border border-white/20 min-w-0" style={{ background: "rgba(255,255,255,0.13)" }}>
                {s.icon && <s.icon size={16} className="text-white/80 mb-1" />}
                <p className="font-display font-bold text-2xl truncate">{s.value}</p>
                <p className="text-xs text-white/80 truncate">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatChip({ stat: s }: { stat: HeroStat }) {
  return (
    <span className="flex items-center gap-1.5 rounded-pill px-3 py-1.5 border border-white/20 text-xs text-white/85 whitespace-nowrap" style={{ background: "rgba(255,255,255,0.13)" }}>
      {s.icon && <s.icon size={13} className="text-white/80" />}
      <span className="font-display font-bold text-sm text-white">{s.value}</span> {s.label}
    </span>
  );
}

// A white card with a colored icon chip in its title, used for page sections.
export function LearnerCard({
  title,
  icon: Icon,
  color = "var(--color-navy)",
  action,
  children,
  className = "",
}: {
  title: ReactNode;
  icon: LucideIcon;
  color?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-4 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display font-bold text-ink">
          <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ background: color }}>
            <Icon size={18} />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const SKILL_COLOR: Record<"listening" | "speaking" | "reading" | "writing", string> = {
  listening: "var(--color-listening)",
  speaking: "var(--color-speaking)",
  reading: "var(--color-reading)",
  writing: "var(--color-writing)",
};
