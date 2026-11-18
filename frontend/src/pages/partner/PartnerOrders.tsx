import { useEffect, useMemo, useState } from "react";
import { Copy, FileText, Plus, Receipt, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatusPill, useStaffPermissions } from "@/components/staff/StaffKit";
import { DetailModal } from "@/components/DetailModal";
import { tr } from "@/i18n/tr";

// Paid orders (Channel Partners stage 5). The same screens serve the partner
// portal (their own orders) and Spica staff (every order, with prices they can
// change and the payment steps). Finance's proforma and invoices come in stage 6,
// allocation and the licence clocks in stage 7.
type Mode = "partner" | "staff";
type Status = "draft" | "submitted" | "proforma_sent" | "payment_received" | "confirmed" | "allocated" | "active" | "expired" | "cancelled";
type LineKind = "full_access" | "product" | "credits";

export interface OrderRow {
  id: string;
  orderNumber: string;
  status: Status;
  partner: { id: string; name: string; code: string } | null;
  inIndia: boolean;
  currency: "INR" | "USD";
  gstin: string | null;
  maxOrganisations: number;
  perOrgCap: number | null;
  validUntil: string;
  licenceMonths: 1 | 3 | 6;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  commissionPercent: number;
  commissionAmount: number;
  notes: string | null;
  cancelReason: string | null;
  billTo: BillTo | null;
  proformaNumber: string | null;
  proformaSentAt: string | null;
  paymentLinkUrl: string | null;
  paymentMethod: "stripe" | "bank" | "other" | null;
  paymentReference: string | null;
  paymentAmount: number | null;
  paymentReceivedOn: string | null;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  licences: number;
  credits: number;
  allocatedLicences: number;
  allocatedCredits: number;
  assignedLearners: number;
  organisations: string[];
  createdAt: string;
}
interface Allocation {
  licences: number;
  credits: number;
  allocatedLicences: number;
  allocatedCredits: number;
  perOrgCap: number;
  organisations: { id: string; name: string; licences: number; credits: number; graceEndsAt: string | null; assigned: number }[];
}
interface BillTo {
  name: string;
  attention?: string | null;
  address?: string | null;
  email: string;
  gstin?: string | null;
  country?: string | null;
}
interface Line {
  kind: LineKind;
  productId: string | null;
  name?: string;
  level: string | null;
  quantity: number;
  credits?: number | null;
  unitAmount: number | null;
  amount?: number;
  priceOverridden?: boolean;
}
interface OrderDetail {
  order: OrderRow;
  effectivePerOrgCap: number | null;
  lines: Line[];
  organisations: { id: string; name: string; category: string }[];
  history: { from: string | null; to: Status; note: string | null; at: string; by: { name: string; email: string; role: string } | null }[];
  nextSteps: { to: Status; who: ("partner" | "staff" | "finance")[] }[];
  allocation: Allocation | null;
}
interface Quote {
  currency: "INR" | "USD";
  lines: (Line & { listUnitAmount: number })[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  licences: number;
  credits: number;
  education: boolean;
}
interface Product {
  id: string;
  kind: string;
  name: string;
  credits: number;
}

const base = (mode: Mode) => (mode === "partner" ? "/partner/orders" : "/admin/partner-orders");
const post = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const label = "text-xs font-semibold text-muted uppercase tracking-wide";
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const day = (s: string) => new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number, months = 0) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return iso(d);
};
export const money = (minor: number, currency: string) => new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency }).format(minor / 100);

const STATUS_LABEL: Record<Status, string> = {
  draft: tr("Draft"),
  submitted: tr("Submitted"),
  proforma_sent: tr("Proforma sent"),
  payment_received: tr("Payment received"),
  confirmed: tr("Confirmed"),
  allocated: tr("Allocated"),
  active: tr("Active"),
  expired: tr("Expired"),
  cancelled: tr("Cancelled"),
};
const STATUS_TONE: Record<Status, "success" | "warning" | "error" | "muted" | "navy"> = {
  draft: "muted",
  submitted: "warning",
  proforma_sent: "warning",
  payment_received: "navy",
  confirmed: "navy",
  allocated: "success",
  active: "success",
  expired: "muted",
  cancelled: "error",
};
const STEP_LABEL: Partial<Record<Status, string>> = {
  submitted: tr("Submit order"),
  proforma_sent: tr("Mark proforma sent"),
  payment_received: tr("Mark payment received"),
  confirmed: tr("Confirm order"),
};

