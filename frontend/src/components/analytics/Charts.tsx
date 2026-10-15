import type { ReactNode } from "react";
import type { Bucket } from "@/api/analytics";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
export function Card({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4 break-inside-avoid">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm px-4 py-3.5" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-display font-bold text-ink mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

// Horizontal bars, largest first. Hidden (small) groups are listed without a number.
export function BarList({ data, label, emptyText = tr("No data yet.") }: { data: Bucket[]; label: (key: string) => string; emptyText?: string }) {
  const known = data.filter((d) => d.key !== "unknown");
  const unknown = data.find((d) => d.key === "unknown");
  const max = Math.max(1, ...known.map((d) => d.count ?? 0));
  const hidden = known.filter((d) => d.count === null);
  const shown = known.filter((d) => d.count !== null);
  if (shown.length === 0 && hidden.length === 0) {
    return <p className="text-sm text-muted">{unknown ? `${emptyText} (${unknown.count} not answered)` : emptyText}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {shown.map((d) => (
        <div key={d.key} className="flex items-center gap-3 text-sm">
          <span className="w-36 shrink-0 truncate text-ink" title={trServer(label(d.key))}>
            {trServer(label(d.key))}
          </span>
          <div className="flex-1 h-2.5 rounded-full bg-rule overflow-hidden">
            <div className="h-full rounded-full bg-navy" style={{ width: `${((d.count ?? 0) / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-muted tabular-nums">{d.count}</span>
        </div>
      ))}
      {(hidden.length > 0 || unknown) && (
        <p className="text-[11px] text-muted pt-1">
          {hidden.length > 0 && `${hidden.map((h) => label(h.key)).join(", ")}: fewer than 5 (hidden for privacy). `}
          {unknown && tr("{{v}} not answered.", { v: unknown.count })}
        </p>
      )}
    </div>
  );
}

// Simple weekly column chart (no chart library needed).
export function WeeklyBars({ data, valueLabel }: { data: { week: string; value: number }[]; valueLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1.5 h-36">
        {data.map((d) => (
          <div key={d.week} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={tr("{{value}} {{valueLabel}} · week of {{week}}", { value: d.value, valueLabel: valueLabel, week: d.week })}>
            <span className="text-[10px] text-muted tabular-nums">{d.value || ""}</span>
            <div className="w-full rounded-t bg-navy/80" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 4 : 1 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {data.map((d) => (
          <span key={d.week} className="flex-1 text-center text-[10px] text-muted">
            {new Date(d.week).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
}

export function StackedBar({ parts }: { parts: { label: string; value: number; className: string }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 rounded-full overflow-hidden bg-rule">
        {total > 0 && parts.map((p) => p.value > 0 && <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-2.5 w-2.5 rounded-full ${p.className}`} /> {p.label} · <span className="text-ink font-semibold">{p.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
