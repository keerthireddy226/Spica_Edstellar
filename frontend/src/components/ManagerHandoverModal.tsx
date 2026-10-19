import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { handOverManager, type OrgManager } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
// A Manager is leaving or changing role: their batches (and the unused part
// of their license pool) go to another Manager in one step.
export function ManagerHandoverModal({
  from,
  managers,
  onClose,
  onDone,
}: {
  from: OrgManager;
  managers: OrgManager[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const options = managers.filter((m) => m.id !== from.id && m.active);
  const [to, setTo] = useState(options[0]?.id ?? "");
  const [movePool, setMovePool] = useState(true);
  const [deactivate, setDeactivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (m: OrgManager) => [m.firstName, m.lastName].filter(Boolean).join(" ") || m.email;
  const unused = from.licensesAllotted != null ? Math.max(0, from.licensesAllotted - from.licensesUsed) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Hand over {{name}}'s work", { name: name(from) })}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          {options.length === 0 ? (
            <p className="text-sm text-muted">{tr("Onboard another Manager first — there's nobody to hand over to.")}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {tr("New Manager")}<select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink normal-case font-normal tracking-normal cursor-pointer">
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {name(m)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-ink">
                {from.batchNames.length ? tr("Batches: {{join}}.", { join: from.batchNames.join(", ") }) : tr("No batches to move.")} {tr("Their pending license requests move too.")}</p>
              {unused > 0 && (
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={movePool} onChange={(e) => setMovePool(e.target.checked)} className="h-4 w-4 accent-navy" />
                  {unused === 1 ? tr("Move their 1 unused license to the new Manager's pool") : tr("Move their {{n}} unused licenses to the new Manager's pool", { n: unused })}</label>
              )}
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} className="h-4 w-4 accent-navy" />
                {tr("Deactivate {{name}} afterwards", { name: name(from) })}</label>
            </>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button
              disabled={busy || !to}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await handOverManager(from.id, { toManagerId: to, movePool, deactivate });
                  onDone(
                    r.batchesMoved === 1
                      ? r.poolMoved
                        ? tr("1 batch handed over, with {{licenses}} licenses.", { licenses: r.poolMoved })
                        : tr("1 batch handed over.")
                      : r.poolMoved
                        ? tr("{{n}} batches handed over, with {{licenses}} licenses.", { n: r.batchesMoved, licenses: r.poolMoved })
                        : tr("{{n}} batches handed over.", { n: r.batchesMoved }),
                  );
                } catch (err) {
                  setError(err instanceof ApiError ? tr("Couldn't hand over — check the new Manager's plan allows license pools.") : tr("Couldn't hand over."));
                  setBusy(false);
                }
              }}
              className="flex-1"
            >
              {busy ? tr("Handing over…") : tr("Hand over")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
