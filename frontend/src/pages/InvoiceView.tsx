import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { getInvoice, formatAmount, type Invoice } from "@/api/payments";
import { countryName } from "@/constants/demographics";

// Print-friendly invoice — "Print" in the browser saves it as a PDF.
export function InvoiceView() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    getInvoice(id)
      .then(setInvoice)
      .catch(() => setError(true));
  }, [id]);

  if (error) return <p className="p-10 text-sm text-error">Invoice not found.</p>;
  if (!invoice) return <p className="p-10 text-sm text-muted">Loading…</p>;

  const b = invoice.billTo;
  const money = (n: number) => formatAmount(n, invoice.currency);

  return (
    <div className="min-h-screen bg-paper py-10 px-4 print:p-0 print:bg-white">
      <div className="max-w-3xl mx-auto mb-4 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-pill bg-navy text-white text-sm font-semibold cursor-pointer"
        >
          <Printer size={16} /> Print / save PDF
        </button>
      </div>
      <div className="max-w-3xl mx-auto bg-white text-[#1a1a1a] border border-rule rounded-card p-10 flex flex-col gap-8 print:border-0 print:rounded-none">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-display font-bold text-2xl">{invoice.seller.name}</p>
            {invoice.seller.address && <p className="text-sm whitespace-pre-line">{invoice.seller.address}</p>}
            {invoice.seller.taxId && <p className="text-sm">GSTIN: {invoice.seller.taxId}</p>}
            {invoice.seller.email && <p className="text-sm">{invoice.seller.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[#666]">{invoice.taxAmount > 0 ? "Tax invoice" : "Invoice"}</p>
            <p className="font-mono font-semibold">{invoice.invoiceNumber}</p>
            <p className="text-sm">{new Date(invoice.issuedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
            <p className="text-xs mt-1 inline-block px-2 py-0.5 rounded-pill bg-[#e6f4ea] text-[#1e7a3c] font-semibold">PAID</p>
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-[#666] mb-1">Bill to</p>
          <p className="font-semibold">{b.name}</p>
          {b.attention && <p className="text-sm">Attn: {b.attention}</p>}
          {b.address && <p className="text-sm">{b.address}</p>}
          {b.country && <p className="text-sm">{countryName(b.country, "en")}</p>}
          {b.email && <p className="text-sm">{b.email}</p>}
          {b.taxId && <p className="text-sm">Tax ID: {b.taxId}</p>}
          {b.purchaseOrderRef && <p className="text-sm">PO: {b.purchaseOrderRef}</p>}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#ddd] text-left text-xs uppercase tracking-wide text-[#666]">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#eee]">
              <td className="py-3">{invoice.description}</td>
              <td className="py-3 text-right">{invoice.quantity}</td>
              <td className="py-3 text-right">{money(invoice.unitAmount)}</td>
              <td className="py-3 text-right">{money(invoice.subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="ml-auto w-64 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{invoice.taxLabel ?? "Tax (export of services, zero-rated)"}</span>
            <span>{money(invoice.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-[#ddd] pt-1.5 font-semibold text-base">
            <span>Total paid</span>
            <span>{money(invoice.total)}</span>
          </div>
        </div>

        {invoice.creditNotes && invoice.creditNotes.length > 0 && (
          <div className="flex flex-col gap-1.5 text-sm border-t border-[#ddd] pt-4">
            <p className="text-xs uppercase tracking-wide text-[#666]">Credit notes</p>
            {invoice.creditNotes.map((c) => (
              <div key={c.creditNoteNumber} className="flex justify-between gap-4">
                <span>
                  <span className="font-mono">{c.creditNoteNumber}</span> · {new Date(c.issuedAt).toLocaleDateString()} · {c.reason}
                  {c.licensesRemoved ? ` · ${c.licensesRemoved} licenses removed` : ""}
                </span>
                <span>−{money(c.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold border-t border-[#eee] pt-1.5">
              <span>Net after credits</span>
              <span>{money(invoice.total - invoice.creditNotes.reduce((s, c) => s + c.amount, 0))}</span>
            </div>
          </div>
        )}

        <p className="text-xs text-[#666]">
          Paid via {invoice.provider === "test" ? "test checkout (no real charge)" : invoice.provider === "invoice" ? "bank transfer" : invoice.provider}
          {invoice.providerPaymentId ? ` · Ref ${invoice.providerPaymentId}` : ""}. 1 license = 1 learner's access for 1 month from the date it is
          assigned. Unassigned licenses are valid for 12 months from purchase.
        </p>
      </div>
    </div>
  );
}
