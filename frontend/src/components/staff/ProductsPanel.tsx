import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { ApiError, api } from "@/lib/api";
import { getProducts, type Product } from "@/api/access";
import { tr } from "@/i18n/tr";

// Spica staff: each product's prices in every currency, whether it's on
// sale, and giving a product to a learner by hand (support, pilots).
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
type Prices = Record<string, Partial<Record<(typeof CURRENCIES)[number], number>>>;

const inputClass = "rounded-input border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink w-24 tabular-nums";

export function ProductsPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Prices>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", productId: "", level: "B1", days: "" });
  const [granting, setGranting] = useState(false);

  function load() {
    getProducts().then((r) => setProducts(r.products));
    api<{ prices: { productId: string; currency: string; amount: number }[] }>("/access/prices").then((r) => {
      const p: Prices = {};
      for (const x of r.prices) (p[x.productId] ??= {})[x.currency as (typeof CURRENCIES)[number]] = x.amount;
      setPrices(p);
    });
  }
  useEffect(load, []);

  async function save(id: string) {
    setSaving(id);
    setNote(null);
    try {
      await api(`/access/products/${id}/prices`, { method: "PUT", body: JSON.stringify(prices[id] ?? {}) });
      setNote(tr("Prices saved."));
    } catch {
      setNote(tr("Prices couldn't be saved."));
    } finally {
      setSaving(null);
    }
  }
  async function toggle(p: Product) {
    await api(`/access/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ active: !p.active }) });
    load();
  }
  async function give() {
    setGranting(true);
    setNote(null);
    try {
      const product = products.find((x) => x.id === grant.productId);
      await api("/access/grants", {
        method: "POST",
        body: JSON.stringify({
          email: grant.email.trim(),
          productId: grant.productId,
          // A level test and a practice pack are for one level.
          ...(product?.kind === "level" || product?.kind === "pack" ? { level: grant.level } : {}),
          ...(grant.days ? { days: Number(grant.days) } : {}),
        }),
      });
      setNote(tr("Given to {{email}}.", { email: grant.email.trim() }));
      setGrant({ ...grant, email: "" });
    } catch (err) {
      // Say what actually went wrong, not always the email.
      const code = err instanceof ApiError ? err.message : "";
      setNote(
        code === "user_not_found"
          ? tr("Couldn't give it. Check the email address.")
          : code === "level_required"
            ? tr("Choose a level first.")
            : code === "product_not_found"
              ? tr("That product no longer exists.")
              : tr("Couldn't give it ({{error}}).", { error: code || tr("network error") }),
      );
    } finally {
      setGranting(false);
    }
  }

  const chosen = products.find((x) => x.id === grant.productId);
  // Certificate extras change a certificate; they aren't something a learner owns.
  const givable = products.filter((p) => !String(p.kind).startsWith("cert_"));
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <div>
        <h2 className="font-display font-bold text-lg text-ink">{tr("Products and prices")}</h2>
        <p className="text-sm text-muted">{tr("What individuals can buy on their Plans page, in each currency (whole amounts, e.g. 4999 = ₹4,999). Learners outside these currencies pay in USD.")}</p>
      </div>
      <div className="overflow-x-auto border border-rule rounded-xl">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-3 py-2">{tr("Product")}</th>
              {CURRENCIES.map((c) => (
                <th key={c} className="px-2 py-2">
                  {c}
                </th>
              ))}
              <th className="px-3 py-2">{tr("On sale")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-rule">
                <td className="px-3 py-2">
                  <span className="font-semibold text-ink">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {p.durationDays} {tr("days")}
                    {p.credits !== null ? ` · ${tr("{{n}} credits for organizations", { n: p.credits })}` : ""}
                  </span>
                </td>
                {CURRENCIES.map((c) => (
                  <td key={c} className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      aria-label={`${p.name} ${c}`}
                      className={inputClass}
                      value={prices[p.id]?.[c] !== undefined ? prices[p.id]![c]! / 100 : ""}
                      onChange={(e) =>
                        setPrices((all) => ({ ...all, [p.id]: { ...all[p.id], [c]: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 100) } }))
                      }
                    />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <input type="checkbox" checked={p.active} onChange={() => toggle(p)} className="h-4 w-4 accent-navy" aria-label={tr("On sale")} />
                </td>
                <td className="px-3 py-2">
                  <Button variant="secondary" onClick={() => save(p.id)} disabled={saving === p.id} className="!px-3 !py-1.5 !text-xs">
                    {saving === p.id ? tr("Saving…") : tr("Save")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <h3 className="font-display font-semibold text-ink">{tr("Give a product to a learner")}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <input type="email" placeholder={tr("Learner's email")} value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm w-64" />
          <select value={grant.productId} onChange={(e) => setGrant({ ...grant, productId: e.target.value })} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
            <option value="">{tr("Choose a product")}</option>
            {givable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {(chosen?.kind === "level" || chosen?.kind === "pack") && (
            <select value={grant.level} onChange={(e) => setGrant({ ...grant, level: e.target.value })} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
              {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          )}
          <input type="number" min={1} placeholder={tr("Days (optional)")} value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm w-36" />
          <Button onClick={give} disabled={granting || !grant.email.trim() || !grant.productId} className="!py-2">
            {tr("Give")}
          </Button>
        </div>
      </div>
      {note && <p className="text-sm text-ink">{note}</p>}
    </section>
  );
}
