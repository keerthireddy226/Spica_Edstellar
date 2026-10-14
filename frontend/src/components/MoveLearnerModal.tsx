import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";

// A learner is in exactly one batch — this shifts them to another one the
// caller is allowed to manage. Shared by the Org Admin and Manager consoles;
// each passes its own scoped batch list and move call.
export function MoveLearnerModal({
  learnerName,
  currentBatchId,
  currentBatchName,
  batches,
  onMove,
  onClose,
  onMoved,
}: {
  learnerName: string;
  currentBatchId?: string | null;
  currentBatchName: string | null;
  batches: { id: string; name: string; label?: string }[];
  onMove: (batchId: string, reason?: string) => Promise<unknown>;
  onClose: () => void;
  onMoved: () => void;
}) {
  const options = batches.filter((b) => (currentBatchId !== undefined ? b.id !== currentBatchId : b.name !== currentBatchName));
  const [batchId, setBatchId] = useState(options[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!batchId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onMove(batchId, reason.trim() || undefined);
      onMoved();
    } catch (err) {
      setError(err instanceof ApiError && err.message === "already_in_batch" ? "They're already in that batch." : "Could not move this learner.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Move learner</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <p className="text-sm text-ink">
            Move <span className="font-semibold">{learnerName}</span> out of{" "}
            <span className="font-semibold">{currentBatchName ?? "no batch"}</span>. A learner can only be in one batch at a time.
          </p>
          {options.length === 0 ? (
            <p className="text-sm text-muted">There's no other batch to move them to yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">New batch</label>
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
                >
                  {options.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label ?? b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">Reason (optional)</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Placed at a higher level"
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
                />
              </div>
            </>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting || options.length === 0} className="flex-1">
              {submitting ? "Moving…" : "Move"}
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
