import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { commercialApi, type OrgCommercial } from "@/api/admin";
import { formatAmount } from "@/api/payments";
import { HealthBadge } from "@/components/HealthBadge";

// Edstellar's account view of one organization: health, contract, account
// manager, invoice payments to record, credit notes, and "view as".
export function OrgCommercialPanel({ tenantId, hasOrgAdmin }: { tenantId: string; hasOrgAdmin: boolean }) {
  const [data, setData] = useState<OrgCommercial | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [refFor, setRefFor] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [creditFor, setCreditFor] = useState<string | null>(null);
  const [credit, setCredit] = useState({ amount: "", licenses: "0", reason: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load() {
    commercialApi
      .get(tenantId)
      .then((d) => {
        setData(d);
        setForm({
          contractStart: d.contract.start?.slice(0, 10) ?? "",
          contractEnd: d.contract.end?.slice(0, 10) ?? "",
          contractValue: d.contract.valueCents !== null ? String(d.contract.valueCents / 100) : "",
          contractCurrency: d.contract.currency ?? "USD",
          contractNotes: d.contract.notes ?? "",
          accountManagerId: d.accountManager?.id ?? "",
        });
      })
      .catch(() => {});
  }
  useEffect(load, [tenantId]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      load();
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      setMsg({
        ok: false,
        text:
          code === "amount_too_high"
            ? "That's more than is left to credit on this invoice."
            : code === "not_enough_unused_licenses"
              ? "That many licenses from this purchase aren't unused any more."
              : code === "contract_end_before_start"
                ? "The contract can't end before it starts."
                : "That didn't save.",
      });
    }
  }

  if (!data) return null;
  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  const pending = data.orders.filter((o) => o.provider === "invoice" && o.status === "created");
  const paid = data.orders.filter((o) => o.status === "paid" && o.invoiceId);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Account</p>
        {hasOrgAdmin && (
          <button
            onClick={() => act(async () => {
              await commercialApi.viewAs(tenantId);
              window.location.assign("/orgadmin/dashboard");
            }, "Opening…")}
            className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
            title="Open their console read-only for an hour; recorded in their audit log"
          >
            <Eye size={13} /> View as Org Admin
          </button>
        )}
      </div>
      <div className="border border-rule rounded-input px-4 py-4 flex flex-col gap-4">
        {data.health && (
          <div className="flex items-start gap-3">
            <HealthBadge health={data.health} />
            <p className="text-xs text-muted">{data.health.flags.length ? data.health.flags.join(" · ") : "No issues spotted."}</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Contract start
            <input type="date" value={form.contractStart} onChange={(e) => setForm({ ...form, contractStart: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Contract end
            <input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Value
            <div className="flex gap-1">
              <select value={form.contractCurrency} onChange={(e) => setForm({ ...form, contractCurrency: e.target.value })} className={`${inputClass} !px-1.5`}>
                {["USD", "INR", "EUR", "GBP"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input type="number" min={0} value={form.contractValue} onChange={(e) => setForm({ ...form, contractValue: e.target.value })} className={`${inputClass} w-full`} />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Account manager
            <select value={form.accountManagerId} onChange={(e) => setForm({ ...form, accountManagerId: e.target.value })} className={`${inputClass} cursor-pointer`}>
              <option value="">None</option>
              {data.accountManagerOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input placeholder="Contract notes (renewal terms, discounts…)" value={form.contractNotes} onChange={(e) => setForm({ ...form, contractNotes: e.target.value })} className={inputClass} />
        <Button
          variant="secondary"
          className="self-start !px-3.5 !py-2"
          onClick={() =>
            act(
              () =>
                commercialApi.update(tenantId, {
                  contractStart: form.contractStart || null,
                  contractEnd: form.contractEnd || null,
                  contractValueCents: form.contractValue ? Math.round(Number(form.contractValue) * 100) : null,
                  contractCurrency: form.contractCurrency || null,
                  contractNotes: form.contractNotes || null,
                  accountManagerId: form.accountManagerId || null,
                }),
              "Account details saved.",
            )
          }
        >
          Save account details
        </Button>

        {pending.length > 0 && (
          <div className="border-t border-rule pt-3 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Awaiting payment</p>
            {pending.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 text-sm flex-wrap">
                <span>
                  <a href={`/quote/${o.id}`} target="_blank" rel="noreferrer" className="font-mono text-navy hover:underline">
                    {o.quoteNumber}
                  </a>{" "}
                  · {o.quantity} licenses · {formatAmount(o.total, o.currency)}
                  {o.poNumber ? ` · PO ${o.poNumber}` : ""}
                </span>
                {refFor === o.id ? (
                  <span className="flex gap-2">
                    <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Bank reference" className={`${inputClass} !py-1`} />
                    <Button disabled={!reference.trim()} onClick={() => act(() => commercialApi.markPaid(tenantId, o.id, reference.trim()), "Payment recorded — invoice issued and licenses added.").then(() => setRefFor(null))} className="!px-3 !py-1">
                      Record
                    </Button>
                  </span>
                ) : (
                  <span className="flex gap-3">
                    <button onClick={() => { setRefFor(o.id); setReference(""); }} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                      Mark paid
                    </button>
                    <button onClick={() => act(() => commercialApi.cancel(tenantId, o.id), "Cancelled.")} className="text-xs font-semibold text-muted hover:text-error cursor-pointer">
                      Cancel
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {paid.length > 0 && (
          <div className="border-t border-rule pt-3 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Invoices</p>
            {paid.slice(0, 8).map((o) => (
              <div key={o.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <a href={`/invoice/${o.invoiceId}`} target="_blank" rel="noreferrer" className="font-mono text-navy hover:underline">
                      {o.invoiceNumber}
                    </a>{" "}
                    · {formatAmount(o.total, o.currency)}
                    {o.credited ? ` · ${formatAmount(o.credited, o.currency)} credited` : ""}
                  </span>
                  <button onClick={() => setCreditFor(creditFor === o.invoiceId ? null : o.invoiceId)} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                    Credit note
                  </button>
                </div>
                {creditFor === o.invoiceId && (
                  <div className="flex gap-2 flex-wrap items-end bg-paper-warm rounded-input p-3">
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Amount ({o.currency})
                      <input type="number" min={0} value={credit.amount} onChange={(e) => setCredit({ ...credit, amount: e.target.value })} className={`${inputClass} w-28`} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Remove unused licenses
                      <input type="number" min={0} value={credit.licenses} onChange={(e) => setCredit({ ...credit, licenses: e.target.value })} className={`${inputClass} w-24`} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-40">
                      Reason
                      <input value={credit.reason} onChange={(e) => setCredit({ ...credit, reason: e.target.value })} className={inputClass} />
                    </label>
                    <Button
                      disabled={!credit.amount || credit.reason.trim().length < 3}
                      onClick={() =>
                        act(
                          () =>
                            commercialApi.creditNote(tenantId, o.invoiceId!, {
                              amount: Math.round(Number(credit.amount) * 100),
                              licensesToRemove: Math.max(0, Math.floor(Number(credit.licenses) || 0)),
                              reason: credit.reason.trim(),
                            }),
                          "Credit note issued. Refund the money in Stripe, Razorpay or by bank.",
                        ).then(() => {
                          setCreditFor(null);
                          setCredit({ amount: "", licenses: "0", reason: "" });
                        })
                      }
                      className="!px-3 !py-2"
                    >
                      Issue
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
