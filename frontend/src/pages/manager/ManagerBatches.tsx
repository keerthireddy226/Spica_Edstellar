import { useEffect, useState } from "react";
import { Plus, Layers, Users, MapPin, KeyRound } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { BatchFormModal } from "@/components/BatchFormModal";
import { ManagerBatchModal } from "@/components/ManagerBatchModal";
import { BATCH_STATUS_LABEL } from "@/components/BatchLifecycleActions";
import { PlanLimitHint, PlanLockNote, refreshPlan, useHasFeature } from "@/components/plans/usePlan";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";
import { EXAM_FOCUS_LABEL } from "@/api/details";
import { getManagerBatches, managerCreateBatch, type ManagerBatch } from "@/api/manager";
import { getManagerLicenseOverview, type BatchBudget, type ManagerPool } from "@/api/licenses";

import { tr } from "@/i18n/tr";
type Status = ManagerBatch["status"];

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const fieldClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-muted";

// A Manager's new batch. Licenses can be set aside from their own pool right
// away (no approval needed, they're already theirs), and more can be asked
// of the Org Admin in the same step.
function NewBatchModal({ poolLeft, onClose, onCreated }: { poolLeft: number | null; onClose: () => void; onCreated: (text: string) => void }) {
  const [fromPool, setFromPool] = useState("");
  const [askMore, setAskMore] = useState(false);
  const [askQty, setAskQty] = useState("");
  const [askReason, setAskReason] = useState("");
  const allotmentsAllowed = useHasFeature("batch_allotments") !== false;
  const requestsAllowed = useHasFeature("license_requests") !== false;
  const n = Math.max(0, Math.floor(Number(fromPool) || 0));
  const tooMany = poolLeft !== null && n > poolLeft;

  return (
    <BatchFormModal
      title={tr("New batch")}
      submitLabel={tr("Create batch")}
      note={tr("You manage this batch automatically and it shows on your Org Admin's Batches page. Learners use its fixed licenses first, then your pool.")}
      onClose={onClose}
      extra={
        !allotmentsAllowed ? (
          <div className="sm:col-span-2">
            <PlanLockNote feature="batch_allotments" compact />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className={labelClass}>{tr("Fixed licenses from your pool")}</label>
              <input
                type="number"
                min={0}
                max={poolLeft ?? 0}
                value={fromPool}
                onChange={(e) => setFromPool(e.target.value)}
                placeholder={poolLeft ? tr("Up to {{poolLeft}}", { poolLeft: poolLeft }) : tr("None")}
                disabled={!poolLeft}
                className={fieldClass}
              />
              <p className={`text-xs ${tooMany ? "text-error" : "text-muted"}`}>
                {poolLeft === null
                  ? tr("You have no license pool yet — ask your Org Admin for licenses below.")
                  : tooMany
                    ? tr("Only {{poolLeft}} left in your pool.", { poolLeft: poolLeft })
                    : tr("{{poolLeft}} left in your pool. These move into the batch and are kept for its learners only.", { poolLeft: poolLeft })}
              </p>
            </div>
            {requestsAllowed && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={askMore} onChange={(e) => setAskMore(e.target.checked)} className="h-4 w-4 accent-navy" />
                  {tr("Also ask my Org Admin for fixed licenses for this batch")}</label>
                {askMore && (
                  <div className="grid sm:grid-cols-3 gap-3">
                    <input type="number" min={1} value={askQty} onChange={(e) => setAskQty(e.target.value)} placeholder={tr("How many")} className={fieldClass} />
                    <input
                      value={askReason}
                      onChange={(e) => setAskReason(e.target.value)}
                      placeholder={tr("Reason, e.g. 12 new joiners")}
                      className={`${fieldClass} sm:col-span-2`}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )
      }
      onSubmit={async (d) => {
        if (tooMany) throw new Error("too_many");
        const ask = askMore && Number(askQty) > 0 && askReason.trim() ? { quantity: Math.floor(Number(askQty)), reason: askReason.trim() } : undefined;
        const r = await managerCreateBatch({ ...d, fixedFromPool: n || undefined, requestFromOrg: ask });
        onCreated(
          [
            `${d.name} created.`,
            r.fixedLicenses ? tr("{{fixedLicenses}} licenses set aside from your pool.", { fixedLicenses: r.fixedLicenses }) : "",
            r.requestId ? tr("Request for {{quantity}} more sent to your Org Admin.", { quantity: ask!.quantity }) : "",
            r.requestError ? tr("The license request couldn't be sent — try again from the batch.") : "",
            tr("Invite learners into it from Learners."),
          ]
            .filter(Boolean)
            .join(" "),
        );
      }}
    />
  );
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
      .catch(() => setError(tr("Could not load your batches.")));
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
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Batches")}</h1>
          <p className="text-sm text-muted mt-1">{tr("The batches you manage — never the whole organization.")}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setCreating(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={18} /> {tr("New batch")}</Button>
          <PlanLimitHint limit="batches" />
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm px-5 py-4 flex items-center gap-5 flex-wrap">
        <span className="h-10 w-10 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
          <KeyRound size={20} strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-48">
          <p className="font-semibold text-ink text-sm">{tr("Your license pool")}</p>
          <p className="text-xs text-muted">
            {myPool?.allotment != null
              ? tr("{{v}} left of {{allotment}} · used for learners in batches without fixed licenses, or once those run out.", { v: myPool.remaining ?? 0, allotment: myPool.allotment })
              : tr("None allotted yet — learners can only get licenses from a batch's fixed licenses.")}
          </p>
        </div>
        <button onClick={() => setRequestingFor("")} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
          {tr("Request licenses")}</button>
      </div>

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      {!batches && !error && <p className="text-sm text-muted">{tr("Loading…")}</p>}

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
          {tr("No batches yet — create one, or ask your Org Admin to assign you one.")}</p>
      )}
      {batches && batches.length > 0 && shown.length === 0 && <p className="text-sm text-muted">{tr("No {{toLowerCase}} batches.", { toLowerCase: BATCH_STATUS_LABEL[status].toLowerCase() })}</p>}

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
                    {tr("Goal:")}{" "}{b.startCefr ?? "?"} → {b.targetCefr ?? "?"}
                  </span>
                )}
                <div className="flex items-center gap-1.5 text-white/85 text-xs">
                  <Users size={13} /> {L.learners}
                  {b.capacity ? ` of ${b.capacity}` : ""} {tr("learner{{v}}", { v: (b.capacity ?? L.learners) === 1 ? "" : "s" })}
                  {b.capacity && L.learners >= b.capacity ? tr(" · full") : ""}
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
                    {fixedLeft !== null ? tr("Fixed licenses: {{fixedLeft}} left of {{fixedLicenses}}", { fixedLeft: fixedLeft, fixedLicenses: b.fixedLicenses }) : tr("No fixed licenses — uses your pool")}
                    {L.fromPool ? tr(" · {{fromPool}} from your pool", { fromPool: L.fromPool }) : ""}
                  </span>
                  <span>
                    {tr("{{licensed}} licensed · {{unlicensed}} without a license", { licensed: L.licensed, unlicensed: L.unlicensed })}{L.endingSoon ? tr(" · {{endingSoon}} ending soon", { endingSoon: L.endingSoon }) : ""}
                  </span>
                  {b.defaultLicenseMonths != null && (
                    <span className="text-white/70">
                      {tr("New learners get {{defaultLicenseMonths}} month{{v}}", { defaultLicenseMonths: b.defaultLicenseMonths, v: b.defaultLicenseMonths === 1 ? "" : "s" })}
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
                      {b.fixedLicenses != null ? tr("Request more") : tr("Request fixed licenses")}
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
        <NewBatchModal
          poolLeft={myPool?.allotment != null ? (myPool.remaining ?? 0) : null}
          onClose={() => setCreating(false)}
          onCreated={(text) => {
            refreshPlan();
            setCreating(false);
            setNotice(text);
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
            setNotice(tr("Request sent to your Org Admin."));
          }}
        />
      )}
    </div>
  );
}
