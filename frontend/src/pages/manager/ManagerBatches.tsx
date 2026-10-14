import { useEffect, useState } from "react";
import { Plus, Layers, Users, MapPin, KeyRound } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { BatchFormModal } from "@/components/BatchFormModal";
import { ManagerBatchModal } from "@/components/ManagerBatchModal";
import { BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { PlanLimitHint, refreshPlan } from "@/components/plans/usePlan";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";
import { EXAM_FOCUS_LABEL } from "@/api/details";
import { getManagerBatches, managerCreateBatch, type ManagerBatch } from "@/api/manager";
import { getManagerLicenseOverview, type BatchBudget, type ManagerPool } from "@/api/licenses";

type Status = ManagerBatch["status"];

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Every batch the Manager runs: details, seats and licenses at a glance;
// a card opens the batch itself.
export function ManagerBatches() {
  const [batches, setBatches] = useState<ManagerBatch[] | null>(null);
  const [myPool, setMyPool] = useState<ManagerPool | undefined>(undefined);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("active");
  const [viewing, setViewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [requestingFor, setRequestingFor] = useState<string | null>(null);

  function load() {
    getManagerBatches()
      .then((r) => setBatches(r.batches))
      .catch(() => setError("Could not load your batches."));
    getManagerLicenseOverview()
      .then((r) => {
        setMyPool(r.myPool);
        setBudgets(r.batches);
      })
      .catch(() => {});
  }
  useEffect(load, []);

  const shown = (batches ?? []).filter((b) => b.status === status);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Batches</h1>
          <p className="text-sm text-muted mt-1">The batches you manage — never the whole organization.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setCreating(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={18} /> New batch
          </Button>
          <PlanLimitHint limit="batches" />
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm px-5 py-4 flex items-center gap-5 flex-wrap">
        <span className="h-10 w-10 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
          <KeyRound size={20} strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-48">
          <p className="font-semibold text-ink text-sm">Your license pool</p>
          <p className="text-xs text-muted">
            {myPool?.allotment != null
              ? `${myPool.remaining ?? 0} left of ${myPool.allotment} · used for learners in batches without fixed licenses, or once those run out.`
              : "None allotted yet — learners can only get licenses from a batch's fixed licenses."}
          </p>
        </div>
        <button onClick={() => setRequestingFor("")} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
          Request licenses
        </button>
      </div>

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {!batches && !error && <p className="text-sm text-muted">Loading…</p>}

      {batches && batches.length > 0 && (
        <div className="flex items-center gap-1 border-b border-rule">
          {(["active", "completed", "archived"] as Status[]).map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                status === st ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {BATCH_STATUS_LABEL[st]} ({batches.filter((b) => b.status === st).length})
            </button>
          ))}
        </div>
      )}

      {batches?.length === 0 && (
        <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
          No batches yet — create one, or ask your Org Admin to assign you one.
        </p>
      )}
      {batches && batches.length > 0 && shown.length === 0 && <p className="text-sm text-muted">No {BATCH_STATUS_LABEL[status].toLowerCase()} batches.</p>}

      {shown.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map((b, i) => {
            const L = b.licenses;
            const fixedLeft = b.fixedLicenses != null ? Math.max(0, b.fixedLicenses - L.fixedUsed) : null;
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => setViewing(b.id)}
                onKeyDown={(e) => e.key === "Enter" && setViewing(b.id)}
                style={cardGradient(i)}
                className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3 text-left cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
                    <Layers size={18} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display font-bold text-white truncate">{b.name}</p>
                    <p className="text-[11px] text-white/70 font-mono">{b.batchCode}</p>
                  </div>
                </div>
                {(b.department || b.location || b.examFocus) && (
                  <p className="text-xs text-white/80 flex items-center gap-1.5 flex-wrap">
                    {(b.department || b.location) && <MapPin size={12} />}
                    {[b.department, b.location, b.examFocus ? EXAM_FOCUS_LABEL[b.examFocus] : null].filter(Boolean).join(" · ")}
                  </p>
                )}
                {(b.startCefr || b.targetCefr) && (
                  <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-pill bg-white/20 text-white">
                    Goal: {b.startCefr ?? "?"} → {b.targetCefr ?? "?"}
                  </span>
                )}
                <div className="flex items-center gap-1.5 text-white/85 text-xs">
                  <Users size={13} /> {L.learners}
                  {b.capacity ? ` of ${b.capacity}` : ""} learner{(b.capacity ?? L.learners) === 1 ? "" : "s"}
                  {b.capacity && L.learners >= b.capacity ? " · full" : ""}
                </div>
                {(b.startDate || b.endDate) && (
                  <p className="text-xs text-white/70">
                    {b.startDate ? `Starts ${fmt(b.startDate)}` : ""}
                    {b.startDate && b.endDate ? " · " : ""}
                    {b.endDate ? `${b.status === "active" ? "ends" : "ended"} ${fmt(b.endDate)}` : ""}
                  </p>
                )}
                <div className="text-xs text-white/90 bg-black/10 rounded-input px-2.5 py-2 flex flex-col gap-0.5">
                  <span>
                    {fixedLeft !== null ? `Fixed licenses: ${fixedLeft} left of ${b.fixedLicenses}` : "No fixed licenses — uses your pool"}
                    {L.fromPool ? ` · ${L.fromPool} from your pool` : ""}
                  </span>
                  <span>
                    {L.licensed} licensed · {L.unlicensed} without a license
                    {L.endingSoon ? ` · ${L.endingSoon} ending soon` : ""}
                  </span>
                  {b.defaultLicenseMonths != null && (
                    <span className="text-white/70">
                      New learners get {b.defaultLicenseMonths} month{b.defaultLicenseMonths === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {b.status !== "active" ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 text-white uppercase tracking-wide">
                      {BATCH_STATUS_LABEL[b.status]}
                    </span>
                  ) : (
                    <span />
                  )}
                  {b.status === "active" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRequestingFor(b.id);
                      }}
                      className="text-xs font-semibold text-white underline cursor-pointer"
                    >
                      {b.fixedLicenses != null ? "Request more" : "Request fixed licenses"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewing && <ManagerBatchModal batchId={viewing} onClose={() => setViewing(null)} onChanged={load} />}

      {creating && (
        <BatchFormModal
          title="New batch"
          submitLabel="Create batch"
          note="You manage this batch automatically. Its learners' licenses come from your pool unless your Org Admin gives it fixed licenses."
          onClose={() => setCreating(false)}
          onSubmit={async (d) => {
            await managerCreateBatch(d);
            refreshPlan();
            setCreating(false);
            setNotice(`${d.name} created. Invite learners into it from Learners.`);
            load();
          }}
        />
      )}

      {requestingFor !== null && (
        <RequestLicenseChangeModal
          myPool={myPool}
          batches={budgets}
          initialBatchId={requestingFor}
          onClose={() => setRequestingFor(null)}
          onSent={() => {
            setRequestingFor(null);
            setNotice("Request sent to your Org Admin.");
          }}
        />
      )}
    </div>
  );
}