const ERRORS: Record<string, string> = {
  invalid_validity: tr("Choose an order end date between 2 weeks and 6 months from today."),
  no_organisations: tr("Choose at least one organisation."),
  too_many_organisations: tr("This order has more organisations than its maximum."),
  no_lines: tr("Add at least one product."),
  level_required: tr("Choose the level for the level test."),
  order_locked: tr("This order can't be changed any more."),
  status_change_not_allowed: tr("This step isn't possible for the order's current status. Refresh and try again."),
  reason_required: tr("Write the reason for cancelling."),
  stripe_not_configured: tr("Stripe isn't set up yet. Ask the organisation to pay by bank transfer."),
  partner_deactivated: tr("This partner is deactivated."),
};
const errText = (e: unknown) => {
  const m = String((e as Error)?.message ?? "");
  const k = Object.keys(ERRORS).find((x) => m.includes(x));
  return k ? ERRORS[k] : tr("That didn't work. Try again.");
};

export function OrdersPanel({ mode, partnerId }: { mode: Mode; partnerId?: string }) {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<Status | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrderDetail | "new" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const perms = useStaffPermissions();
  const load = () => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (partnerId) q.set("partnerId", partnerId);
    api<{ orders: OrderRow[] }>(`${base(mode)}${mode === "staff" && q.toString() ? `?${q}` : ""}`)
      .then((r) => setRows(r.orders))
      .catch(() => setError(true));
  };
  useEffect(load, [status, partnerId]);
  if (error) return <PageError message={tr("Could not load the orders.")} />;
  if (!rows) return <PageLoading />;
  const shown = mode === "partner" && status ? rows.filter((r) => r.status === status) : rows;
  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <Notice tone="success" onClose={() => setMsg(null)}>
          {msg}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select className={`${input} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
          <option value="">{tr("All statuses")}</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {(mode === "partner" || perms.manageOrganizations) && (
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> {tr("New order")}
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <EmptyNote>{tr("No orders yet. A new order lists the organisations, the products and how long the licences last.")}</EmptyNote>
      ) : (
        <div className="overflow-x-auto bg-surface border border-rule rounded-card">
          <table className="w-full text-sm">
            <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
              <tr>
                {[tr("Order ID"), ...(mode === "staff" ? [tr("Partner")] : []), tr("Organisations"), tr("Licences and credits"), tr("Total"), tr("Order ends"), tr("Status")].map((h) => (
                  <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id} className="border-t border-rule hover:bg-paper-warm/50 cursor-pointer" onClick={() => setOpen(o.id)}>
                  <td className="px-4 py-3 font-semibold text-navy whitespace-nowrap">{o.orderNumber}</td>
                  {mode === "staff" && <td className="px-4 py-3">{o.partner ? `${o.partner.name} (${o.partner.code})` : tr("Direct (no partner)")}</td>}
                  <td className="px-4 py-3">{o.organisations.join(", ")}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {tr("{{l}} licences · {{c}} credits", { l: o.licences, c: o.credits })}
                    {o.allocatedLicences + o.allocatedCredits > 0 && <p className="text-xs text-muted">{tr("{{a}} allocated · {{s}} learners assigned", { a: o.allocatedLicences, s: o.assignedLearners })}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{money(o.total, o.currency)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{day(o.validUntil)}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <OrderModal
          mode={mode}
          orderId={open}
          onClose={() => setOpen(null)}
          onChanged={load}
          onEdit={(d) => {
            setOpen(null);
            setEditing(d);
          }}
        />
      )}
      {editing && (
        <OrderForm
          mode={mode}
          existing={editing === "new" ? null : editing}
          fixedPartnerId={partnerId}
          onClose={() => setEditing(null)}
          onDone={(text, id) => {
            setEditing(null);
            setMsg(text);
            load();
            if (id) setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function OrderModal({ mode, orderId, onClose, onChanged, onEdit }: { mode: Mode; orderId: string; onClose: () => void; onChanged: () => void; onEdit: (d: OrderDetail) => void }) {
  const [d, setD] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [finance, setFinance] = useState<"proforma" | "payment" | null>(null);
  const perms = useStaffPermissions();
  const canManage = mode === "staff" && perms.manageOrganizations;
  const canFinance = mode === "staff" && perms.finance;
  const paymentLink = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`${base(mode)}/${orderId}/payment-link`, post({}));
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const load = () => api<OrderDetail>(`${base(mode)}/${orderId}`).then(setD).catch(() => setErr(tr("Could not load this order.")));
  useEffect(() => {
    load();
  }, [orderId]);
  const move = async (to: Status, note?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api(`${base(mode)}/${orderId}/status`, post({ to, note }));
      setCancelling(false);
      await load();
      onChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const o = d?.order;
  const steps = (d?.nextSteps ?? []).filter((s) => (mode === "staff" ? canManage && s.who.includes("staff") : s.who.includes("partner")));
  const canEdit = !!o && (mode === "staff" ? canManage && ["draft", "submitted", "proforma_sent", "payment_received"].includes(o.status) : o.status === "draft");
  return (
    <DetailModal title={o ? o.orderNumber : tr("Order")} subtitle={o ? STATUS_LABEL[o.status] : ""} icon={Receipt} onClose={onClose} wide>
      {!d || !o ? (
        err ? <Notice tone="error">{err}</Notice> : <PageLoading />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {o.partner && <p><b>{tr("Partner")}:</b> {o.partner.name} ({o.partner.code})</p>}
            <p><b>{tr("Organisations")}:</b> {d.organisations.map((x) => x.name).join(", ")}</p>
            <p><b>{tr("Order ends")}:</b> {day(o.validUntil)}</p>
            <p><b>{tr("Each licence lasts")}:</b> {tr("{{n}} months from when it starts", { n: o.licenceMonths })}</p>
            <p><b>{tr("Organisations allowed")}:</b> {o.maxOrganisations}</p>
            {d.effectivePerOrgCap != null && <p><b>{tr("Licences per organisation")}:</b> {tr("up to {{n}}", { n: d.effectivePerOrgCap })}</p>}
            <p><b>{tr("Billing")}:</b> {o.inIndia ? tr("India (INR, GST 18%)") : tr("Outside India (USD, no Indian GST)")}</p>
            {o.gstin && <p><b>GSTIN:</b> {o.gstin}</p>}
          </div>
          <LinesTable lines={d.lines} currency={o.currency} months={o.licenceMonths} />
          <Totals subtotal={o.subtotal} taxRate={o.taxRate} taxAmount={o.taxAmount} total={o.total} currency={o.currency} />
          {o.partner && <p className="text-muted">{tr("Commission: {{p}}% · {{a}}", { p: o.commissionPercent, a: money(o.commissionAmount, o.currency) })}</p>}
          {o.notes && <p className="text-muted whitespace-pre-line">{o.notes}</p>}
          {o.cancelReason && <Notice tone="error">{tr("Cancelled: {{r}}", { r: o.cancelReason })}</Notice>}
          {(o.proformaNumber || o.invoiceNumber || o.paymentLinkUrl) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-rule rounded-input p-3">
              {o.proformaNumber && (
                <a className="flex items-center gap-1.5 font-semibold text-navy" href={`/order-document/${o.id}/proforma`} target="_blank" rel="noreferrer">
                  <FileText size={15} /> {tr("Proforma {{n}}", { n: o.proformaNumber })}
                </a>
              )}
              {o.invoiceNumber && (
                <a className="flex items-center gap-1.5 font-semibold text-navy" href={`/order-document/${o.id}/invoice`} target="_blank" rel="noreferrer">
                  <FileText size={15} /> {tr("Tax invoice {{n}}", { n: o.invoiceNumber })}
                </a>
              )}
              {o.paymentLinkUrl && o.status === "proforma_sent" && (
                <button className="flex items-center gap-1.5 font-semibold text-navy cursor-pointer" onClick={() => navigator.clipboard?.writeText(o.paymentLinkUrl!)}>
                  <Copy size={15} /> {tr("Copy the payment link")}
                </button>
              )}
              {o.paymentReceivedOn && o.paymentAmount != null && (
                <span className="text-muted">
                  {tr("Paid {{a}} on {{d}}", { a: money(o.paymentAmount, o.currency), d: day(o.paymentReceivedOn) })}
                  {o.paymentReference ? ` · ${o.paymentReference}` : ""}
                </span>
              )}
            </div>
          )}
          {d.allocation && <AllocationSection orderId={o.id} status={o.status} validUntil={o.validUntil} a={d.allocation} canManage={canManage} onChanged={() => { load(); onChanged(); }} />}
          {finance === "proforma" && <ProformaForm orderId={o.id} onCancel={() => setFinance(null)} onDone={() => { setFinance(null); load(); onChanged(); }} />}
          {finance === "payment" && <PaymentForm order={o} onCancel={() => setFinance(null)} onDone={() => { setFinance(null); load(); onChanged(); }} />}
          <div>
            <p className={label}>{tr("History")}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {d.history.map((h, i) => (
                <li key={i} className="text-muted">
                  {new Date(h.at).toLocaleString()} · <b className="text-ink">{h.from === h.to ? tr("Order changed") : STATUS_LABEL[h.to]}</b>
                  {h.by ? ` · ${h.by.name || h.by.email}` : ""}
                  {h.note ? ` · ${h.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
          {cancelling ? (
            <div className="flex flex-col gap-2 border border-rule rounded-input p-3">
              <span className={label}>{mode === "staff" ? tr("Reason for cancelling") : tr("Reason (optional)")}</span>
              <textarea className={input} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCancelling(false)}>
                  {tr("Keep the order")}
                </Button>
                <Button disabled={busy || (mode === "staff" && !reason.trim())} onClick={() => move("cancelled", reason)}>
                  {tr("Cancel the order")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {canEdit && (
                <Button variant="secondary" onClick={() => onEdit(d)}>
                  {tr("Change order")}
                </Button>
              )}
              {canFinance && o.status === "submitted" && !finance && (
                <Button disabled={busy} onClick={() => setFinance("proforma")}>
                  {tr("Send the proforma invoice")}
                </Button>
              )}
              {canFinance && o.status === "proforma_sent" && !finance && (
                <>
                  <Button variant="secondary" disabled={busy} onClick={paymentLink}>
                    {o.paymentLinkUrl ? tr("New payment link") : tr("Create a Stripe payment link")}
                  </Button>
                  <Button disabled={busy} onClick={() => setFinance("payment")}>
                    {tr("Record the payment")}
                  </Button>
                </>
              )}
              {steps.some((s) => s.to === "cancelled") && (
                <Button variant="secondary" onClick={() => setCancelling(true)}>
                  {tr("Cancel order")}
                </Button>
              )}
              {steps
                .filter((s) => s.to !== "cancelled")
                .map((s) => (
                  <Button key={s.to} disabled={busy} onClick={() => move(s.to)}>
                    {STEP_LABEL[s.to] ?? STATUS_LABEL[s.to]}
                  </Button>
                ))}
            </div>
          )}
        </div>
      )}
    </DetailModal>
  );
}

