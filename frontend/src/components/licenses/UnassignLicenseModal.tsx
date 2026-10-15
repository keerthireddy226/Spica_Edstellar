import { useState } from "react";
import { X, Minus, Plus } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { LICENSE_ERROR_TEXT, formatShortDate, type LearnerAccess } from "@/api/licenses";

import { tr } from "@/i18n/tr";
// Stored with the license history in English; shown translated.
const REASONS = [
  "Learner left the organization",
  "Learner no longer needs access",
  "Assigned by mistake",
  "Reallocating to another learner",
  "Other",
];

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

// Returns unstarted months to the pool. The month currently running stays
// with the learner (it's already been consumed).
export function UnassignLicenseModal({
  learnerName,
  license,
  onUnassign,
  onClose,
  onDone,
}: {
  learnerName: string;
  license: LearnerAccess;
  onUnassign: (months: number, reason: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const max = license.queuedMonths;
  const [months, setMonths] = useState(max);
  const [reason, setReason] = useState("");
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalReason = reason === "Other" ? otherText.trim() : reason;
  const newEnd = license.accessEndsAt ? addMonths(license.accessEndsAt, -months) : null;

  async function submit() {
    if (!finalReason) {
      setError(tr("Pick a reason."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onUnassign(months, finalReason);
      onDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      setError(LICENSE_ERROR_TEXT[code] ?? tr("Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Unassign licenses")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <p className="text-sm text-ink">
            <span className="font-semibold">{learnerName}</span> {tr("has {{totalMonths}} month{{v}} assigned:", { totalMonths: license.totalMonths, v: license.totalMonths === 1 ? "" : "s" })}{" "}
            {license.currentEndsAt ? tr("1 running") : tr("none running")} {tr("and {{max}} not started yet.", { max: max })}</p>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Months to return to the pool")}</label>
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
                onClick={() => setMonths((m) => Math.min(max, m + 1))}
                className="h-9 w-9 rounded-input border border-rule flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer"
              >
                <Plus size={15} />
              </button>
              <span className="text-xs text-muted ml-2">{tr("of {{max}} unused", { max: max })}</span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Reason")}</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={`${inputClass} cursor-pointer`}>
              <option value="">{tr("Select a reason…")}</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </select>
            {reason === "Other" && (
              <input value={otherText} onChange={(e) => setOtherText(e.target.value)} placeholder={tr("Describe the reason")} className={inputClass} />
            )}
          </div>

          <div className="rounded-input bg-paper-warm px-3.5 py-2.5 text-sm text-ink">
            {tr("{{months}} license{{v}} go back to your pool. Access will now end on", { months: months, v: months === 1 ? "" : "s" })}{" "}
            <span className="font-semibold">{formatShortDate(newEnd)}</span>.
            <p className="text-xs text-muted mt-1">{tr("The month already running can't be returned.")}</p>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={submitting || !finalReason} className="flex-1 !bg-error hover:!bg-error/90">
              {submitting ? tr("Unassigning…") : `Unassign ${months}`}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
