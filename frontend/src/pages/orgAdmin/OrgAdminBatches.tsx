import { useEffect, useState, type FormEvent } from "react";
import { Plus, X, Layers, Users, Trash2 } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { OrgAdminBatchDetailModal } from "@/components/OrgAdminBatchDetailModal";
import { getBatches, createBatch, deleteBatch, type OrgBatch, type CefrLevel, type BatchStatus } from "@/api/orgAdmin";
import { BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { getOrgLicenseOverview, type BatchBudget } from "@/api/licenses";
import { ApiError } from "@/lib/api";
import { planErrorMessage } from "@/api/plans";
import { PlanLimitHint, PlanLockNote, refreshPlan, useHasFeature } from "@/components/plans/usePlan";

const CEFR: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function CreateBatchModal({ onClose, onCreated, unreserved }: { onClose: () => void; onCreated: () => void; unreserved: number | null }) {
  const [name, setName] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetCutScore, setTargetCutScore] = useState("");
  const [startCefr, setStartCefr] = useState<CefrLevel | "">("");
  const [targetCefr, setTargetCefr] = useState<CefrLevel | "">("");
  const [fixedLicenses, setFixedLicenses] = useState("");
  const allotmentsAllowed = useHasFeature("batch_allotments") !== false;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (startCefr && targetCefr && CEFR.indexOf(targetCefr) <= CEFR.indexOf(startCefr)) {
      setError("Target level must be above the starting level.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createBatch({
        startCefr: startCefr || undefined,
        targetCefr: targetCefr || undefined,
        licenseAllotment: allotmentsAllowed && fixedLicenses.trim() ? Number(fixedLicenses) : undefined,
        name: name.trim(),
        durationMonths: durationMonths.trim() ? Number(durationMonths.trim()) : undefined,
        startDate: startDate.trim() || undefined,
        targetCutScore: targetCutScore.trim() ? Number(targetCutScore.trim()) : undefined,
      });
      onCreated();
    } catch (err) {
      setError(
        planErrorMessage(err) ??
        (err instanceof ApiError && err.message === "insufficient_unreserved"
          ? "Not enough unreserved licenses for that many fixed licenses."
          : "Something went wrong creating that batch."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">New batch</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Batch name</label>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 2026 Intake"
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Duration (months)</label>
              <input
                type="number"
                min={1}
                value={durationMonths}
                onChange={(e) => setDurationMonths(e.target.value)}
                placeholder="e.g. 3"
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Starting level</label>
              <select
                value={startCefr}
                onChange={(e) => setStartCefr(e.target.value as CefrLevel | "")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
              >
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Goal level</label>
              <select
                value={targetCefr}
                onChange={(e) => setTargetCefr(e.target.value as CefrLevel | "")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
              >
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Fixed licenses for this batch (optional)</label>
            {!allotmentsAllowed ? (
              <PlanLockNote feature="batch_allotments" compact />
            ) : (
            <>
            <input
              type="number"
              min={0}
              max={unreserved ?? undefined}
              value={fixedLicenses}
              onChange={(e) => setFixedLicenses(e.target.value)}
              placeholder="None — learners use their Manager's pool"
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
            <p className="text-xs text-muted">
              Set aside only for this batch's learners{unreserved !== null ? ` · ${unreserved} unreserved licenses available` : ""}.
            </p>
            </>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Target cut score % (optional)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={targetCutScore}
              onChange={(e) => setTargetCutScore(e.target.value)}
              placeholder="e.g. 60"
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
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

export function OrgAdminBatches() {
  const [batches, setBatches] = useState<OrgBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [viewingBatchId, setViewingBatchId] = useState<string | null>(null);
  const [deletingBatch, setDeletingBatch] = useState<OrgBatch | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unreserved, setUnreserved] = useState<number | null>(null);
  const [fixed, setFixed] = useState<BatchBudget[]>([]);
  const [statusFilter, setStatusFilter] = useState<BatchStatus>("active");

  function load() {
    getBatches()
      .then((res) => setBatches(res.batches))
      .catch(() => setError("Could not load batches."));
    getOrgLicenseOverview()
      .then((res) => {
        setUnreserved(res.summary.unreserved);
        setFixed(res.batches);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleDelete(batch: OrgBatch) {
    setBusyId(batch.id);
    try {
      await deleteBatch(batch.id);
      refreshPlan();
      setDeletingBatch(null);
      load();
    } catch {
      setError("Could not delete that batch.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Batches</h1>
          <p className="text-sm text-muted mt-1">Sub-groups inside your organization — e.g. "2026 Intake".</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={18} /> New Batch
          </Button>
          <PlanLimitHint limit="batches" />
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!batches && !error && <p className="text-sm text-muted">Loading…</p>}
      {batches && batches.length > 0 && (
        <div className="flex items-center gap-1 border-b border-rule">
          {(["active", "completed", "archived"] as BatchStatus[]).map((st) => {
            const n = batches.filter((b) => b.status === st).length;
            return (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                  statusFilter === st ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {BATCH_STATUS_LABEL[st]} ({n})
              </button>
            );
          })}
        </div>
      )}

      {batches?.length === 0 && <p className="text-sm text-muted">No batches yet — create your first one.</p>}
      {batches && batches.length > 0 && batches.filter((b) => b.status === statusFilter).length === 0 && (
        <p className="text-sm text-muted">No {BATCH_STATUS_LABEL[statusFilter].toLowerCase()} batches.</p>
      )}

      {batches && batches.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.filter((b) => b.status === statusFilter).map((b, i) => (
            <button
              key={b.id}
              onClick={() => setViewingBatchId(b.id)}
              style={cardGradient(i)}
              className="relative rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3 text-left cursor-pointer"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingBatch(b);
                }}
                title="Delete batch"
                className="absolute top-3 right-3 p-1.5 rounded-input text-white/70 hover:bg-black/15 hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
              <div className="flex items-center gap-2">
                <span className="h-9 w-9 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
                  <Layers size={18} strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <p className="font-display font-bold text-white truncate">{b.name}</p>
                  <p className="text-[11px] text-white/70 font-mono">{b.batchCode}</p>
                </div>
              </div>
              {(b.startCefr || b.targetCefr) && (
                <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-pill bg-white/20 text-white">
                  Goal: {b.startCefr ?? "?"} → {b.targetCefr ?? "?"}
                </span>
              )}
              <div className="flex items-center gap-1.5 text-white/80 text-xs">
                <Users size={13} /> {b.learnerCount} learner{b.learnerCount === 1 ? "" : "s"}
              </div>
              {b.durationMonths && (
                <p className="text-xs text-white/70">
                  {b.durationMonths} month{b.durationMonths === 1 ? "" : "s"}
                  {b.startDate ? ` · starts ${new Date(b.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
                  {b.endDate ? ` · ${b.status === "active" ? "ends" : "ended"} ${new Date(b.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
                </p>
              )}
              {b.status !== "active" && (
                <span className="self-start text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 text-white uppercase tracking-wide">
                  {BATCH_STATUS_LABEL[b.status]}
                </span>
              )}
              <p className="text-xs text-white/70">
                {b.managerNames.length === 0 ? "No manager assigned yet" : `Managed by ${b.managerNames.join(", ")}`}
              </p>
              <p className="text-xs text-white/80">
                {(() => {
                  const f = fixed.find((x) => x.batchId === b.id);
                  return f?.budget != null ? `Fixed licenses: ${f.used} used of ${f.budget} · ${Math.max(0, f.budget - f.used)} left` : "No fixed licenses — uses Manager's pool";
                })()}
              </p>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateBatchModal
          unreserved={unreserved}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            refreshPlan();
            setShowCreate(false);
            load();
          }}
        />
      )}

      {viewingBatchId && <OrgAdminBatchDetailModal batchId={viewingBatchId} onClose={() => setViewingBatchId(null)} onChanged={load} />}

      {deletingBatch && (
        <ConfirmActionModal
          title="Delete batch"
          message={`Delete "${deletingBatch.name}"? Its learners are removed from the batch (not deleted) and any manager loses this assignment. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          submitting={busyId === deletingBatch.id}
          onClose={() => setDeletingBatch(null)}
          onConfirm={() => handleDelete(deletingBatch)}
        />
      )}
    </div>
  );
}
