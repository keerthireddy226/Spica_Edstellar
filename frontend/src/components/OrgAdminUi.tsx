import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Info, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { tr } from "@/i18n/tr";

// Small building blocks shared by the Org Admin pages, so every page has the
// same header, stat tiles, notices, search box and empty/loading states.

export function OrgPageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-display font-bold text-2xl text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-col items-end gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

// A gradient stat tile: value and icon on top, the label underneath at full
// width, so long labels don't squeeze the number and every tile in a row has
// the same height.
export function OrgStatTile({
  label,
  value,
  hint,
  icon: Icon,
  index,
  to,
  title,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: LucideIcon;
  index: number;
  to?: string;
  title?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xl font-display font-bold text-white tabular-nums leading-tight truncate">{value}</p>
        <span className="h-9 w-9 rounded-xl bg-white/20 text-white flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={1.8} />
        </span>
      </div>
      <div className="mt-auto pt-2 min-w-0">
        <p className="text-xs font-medium text-white/90 leading-snug">{label}</p>
        {hint && <p className="text-[11px] text-white/75 truncate mt-0.5">{hint}</p>}
      </div>
    </>
  );
  const cls = "h-full min-h-[108px] rounded-card shadow-sm p-4 flex flex-col transition-shadow";
  if (to) {
    return (
      <Link to={to} style={cardGradient(index)} title={title ?? label} className={`${cls} hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`}>
        {body}
      </Link>
    );
  }
  return (
    <div style={cardGradient(index)} title={title ?? label} className={cls}>
      {body}
    </div>
  );
}

const NOTICE_TONE = {
  success: { cls: "text-success bg-success/10 border-success/25", icon: CheckCircle2 },
  error: { cls: "text-error bg-error/10 border-error/25", icon: AlertCircle },
  info: { cls: "text-ink bg-paper-warm border-rule", icon: Info },
  warning: { cls: "text-navy-deep bg-warning/10 border-warning/30", icon: AlertCircle },
} as const;

export function OrgNotice({ tone = "info", children, onClose }: { tone?: keyof typeof NOTICE_TONE; children: ReactNode; onClose?: () => void }) {
  const t = NOTICE_TONE[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 text-sm border rounded-input px-3.5 py-2.5 ${t.cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label={tr("Close")} className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function OrgSearch({ value, onChange, placeholder, className = "" }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-input border border-rule bg-surface pl-9 pr-3 py-2 text-sm text-ink placeholder:text-muted focus:border-navy focus:outline-none"
      />
    </div>
  );
}

export function OrgEmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-surface border border-dashed border-rule-strong rounded-card px-6 py-10 text-center flex flex-col items-center gap-2">
      <span className="h-12 w-12 rounded-2xl bg-navy/10 text-navy flex items-center justify-center mb-1">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <p className="font-display font-bold text-ink">{title}</p>
      {text && <p className="text-sm text-muted max-w-md">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function OrgLoading({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted py-6" role="status">
      <span className="h-4 w-4 rounded-full border-2 border-rule-strong border-t-navy animate-spin" />
      {text ?? tr("Loading…")}
    </div>
  );
}

export function OrgLoadError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <OrgNotice tone="error">
      <span>{text}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-2 font-semibold underline cursor-pointer">
          {tr("Try again")}
        </button>
      )}
    </OrgNotice>
  );
}

// Underlined page tabs (Batches, Licenses, Learners).
export function OrgTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly (readonly [T, ReactNode])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1 border-b border-rule overflow-x-auto" role="tablist">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
            value === key ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
