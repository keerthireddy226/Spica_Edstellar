import { useEffect, useState } from "react";
import { Plus, Layers, Users, Trash2, MapPin, ArrowRight } from "lucide-react";
import { OrgEmptyState, OrgLoadError, OrgLoading, OrgTabs } from "@/components/OrgAdminUi";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { OrgAdminBatchDetailModal } from "@/components/OrgAdminBatchDetailModal";
import { getBatches, createBatch, deleteBatch, type OrgBatch, type BatchStatus } from "@/api/orgAdmin";
import { BatchFormModal } from "@/components/BatchFormModal";
import { EXAM_FOCUS_LABEL } from "@/api/details";
import { BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { getOrgLicenseOverview } from "@/api/licenses";
import { PlanLimitHint, PlanLockNote, refreshPlan, useHasFeature } from "@/components/plans/usePlan";

import { tr } from "@/i18n/tr";
function CreateBatchModal({ onClose, onCreated, unreserved }: { onClose: () => void; onCreated: () => void; unreserved: number | null }) {
  const [fixedLicenses, setFixedLicenses] = useState("");
  const allotmentsAllowed = useHasFeature("batch_allotments") !== false;
  return (
    <BatchFormModal
      title={tr("New batch")}
      submitLabel={tr("Create batch")}
      onClose={onClose}
      onSubmit={async (d) => {
        await createBatch({ ...d, licenseAllotment: allotmentsAllowed && fixedLicenses.trim() ? Number(fixedLicenses) : undefined });
        onCreated();
      }}
      extra={
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Fixed licenses for this batch (optional)")}</label>
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
                placeholder={tr("None — learners use their Manager's pool")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
              <p className="text-xs text-muted">
                {tr("Set aside only for this batch's learners")}{unreserved !== null ? tr(" · {{unreserved}} unreserved licenses available", { unreserved: unreserved }) : ""}.
              </p>
            </>
          )}
        </div>
      }
    />
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
  const [statusFilter, setStatusFilter] = useState<BatchStatus>("active");

  function load() {
    setError(null);
    getBatches()
      .then((res) => setBatches(res.batches))
      .catch(() => setError(tr("Could not load batches.")));
    getOrgLicenseOverview()
      .then((res) => setUnreserved(res.summary.unreserved))
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
      setError(tr("Could not delete that batch."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Batches")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Sub-groups inside your organization — e.g. \"2026 Intake\".")}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={18} /> {tr("New Batch")}</Button>
          <PlanLimitHint limit="batches" />
        </div>
      </div>

      {error && <OrgLoadError text={error} onRetry={load} />}
      {!batches && !error && <OrgLoading />}
      {batches && batches.length > 0 && (
        <OrgTabs
          value={statusFilter}
          onChange={setStatusFilter}
          tabs={(["active", "completed", "archived"] as BatchStatus[]).map((st) => [st, `${BATCH_STATUS_LABEL[st]} (${batches.filter((b) => b.status === st).length})`] as const)}
        />
      )}

      {batches?.length === 0 && (
        <OrgEmptyState
          icon={Layers}
          title={tr("No batches yet — create your first one.")}
          text={tr("Sub-groups inside your organization — e.g. \"2026 Intake\".")}
          action={
            <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2">
              <Plus size={16} /> {tr("New Batch")}
            </Button>
          }
        />
      )}
      {batches && batches.length > 0 && batches.filter((b) => b.status === statusFilter).length === 0 && (
        <p className="text-sm text-muted bg-surface border border-dashed border-rule-strong rounded-card px-5 py-8 text-center">
          {tr("No {{toLowerCase}} batches.", { toLowerCase: BATCH_STATUS_LABEL[statusFilter].toLowerCase() })}
        </p>
      )}

      {batches && batches.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.filter((b) => b.status === statusFilter).map((b, i) => (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              onClick={() => setViewingBatchId(b.id)}
              onKeyDown={(e) => e.key === "Enter" && setViewingBatchId(b.id)}
              style={cardGradient(i)}
              className="relative rounded-card shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 flex flex-col gap-3 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingBatch(b);
                }}
                title={tr("Delete batch")}
                aria-label={tr("Delete batch")}
                className="absolute top-3 right-3 p-1.5 rounded-input text-white/70 hover:bg-black/15 hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 size={15} />
              </button>
              <div className="flex items-center gap-2.5 pr-8">
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
                  {tr("Goal:")}{" "}{b.startCefr ?? "?"} → {b.targetCefr ?? "?"}
                </span>
              )}
              {(b.department || b.location || b.examFocus) && (
                <p className="text-xs text-white/80 flex items-center gap-1.5 flex-wrap">
                  {(b.department || b.location) && <MapPin size={12} />}
                  {[b.department, b.location, b.examFocus ? EXAM_FOCUS_LABEL[b.examFocus] : null].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex items-center gap-1.5 text-white/80 text-xs">
                <Users size={13} />{" "}
                {b.capacity
                  ? b.capacity === 1
                    ? tr("{{n}} of 1 learner", { n: b.learnerCount })
                    : tr("{{n}} of {{capacity}} learners", { n: b.learnerCount, capacity: b.capacity })
                  : b.learnerCount === 1
                    ? tr("1 learner")
                    : tr("{{n}} learners", { n: b.learnerCount })}
                {b.capacity && b.learnerCount >= b.capacity ? tr(" · full") : ""}
              </div>
              {b.durationMonths && (
                <p className="text-xs text-white/70">
                  {b.durationMonths === 1 ? tr("1 month") : tr("{{n}} months", { n: b.durationMonths })}
                  {b.startDate ? tr(" · starts {{toLocaleDateString}}", { toLocaleDateString: new Date(b.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }) : ""}
                  {b.endDate
                    ? " · " +
                      (b.status === "active"
                        ? tr("ends {{date}}", { date: new Date(b.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) })
                        : tr("ended {{date}}", { date: new Date(b.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) }))
                    : ""}
                </p>
              )}
              {b.status !== "active" && (
                <span className="self-start text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 text-white uppercase tracking-wide">
                  {BATCH_STATUS_LABEL[b.status]}
                </span>
              )}
              <p className="text-xs text-white/70">
                {b.managerNames.length === 0 ? tr("No manager assigned yet") : tr("Managed by {{join}}", { join: b.managerNames.join(", ") })}
                {b.createdBy?.role === "manager" ? tr(" · created by {{name}}", { name: b.createdBy.name }) : ""}
              </p>
              <div className="mt-auto text-xs text-white/85 bg-black/10 rounded-input px-2.5 py-2 flex flex-col gap-0.5">
                <span>
                  {b.fixedLicenses != null
                    ? tr("Fixed licenses: {{fixedUsed}} used of {{fixedLicenses}} · {{max}} left", { fixedUsed: b.licenses.fixedUsed, fixedLicenses: b.fixedLicenses, max: Math.max(0, b.fixedLicenses - b.licenses.fixedUsed) })
                    : tr("No fixed licenses — uses Manager's pool")}
                </span>
                <span>
                  {tr("{{licensed}} licensed · {{unlicensed}} without a license", { licensed: b.licenses.licensed, unlicensed: b.licenses.unlicensed })}{b.licenses.endingSoon ? tr(" · {{endingSoon}} ending soon", { endingSoon: b.licenses.endingSoon }) : ""}
                </span>
              </div>
              <span className="self-end text-xs font-semibold text-white/90 flex items-center gap-1">
                {tr("View details")} <ArrowRight size={13} />
              </span>
            </div>
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
          title={tr("Delete batch")}
          message={tr("Delete \"{{name}}\"? Its learners are removed from the batch (not deleted) and any manager loses this assignment. This cannot be undone.", { name: deletingBatch.name })}
          confirmLabel={tr("Delete")}
          destructive
          submitting={busyId === deletingBatch.id}
          onClose={() => setDeletingBatch(null)}
          onConfirm={() => handleDelete(deletingBatch)}
        />
      )}
    </div>
  );
}
