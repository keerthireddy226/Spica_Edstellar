import { useEffect, useState, type FormEvent } from "react";
import { Plus, X, Layers, Users, Trash2 } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { OrgAdminBatchDetailModal } from "@/components/OrgAdminBatchDetailModal";
import { getBatches, createBatch, deleteBatch, type OrgBatch } from "@/api/orgAdmin";

function CreateBatchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createBatch(name.trim());
      onCreated();
    } catch {
      setError("Something went wrong creating that batch.");
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

  function load() {
    getBatches()
      .then((res) => setBatches(res.batches))
      .catch(() => setError("Could not load batches."));
  }

  useEffect(load, []);

  async function handleDelete(batch: OrgBatch) {
    setBusyId(batch.id);
    try {
      await deleteBatch(batch.id);
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
        <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
          <Plus size={18} /> New Batch
        </Button>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!batches && !error && <p className="text-sm text-muted">Loading…</p>}
      {batches?.length === 0 && <p className="text-sm text-muted">No batches yet — create your first one.</p>}

      {batches && batches.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.map((b, i) => (
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
                <p className="font-display font-bold text-white">{b.name}</p>
              </div>
              <div className="flex items-center gap-1.5 text-white/80 text-xs">
                <Users size={13} /> {b.learnerCount} learner{b.learnerCount === 1 ? "" : "s"}
              </div>
              <p className="text-xs text-white/70">
                {b.managerNames.length === 0 ? "No manager assigned yet" : `Managed by ${b.managerNames.join(", ")}`}
              </p>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateBatchModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {viewingBatchId && <OrgAdminBatchDetailModal batchId={viewingBatchId} onClose={() => setViewingBatchId(null)} />}

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
