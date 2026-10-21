import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, BookOpen, ClipboardCheck, Dumbbell, X } from "lucide-react";
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
  type Shipping,
} from "@/api/payments";
import { tr } from "@/i18n/tr";

// Buy just one test: preparation + assessment, an assessment on its own, or a
// level test. Prices in the learner's currency, which they can change.

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CURRENCY_NAME: Record<ShopCurrency, string> = { INR: "₹ INR", USD: "$ USD", EUR: "€ EUR", GBP: "£ GBP", AED: "AED", SGD: "S$ SGD" };

const GROUPS: { kind: PricedProduct["kind"]; title: () => string; note: () => string; icon: typeof BookOpen }[] = [
  {
    kind: "prep",
    title: () => tr("Preparation + real test + certificate"),
    note: () => tr("A month of practice tests, mock tests and Practice Modules for one test, then one real test with a certificate."),
    icon: BookOpen,
  },
  {
    kind: "assessment",
    title: () => tr("Real test + certificate"),
    note: () => tr("One strictly proctored real test with a score report and a certificate. A free sample comes first."),
    icon: Award,
  },
  {
    kind: "level",
    title: () => tr("Level test"),
    note: () => tr("One test at the level you choose, to check where you are (a pass is 70% overall and at least 50% in each skill). No certificate: certificates come from the final assessment."),
    icon: ClipboardCheck,
  },
  {
    kind: "pack",
    title: () => tr("Practice pack"),
    note: () => tr("30 days of Practice Modules in every question type, at your level as it grows, aiming at the level you choose. No tests."),
    icon: Dumbbell,
  },
];

const EMPTY_SHIPPING: Shipping = { name: "", line1: "", line2: "", city: "", postalCode: "", country: "", phone: "" };

// Checkout for one product. A certificate extra passes the certificate; a printed copy asks where to post it.
export function Checkout({ product, currency, certificateId, onClose }: { product: PricedProduct; currency: ShopCurrency; certificateId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [level, setLevel] = useState(product.kind === "level" || product.kind === "pack" ? "B1" : "");
  const [ship, setShip] = useState<Shipping>(EMPTY_SHIPPING);
  const needsShipping = product.kind === "cert_print";
  const shipReady = !needsShipping || (ship.name.trim() && ship.line1.trim() && ship.city.trim() && ship.postalCode.trim() && ship.country.trim());
  const [q, setQ] = useState<ProductQuote | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setQ(null);
    getProductQuote(product.id, currency, level || undefined, certificateId)
      .then(setQ)
      .catch(() => setError(tr("Prices couldn't load. Try again.")));
  }, [product.id, currency, level, certificateId]);
  async function pay() {
    setPaying(true);
    setError(null);
    try {
      await startCheckout(await createProductOrder(product.id, currency, level || undefined, { certificateId, shipping: needsShipping ? ship : undefined }), navigate);
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
        {(product.kind === "level" || product.kind === "pack") && (
          <label className="flex flex-col gap-1 text-sm text-ink">
            {product.kind === "pack" ? tr("Level to aim for") : tr("Level")}
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsShipping && (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["name", tr("Full name"), true],
                ["line1", tr("Address"), true],
                ["line2", tr("Address line 2 (optional)"), true],
                ["city", tr("City"), false],
                ["postalCode", tr("Postal code"), false],
                ["country", tr("Country"), false],
                ["phone", tr("Phone (optional)"), false],
              ] as [keyof Shipping, string, boolean][]
            ).map(([k, label, wide]) => (
              <input
                key={k}
                value={ship[k] ?? ""}
                onChange={(e) => setShip((s) => ({ ...s, [k]: e.target.value }))}
                placeholder={label}
                aria-label={label}
                className={`rounded-input border border-rule bg-surface px-3 py-2 text-sm ${wide ? "col-span-2" : ""}`}
              />
            ))}
          </div>
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
            {q.discount > 0 && (
              <div className="flex justify-between text-success">
                <span>{q.discountReason === "level_retake" ? tr("Retake at half price") : tr("25% off the next level")}</span>
                <span>−{formatAmount(q.discount, q.currency)}</span>
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
              {!product.kind.startsWith("cert_") && tr("Valid for {{n}} days", { n: q.durationDays })}
              {q.attempts > 0 ? ` · ${q.attempts === 1 ? tr("1 real test") : tr("{{n}} real tests", { n: q.attempts })}` : ""}
            </span>
          </div>
        ) : !error ? (
          <p className="text-sm text-muted">{tr("Loading…")}</p>
        ) : null}
        {error && <p className="text-sm text-error">{error}</p>}
        <Button onClick={pay} disabled={!q || paying || !shipReady} className="w-full">
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
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-ink">{g.title()}</h3>
                <p className="text-sm text-muted">{g.note()}</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {items.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 border border-rule rounded-xl px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{p.testTypeName ?? (p.kind === "level" || p.kind === "pack" ? tr("Any level, A1 to C2") : p.name)}</p>
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