function LinesTable({ lines, currency, months }: { lines: Line[]; currency: string; months: number }) {
  return (
    <table className="w-full text-sm border border-rule">
      <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
        <tr>
          {[tr("Product"), tr("Quantity"), tr("Price"), tr("Amount")].map((h) => (
            <th key={h} className="text-left font-semibold px-3 py-2">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-t border-rule">
            <td className="px-3 py-2">
              {l.kind === "full_access" ? tr("Full access") : l.kind === "credits" ? tr("Recruitment or admissions credits") : l.name}
              {l.level ? ` · ${l.level}` : ""}
            </td>
            <td className="px-3 py-2">
              {l.kind === "full_access"
                ? tr("{{n}} licences × {{m}} months", { n: l.quantity, m: months })
                : l.kind === "credits"
                  ? tr("{{n}} credits", { n: l.quantity })
                  : tr("{{n}} learners · {{c}} credits", { n: l.quantity, c: l.credits ?? 0 })}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              {money(l.unitAmount ?? 0, currency)} {l.kind === "full_access" ? tr("per learner-month") : tr("per credit")}
              {l.priceOverridden && <span className="text-warning"> · {tr("special price")}</span>}
            </td>
            <td className="px-3 py-2 whitespace-nowrap">{money(l.amount ?? 0, currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ subtotal, taxRate, taxAmount, total, currency }: { subtotal: number; taxRate: number; taxAmount: number; total: number; currency: string }) {
  return (
    <div className="self-end text-right flex flex-col gap-0.5">
      <span>
        {tr("Subtotal")}: {money(subtotal, currency)}
      </span>
      <span>{taxRate ? tr("GST {{r}}%: {{a}}", { r: taxRate, a: money(taxAmount, currency) }) : tr("No Indian GST (export of services)")}</span>
      <b className="text-base">
        {tr("Total")}: {money(total, currency)}
      </b>
    </div>
  );
}

// Allocation (stage 7): each organisation's share of a confirmed order. Spica
// allocates; everyone sees what each organisation has and has assigned.
function AllocationSection({ orderId, status, validUntil, a, canManage, onChanged }: { orderId: string; status: Status; validUntil: string; a: Allocation; canManage: boolean; onChanged: () => void }) {
  const leftL = a.licences - a.allocatedLicences;
  const leftC = a.credits - a.allocatedCredits;
  const open = ["confirmed", "allocated", "active"].includes(status);
  const [form, setForm] = useState<Record<string, { licences: string; credits: string }> | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [upgradeDemo, setUpgradeDemo] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startForm = () => {
    const n = a.organisations.length || 1;
    setForm(
      Object.fromEntries(
        a.organisations.map((o, i) => {
          const l = Math.max(0, Math.min(a.perOrgCap - o.licences, Math.floor(leftL / n) + (i < leftL % n ? 1 : 0)));
          const c = Math.floor(leftC / n) + (i < leftC % n ? 1 : 0);
          return [o.id, { licences: String(l), credits: String(c) }];
        }),
      ),
    );
  };
  const allocate = async () => {
    if (!form) return;
    const items = Object.entries(form).map(([tenantId, v]) => ({ tenantId, licences: Math.max(0, Math.round(Number(v.licences) || 0)), credits: Math.max(0, Math.round(Number(v.credits) || 0)) }));
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/partner-orders/${orderId}/allocate`, post({ items, upgradeDemo }));
      setForm(null);
      onChanged();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setErr(m.includes("over_org_cap") ? tr("One organisation would get more than its cap of {{n}} licences.", { n: a.perOrgCap }) : m.includes("over_order") ? tr("That's more than the order has left.") : m.includes("nothing_to_allocate") ? tr("Enter at least one licence or credit.") : m.includes("order_ended") ? tr("The order has ended. Change its end date first.") : errText(e));
    } finally {
      setBusy(false);
    }
  };
  const saveEnd = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/partner-orders/${orderId}/end-date`, post({ validUntil: end }));
      setEnd(null);
      onChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border border-rule rounded-input p-3">
      <p className={label}>{tr("Allocation")}</p>
      <p>
        {tr("{{a}} of {{l}} licences and {{c}} of {{t}} credits allocated.", { a: a.allocatedLicences, l: a.licences, c: a.allocatedCredits, t: a.credits })}{" "}
        {a.licences > 0 && <span className="text-muted">{tr("Up to {{n}} licences per organisation.", { n: a.perOrgCap })}</span>}
      </p>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted uppercase tracking-wide">
          <tr>
            {[tr("Organisation"), tr("Licences"), tr("Credits"), tr("Learners assigned"), tr("Licences start counting")].map((h) => (
              <th key={h} className="text-left font-semibold py-1.5 pr-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {a.organisations.map((o) => (
            <tr key={o.id} className="border-t border-rule">
              <td className="py-1.5 pr-3">{o.name}</td>
              <td className="py-1.5 pr-3">
                {form ? (
                  <input className={`${input} !w-24 !py-1`} type="number" min={0} value={form[o.id]?.licences ?? "0"} onChange={(e) => setForm({ ...form, [o.id]: { ...form[o.id], licences: e.target.value } })} />
                ) : (
                  o.licences
                )}
              </td>
              <td className="py-1.5 pr-3">
                {form ? (
                  <input className={`${input} !w-24 !py-1`} type="number" min={0} value={form[o.id]?.credits ?? "0"} onChange={(e) => setForm({ ...form, [o.id]: { ...form[o.id], credits: e.target.value } })} />
                ) : (
                  o.credits
                )}
              </td>
              <td className="py-1.5 pr-3">{o.licences ? tr("{{a}} of {{l}}", { a: o.assigned, l: o.licences }) : "—"}</td>
              <td className="py-1.5 pr-3 text-muted">{o.graceEndsAt ? day(o.graceEndsAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {form && <p className="text-xs text-muted">{tr("Adding now: licences on top of what each organisation already has. Each organisation gets {{d}} setup days before the licences start counting.", { d: 3 })}</p>}
      {form && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={upgradeDemo} onChange={(e) => setUpgradeDemo(e.target.checked)} />
          {tr("Give paid licences to each organisation's demo learners now (they keep their history)")}
        </label>
      )}
      {err && <Notice tone="error">{err}</Notice>}
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          {end !== null ? (
            <>
              <input className={`${input} !w-auto`} type="date" min={plus(1)} value={end} onChange={(e) => setEnd(e.target.value)} />
              <Button variant="secondary" onClick={() => setEnd(null)}>
                {tr("Cancel")}
              </Button>
              <Button disabled={busy || !end} onClick={saveEnd}>
                {tr("Save the end date")}
              </Button>
            </>
          ) : form ? (
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                {tr("Cancel")}
              </Button>
              <Button disabled={busy} onClick={allocate}>
                {tr("Allocate")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setEnd(validUntil)}>
                {status === "expired" ? tr("Reopen with a new end date") : tr("Change the order end date")}
              </Button>
              {open && (leftL > 0 || leftC > 0) && <Button onClick={startForm}>{a.allocatedLicences + a.allocatedCredits ? tr("Allocate the rest") : tr("Allocate to organisations")}</Button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Finance: who the proforma is billed to (suggested from the first organisation).
function ProformaForm({ orderId, onCancel, onDone }: { orderId: string; onCancel: () => void; onDone: () => void }) {
  const [b, setB] = useState<BillTo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ billTo: BillTo }>(`/admin/partner-orders/${orderId}/bill-to`).then((r) => setB(r.billTo)).catch(() => setErr(tr("Could not load the billing details.")));
  }, [orderId]);
  if (!b) return err ? <Notice tone="error">{err}</Notice> : <PageLoading />;
  const set = (k: keyof BillTo) => (e: { target: { value: string } }) => setB({ ...b, [k]: e.target.value });
  const send = async () => {
    if (!b.name.trim() || !/^\S+@\S+\.\S+$/.test(b.email.trim())) return setErr(tr("Enter the name and a valid email to bill."));
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/partner-orders/${orderId}/proforma`, post({ billTo: b }));
      onDone();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 border border-rule rounded-input p-3">
      <p className="font-semibold">{tr("Send the proforma invoice")}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Bill to (organisation)")}</span>
          <input className={input} value={b.name} onChange={set("name")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("For the attention of")}</span>
          <input className={input} value={b.attention ?? ""} onChange={set("attention")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Billing email")}</span>
          <input className={input} type="email" value={b.email} onChange={set("email")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("GSTIN (optional)")}</span>
          <input className={input} value={b.gstin ?? ""} onChange={set("gstin")} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={label}>{tr("Billing address")}</span>
        <textarea className={input} rows={2} value={b.address ?? ""} onChange={set("address")} />
      </label>
      <p className="text-muted">{tr("The proforma goes to this email, the organisations' admins and the partner.")}</p>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {tr("Cancel")}
        </Button>
        <Button disabled={busy} onClick={send}>
          {tr("Send proforma")}
        </Button>
      </div>
    </div>
  );
}

// Finance: a payment that arrived (bank transfer or other). Issues the tax invoice.
function PaymentForm({ order, onCancel, onDone }: { order: OrderRow; onCancel: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"bank" | "stripe" | "other">("bank");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(order.total / 100));
  const [receivedOn, setReceivedOn] = useState(iso(new Date()));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = Math.round(Number(amount) * 100);
  const save = async () => {
    if (!(minor > 0)) return setErr(tr("Enter the amount received."));
    setBusy(true);
    setErr(null);
    try {
      await api(`/admin/partner-orders/${order.id}/payment`, post({ method, reference: reference.trim() || null, amount: minor, receivedOn }));
      onDone();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 border border-rule rounded-input p-3">
      <p className="font-semibold">{tr("Record the payment")}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Paid by")}</span>
          <select className={input} value={method} onChange={(e) => setMethod(e.target.value as "bank" | "stripe" | "other")}>
            <option value="bank">{tr("Bank transfer")}</option>
            <option value="stripe">{tr("Stripe")}</option>
            <option value="other">{tr("Other")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Reference (UTR or transaction ID)")}</span>
          <input className={input} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Amount received ({{c}})", { c: order.currency })}</span>
          <input className={input} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Received on")}</span>
          <input className={input} type="date" max={iso(new Date())} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </label>
      </div>
      {minor > 0 && minor !== order.total && <Notice tone="info">{tr("This is different from the order total of {{t}}.", { t: money(order.total, order.currency) })}</Notice>}
      <p className="text-muted">{tr("Saving issues the tax invoice and tells the organisations, the partner and Spica's admins.")}</p>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {tr("Cancel")}
        </Button>
        <Button disabled={busy} onClick={save}>
          {tr("Save the payment")}
        </Button>
      </div>
    </div>
  );
}

const VALIDITY = [
  { key: "2w", label: tr("2 weeks"), date: () => plus(14) },
  { key: "1m", label: tr("1 month"), date: () => plus(0, 1) },
  { key: "3m", label: tr("3 months"), date: () => plus(0, 3) },
  { key: "6m", label: tr("6 months"), date: () => plus(0, 6) },
];

function OrderForm({ mode, existing, fixedPartnerId, onClose, onDone }: { mode: Mode; existing: OrderDetail | null; fixedPartnerId?: string; onClose: () => void; onDone: (msg: string, id?: string) => void }) {
  const staff = mode === "staff";
  const ex = existing?.order;
  const [partnerId, setPartnerId] = useState<string>(ex?.partner?.id ?? fixedPartnerId ?? "");
  const [partners, setPartners] = useState<{ id: string; fullName: string; code: string; active: boolean }[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [chosen, setChosen] = useState<string[]>(existing?.organisations.map((o) => o.id) ?? []);
  const [lines, setLines] = useState<Line[]>(existing?.lines.map((l) => ({ kind: l.kind, productId: l.productId, level: l.level, quantity: l.quantity, unitAmount: l.priceOverridden ? l.unitAmount : null })) ?? [{ kind: "full_access", productId: null, level: null, quantity: 25, unitAmount: null }]);
  const [inIndia, setInIndia] = useState(ex?.inIndia ?? true);
  const [gstin, setGstin] = useState(ex?.gstin ?? "");
  const [months, setMonths] = useState<1 | 3 | 6>(ex?.licenceMonths ?? 3);
  const [validity, setValidity] = useState(ex ? "custom" : "3m");
  const [customDate, setCustomDate] = useState(ex?.validUntil ?? plus(0, 3));
  const [maxOrgs, setMaxOrgs] = useState(String(ex?.maxOrganisations ?? 10));
  const [cap, setCap] = useState(ex?.perOrgCap ? String(ex.perOrgCap) : "");
  const [notes, setNotes] = useState(ex?.notes ?? "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ products: Product[] }>(`${base(mode)}/products`).then((r) => setProducts(r.products)).catch(() => {});
    if (staff) api<{ partners: { id: string; fullName: string; code: string; active: boolean }[] }>("/admin/channel-partners").then((r) => setPartners(r.partners.filter((p) => p.active))).catch(() => {});
  }, []);
  useEffect(() => {
    const url = staff ? `/admin/partner-orders/organisations${partnerId ? `?partnerId=${partnerId}` : ""}` : "/partner/organisations";
    api<{ organisations: { id: string; name: string }[] }>(url).then((r) => setOrgs(r.organisations)).catch(() => setOrgs([]));
  }, [partnerId]);

  const validUntil = validity === "custom" ? customDate : VALIDITY.find((v) => v.key === validity)!.date();
  const body = useMemo(
    () => ({
      ...(staff ? { partnerId: partnerId || null } : {}),
      organisationIds: chosen,
      lines: lines.map((l) => ({ ...l, quantity: Math.max(1, Math.round(Number(l.quantity) || 1)), unitAmount: staff && l.unitAmount != null ? l.unitAmount : null })),
      inIndia,
      gstin: inIndia ? gstin.trim() || null : null,
      maxOrganisations: Math.max(1, Math.round(Number(maxOrgs) || 10)),
      perOrgCap: staff && cap ? Math.round(Number(cap)) : null,
      validUntil,
      licenceMonths: months,
      notes: notes.trim() || null,
    }),
    [partnerId, chosen, lines, inIndia, gstin, maxOrgs, cap, validUntil, months, notes],
  );
  useEffect(() => {
    if (!chosen.length || !lines.length || lines.some((l) => l.kind === "product" && !l.productId)) return setQuote(null);
    const t = setTimeout(() => {
      api<Quote>(`${base(mode)}/quote`, post(body))
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(t);
  }, [body]);

  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async (submit: boolean) => {
    if (!chosen.length) return setErr(ERRORS.no_organisations);
    if (chosen.length > Number(maxOrgs)) return setErr(ERRORS.too_many_organisations);
    if (lines.some((l) => l.kind === "product" && !l.productId)) return setErr(tr("Choose the product on each line."));
    if (lines.some((l) => l.kind === "product" && products.find((p) => p.id === l.productId)?.kind === "level" && !l.level)) return setErr(ERRORS.level_required);
    setBusy(true);
    setErr(null);
    try {
      if (ex) {
        await api(`${base(mode)}/${ex.id}`, post(body, "PUT"));
        if (submit) await api(`${base(mode)}/${ex.id}/status`, post({ to: "submitted" }));
        onDone(submit ? tr("Order {{n}} submitted.", { n: ex.orderNumber }) : tr("Order {{n}} saved.", { n: ex.orderNumber }), ex.id);
      } else {
        const r = await api<{ id: string; orderNumber: string }>(base(mode), post({ ...body, submit }));
        onDone(submit ? tr("Order {{n}} submitted. Spica will send the proforma invoice.", { n: r.orderNumber }) : tr("Order {{n}} saved as a draft.", { n: r.orderNumber }), r.id);
      }
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  return (
    <DetailModal title={ex ? tr("Change order {{n}}", { n: ex.orderNumber }) : tr("New order")} subtitle={tr("Normal Spica prices. Each licence starts when it's assigned to a learner.")} icon={Receipt} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        {staff && !ex && !fixedPartnerId && (
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Partner")}</span>
            <select
              className={input}
              value={partnerId}
              onChange={(e) => {
                setPartnerId(e.target.value);
                setChosen([]);
              }}
            >
              <option value="">{tr("No partner (Spica's own customer)")}</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} ({p.code})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-col gap-1">
          <span className={label}>{tr("Organisations ({{n}} of up to {{max}})", { n: chosen.length, max: maxOrgs })}</span>
          {orgs.length === 0 ? (
            <p className="text-muted">{tr("No organisations yet. Add an organisation first.")}</p>
          ) : (
            <div className="max-h-40 overflow-y-auto border border-rule rounded-input p-2 grid sm:grid-cols-2 gap-1">
              {orgs.map((o) => (
                <label key={o.id} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={chosen.includes(o.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
                  {o.name}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className={label}>{tr("Products")}</span>
          {lines.map((l, i) => {
            const p = products.find((x) => x.id === l.productId);
            const q = quote?.lines[i];
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 border border-rule rounded-input p-2">
                <select
                  className={`${input} !w-auto flex-1 min-w-48`}
                  value={l.kind === "product" ? l.productId ?? "" : l.kind}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLine(i, v === "full_access" || v === "credits" ? { kind: v, productId: null, level: null, unitAmount: null } : { kind: "product", productId: v || null, level: null, unitAmount: null });
                  }}
                >
                  <option value="full_access">{tr("Full access (licences)")}</option>
                  {products.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({tr("{{n}} credits", { n: x.credits })})
                    </option>
                  ))}
                  <option value="credits">{tr("Recruitment or admissions credits")}</option>
                </select>
                {p?.kind === "level" && (
                  <select className={`${input} !w-24`} value={l.level ?? ""} onChange={(e) => setLine(i, { level: e.target.value || null })}>
                    <option value="">{tr("Level")}</option>
                    {LEVELS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                )}
                <label className="flex flex-col gap-0.5 w-28">
                  <span className="text-xs text-muted">{l.kind === "full_access" ? tr("Licences") : l.kind === "credits" ? tr("Credits") : tr("Learners")}</span>
                  <input className={input} type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                </label>
                {staff && (
                  <label className="flex flex-col gap-0.5 w-36">
                    <span className="text-xs text-muted">{tr("Special price (optional)")}</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={q ? String(q.listUnitAmount / 100) : ""}
                      value={l.unitAmount == null ? "" : l.unitAmount / 100}
                      onChange={(e) => setLine(i, { unitAmount: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })}
                    />
                  </label>
                )}
                <span className="ml-auto text-right whitespace-nowrap">{q ? money(q.amount ?? 0, quote!.currency) : ""}</span>
                {lines.length > 1 && (
                  <button aria-label={tr("Remove")} className="text-muted hover:text-error cursor-pointer p-1" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <button className="self-start text-sm font-semibold text-navy cursor-pointer" onClick={() => setLines([...lines, { kind: "product", productId: null, level: null, quantity: 10, unitAmount: null }])}>
            + {tr("Add a product")}
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Each licence lasts")}</span>
            <select className={input} value={months} onChange={(e) => setMonths(Number(e.target.value) as 1 | 3 | 6)}>
              {[1, 3, 6].map((m) => (
                <option key={m} value={m}>
                  {tr("{{n}} months", { n: m })}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Order ends (licences must be assigned by then)")}</span>
            <div className="flex gap-2">
              <select className={`${input} !w-auto`} value={validity} onChange={(e) => setValidity(e.target.value)}>
                {VALIDITY.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label}
                  </option>
                ))}
                <option value="custom">{tr("Choose a date")}</option>
              </select>
              {validity === "custom" ? (
                <input className={input} type="date" value={customDate} min={staff ? plus(1) : plus(14)} max={staff ? plus(0, 24) : plus(0, 6)} onChange={(e) => setCustomDate(e.target.value)} />
              ) : (
                <span className="self-center text-muted">{day(validUntil)}</span>
              )}
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Billing")}</span>
            <select className={input} value={inIndia ? "in" : "abroad"} onChange={(e) => setInIndia(e.target.value === "in")}>
              <option value="in">{tr("India (INR, GST 18%)")}</option>
              <option value="abroad">{tr("Outside India (USD, no Indian GST)")}</option>
            </select>
          </label>
          {inIndia && (
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("GSTIN (optional)")}</span>
              <input className={input} value={gstin} maxLength={20} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Most organisations on this order")}</span>
            <input className={input} type="number" min={1} max={staff ? 500 : 10} value={maxOrgs} onChange={(e) => setMaxOrgs(e.target.value)} />
          </label>
          {staff && (
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("Licences per organisation (optional cap)")}</span>
              <input className={input} type="number" min={1} value={cap} placeholder={quote?.licences ? String(Math.ceil(quote.licences / Math.max(1, chosen.length))) : ""} onChange={(e) => setCap(e.target.value)} />
            </label>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Notes")}</span>
          <textarea className={input} rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {quote && <Totals subtotal={quote.subtotal} taxRate={quote.taxRate} taxAmount={quote.taxAmount} total={quote.total} currency={quote.currency} />}
        {quote?.education && <p className="text-xs text-muted self-end">{tr("Includes 15% off Full access for universities and colleges.")}</p>}
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          {(!ex || ex.status === "draft") && (
            <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
              {tr("Save as draft")}
            </Button>
          )}
          <Button disabled={busy} onClick={() => save(!ex || ex.status === "draft")}>
            {!ex || ex.status === "draft" ? tr("Submit order") : tr("Save changes")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}

export function PartnerOrders() {
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Orders")} subtitle={tr("Paid orders for your organisations. Spica sends the proforma invoice, confirms the payment and then makes the licences available.")} />
      <OrdersPanel mode="partner" />
    </div>
  );
}

export function StaffPartnerOrders() {
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Partner orders")} subtitle={tr("Every paid order, from partners or placed by Spica. Move each order through proforma, payment and confirmation.")} />
      <OrdersPanel mode="staff" />
    </div>
  );
}
