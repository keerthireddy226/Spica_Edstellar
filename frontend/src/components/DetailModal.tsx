import { ArrowLeft, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { tr } from "@/i18n/tr";
// Earthy accents that sit with the clay brand.
const ACCENTS = ["var(--color-navy)", "var(--color-accent)", "#c9965c", "#b97a62", "#8a8f4f", "#a8613f"];
const accent = (i: number) => ACCENTS[i % ACCENTS.length];

export interface ModalStatItem {
  label: string;
  value: ReactNode;
  hint?: string;
}

export interface ModalTab {
  key: string;
  label: string;
  count?: number;
}

// Shared chrome for every detail view in the consoles (people, batches,
// organizations, learners): a header with who/what it is and its status, a
// strip of key numbers, optional tabs, then the sections. One accent color
// (the brand clay) so every module feels like the same product.
// onBack is only passed when this modal was opened from inside another one —
// it shows a "Back" affordance separate from the close button.
export function DetailModal({
  title,
  subtitle,
  onClose,
  onBack,
  children,
  wide,
  actions,
  icon: Icon,
  initials,
  badges,
  stats,
  tabs,
  tab,
  onTab,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  wide?: boolean;
  // Buttons shown in the header, left of the close button.
  actions?: ReactNode;
  icon?: LucideIcon;
  initials?: string;
  badges?: ReactNode;
  stats?: ModalStatItem[];
  tabs?: ModalTab[];
  tab?: string;
  onTab?: (key: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div
        // With tabs the height is fixed, so switching tabs never resizes the
        // window; the body scrolls instead.
        className={`bg-surface border border-rule rounded-card shadow-2xl w-full flex flex-col overflow-hidden ${wide ? "max-w-7xl" : "max-w-4xl"} ${
          tabs && tabs.length > 0 ? "h-[90vh]" : `max-h-[94vh] ${wide ? "min-h-[70vh]" : ""}`
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 relative overflow-hidden" style={{ background: "linear-gradient(120deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 70%, black) 70%, color-mix(in srgb, #c9965c 60%, var(--color-navy)))" }}>
          <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute right-40 -bottom-24 h-48 w-48 rounded-full bg-white/5" />
          <div className="relative flex items-start gap-4 px-6 sm:px-8 pt-6 pb-5">
            {onBack && (
              <button
                onClick={onBack}
                title={tr("Back")}
                className="mt-1 h-9 w-9 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            {(initials || Icon) && (
              <span className="relative h-16 w-16 rounded-2xl bg-white/20 ring-2 ring-white/40 text-white flex items-center justify-center font-display font-bold text-xl shrink-0 shadow-sm">
                {Icon ? <Icon size={26} strokeWidth={1.8} /> : initials}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-bold text-xl sm:text-2xl text-white truncate">{title}</h2>
              {subtitle && <p className="text-sm text-white/80 mt-0.5 truncate">{subtitle}</p>}
              {badges && <div className="flex items-center gap-1.5 flex-wrap mt-2">{badges}</div>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {actions && <div className="hidden sm:flex items-center gap-2 [&_button]:bg-white [&_button]:text-ink [&_button]:border-white [&_button:hover]:bg-white/90 [&_a]:text-white">{actions}</div>}
              <button
                onClick={onClose}
                title={tr("Close")}
                className="h-9 w-9 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
          </div>
          {actions && <div className="sm:hidden flex items-center gap-2 flex-wrap px-6 pb-3">{actions}</div>}

          {stats && stats.length > 0 && (
            <div className={`relative grid grid-cols-2 ${["", "md:grid-cols-1", "md:grid-cols-2", "md:grid-cols-3"][stats.length] ?? "md:grid-cols-4"} gap-3 px-6 sm:px-8 pb-5`}>
              {stats.map((s, i) => (
                <div key={s.label} className="bg-surface rounded-input px-4 py-3 min-w-0 shadow-sm border-l-4" style={{ borderLeftColor: accent(i) }}>
                  <p className="font-display font-bold text-2xl truncate" style={{ color: `color-mix(in srgb, ${accent(i)} 80%, black)` }}>
                    {s.value}
                  </p>
                  <p className="text-xs text-muted truncate">{s.label}</p>
                  {s.hint && <p className="text-[11px] text-muted/80 truncate">{s.hint}</p>}
                </div>
              ))}
            </div>
          )}

          {tabs && tabs.length > 0 && (
            <div className="relative flex items-center gap-1 px-4 sm:px-6 overflow-x-auto bg-surface border-b border-rule">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onTab?.(t.key)}
                  className={`px-3.5 py-2.5 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                    tab === t.key ? "border-navy text-navy-deep" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                  {t.count !== undefined && <span className="ml-1.5 text-xs font-normal text-muted">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 sm:px-8 py-6 overflow-y-auto flex-1 min-h-0" style={{ background: "color-mix(in srgb, var(--color-paper) 45%, var(--color-surface))" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// A titled block inside a detail view.
export function ModalSection({ title, action, children, icon: Icon }: { title: string; action?: ReactNode; children: ReactNode; icon?: LucideIcon }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2.5 text-sm font-display font-bold text-ink">
          {Icon && (
            <span className="h-8 w-8 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ background: accent(title.length) }}>
              <Icon size={16} />
            </span>
          )}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Label/value pairs in a tidy grid.
export function InfoGrid({ items, columns = 4 }: { items: [string, ReactNode][]; columns?: 2 | 3 | 4 }) {
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4";
  return (
    <div className={`grid grid-cols-1 ${cols} gap-x-6 gap-y-4 bg-surface border border-rule rounded-card px-5 py-4 shadow-sm`}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
          <div className="text-sm text-ink break-words">{value ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}

export function ModalEmpty({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 bg-surface border border-dashed border-rule-strong rounded-card px-5 py-5 text-sm text-muted">
      {Icon && <Icon size={18} className="text-navy/70 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls = {
    neutral: "bg-white/20 text-white border border-white/30",
    good: "bg-white text-success",
    warn: "bg-white text-navy-deep",
    bad: "bg-white text-error",
  }[tone];
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-pill whitespace-nowrap ${cls}`}>{children}</span>;
}

// One person or item in a list inside a detail view.
export function ModalRow({
  initials,
  icon: Icon,
  title,
  subtitle,
  right,
  onClick,
}: {
  initials?: string;
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white" style={{ background: accent(typeof title === "string" ? title.length : 0) }}>
        {Icon ? <Icon size={18} /> : initials}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </>
  );
  const cls = "bg-surface border border-rule rounded-card px-4 py-3 flex items-center gap-3 text-left w-full shadow-sm transition-all";
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:border-navy/50 hover:shadow-md hover:-translate-y-px cursor-pointer`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export const personInitials = (first: string | null | undefined, last: string | null | undefined, email: string) =>
  `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || email.slice(0, 2).toUpperCase();

// Status pill for rows and sections in the body (the header uses Badge).
export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const cls = {
    neutral: "bg-navy/10 text-navy-deep",
    good: "bg-success/15 text-success",
    warn: "bg-warning/20 text-navy-deep",
    bad: "bg-error/15 text-error",
  }[tone];
  return <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-pill whitespace-nowrap ${cls}`}>{children}</span>;
}
