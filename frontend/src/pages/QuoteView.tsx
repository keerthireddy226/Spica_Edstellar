import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { getProforma, formatAmount, type Proforma } from "@/api/payments";
import { countryName } from "@/constants/demographics";

import { tr } from "@/i18n/tr";
// Proforma invoice for paying by bank transfer. Becomes a real invoice once
// Edstellar records the payment.
export function QuoteView() {
  const { id } = useParams();
  const [q, setQ] = useState<Proforma | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (id) getProforma(id).then(setQ).catch(() => setError(true));
  }, [id]);

  if (error) return <p className="p-10 text-sm text-error">{tr("Quote not found.")}</p>;
  if (!q) return <p className="p-10 text-sm text-muted">{tr("Loading…")}</p>;
  const money = (n: number) => formatAmount(n, q.currency);
  const b = q.billTo;
  const date = (d: string) => new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-screen bg-paper py-10 px-4 print:p-0 print:bg-white">
      <div className="max-w-3xl mx-auto mb-4 flex justify-end print:hidden">
        <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-pill bg-navy text-white text-sm font-semibold cursor-pointer">
          <Printer size={16} /> {tr("Print / save PDF")}</button>
      </div>
      <div className="max-w-3xl mx-auto bg-white text-[#1a1a1a] border border-rule rounded-card p-10 flex flex-col gap-8 print:border-0 print:rounded-none">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-display font-bold text-2xl">{q.seller.name}</p>
            {q.seller.address && <p className="text-sm whitespace-pre-line">{q.seller.address}</p>}
            {q.seller.taxId && <p className="text-sm">{tr("GSTIN:")}{" "}{q.seller.taxId}</p>}
            {q.seller.email && <p className="text-sm">{q.seller.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[#666]">{tr("Proforma invoice")}</p>
            <p className="font-mono font-semibold">{q.quoteNumber}</p>
            <p className="text-sm">{date(q.createdAt)}</p>
            {q.dueDate && <p className="text-sm">{tr("Payment due")}{" "}{date(q.dueDate)}</p>}
            <p
              className={`text-xs mt-1 inline-block px-2 py-0.5 rounded-pill font-semibold ${
                q.status === "paid" ? "bg-[#e6f4ea] text-[#1e7a3c]" : q.status === "cancelled" ? "bg-[#fdecea] text-[#b3261e]" : "bg-[#fff4e5] text-[#8a5300]"
              }`}
            >
              {q.status === "paid" ? "PAID" : q.status === "cancelled" ? tr("CANCELLED") : tr("AWAITING PAYMENT")}
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-[#666] mb-1">{tr("Bill to")}</p>
          <p className="font-semibold">{b.name}</p>
          {b.attention && <p className="text-sm">{tr("Attn:")}{" "}{b.attention}</p>}
          {b.address && <p className="text-sm">{b.address}</p>}
          {b.country && <p className="text-sm">{countryName(b.country, "en")}</p>}
          {b.taxId && <p className="text-sm">{tr("Tax ID:")}{" "}{b.taxId}</p>}
          {(q.poNumber || b.purchaseOrderRef) && <p className="text-sm">{tr("PO:")}{" "}{q.poNumber ?? b.purchaseOrderRef}</p>}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#ddd] text-left text-xs uppercase tracking-wide text-[#666]">
              <th className="py-2">{tr("Description")}</th>
              <th className="py-2 text-right">{tr("Qty")}</th>
              <th className="py-2 text-right">{tr("Unit price")}</th>
              <th className="py-2 text-right">{tr("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#eee]">
              <td className="py-3">{tr("Spica learner licenses (1 license = 1 learner-month)")}</td>
              <td className="py-3 text-right">{q.quantity}</td>
              <td className="py-3 text-right">{money(q.unitAmount)}</td>
              <td className="py-3 text-right">{money(q.subtotal)}</td>
            </tr>
          </tbody>
        </table>
        <div className="ml-auto w-64 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span>{tr("Subtotal")}</span>
            <span>{money(q.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{q.taxRate > 0 ? tr("GST {{taxRate}}%", { taxRate: q.taxRate }) : tr("Tax (export of services, zero-rated)")}</span>
            <span>{money(q.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-[#ddd] pt-1.5 font-semibold text-base">
            <span>{tr("Total due")}</span>
            <span>{money(q.total)}</span>
          </div>
        </div>
        <p className="text-xs text-[#666]">
          {tr("Please pay by bank transfer quoting")}{" "}{q.quoteNumber}{tr(". Licenses are added to your pool as soon as the payment is received, and a tax invoice is issued then. This proforma is not a tax invoice.")}</p>
      </div>
    </div>
  );
}
