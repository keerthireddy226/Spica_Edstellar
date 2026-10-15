import { useEffect, useState } from "react";
import { Minus, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { LICENSE_ERROR_TEXT, getOrgLicenseSummary, setBatchBudget } from "@/api/licenses";
import { planErrorMessage } from "@/api/plans";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";

import { tr } from "@/i18n/tr";
// A batch's fixed license allotment, with an inline editor for the Org Admin.
export function BatchFixedLicenses({
  batchId,
  allotted,
  used,
  stats,
  learnersLicensed,
  learnersTotal,
  onChanged,
}: {
  batchId: string;
  allotted: number | null;
  used: number;
  stats?: { total: number; fromFixed: number; fromManagerPools: number; fromOrgPool: number; used: number; notStarted: number };
  learnersLicensed: number;
  learnersTotal: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // On a plan without fixed allotments an existing one can still be lowered or removed.
  const allowed = useHasFeature("batch_allotments") !== false;
  const [value, setValue] = useState(allotted ?? 0);
  const [unreserved, setUnreserved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    getOrgLicenseSummary()
      .then((s) => setUnreserved(s.unreserved))
      .catch(() => {});
  }, [editing]);

  const current = allotted ?? 0;
  // Most this batch can hold: what it already has set aside + everything unreserved.
  const max = unreserved === null ? null : current + unreserved;
  const left = allotted === null ? null : Math.max(0, allotted - used);

  async function save(next: number | null) {
    setSaving(true);
    setError(null);
    try {
      await setBatchBudget(batchId, next);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(planErrorMessage(err) ?? LICENSE_ERROR_TEXT[err instanceof ApiError ? err.message : ""] ?? tr("Couldn't save."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Licenses")}</p>
        {!editing && (allowed || allotted !== null) && (
          <button
            onClick={() => {
              setValue(current);
              setEditing(true);
            }}
            className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
          >
            <Pencil size={12} /> {allotted === null ? tr("Set fixed licenses") : tr("Change fixed licenses")}
          </button>
        )}
      </div>
      {!allowed && allotted === null && (
        <div className="mb-2">
          <PlanLockNote feature="batch_allotments" compact />
        </div>
      )}
      <div className="border border-rule rounded-input px-4 py-3">
        {!editing ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {(
                [
                  [tr("Fixed allotted"), allotted === null ? tr("None") : allotted, tr("Set aside only for this batch")],
                  [tr("Fixed left"), left === null ? "—" : left, tr("Still unassigned from the fixed allotment")],
                  [tr("Assigned"), stats?.total ?? 0, tr("License-months given to this batch's learners")],
                  [tr("Used"), stats?.used ?? 0, tr("Months already started or finished")],
                  [tr("Not started"), stats?.notStarted ?? 0, tr("Assigned months still queued — can be returned")],
                  [tr("Learners licensed"), `${learnersLicensed} / ${learnersTotal}`, tr("Learners with active access right now")],
                ] as const
              ).map(([label, v, hint]) => (
                <div key={label} className="rounded-input bg-paper-warm/60 px-3 py-2.5" title={hint}>
                  <p className="text-[11px] text-muted">{label}</p>
                  <p className="text-lg font-display font-bold text-ink">{v}</p>
                </div>
              ))}
            </div>
            {allotted !== null && (
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-rule overflow-hidden">
                  <div className="h-full bg-navy rounded-full" style={{ width: `${allotted ? Math.min(100, (used / allotted) * 100) : 0}%` }} />
                </div>
                <span className="text-xs text-muted whitespace-nowrap">
                  {tr("{{used}} of {{allotted}} fixed licenses assigned", { used: used, allotted: allotted })}</span>
              </div>
            )}
            <p className="text-xs text-muted">
              {stats && stats.total > 0
                ? tr("Assigned licenses came from: {{fromFixed}} fixed · {{fromManagerPools}} Manager pools · {{fromOrgPool}} your unreserved pool.", { fromFixed: stats.fromFixed, fromManagerPools: stats.fromManagerPools, fromOrgPool: stats.fromOrgPool })
                : tr("No licenses assigned to this batch's learners yet.")}
              {allotted === null && tr(" This batch has no fixed licenses — learners get them from their Manager's pool, or your unreserved pool when you assign.")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setValue((v) => Math.max(used, v - 1))}
                className="h-9 w-9 rounded-input border border-rule flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer"
              >
                <Minus size={15} />
              </button>
              <input
                type="number"
                min={used}
                max={max ?? undefined}
                value={value}
                onChange={(e) => setValue(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="w-20 text-center rounded-input border border-rule bg-paper px-2 py-1.5 text-lg font-display font-bold text-ink focus:border-navy focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setValue((v) => (max === null ? v + 1 : Math.min(max, v + 1)))}
                className="h-9 w-9 rounded-input border border-rule flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer"
              >
                <Plus size={15} />
              </button>
              <span className="text-xs text-muted ml-2">
                {value > current ? tr("+{{v}} from unreserved", { v: value - current }) : value < current ? tr("{{v}} back to unreserved", { v: current - value }) : tr("No change")}
              </span>
            </div>
            <p className="text-xs text-muted">
              {tr("{{used}} already assigned, so it can't go below {{used2}}.", { used: used, used2: used })}{max !== null ? tr(" Up to {{max}} ({{unreserved}} unreserved).", { max: max, unreserved: unreserved }) : ""}
            </p>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex items-center gap-2">
              <Button onClick={() => save(value)} disabled={saving || value === current || value < used} className="!px-3 !py-1.5 !text-xs">
                {saving ? tr("Saving…") : tr("Save")}
              </Button>
              {allotted !== null && used === 0 && (
                <Button variant="secondary" onClick={() => save(null)} disabled={saving} className="!px-3 !py-1.5 !text-xs">
                  {tr("Remove fixed licenses")}</Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving} className="!px-3 !py-1.5 !text-xs">
                {tr("Cancel")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
