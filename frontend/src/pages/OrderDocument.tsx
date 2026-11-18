import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";

// The proforma invoice or the final tax invoice for a Channel Partner order
// (stage 6). White and print-friendly: "Print" saves it as a PDF.
interface Doc {
  available: boolean;
  kind: "proforma" | "invoice";
  number: string;
  issuedAt: string;
  orderNumber: string;
  status: string;
  seller: { name: string; address: string; taxId: string; email: string };
  bankDetails: string;
  billTo: { name: string; attention?: string | null; address?: string | null; email: string; gstin?: string | null };
  organisations: string[];
  inIndia: boolean;
  currency: string;
  validUntil: string;
  licenceMonths: number;
  lines: { kind: string; name: string | null; level: string | null; quantity: number; credits: number | null; unitAmount: number; amount: number }[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentLinkUrl: string | null;
  payment: { method: string; reference: string | null; amount: number; receivedOn: string } | null;
}

const money = (minor: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(minor / 100);
const date = (s: string) => new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export function OrderDocument() {
  const { orderId, kind } = useParams();
  const [params] = useSearchParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Doc>(`/order-documents/${orderId}/${kind}`)
      .then(setDoc)
      .catch(() => setError(true));
  }, [orderId, kind]);
  if (error) return <p className="p-10 text-sm text-error">{tr("This document isn't available.")}</p>;
  if (!doc) return <p className="p-10 text-sm text-muted">{tr("Loading…")}</p>;
  if (!doc.available) return <p className="p-10 text-sm text-muted">{kind === "invoice" ? tr("The invoice is issued when the payment is received.") : tr("The proforma invoice hasn't been sent yet.")}</p>;
  const m = (n: number) => money(n, doc.currency);
  const proforma = doc.kind === "proforma";
  return (
    <div className="min-h-screen bg-white py-10 px-4 print:p-0">
      <div className="max-w-3xl mx-auto mb-4 flex justify-between items-center gap-3 print:hidden">
        {params.get("paid") ? <p className="text-sm font-semibold text-[#1e7a3c]">{tr("Thank you. Your payment is being confirmed.")}</p> : <span />}
        <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-pill bg-navy text-white text-sm font-semibold cursor-pointer">
          <Printer size={16} /> {tr("Print / save PDF")}
        </button>
      </div>
      <div className="max-w-3xl mx-auto bg-white text-[#1a1a1a] border border-[#e5e5e5] rounded-card p-10 flex flex-col gap-8 print:border-0 print:rounded-none">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-display font-bold text-2xl">{doc.seller.name}</p>
            {doc.seller.address && <p className="text-sm whitespace-pre-line">{doc.seller.address}</p>}
            {doc.seller.taxId && <p className="text-sm">{tr("GSTIN: {{id}}", { id: doc.seller.taxId })}</p>}
            {doc.seller.email && <p className="text-sm">{doc.seller.email}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-[#666]">{proforma ? tr("Proforma invoice") : doc.taxAmount > 0 ? tr("Tax invoice") : tr("Invoice")}</p>
            <p className="font-mono font-semibold">{doc.number}</p>
            <p className="text-sm">{date(doc.issuedAt)}</p>
            <p className="text-sm">{tr("Order {{n}}", { n: doc.orderNumber })}</p>
            {!proforma && <p className="text-xs mt-1 inline-block px-2 py-0.5 rounded-pill bg-[#e6f4ea] text-[#1e7a3c] font-semibold">{tr("PAID")}</p>}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#666] mb-1">{tr("Bill to")}</p>
            <p className="font-semibold">{doc.billTo.name}</p>
            {doc.billTo.attention && <p className="text-sm">{tr("Attn: {{name}}", { name: doc.billTo.attention })}</p>}
            {doc.billTo.address && <p className="text-sm whitespace-pre-line">{doc.billTo.address}</p>}
            <p className="text-sm">{doc.billTo.email}</p>
            {doc.billTo.gstin && <p className="text-sm">{tr("GSTIN: {{id}}", { id: doc.billTo.gstin })}</p>}
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-[#666] mb-1">{tr("Organisations")}</p>
            <p>{doc.organisations.join(", ")}</p>
            <p className="mt-2">{tr("Licences must be assigned by {{d}}. Each licence lasts {{n}} months from when it starts.", { d: date(doc.validUntil), n: doc.licenceMonths })}</p>
          </div>
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
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-[#eee]">
                <td className="py-3">
                  {l.kind === "full_access"
                    ? tr("Spica Full access, {{n}} months per learner", { n: doc.licenceMonths })
                    : l.kind === "credits"
                      ? tr("Recruitment or admissions credits")
                      : `${l.name}${l.level ? ` · ${l.level}` : ""} (${tr("{{n}} learners", { n: l.quantity })})`}
                </td>
                <td className="py-3 text-right">{l.kind === "full_access" ? tr("{{n}} learner-months", { n: l.quantity * doc.licenceMonths }) : tr("{{n}} credits", { n: l.credits ?? l.quantity })}</td>
                <td className="py-3 text-right">{m(l.unitAmount)}</td>
                <td className="py-3 text-right">{m(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto w-72 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <span>{tr("Subtotal")}</span>
            <span>{m(doc.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>{doc.taxRate ? tr("GST {{r}}%", { r: doc.taxRate }) : tr("Tax (export of services, zero-rated)")}</span>
            <span>{m(doc.taxAmount)}</span>
          </div>
          <div className="flex justify-between border-t border-[#ddd] pt-1.5 font-semibold text-base">
            <span>{proforma ? tr("Total to pay") : tr("Total paid")}</span>
            <span>{m(doc.total)}</span>
          </div>
        </div>
        {proforma ? (
          <div className="text-sm flex flex-col gap-2 border-t border-[#ddd] pt-4">
            <p className="text-xs uppercase tracking-wide text-[#666]">{tr("How to pay")}</p>
            {doc.bankDetails && <p className="whitespace-pre-line">{doc.bankDetails}</p>}
            <p>{tr("Quote {{n}} as the payment reference.", { n: doc.number })}</p>
            {doc.paymentLinkUrl && (
              <p className="print:hidden">
                <a href={doc.paymentLinkUrl} className="font-semibold text-navy underline">
                  {tr("Pay online now")}
                </a>
              </p>
            )}
            <p className="text-[#666]">{tr("This is a proforma invoice, not a tax invoice. The tax invoice is issued when the payment is received.")}</p>
          </div>
        ) : (
          doc.payment && (
            <p className="text-sm border-t border-[#ddd] pt-4">
              {tr("Paid {{a}} on {{d}} by {{how}}.", { a: m(doc.payment.amount), d: date(doc.payment.receivedOn), how: doc.payment.method === "stripe" ? tr("card (Stripe)") : doc.payment.method === "bank" ? tr("bank transfer") : tr("other means") })}
              {doc.payment.reference ? ` ${tr("Reference: {{r}}", { r: doc.payment.reference })}` : ""}
            </p>
          )
        )}
      </div>
    </div>
  );
}
