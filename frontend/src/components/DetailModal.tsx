import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";

// Shared chrome for the "what did this account actually do" detail views —
// Admins/Org Admins/Managers tables each open one of these from clicking an
// avatar, same backdrop/header/close pattern, different body per role.
// onBack is only passed when this modal was opened from inside another one
// (e.g. clicking a Manager from an Org Admin's detail view) — it shows a
// distinct "back to previous" affordance next to the title, separate from X.
export function DetailModal({
  title,
  subtitle,
  onClose,
  onBack,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-surface border border-rule rounded-card shadow-xl w-full flex flex-col ${
          wide ? "max-w-6xl h-[92vh]" : "max-w-2xl max-h-[85vh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {onBack && (
          <div className="px-8 pt-4 shrink-0">
            <button
              onClick={onBack}
              title="Back"
              className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink transition-colors cursor-pointer -ml-2 px-2 py-1 rounded-input hover:bg-paper-warm"
            >
              <ArrowLeft size={18} /> Back
            </button>
          </div>
        )}
        <div className={`flex items-center justify-between px-8 ${onBack ? "pt-2 pb-5" : "py-5"} border-b border-rule shrink-0`}>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-2xl text-ink truncate">{title}</h2>
            {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer shrink-0">
            <X size={26} />
          </button>
        </div>
        <div className={`px-8 py-6 overflow-y-auto ${wide ? "flex-1" : ""}`}>{children}</div>
      </div>
    </div>
  );
}
