import { useEffect, useState } from "react";
import { FileText, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";

// Org Admin: the paid orders a Channel Partner (or Spica) placed for this
// organisation, with the proforma, payment link and tax invoice. Hidden when
// there are none.
interface Order {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  currency: string;
  validUntil: string;
  licenceMonths: number;
  licences: number;
  credits: number;
  proformaNumber: string | null;
  invoiceNumber: string | null;
  paymentLinkUrl: string | null;
}
const STATUS: Record<string, string> = {
  submitted: tr("Waiting for the proforma invoice"),
  proforma_sent: tr("Waiting for payment"),
  payment_received: tr("Paid, waiting for confirmation"),
  confirmed: tr("Confirmed"),
  allocated: tr("Licences available"),
  active: tr("Active"),
  expired: tr("Ended"),
  cancelled: tr("Cancelled"),
};
const money = (minor: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(minor / 100);
const day = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function OrgOrdersPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  useEffect(() => {
    api<{ orders: Order[] }>("/org-orders")
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  }, []);
  if (!orders?.length) return null;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg flex items-center gap-2">
        <Receipt size={18} className="text-navy" /> {tr("Orders and invoices")}
      </h2>
      <ul className="flex flex-col divide-y divide-rule border border-rule rounded-input">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="flex flex-col">
              <b>
                {o.orderNumber} · {money(o.total, o.currency)}
              </b>
              <span className="text-muted">
                {tr("{{l}} licences of {{m}} months · {{c}} credits · assign by {{d}}", { l: o.licences, m: o.licenceMonths, c: o.credits, d: day(o.validUntil) })}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-3">
              <span className={o.status === "cancelled" ? "text-error font-semibold" : "font-semibold"}>{STATUS[o.status] ?? o.status}</span>
              {o.paymentLinkUrl && (
                <a className="font-semibold text-navy" href={o.paymentLinkUrl} target="_blank" rel="noreferrer">
                  {tr("Pay online")}
                </a>
              )}
              {o.proformaNumber && (
                <a className="flex items-center gap-1 text-navy" href={`/order-document/${o.id}/proforma`} target="_blank" rel="noreferrer">
                  <FileText size={14} /> {tr("Proforma")}
                </a>
              )}
              {o.invoiceNumber && (
                <a className="flex items-center gap-1 text-navy" href={`/order-document/${o.id}/invoice`} target="_blank" rel="noreferrer">
                  <FileText size={14} /> {tr("Tax invoice")}
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
