import { useState, type FormEvent } from "react";
import { planErrorMessage } from "@/api/plans";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { managerCreateBatch } from "@/api/manager";

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

// A Manager's own batch: they manage it automatically, and its learners'
// licenses come from the Manager's pool.
export function ManagerCreateBatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startCefr, setStartCefr] = useState("");
  const [targetCefr, setTargetCefr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (startCefr && targetCefr && CEFR.indexOf(targetCefr as (typeof CEFR)[number]) <= CEFR.indexOf(startCefr as (typeof CEFR)[number])) {
      setError("Goal level must be above the starting level.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await managerCreateBatch({
        name: name.trim(),
        durationMonths: durationMonths ? Number(durationMonths) : undefined,
        startDate: startDate || undefined,
        startCefr: startCefr || undefined,
        targetCefr: targetCefr || undefined,
      });
      onCreated();
    } catch (err) {
      setError(planErrorMessage(err) ?? "Couldn't create the batch.");
      setSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">New batch</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Batch name</label>
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support team — Nov" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Duration (months)</label>
              <input type="number" min={1} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Starting level</label>
              <select value={startCefr} onChange={(e) => setStartCefr(e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Goal level</label>
              <select value={targetCefr} onChange={(e) => setTargetCefr(e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted">Learners in this batch get licenses from your own pool.</p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Creating…" : "Create batch"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
