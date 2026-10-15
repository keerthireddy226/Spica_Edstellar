import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { formatShortDate } from "@/api/licenses";
import {
  endPilot,
  formatUsdCents,
  getOrgPlanAdmin,
  startPilot,
  TIER_LABELS,
  updateOrgPlan,
  type PlanEvent,
  type PlanSummary,
  type PlanTier,
} from "@/api/plans";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
function eventSentence(e: PlanEvent): string {
  switch (e.kind) {
    case "tier_change":
      return `${e.fromTier ? TIER_LABELS[e.fromTier] : "—"} → ${e.toTier ? TIER_LABELS[e.toTier] : "—"}`;
    case "price_change":
      return e.customPriceCents === null ? tr("Back to the standard rate card") : tr("Negotiated price set to {{formatUsdCents}}", { formatUsdCents: formatUsdCents(e.customPriceCents) });
    case "pilot_started":
      return tr("Pilot started");
    case "pilot_ended":
      return tr("Pilot ended");
    case "enterprise_inquiry":
      return tr("Asked about Enterprise");
  }
}

// Plan controls for Edstellar staff on one organization: tier, negotiated
// price, pilots, and the history of all of it.
export function OrgPlanAdminPanel({ tenantId, onTier }: { tenantId: string; onTier?: (tier: PlanTier) => void }) {
  const [plan, setPlan] = useState<(PlanSummary & { events: PlanEvent[] }) | null>(null);
  const [tier, setTier] = useState<PlanTier>("starter");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [pilotLicenses, setPilotLicenses] = useState("10");
  const [pilotDays, setPilotDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    getOrgPlanAdmin(tenantId)
      .then((p) => {
        setPlan(p);
        setTier(p.tier);
        onTier?.(p.tier);
        setPrice(p.customPriceCents === null ? "" : String(p.customPriceCents / 100));
      })
      .catch(() => setMessage({ ok: false, text: tr("Could not load the plan.") }));
  }
  useEffect(load, [tenantId]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: done });
      setNote("");
      load();
    } catch {
      setMessage({ ok: false, text: tr("That didn't save. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  if (!plan) return null;
  const priceCents = price.trim() === "" ? null : Math.round(Number(price) * 100);
  const dirty = tier !== plan.tier || priceCents !== plan.customPriceCents;
  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{tr("Plan")}</p>
      <div className="border border-rule rounded-input px-4 py-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Tier")}</label>
            <select value={tier} onChange={(e) => setTier(e.target.value as PlanTier)} className={`${inputClass} cursor-pointer`}>
              {(Object.keys(TIER_LABELS) as PlanTier[]).map((t) => (
                <option key={t} value={t}>
                  {TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Negotiated price (USD / license)")}</label>
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={tr("Rate card")} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Note (shown in history)")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. Annual contract signed")} className={inputClass} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted">
            {plan.limits.map((l) => `${l.used} ${l.key}${l.max !== null ? ` of ${l.max}` : ""}`).join(" · ")}
            {plan.educationDiscountPercent > 0 && tr(" · {{educationDiscountPercent}}% education discount", { educationDiscountPercent: plan.educationDiscountPercent })}
          </p>
          <Button
            disabled={busy || !dirty}
            onClick={() =>
              run(
                () =>
                  updateOrgPlan(tenantId, {
                    ...(tier !== plan.tier ? { tier } : {}),
                    ...(priceCents !== plan.customPriceCents ? { customPriceCents: priceCents } : {}),
                    note: note.trim() || undefined,
                  }),
                tr("Plan updated. The Org Admin has been notified."),
              )
            }
          >
            {tr("Save plan")}</Button>
        </div>

        <div className="border-t border-rule pt-4">
          {plan.pilotEndsAt ? (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-ink">{tr("Pilot running until {{formatShortDate}}", { formatShortDate: formatShortDate(plan.pilotEndsAt) })}</p>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => endPilot(tenantId), tr("Pilot ended."))}>
                {tr("End pilot now")}</Button>
            </div>
          ) : (
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">{tr("Pilot licenses")}</label>
                <input type="number" min={1} max={500} value={pilotLicenses} onChange={(e) => setPilotLicenses(e.target.value)} className={`${inputClass} w-28`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">{tr("Days")}</label>
                <input type="number" min={1} max={180} value={pilotDays} onChange={(e) => setPilotDays(e.target.value)} className={`${inputClass} w-24`} />
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => startPilot(tenantId, { licenses: Number(pilotLicenses) || 10, days: Number(pilotDays) || 30 }),
                    tr("Pilot started. The free licenses lapse when it ends."),
                  )
                }
              >
                {tr("Start pilot")}</Button>
            </div>
          )}
        </div>

        {message && <p className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>}

        {plan.events.length > 0 && (
          <div className="border-t border-rule pt-3 flex flex-col gap-1.5">
            {plan.events.slice(0, 8).map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-ink">
                  {eventSentence(e)}
                  {e.note && <span className="text-muted"> — {trServer(e.note)}</span>}
                </span>
                <span className="text-xs text-muted shrink-0">
                  {e.actorName ? `${e.actorName} · ` : ""}
                  {formatShortDate(e.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
