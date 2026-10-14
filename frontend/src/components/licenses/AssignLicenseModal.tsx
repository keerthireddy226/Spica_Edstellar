import { useState } from "react";
import { X, Minus, Plus } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { LICENSE_ERROR_TEXT, formatShortDate, type LearnerAccess } from "@/api/licenses";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";

const QUICK = [1, 3, 6, 12];

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Assign (first time) or extend (stack more months). Optionally reclaim
// queued months back to the pool — Org Admin only.
export function AssignLicenseModal({
  learnerName,
  license,
  poolHint,
  onAssign,
  onReclaim,
  onClose,
  onDone,
}: {
  learnerName: string;
  license: LearnerAccess;
  poolHint: string;
  onAssign: (months: number) => Promise<unknown>;
  onReclaim?: (months: number) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"assign" | "reclaim">("assign");
  const [months, setMonths] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExtend = license.status === "active" || license.status === "grace";
  const startFrom =
    license.status === "active" && license.accessEndsAt ? new Date(license.accessEndsAt) : new Date();
  const newEnd = addMonths(startFrom, months);
  const maxReclaim = license.queuedMonths;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "assign") await onAssign(months);
      else await onReclaim!(Math.min(months, maxReclaim));
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      setError(LICENSE_ERROR_TEXT[code] ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">
            {mode === "reclaim" ? "Reclaim licenses" : isExtend ? "Extend access" : "Assign licenses"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink truncate">{learnerName}</p>
            <LicenseStatusPill license={license} />
          </div>

          {onReclaim && maxReclaim > 0 && (
            <div className="flex items-center gap-1">
              {(["assign", "reclaim"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setMonths(1);
                    setError(null);
                  }}
                  className={`px-3 py-1.5 text-sm font-semibold rounded-input transition-colors cursor-pointer ${
                    mode === m ? "bg-navy/10 text-navy" : "text-muted hover:text-ink"
                  }`}
                >
                  {m === "assign" ? (isExtend ? "Extend" : "Assign") : "Reclaim queued"}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">
              {mode === "assign" ? "Months (1 license = 1 month)" : `Months to return (up to ${maxReclaim})`}
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMonths((m) => Math.max(1, m - 1))}
                className="h-9 w-9 rounded-input border border-rule flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer"
              >
                <Minus size={15} />
              </button>
              <span className="w-12 text-center font-display font-bold text-xl text-ink">{months}</span>
              <button
                type="button"
                onClick={() => setMonths((m) => Math.min(mode === "assign" ? 24 : maxReclaim, m + 1))}
                className="h-9 w-9 rounded-input border border-rule flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer"
              >
                <Plus size={15} />
              </button>
              {mode === "assign" && (
                <div className="flex items-center gap-1 ml-auto">
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setMonths(q)}
                      className={`px-2.5 py-1 rounded-pill text-xs font-semibold cursor-pointer transition-colors ${
                        months === q ? "bg-navy text-white" : "bg-paper-warm text-muted hover:text-ink"
                      }`}
                    >
                      {q}m
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-input bg-paper-warm px-3.5 py-2.5 text-sm text-ink">
            {mode === "assign" ? (
              <>
                Uses <span className="font-semibold">{months}</span> license{months === 1 ? "" : "s"} from the pool. Access{" "}
                {isExtend ? "extends" : "starts today and runs"} until <span className="font-semibold">{formatShortDate(newEnd.toISOString())}</span>.
              </>
            ) : (
              <>
                Returns <span className="font-semibold">{Math.min(months, maxReclaim)}</span> unstarted month
                {months === 1 ? "" : "s"} to the pool. The month already running isn't refunded.
              </>
            )}
            <p className="text-xs text-muted mt-1">{poolHint}</p>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={submitting} className="flex-1">
              {submitting ? "Saving…" : mode === "assign" ? (isExtend ? `Extend by ${months}` : `Assign ${months}`) : `Reclaim ${Math.min(months, maxReclaim)}`}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
