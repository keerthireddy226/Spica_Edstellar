import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { planErrorMessage } from "@/api/plans";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { requestLicenseChange, type BatchBudget, type LicenseRequestKind, type ManagerPool } from "@/api/licenses";

// Managers can't change allotments themselves — this sends the Org Admin a
// request they approve or decline.
export function RequestLicenseChangeModal({
  batches,
  myPool,
  initialBatchId,
  learner,
  onClose,
  onSent,
}: {
  batches: BatchBudget[];
  myPool?: ManagerPool;
  // "" = the Manager's own pool.
  initialBatchId?: string;
  // Set when asking to return a specific learner's unused months.
  learner?: { id: string; name: string; queuedMonths: number };
  onClose: () => void;
  onSent: () => void;
}) {
  const [kind, setKind] = useState<LicenseRequestKind>(learner ? "unassign_learner" : "increase_allotment");
  const fixedBatches = batches.filter((b) => b.budget !== null);
  const [batchId, setBatchId] = useState(initialBatchId && fixedBatches.some((b) => b.batchId === initialBatchId) ? initialBatchId : "");
  const [quantity, setQuantity] = useState(learner ? String(learner.queuedMonths) : "5");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = useHasFeature("license_requests") !== false;

  const batch = fixedBatches.find((b) => b.batchId === batchId);
  const target = batch ? { allotted: batch.budget ?? 0, used: batch.used } : { allotted: myPool?.allotment ?? 0, used: myPool?.used ?? 0 };
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const maxQty = kind === "unassign_learner" ? (learner?.queuedMonths ?? 0) : kind === "decrease_allotment" ? Math.max(0, target.allotted - target.used) : 10000;

  async function send() {
    if (qty < 1 || !reason.trim()) return;
    setSending(true);
    setError(null);
    try {
      await requestLicenseChange({
        kind,
        quantity: Math.min(qty, maxQty || qty),
        batchId: kind === "unassign_learner" || !batchId ? null : batchId,
        learnerId: learner?.id ?? null,
        reason: reason.trim(),
      });
      onSent();
    } catch (err) {
      setError(
        planErrorMessage(err) ??
          (err instanceof ApiError && err.message === "invalid_batch" ? "You don't manage that batch." : "Couldn't send the request."),
      );
      setSending(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{learner ? "Request to return licenses" : "Request a license change"}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          {!allowed && <PlanLockNote feature="license_requests" compact />}
          {learner ? (
            <p className="text-sm text-ink">
              Return unused months from <span className="font-semibold">{learner.name}</span> to the pool ({learner.queuedMonths} not started yet).
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["increase_allotment", "Add licenses"],
                    ["decrease_allotment", "Remove licenses"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`rounded-input border px-3 py-2.5 text-sm font-semibold cursor-pointer transition-colors ${
                      kind === k ? "border-navy bg-paper-warm text-ink" : "border-rule text-muted hover:border-rule-strong"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">For</label>
                <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${inputClass} cursor-pointer`}>
                  <option value="">My license pool — {myPool?.allotment ?? 0} allotted, {myPool?.used ?? 0} assigned</option>
                  {fixedBatches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {b.batchName} (fixed) — {b.budget} allotted, {b.used} assigned
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{learner ? "Months to return" : "How many licenses"}</label>
            <input type="number" min={1} max={maxQty || undefined} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            {kind === "decrease_allotment" && (
              <p className="text-xs text-muted">Up to {maxQty} — licenses already assigned to learners can't be removed this way.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Reason</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={kind === "increase_allotment" ? "e.g. 8 new joiners starting next week" : "e.g. Learner left the company"}
              className={inputClass}
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={send} disabled={!allowed || sending || qty < 1 || !reason.trim() || (maxQty === 0 && kind !== "increase_allotment")} className="flex-1">
              {sending ? "Sending…" : "Send to Org Admin"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted">Your Org Admin is notified and approves or declines it. You'll get a notification either way.</p>
        </div>
      </div>
    </div>
  );
}
