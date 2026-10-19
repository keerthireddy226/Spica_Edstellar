import { useEffect, useState, type FormEvent } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/Button";
import {
  getAdminOrgLicenses,
  creditOrgLicenses,
  formatMoney,
  formatShortDate,
  type PoolSummary,
  type LicensePurchase,
} from "@/api/licenses";

import { tr } from "@/i18n/tr";
const SOURCE_LABEL = { purchase: tr("Purchase"), credit: tr("Credit"), comp: tr("Complimentary") } as const;

function CreditModal({
  orgName,
  defaultPriceCents,
  customValidity,
  onSubmit,
  onClose,
}: {
  orgName: string;
  defaultPriceCents: number;
  // Enterprise organizations can have licenses that stay valid longer than 12 months.
  customValidity: boolean;
  onSubmit: (body: Parameters<typeof creditOrgLicenses>[1]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState("10");
  const [source, setSource] = useState<"purchase" | "credit" | "comp">("purchase");
  const [price, setPrice] = useState(String(defaultPriceCents / 100));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [validity, setValidity] = useState("12");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Math.max(0, Number(quantity) || 0);
  const unitCents = source === "comp" ? 0 : Math.round((Number(price) || 0) * 100);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (qty < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        quantity: qty,
        source,
        unitPriceCents: source === "comp" ? undefined : unitCents,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        validityMonths: customValidity ? Math.max(1, Math.min(36, Math.floor(Number(validity) || 12))) : undefined,
      });
    } catch {
      setError(tr("Could not add licenses."));
      setSubmitting(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Add licenses · {{orgName}}", { orgName: orgName })}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Licenses")}</label>
              <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Type")}</label>
              <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={`${inputClass} cursor-pointer`}>
                <option value="purchase">{tr("Purchase (billed)")}</option>
                <option value="credit">{tr("Credit")}</option>
                <option value="comp">{tr("Complimentary")}</option>
              </select>
            </div>
          </div>
          {source !== "comp" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Price per license (USD)")}</label>
              <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
            </div>
          )}
          {customValidity && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Valid for (months)")}</label>
              <input type="number" min={1} max={36} value={validity} onChange={(e) => setValidity(e.target.value)} className={inputClass} />
              <p className="text-xs text-muted">{tr("Enterprise only — standard licenses are valid for 12 months.")}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Invoice / reference")}</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={tr("e.g. INV-2026-014")} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Note (optional)")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </div>
          <p className="text-sm text-ink bg-paper-warm rounded-input px-3.5 py-2.5">
            {qty === 1 ? tr("1 license = 1 learner-month") : tr("{{n}} licenses = {{n}} learner-months", { n: qty })} ·{" "}
            <span className="font-semibold">{source === "comp" ? tr("no charge") : formatMoney(unitCents * qty)}</span>
            <span className="block text-xs text-muted mt-0.5">
              {tr("Unassigned licenses expire")}{" "}{customValidity ? Math.max(1, Math.floor(Number(validity) || 12)) : 12} {tr("months from today.")}</span>
          </p>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting || qty < 1} className="flex-1">
              {submitting ? tr("Adding…") : tr("Add {{qty}} licenses", { qty: qty })}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// License pool for one organization, as seen by Edstellar staff (Admin who
// owns the org, or Super Admin). Sales-led credits happen here until online
// checkout exists.
export function OrgLicensesPanel({ tenantId, orgName, planTier }: { tenantId: string; orgName: string; planTier?: string }) {
  const [summary, setSummary] = useState<PoolSummary | null>(null);
  const [purchases, setPurchases] = useState<LicensePurchase[]>([]);
  const [price, setPrice] = useState(10000);
  const [showCredit, setShowCredit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    getAdminOrgLicenses(tenantId)
      .then((res) => {
        setSummary(res.summary);
        setPurchases(res.purchases);
        setPrice(res.pricePerLicenseCents);
      })
      .catch(() => setError(tr("Could not load licenses.")));
  }

  useEffect(load, [tenantId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Licenses")}</p>
        <button
          onClick={() => setShowCredit(true)}
          className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
        >
          <Plus size={13} /> {tr("Add licenses")}</button>
      </div>
      <div className="border border-rule rounded-input px-4 py-3 flex flex-col gap-3">
        {error && <p className="text-sm text-error">{error}</p>}
        {!summary && !error && <p className="text-sm text-muted">{tr("Loading…")}</p>}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {(
              [
                [tr("Purchased"), summary.purchased],
                [tr("Available"), summary.available],
                [tr("Assigned"), summary.assigned],
                [tr("Active learners"), summary.activeLearners],
                [tr("Expired / grace"), summary.expiredLearners + summary.graceLearners],
                [tr("No license"), summary.unlicensedLearners],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-muted">{label}</p>
                <p className="text-sm font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
        )}
        {purchases.length > 0 && (
          <div className="border-t border-rule pt-3 flex flex-col gap-1.5">
            {purchases.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink">
                  {p.quantity} × {SOURCE_LABEL[p.source]}
                  {p.reference ? <span className="text-muted"> · {p.reference}</span> : null}
                </span>
                <span className="text-xs text-muted shrink-0">
                  {p.source === "comp" ? "free" : formatMoney(p.totalCents, p.currency)} · {tr("{{formatShortDate}}· {{remaining}} left", { formatShortDate: formatShortDate(p.purchasedAt), remaining: p.remaining })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {showCredit && (
        <CreditModal
          orgName={orgName}
          defaultPriceCents={price}
          customValidity={planTier === "enterprise"}
          onSubmit={async (body) => {
            await creditOrgLicenses(tenantId, body);
            setShowCredit(false);
            load();
          }}
          onClose={() => setShowCredit(false)}
        />
      )}
    </div>
  );
}
