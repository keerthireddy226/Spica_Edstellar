import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { updateBatch, type CefrLevel, type OrgBatchDetail } from "@/api/orgAdmin";

const CEFR: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function EditBatchModal({ batch, onClose, onSaved }: { batch: OrgBatchDetail; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(batch.name);
  const [durationMonths, setDurationMonths] = useState(batch.durationMonths?.toString() ?? "");
  const [startDate, setStartDate] = useState(batch.startDate ? batch.startDate.slice(0, 10) : "");
  const [targetCutScore, setTargetCutScore] = useState(batch.targetCutScore?.toString() ?? "");
  const [startCefr, setStartCefr] = useState<CefrLevel | "">(batch.startCefr ?? "");
  const [targetCefr, setTargetCefr] = useState<CefrLevel | "">(batch.targetCefr ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (startCefr && targetCefr && CEFR.indexOf(targetCefr) <= CEFR.indexOf(startCefr)) {
      setError("Goal level must be above the starting level.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateBatch(batch.id, {
        name: name.trim(),
        durationMonths: durationMonths.trim() ? Number(durationMonths) : null,
        startDate: startDate || null,
        targetCutScore: targetCutScore.trim() ? Number(targetCutScore) : null,
        startCefr: startCefr || null,
        targetCefr: targetCefr || null,
      });
      onSaved();
    } catch {
      setError("Couldn't save the batch.");
      setSaving(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Edit batch</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Batch name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
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
              <select value={startCefr} onChange={(e) => setStartCefr(e.target.value as CefrLevel | "")} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Goal level</label>
              <select value={targetCefr} onChange={(e) => setTargetCefr(e.target.value as CefrLevel | "")} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Target cut score % (optional)</label>
            <input type="number" min={0} max={100} value={targetCutScore} onChange={(e) => setTargetCutScore(e.target.value)} className={inputClass} />
          </div>
          <p className="text-xs text-muted">Fixed licenses are changed in the Licenses section of the batch.</p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? "Saving…" : "Save changes"}
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
