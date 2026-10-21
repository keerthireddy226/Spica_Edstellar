import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { createPaymentOrder, formatAmount, getQuote, requestInvoiceOrder, startCheckout, type Quote } from "@/api/payments";
import { useHasFeature } from "@/components/plans/usePlan";
import { planErrorMessage } from "@/api/plans";

import { tr } from "@/i18n/tr";
// Org Admin self-serve purchase. The calculator mirrors how orgs think about
// it ("20 learners for 3 months") and turns it into a license count.
// `upgradeTo`: a purchase big enough to move the organization to Business.
export function BuyLicensesModal({ onClose, upgradeTo }: { onClose: () => void; upgradeTo?: number }) {
  const navigate = useNavigate();
  const [learners, setLearners] = useState(upgradeTo ? String(upgradeTo) : "10");
  const [months, setMonths] = useState(upgradeTo ? "1" : "3");
  const [quantity, setQuantity] = useState(30);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Card checkout, or a proforma to pay by bank transfer against a PO.
  const invoiceAllowed = useHasFeature("po_invoicing");
  const [method, setMethod] = useState<"card" | "invoice">("card");
  const [poNumber, setPoNumber] = useState("");
  const [requested, setRequested] = useState<{ orderId: string; quoteNumber: string } | null>(null);

  useEffect(() => {
    const l = Math.max(0, Math.floor(Number(learners) || 0));
    const m = Math.max(0, Math.floor(Number(months) || 0));
    if (l > 0 && m > 0) setQuantity(l * m);
  }, [learners, months]);

  useEffect(() => {
    if (quantity < 1) return;
    const handle = setTimeout(() => {
      getQuote(quantity)
        .then((q) => {
          setQuote(q);
          setError(null);
        })
        .catch(() => setError(tr("Checkout isn't available right now.")));
    }, 250);
    return () => clearTimeout(handle);
  }, [quantity]);

  async function pay() {
    setPaying(true);
    setError(null);
    if (method === "invoice") {
      try {
        setRequested(await requestInvoiceOrder(quantity, poNumber.trim() || undefined));
      } catch (err) {
        setError(planErrorMessage(err) ?? tr("Couldn't create the quote. Please try again."));
      } finally {
        setPaying(false);
      }
      return;
    }
    try {
      await startCheckout(await createPaymentOrder(quantity), navigate);
    } catch {
      setError(tr("Couldn't start checkout. Please try again."));
      setPaying(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Buy licenses")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Learners")}</label>
              <input type="number" min={1} value={learners} onChange={(e) => setLearners(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Months each")}</label>
              <input type="number" min={1} value={months} onChange={(e) => setMonths(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Licenses to buy")}</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className={inputClass}
            />
            <p className="text-xs text-muted">
              {tr("1 license = 1 learner for 1 month. Unassigned licenses stay valid for 12 months. Buying 50 or more lowers the price per license.")}</p>
          </div>

          {quote && (
            <div className="text-sm flex flex-col gap-1 bg-paper-warm rounded-input px-3.5 py-2.5">
              <div className="flex justify-between">
                <span className="text-muted">
                  {quote.quantity} × {formatAmount(quote.unitAmount, quote.currency)}
                  {quote.unitAmount < quote.listUnitAmount && (
                    <span className="ml-1.5 line-through text-muted/70">{formatAmount(quote.listUnitAmount, quote.currency)}</span>
                  )}
                </span>
                <span className="text-ink">{formatAmount(quote.subtotal, quote.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{quote.taxLabel ?? tr("Tax")}</span>
                <span className="text-ink">{formatAmount(quote.taxAmount, quote.currency)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{tr("Total")}</span>
                <span>{formatAmount(quote.total, quote.currency)}</span>
              </div>
              {!quote.billingCountry && (
                <p className="text-xs text-muted mt-1">{tr("Add your organization's country in Profile so tax and currency are right on the invoice.")}</p>
              )}
              {quote.upgradesTo && (
                <p className="text-xs text-success mt-1">
                  {tr("This purchase moves your organization to the Business plan: lower prices on future purchases, unlimited managers and batches.")}</p>
              )}
              {quote.testMode && <p className="text-xs text-navy-deep mt-1">{tr("Test mode — payment is simulated, no real charge.")}</p>}
            </div>
          )}

          {invoiceAllowed && !requested && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {(
                  [
                    ["card", tr("Pay now by card")],
                    ["invoice", tr("Pay by invoice (PO)")],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`flex-1 px-3 py-2 rounded-input text-sm font-semibold border transition-colors cursor-pointer ${
                      method === m ? "border-navy bg-navy/5 text-navy" : "border-rule text-ink hover:bg-paper-warm"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {method === "invoice" && (
                <>
                  <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder={tr("Your PO number (optional)")} className={inputClass} />
                  <p className="text-xs text-muted">{tr("You'll get a proforma to pay by bank transfer within 30 days. Licenses are added when payment arrives.")}</p>
                </>
              )}
            </div>
          )}

          {requested && (
            <div className="text-sm bg-success/10 border border-success/25 rounded-input px-3.5 py-3 flex flex-col gap-1.5">
              <p className="text-ink">
                {tr("Proforma")}{" "}<span className="font-mono font-semibold">{requested.quoteNumber}</span> {tr("is ready. Your Edstellar contact has been notified.")}</p>
              <a href={`/quote/${requested.orderId}`} target="_blank" rel="noreferrer" className="text-navy font-semibold hover:underline self-start">
                {tr("Open proforma to download or print")}</a>
            </div>
          )}

          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            {!requested && (
              <Button onClick={pay} disabled={paying || !quote} className="flex-1">
                {method === "invoice"
                  ? paying
                    ? tr("Creating proforma…")
                    : tr("Get proforma invoice")
                  : paying
                    ? tr("Opening checkout…")
                    : quote
                      ? `Pay ${formatAmount(quote.total, quote.currency)}`
                      : tr("Pay")}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
