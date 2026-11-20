// A Reseller's Payments page (owner, 20 Nov 2026): Spica bills the Reseller
// for its own orders, so in one place it sees what to pay, how and by when,
// what is still waiting for a proforma, and what it has paid (with the tax
// invoices). It can also open an online card payment itself.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, CreditCard, FileText, Landmark, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatCard } from "@/components/staff/StaffKit";
import { tr } from "@/i18n/tr";
import { ROUTES } from "@/constants/routes";
import { money } from "./PartnerOrders";
import { appLocale } from "@/lib/locale";

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

interface PaymentRow {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string;
  proformaNumber: string | null;
  proformaSentAt: string | null;
  paymentLinkUrl: string | null;
  paymentMethod: "bank" | "stripe" | "other" | null;
  paymentReference: string | null;
  paymentAmount: number | null;
  paymentReceivedOn: string | null;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  submittedAt: string;
}
interface PaymentsResponse {
  bankDetails: string;
  onlinePayment: boolean;
  waiting: PaymentRow[];
  toPay: PaymentRow[];
  paid: PaymentRow[];
}

const day = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" }) : "—");
const METHOD: Record<string, string> = { bank: tr("Bank transfer"), stripe: tr("Card (online)"), other: tr("Other") };
const doc = (id: string, kind: "proforma" | "invoice") => `/order-document/${id}/${kind}`;
const sumBy = (rows: PaymentRow[], f: (r: PaymentRow) => number) => {
  const by: Record<string, number> = {};
  for (const r of rows) by[r.currency] = (by[r.currency] ?? 0) + f(r);
  const parts = Object.entries(by).map(([c, n]) => money(n, c));
  return parts.length ? parts.join(" + ") : money(0, "USD");
};

