import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, BookOpen, ClipboardCheck, X } from "lucide-react";
import { Button } from "@/components/Button";
import {
  createProductOrder,
  formatAmount,
  getPriceList,
  getProductQuote,
  startCheckout,
  type PricedProduct,
  type ProductQuote,
  type ShopCurrency,
} from "@/api/payments";
import { tr } from "@/i18n/tr";

// Buy just one test: preparation + assessment, an assessment on its own, or a
// level test. Prices in the learner's currency, which they can change.

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CURRENCY_NAME: Record<ShopCurrency, string> = { INR: "₹ INR", USD: "$ USD", EUR: "€ EUR", GBP: "£ GBP", AED: "AED", SGD: "S$ SGD" };

const GROUPS: { kind: PricedProduct["kind"]; title: () => string; note: () => string; icon: typeof BookOpen }[] = [
  {
    kind: "prep",
    title: () => tr("Preparation + real test"),
    note: () => tr("A month of practice tests, mock tests and Practice Modules for one test, then one real test with a certificate."),
    icon: BookOpen,
  },
  { kind: "assessment", title: () => tr("Real test only"), note: () => tr("One strictly proctored real test with a score report and a certificate. A free sample comes first."), icon: Award },
  { kind: "level", title: () => tr("Level test"), note: () => tr("One test at the level you choose. Pass it (70% overall, at least 50% in each skill) for that level's certificate."), icon: ClipboardCheck },
];

function Checkout({ product, currency, onClose }: { product: PricedProduct; currency: ShopCurrency; onClose: () => void }) {
  const navigate = useNavigate();
  const [level, setLevel] = useState(product.kind === "level" ? "B1" : "");
  const [q, setQ] = useState<ProductQuote | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQ(null);
    getProductQuote(product.id, currency, level || undefined)
      .then(setQ)
      .catch(() => setError(tr("Prices couldn't load. Try again.")));
  }, [product.id, currency, level]);
  async function pay() {
    setPaying(true);
    setError(null);
    try {
      await startCheckout(await createProductOrder(product.id, currency, level || undefined), navigate);
    } catch {
      setError(tr("Checkout couldn't start. Try again."));
      setPaying(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={product.name}>
      <div className="bg-surface rounded-card shadow-2xl w-full max-w-md p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Checkout")}</p>
            <h2 className="font-display font-bold text-lg text-ink">{product.name}</h2>
          </div>
          <button onClick={onClose} aria-label={tr("Close")} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-paper-warm cursor-pointer">
            <X size={17} />
          </button>
        </div>
        {product.kind === "level" && (
          <label className="flex flex-col gap-1 text-sm text-ink">
            {tr("Level")}
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {q ? (
          <div className="text-sm flex flex-col gap-1 bg-paper-warm rounded-input px-3.5 py-2.5">
            <div className="flex justify-between">
              <span>{tr("Price")}</span>
              <span>{formatAmount(q.price, q.currency)}</span>
            </div>
            {q.credit > 0 && (
              <div className="flex justify-between text-success">
                <span>{tr("Credit for your unused preparation")}</span>
                <span>−{formatAmount(q.credit, q.currency)}</span>
              </div>
            )}
            {q.taxAmount > 0 && (
              <div className="flex justify-between">
                <span>{q.taxLabel}</span>
                <span>{formatAmount(q.taxAmount, q.currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>{tr("Total")}</span>
              <span>{formatAmount(q.total, q.currency)}</span>
            </div>
            <span className="text-xs text-muted">
              {tr("Valid for {{n}} days", { n: q.durationDays })}
              {q.attempts > 0 ? ` · ${q.attempts === 1 ? tr("1 real test") : tr("{{n}} real tests", { n: q.attempts })}` : ""}
            </span>
          </div>
        ) : !error ? (
          <p className="text-sm text-muted">{tr("Loading…")}</p>
        ) : null}
        {error && <p className="text-sm text-error">{error}</p>}
        <Button onClick={pay} disabled={!q || paying} className="w-full">
          {paying ? tr("Starting checkout…") : q ? tr("Pay {{amount}}", { amount: formatAmount(q.total, q.currency) }) : tr("Pay")}
        </Button>
      </div>
    </div>
  );
}

export function ProductShop() {
  const [currency, setCurrency] = useState<ShopCurrency | undefined>(undefined);
  const [data, setData] = useState<Awaited<ReturnType<typeof getPriceList>> | null>(null);
  const [buying, setBuying] = useState<PricedProduct | null>(null);
  useEffect(() => {
    getPriceList(currency)
      .then((r) => {
        setData(r);
        if (!currency) setCurrency(r.currency);
      })
      .catch(() => setData(null));
  }, [currency]);
  if (!data) return null;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-xl text-ink">{tr("Or buy just one test")}</h2>
          <p className="text-sm text-muted">{tr("Prepare for one test, take a real test for a certificate, or prove a level.")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          {tr("Currency")}
          <select
            value={data.currency}
            onChange={(e) => setCurrency(e.target.value as ShopCurrency)}
            className="rounded-input border border-rule bg-surface px-3 py-2 text-sm cursor-pointer"
          >
            {data.currencies.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_NAME[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {GROUPS.map((g) => {
        const items = data.products.filter((p) => p.kind === g.kind);
        if (!items.length) return null;
        const Icon = g.icon;
        return (
          <div key={g.kind} className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="h-10 w-10 rounded-xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
                <Icon size={20} />
              </span>
              <div>
                <h3 className="font-display font-bold text-ink">{g.title()}</h3>
                <p className="text-sm text-muted">{g.note()}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {items.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 border border-rule rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{p.testTypeName ?? (p.kind === "level" ? tr("Any level, A1 to C2") : p.name)}</p>
                    <p className="text-sm text-ink tabular-nums">{formatAmount(p.amount, p.currency)}</p>
                  </div>
                  {data.canBuy && (
                    <Button variant="secondary" onClick={() => setBuying(p)} className="!px-3.5 !py-1.5 !text-sm shrink-0">
                      {tr("Buy")}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!data.canBuy && <p className="text-sm text-muted">{tr("Your organization gives you your access. Ask your organization if you need another test.")}</p>}
      {data.testMode && <p className="text-xs text-navy-deep">{tr("Test mode: no real charge is made.")}</p>}
      {buying && currency && <Checkout product={buying} currency={currency} onClose={() => setBuying(null)} />}
    </section>
  );
}
