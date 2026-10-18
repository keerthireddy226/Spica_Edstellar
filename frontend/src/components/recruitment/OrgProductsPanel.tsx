import { useCallback, useEffect, useState } from "react";
import { Coins, Package } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyNote, Panel, StatusPill } from "@/components/staff/StaffKit";
import { ProctoringSettings } from "@/components/proctoring/ProctoringSettings";
import { shortDate } from "@/api/staff";
import { ApiError } from "@/lib/api";
import { getStaffRecruitment, grantCredits, setAssessmentPrice, setProducts, type Product, type StaffRecruitment } from "@/api/recruitment";
import { getTenantProctoringPolicy, saveTenantProctoringPolicy, type ProctoringPolicy } from "@/api/proctoring";
import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";

const OPTIONS: [Product[], () => string, () => string][] = [
  [["skills"], () => tr("Employee skills"), () => tr("Licenses, batches, Managers, learning and assessments for employees.")],
  [["recruitment"], () => tr("Recruitment"), () => tr("Proctored tests for job candidates, paid per assessment.")],
  [["skills", "recruitment"], () => tr("Both"), () => tr("Employees and candidates, each with their own proctoring settings.")],
];

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Edstellar staff: which products an organization has, its assessment
// credits and per-assessment price, and the candidates' proctoring policy.
export function OrgProductsPanel({ tenantId, onChanged }: { tenantId: string; onChanged?: () => void }) {
  const [d, setD] = useState<StaffRecruitment | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<"grant" | "purchase" | "adjustment">("purchase");
  const [note, setNote] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    getStaffRecruitment(tenantId)
      .then((x) => {
        setD(x);
        setPrice(x.customPriceCents !== null ? (x.customPriceCents / 100).toFixed(2) : "");
      })
      .catch(() => setMsg({ ok: false, text: tr("Could not load products.") }));
  }, [tenantId]);
  useEffect(load, [load]);
  const loadPolicy = useCallback(() => getTenantProctoringPolicy(tenantId, "candidates"), [tenantId]);
  const savePolicy = useCallback((p: ProctoringPolicy) => saveTenantProctoringPolicy(tenantId, p, "candidates"), [tenantId]);
  if (!d) return msg ? <p className="text-sm text-error">{msg.text}</p> : null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      load();
      onChanged?.();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.message === "balance_below_zero" ? tr("That would take the balance below zero.") : tr("Could not save.") });
    } finally {
      setBusy(false);
    }
  }
  const hasRecruitment = d.products.includes("recruitment");

  return (
    <div className="flex flex-col gap-5">
      <Panel title={tr("Products")} action={<Package size={18} className="text-muted" />}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {OPTIONS.map(([value, label, hint]) => {
            const selected = value.length === d.products.length && value.every((v) => d.products.includes(v));
            return (
              <button
                key={label()}
                disabled={busy || selected}
                onClick={() =>
                  window.confirm(tr("Switch this organization to {{p}}? Screens for products it no longer has are hidden; its data is kept.", { p: label() })) &&
                  run(() => setProducts(tenantId, value), tr("Products updated."))
                }
                className={`text-left rounded-card border p-3 flex flex-col gap-1 cursor-pointer disabled:cursor-default ${selected ? "border-navy bg-navy/10" : "border-rule bg-surface hover:border-navy/40"}`}
              >
                <span className="text-sm font-semibold text-ink">{label()}</span>
                <span className="text-xs text-muted">{hint()}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}

      {hasRecruitment && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Panel title={tr("Assessment credits")} action={<Coins size={18} className="text-muted" />}>
            <div className="flex items-baseline gap-3">
              <span className="font-display font-bold text-3xl text-ink">{d.credits}</span>
              <span className="text-sm text-muted">{tr("{{i}} invited · {{c}} completed · {{j}} job openings", { i: d.usage.invited, c: d.usage.completed, j: d.usage.jobs })}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={tr("Credits (negative to remove)")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
              <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
                <option value="purchase">{tr("Purchased")}</option>
                <option value="grant">{tr("Free / trial")}</option>
                <option value="adjustment">{tr("Adjustment")}</option>
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note (invoice, PO)")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
            </div>
            <div>
              <Button
                disabled={busy || !Number(amount)}
                onClick={() =>
                  run(async () => {
                    await grantCredits(tenantId, Number(amount), reason, note.trim() || undefined);
                    setAmount("");
                    setNote("");
                  }, tr("Credits updated."))
                }
              >
                {tr("Update credits")}
              </Button>
            </div>
            {d.events.length === 0 ? (
              <EmptyNote>{tr("No credits added yet.")}</EmptyNote>
            ) : (
              <ul className="divide-y divide-rule max-h-56 overflow-y-auto">
                {d.events.map((e, i) => (
                  <li key={i} className="py-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {e.note ? trServer(e.note) : e.reason} <span className="text-xs text-muted">· {shortDate(e.created_at)}{e.actor ? ` · ${e.actor}` : ""}</span>
                    </span>
                    <span className={`font-mono ${e.delta > 0 ? "text-success" : "text-error"}`}>
                      {e.delta > 0 ? "+" : ""}
                      {e.delta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={tr("Price per assessment")}>
            <p className="text-sm text-muted">{tr("The rate card applies unless you set a contract price for this organization.")}</p>
            <ul className="text-sm text-ink flex flex-col gap-1">
              {d.rateCard.map((b) => (
                <li key={b.minQuantity} className="flex justify-between">
                  <span>{tr("{{n}}+ credits", { n: b.minQuantity })}</span>
                  <span className="font-mono">{money(b.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-sm text-ink">
                {tr("Contract price (USD)")}
                <input type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={tr("Rate card")} className="w-32 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
              </label>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => setAssessmentPrice(tenantId, price.trim() ? Math.round(Number(price) * 100) : null), tr("Price saved."))}>
                {tr("Save price")}
              </Button>
            </div>
            {d.customPriceCents !== null && <StatusPill tone="navy">{tr("Contract price {{p}}", { p: money(d.customPriceCents) })}</StatusPill>}
            <p className="text-xs text-muted">{tr("Candidate data is kept {{n}} days after the hiring decision (set by the organization).", { n: d.retentionDays })}</p>
          </Panel>
        </div>
      )}

      {hasRecruitment && (
        <Panel title={tr("Proctoring for candidates")}>
          <ProctoringSettings load={loadPolicy} save={savePolicy} />
        </Panel>
      )}
    </div>
  );
}
