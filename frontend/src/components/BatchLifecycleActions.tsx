import { useState } from "react";
import { Archive, CheckCircle2, Copy, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/Button";
import { archiveBatch, cloneBatch, completeBatch, reopenBatch, type BatchStatus } from "@/api/orgAdmin";
import { planErrorMessage } from "@/api/plans";
import { refreshPlan } from "@/components/plans/usePlan";

const pill = "flex items-center gap-1.5 px-3 py-1.5 rounded-pill border border-rule text-sm font-semibold text-ink hover:bg-paper-warm transition-colors cursor-pointer disabled:opacity-50";

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = { active: "Active", completed: "Completed", archived: "Archived" };
export const BATCH_STATUS_CLASS: Record<BatchStatus, string> = {
  active: "bg-success/15 text-success",
  completed: "bg-navy/10 text-navy",
  archived: "bg-rule text-muted",
};

// Complete / archive / reopen / clone, for the Org Admin's batch view.
export function BatchLifecycleActions({
  batchId,
  batchName,
  status,
  onChanged,
}: {
  batchId: string;
  batchName: string;
  status: BatchStatus;
  onChanged: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState(`${batchName} (copy)`);
  const [cloneStart, setCloneStart] = useState("");
  const [copyManagers, setCopyManagers] = useState(true);

  async function run(action: () => Promise<{ releasedLicenses?: number } | unknown>, message: (r: any) => string) {
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      refreshPlan();
      onChanged(message(r));
    } catch (err) {
      setError(planErrorMessage(err) ?? "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status === "active" && (
        <button
          className={pill}
          disabled={busy}
          onClick={() =>
            run(
              () => completeBatch(batchId),
              (r) => `${batchName} marked complete.${r?.releasedLicenses ? ` ${r.releasedLicenses} unused fixed licenses went back to your pool.` : ""}`,
            )
          }
        >
          <CheckCircle2 size={14} /> Complete
        </button>
      )}
      {status !== "archived" && (
        <button className={pill} disabled={busy} onClick={() => run(() => archiveBatch(batchId), () => `${batchName} archived.`)}>
          <Archive size={14} /> Archive
        </button>
      )}
      {status !== "active" && (
        <button className={pill} disabled={busy} onClick={() => run(() => reopenBatch(batchId), () => `${batchName} reopened.`)}>
          <RotateCcw size={14} /> Reopen
        </button>
      )}
      <button className={pill} disabled={busy} onClick={() => setCloning(true)}>
        <Copy size={14} /> Clone
      </button>
      {error && <span className="text-xs text-error self-center">{error}</span>}

      {cloning && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setCloning(false)}>
          <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
              <h2 className="font-display font-bold text-lg text-ink">Clone batch</h2>
              <button onClick={() => setCloning(false)} className="text-muted hover:text-ink cursor-pointer">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <p className="text-sm text-muted">Copies the goals, duration and reminder setting. Learners and licenses are not copied.</p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
                <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">Start date (optional)</label>
                <input type="date" value={cloneStart} onChange={(e) => setCloneStart(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={copyManagers} onChange={(e) => setCopyManagers(e.target.checked)} className="h-4 w-4 accent-navy" />
                Same Managers
              </label>
              {error && <p className="text-sm text-error">{error}</p>}
              <div className="flex gap-3">
                <Button
                  disabled={busy || !cloneName.trim()}
                  onClick={() =>
                    run(
                      () => cloneBatch(batchId, { name: cloneName.trim(), startDate: cloneStart || undefined, copyManagers }),
                      () => {
                        setCloning(false);
                        return `${cloneName.trim()} created.`;
                      },
                    )
                  }
                  className="flex-1"
                >
                  {busy ? "Cloning…" : "Create copy"}
                </Button>
                <Button variant="secondary" onClick={() => setCloning(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
