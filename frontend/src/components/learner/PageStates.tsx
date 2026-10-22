import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { tr } from "@/i18n/tr";

// Shared loading, error and empty states for the learner pages, so a page
// that's still loading (or failed) looks like the product, not a stray line.

// A soft skeleton: a hero-sized block and a few cards.
export function PageLoading({ label, cards = 2, hero = true }: { label?: string; cards?: number; hero?: boolean }) {
  return (
    <div className="w-full flex flex-col gap-5" role="status" aria-live="polite">
      <span className="sr-only">{label ?? tr("Loading…")}</span>
      {hero && <div className="h-36 rounded-card bg-rule/60 animate-pulse" />}
      <div className="grid gap-5 lg:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3">
            <div className="h-4 w-1/3 rounded-pill bg-rule animate-pulse" />
            <div className="h-3 w-5/6 rounded-pill bg-rule/70 animate-pulse" />
            <div className="h-3 w-2/3 rounded-pill bg-rule/70 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// A smaller inline skeleton for one list or section.
export function SectionLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-surface border border-rule rounded-card divide-y divide-rule" role="status" aria-live="polite">
      <span className="sr-only">{tr("Loading…")}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-4 flex items-center gap-4">
          <div className="h-5 w-16 rounded-pill bg-rule animate-pulse" />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3 w-1/2 rounded-pill bg-rule animate-pulse" />
            <div className="h-3 w-1/4 rounded-pill bg-rule/70 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Something failed to load: say so and offer a retry.
export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-error/10 text-error flex items-center justify-center shrink-0">
        <AlertTriangle size={20} />
      </span>
      <p className="flex-1 text-sm text-ink">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-pill border border-rule-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-paper-warm cursor-pointer"
        >
          <RotateCcw size={14} /> {tr("Try again")}
        </button>
      )}
    </div>
  );
}

// Nothing here yet: an icon, what will show here, and the next step.
export function EmptyState({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="bg-surface border border-dashed border-rule-strong rounded-card px-6 py-10 flex flex-col items-center text-center gap-3">
      <span className="h-14 w-14 rounded-2xl bg-navy/10 text-navy-deep flex items-center justify-center">
        <Icon size={26} strokeWidth={1.8} />
      </span>
      <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
      {body && <p className="text-sm text-muted max-w-md">{body}</p>}
      {children && <div className="flex flex-wrap justify-center gap-2 mt-1">{children}</div>}
    </div>
  );
}
