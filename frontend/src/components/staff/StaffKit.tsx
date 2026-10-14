import type { ReactNode } from "react";
import { Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { useAuth } from "@/hooks/useAuth";
import type { StaffPermissions } from "@/api/staff";

// Small building blocks shared by the Super Admin and Admin consoles.

const ALL: StaffPermissions = {
  manageOrganizations: true,
  inviteLearners: true,
  viewLearnerInfo: true,
  contentReview: true,
  scoreReview: true,
  viewReports: true,
};

// What this staff member may do: everything for a Super Admin, the granted
// permissions for an Admin.
export function useStaffPermissions(): StaffPermissions & { isSuper: boolean } {
  const { user } = useAuth();
  if (user?.role === "super_admin") return { ...ALL, isSuper: true };
  const p = (user?.permissions ?? {}) as Partial<StaffPermissions>;
  return {
    manageOrganizations: !!p.manageOrganizations,
    inviteLearners: !!p.inviteLearners,
    viewLearnerInfo: !!p.viewLearnerInfo,
    contentReview: !!p.contentReview,
    scoreReview: !!p.scoreReview,
    viewReports: !!p.viewReports,
    isSuper: false,
  };
}

// Each console page has its own card look and colors, so modules are easy
// to tell apart at a glance.
export const PALETTES = {
  warm: ["var(--color-navy)", "var(--color-accent)", "var(--color-warning)", "var(--color-error)"],
  terracotta: ["#b5653f", "#d4a373", "#8b5e3c", "#c98a7a"],
  rose: ["#c98a7a", "#a8613f", "#b97a62", "#8b5e3c"],
  moss: ["#6e9660", "#8a8f4f", "#5f7d52", "#9a9a62"],
  sand: ["#c9965c", "#e0aa52", "#b8865b", "#d48c5e"],
  sage: ["#7f9478", "#6e9660", "#a08c5b", "#b5653f"],
} as const;
export type PaletteName = keyof typeof PALETTES;
export type CardVariant = "gradient" | "tint" | "outline" | "split" | "pastel" | "glass" | "ledger";

export const paletteColor = (palette: PaletteName, i: number) => PALETTES[palette][i % PALETTES[palette].length];
const mix = (c: string, pct: number, w = "white") => `color-mix(in srgb, ${c} ${pct}%, ${w})`;

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  index,
  variant = "gradient",
  palette = "warm",
  progress,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: LucideIcon;
  index: number;
  variant?: CardVariant;
  palette?: PaletteName;
  // 0..1, drawn by the "ledger" style.
  progress?: number | null;
}) {
  const c = palette === "warm" && variant === "gradient" ? null : paletteColor(palette, index);
  const text = (
    <div className="min-w-0">
      <p className="text-2xl font-display font-bold truncate">{value}</p>
      <p className="text-xs opacity-85">{label}</p>
      {sub && <p className="text-[11px] opacity-70 mt-0.5 truncate">{sub}</p>}
    </div>
  );
  if (variant === "gradient" || variant === "glass") {
    const style =
      variant === "glass" && c
        ? { background: `linear-gradient(160deg, ${mix(c, 85)}, ${c} 55%, ${mix(c, 70, "black")})` }
        : c
          ? { background: `linear-gradient(135deg, ${c}, ${mix(c, 65, "black")})` }
          : cardGradient(index);
    return (
      <div style={style} className={`relative overflow-hidden rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4 min-w-0 text-white`}>
        {variant === "glass" && <span className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />}
        <span className={`h-11 w-11 ${variant === "glass" ? "rounded-full ring-2 ring-white/40" : "rounded-2xl"} bg-white/20 flex items-center justify-center shrink-0`}>
          <Icon size={22} strokeWidth={1.8} />
        </span>
        {text}
      </div>
    );
  }
  const col = c ?? "var(--color-navy)";
  if (variant === "tint") {
    return (
      <div
        style={{ background: mix(col, 13, "var(--color-surface)"), borderLeftColor: col }}
        className="rounded-card border border-rule border-l-4 shadow-sm p-5 flex items-center gap-4 min-w-0 text-ink"
      >
        <span style={{ background: col }} className="h-11 w-11 rounded-xl text-white flex items-center justify-center shrink-0">
          <Icon size={21} strokeWidth={1.8} />
        </span>
        {text}
      </div>
    );
  }
  if (variant === "outline") {
    return (
      <div className="relative bg-surface rounded-card border border-rule shadow-sm p-5 pt-6 flex items-center gap-4 min-w-0 overflow-hidden">
        <span style={{ background: col }} className="absolute inset-x-0 top-0 h-1.5" />
        <span style={{ background: mix(col, 15, "var(--color-surface)"), color: col }} className="h-11 w-11 rounded-full flex items-center justify-center shrink-0">
          <Icon size={21} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p style={{ color: col }} className="text-2xl font-display font-bold truncate">
            {value}
          </p>
          <p className="text-xs text-ink">{label}</p>
          {sub && <p className="text-[11px] text-muted mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    );
  }
  if (variant === "split") {
    return (
      <div className="bg-surface rounded-card border border-rule shadow-sm flex items-stretch min-w-0 overflow-hidden">
        <span style={{ background: `linear-gradient(180deg, ${col}, ${mix(col, 70, "black")})` }} className="w-16 text-white flex items-center justify-center shrink-0">
          <Icon size={24} strokeWidth={1.8} />
        </span>
        <div className="p-4 text-ink min-w-0">{text}</div>
      </div>
    );
  }
  if (variant === "pastel") {
    return (
      <div style={{ background: mix(col, 22, "var(--color-surface)") }} className="rounded-card shadow-sm p-5 flex flex-col gap-3 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: mix(col, 75, "black") }}>
            {label}
          </p>
          <Icon size={18} style={{ color: col }} />
        </div>
        <p className="text-3xl font-display font-bold" style={{ color: mix(col, 70, "black") }}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
      </div>
    );
  }
  // ledger
  return (
    <div className="bg-surface rounded-card border border-rule shadow-sm p-5 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2 text-muted">
        <Icon size={16} style={{ color: col }} />
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-3xl font-display font-bold text-ink truncate">{value}</p>
      <div className="h-1.5 rounded-full bg-rule overflow-hidden">
        <div style={{ background: col, width: `${Math.round(Math.min(1, Math.max(0.04, progress ?? 1)) * 100)}%` }} className="h-full rounded-full" />
      </div>
      {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{title}</h1>
        <p className="text-sm text-muted mt-1">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative flex-1 min-w-56 max-w-md">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-input border border-rule bg-paper pl-9 pr-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
      />
    </div>
  );
}

export function FilterPills<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string, number?][] }) {
  return (
    <div className="flex items-center gap-1 bg-surface border border-rule rounded-pill p-1 max-w-full overflow-x-auto">
      {options.map(([key, label, n]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-3 py-1 text-xs font-semibold rounded-pill whitespace-nowrap transition-colors cursor-pointer ${
            value === key ? "bg-navy text-white" : "text-muted hover:text-ink"
          }`}
        >
          {label}
          {n !== undefined ? ` (${n})` : ""}
        </button>
      ))}
    </div>
  );
}

export function SelectFilter({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function StatusPill({ tone, children }: { tone: "success" | "warning" | "error" | "muted" | "navy"; children: ReactNode }) {
  const cls = {
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-navy-deep",
    error: "bg-error/15 text-error",
    muted: "bg-rule text-muted",
    navy: "bg-navy/10 text-navy",
  }[tone];
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill whitespace-nowrap ${cls}`}>{children}</span>;
}

export function Avatar({ first, last, email, size = 9 }: { first: string | null; last: string | null; email: string; size?: 7 | 9 | 11 }) {
  const text = `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || email.slice(0, 2).toUpperCase();
  const dim = size === 7 ? "h-7 w-7 text-[10px]" : size === 11 ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  return <span className={`${dim} rounded-full bg-navy text-lime flex items-center justify-center font-bold shrink-0`}>{text}</span>;
}

// Two series over the last weeks, as paired bars.
export function WeeklyBars({ data }: { data: { week: string; signups: number; active: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.signups, d.active)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2 h-40">
        {data.map((d) => (
          <div key={d.week} className="flex-1 flex items-end justify-center gap-1 h-full" title={`Week of ${d.week}: ${d.signups} new, ${d.active} active`}>
            <div className="w-1/2 max-w-4 rounded-t bg-navy/80" style={{ height: `${(d.signups / max) * 100}%`, minHeight: d.signups ? 3 : 0 }} />
            <div className="w-1/2 max-w-4 rounded-t bg-accent" style={{ height: `${(d.active / max) * 100}%`, minHeight: d.active ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {data.map((d) => (
          <span key={d.week} className="flex-1 text-center text-[10px] text-muted">
            {new Date(d.week).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        ))}
      </div>
      <div className="flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-navy/80" /> New learners
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Learners who practised
        </span>
      </div>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">{children}</p>;
}