export function PartnerPayments() {
  const [d, setD] = useState<PaymentsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => api<PaymentsResponse>("/partner/orders/payments").then(setD).catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, []);
  if (failed) return <PageError message={tr("Could not load your payments.")} onRetry={load} />;
  if (!d) return <PageLoading />;
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Payments")} subtitle={tr("What you owe Spica for your orders, how to pay, and what you have paid.")} />

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={CreditCard} value={sumBy(d.toPay, (r) => r.total)} label={tr("To pay now")} sub={tr("{{n}} proforma invoices", { n: d.toPay.length })} progress={d.toPay.length ? 1 : 0} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={Clock} value={d.waiting.length} label={tr("Waiting for a proforma")} sub={tr("Submitted orders")} progress={d.waiting.length ? 0.5 : 0} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={CheckCircle2} value={sumBy(d.paid, (r) => r.paymentAmount ?? r.total)} label={tr("Paid")} sub={tr("{{n}} payments", { n: d.paid.length })} progress={d.paid.length ? 1 : 0} />
      </div>

      <HowItWorks />

      <section className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg text-ink">{tr("To pay")}</h2>
        {d.toPay.length === 0 ? (
          <EmptyNote>{tr("Nothing to pay right now. When Spica sends a proforma invoice for an order, it appears here.")}</EmptyNote>
        ) : (
          d.toPay.map((r) => <ToPayCard key={r.id} r={r} bankDetails={d.bankDetails} online={d.onlinePayment} onChanged={load} />)
        )}
      </section>

      {d.waiting.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Waiting for a proforma")}</h2>
          <div className="bg-surface border border-rule rounded-card shadow-sm divide-y divide-rule">
            {d.waiting.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <b className="text-ink">{r.orderNumber}</b>
                <span className="text-muted">{tr("Submitted {{d}}", { d: day(r.submittedAt) })}</span>
                <span className="ml-auto font-semibold">{money(r.total, r.currency)}</span>
                <span className="w-full text-xs text-muted">{tr("Spica's Finance team checks the order and sends the proforma invoice. You get an email and a notification. Don't pay before you have it.")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg text-ink">{tr("Paid")}</h2>
        {d.paid.length === 0 ? (
          <EmptyNote>{tr("No payments yet.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto bg-surface border border-rule rounded-card shadow-sm">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <tr>
                  {[tr("Order"), tr("Paid on"), tr("Amount"), tr("Method"), tr("Reference"), tr("Tax invoice")].map((h) => (
                    <th key={h} className="px-3 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.paid.map((r) => (
                  <tr key={r.id} className="border-t border-rule">
                    <td className="px-3 py-2 font-semibold text-ink">{r.orderNumber}</td>
                    <td className="px-3 py-2">{day(r.paymentReceivedOn)}</td>
                    <td className="px-3 py-2">{money(r.paymentAmount ?? r.total, r.currency)}</td>
                    <td className="px-3 py-2">{r.paymentMethod ? METHOD[r.paymentMethod] : "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.paymentReference || "—"}</td>
                    <td className="px-3 py-2">
                      {r.invoiceNumber ? (
                        <a href={doc(r.id, "invoice")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-navy">
                          <FileText size={14} /> {r.invoiceNumber}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// The steps, why payment comes first, and the deadline.
function HowItWorks() {
  const steps = [
    { icon: Receipt, title: tr("1. You submit an order"), text: tr("Choose the licences on Orders. Organisations are optional: you can choose them when you allocate.") },
    { icon: FileText, title: tr("2. Spica sends a proforma invoice"), text: tr("It shows the amount, your discount, GST if you are billed in India, and how to pay. You get an email and a notification.") },
    { icon: Landmark, title: tr("3. You pay"), text: tr("By bank transfer to the account on the proforma, quoting the proforma number, or online by card from this page.") },
    { icon: CheckCircle2, title: tr("4. Tax invoice and licences"), text: tr("Spica records the payment, sends the tax invoice and confirms the order. Then you allocate the licences to your organisations.") },
  ];
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg text-ink">{tr("How paying works")}</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {steps.map((s) => (
          <div key={s.title} className="flex flex-col gap-1.5">
            <s.icon size={20} className="text-navy" />
            <p className="font-semibold text-ink text-sm">{s.title}</p>
            <p className="text-sm text-muted">{s.text}</p>
          </div>
        ))}
      </div>
      <div className="text-sm text-muted flex flex-col gap-1 border-t border-rule pt-3">
        <p>
          <b className="text-ink">{tr("Why pay first?")}</b> {tr("You buy the licences from Spica and sell them on at your own price. Spica releases them once your payment is received.")}
        </p>
        <p>
          <b className="text-ink">{tr("When?")}</b> {tr("Pay soon after the proforma arrives. Licences must be allocated and assigned before the order ends (the end of your partnership), and unused licences then expire, so paying late leaves less time to use them.")}
        </p>
        <p>
          {tr("Questions about an invoice? Open the order on")} <Link to={ROUTES.PARTNER_ORDERS} className="font-semibold text-navy">{tr("Orders")}</Link>.
        </p>
      </div>
    </section>
  );
}

function ToPayCard({ r, bankDetails, online, onChanged }: { r: PaymentRow; bankDetails: string; online: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const payOnline = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api<{ url: string }>(`/partner/orders/${r.id}/pay-online`, post({}));
      window.location.href = url;
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setErr(m.includes("stripe_not_configured") ? tr("Online payment isn't available yet. Please pay by bank transfer.") : tr("Could not open the online payment. Please try again or pay by bank transfer."));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <b className="text-ink text-base">{r.orderNumber}</b>
        <a href={doc(r.id, "proforma")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-navy">
          <FileText size={14} /> {tr("Proforma {{n}}", { n: r.proformaNumber ?? "" })}
        </a>
        <span className="text-sm text-muted">{tr("Sent {{d}}", { d: day(r.proformaSentAt) })}</span>
        <span className="ml-auto text-right">
          <span className="block text-xs text-muted">{r.taxRate ? tr("{{s}} + GST {{r}}% {{t}}", { s: money(r.subtotal, r.currency), r: r.taxRate, t: money(r.taxAmount, r.currency) }) : tr("No Indian GST (export of services)")}</span>
          <b className="text-xl text-ink">{money(r.total, r.currency)}</b>
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div className="flex flex-col gap-1 border border-rule rounded-input p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
            <Landmark size={14} /> {tr("Bank transfer")}
          </p>
          {bankDetails ? <p className="whitespace-pre-line text-ink">{bankDetails}</p> : <p className="text-muted">{tr("The bank account is on the proforma invoice.")}</p>}
          <p>{tr("Quote {{n}} as the payment reference.", { n: r.proformaNumber ?? r.orderNumber })}</p>
          <p className="text-xs text-muted">{tr("Spica records the payment when it reaches Spica's account.")}</p>
        </div>
        <div className="flex flex-col gap-2 border border-rule rounded-input p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
            <CreditCard size={14} /> {tr("Card (online)")}
          </p>
          {online ? (
            <>
              <p className="text-muted">{tr("Pay the full amount securely with a card. The payment is recorded automatically.")}</p>
              <Button className="self-start" disabled={busy} onClick={payOnline}>
                {tr("Pay {{a}} online", { a: money(r.total, r.currency) })}
              </Button>
            </>
          ) : (
            <p className="text-muted">{tr("Online payment isn't available yet. Please pay by bank transfer.")}</p>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">{tr("Licences must be assigned by {{d}}.", { d: day(r.validUntil) })}</p>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}
