import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, FileText } from "lucide-react";
import { TIER_LABELS } from "@/api/plans";
import { getStaffBilling, money, shortDate, type BillingContract, type BillingMonth, type BillingOrder } from "@/api/staff";
import { EmptyNote, FilterPills, PageError, PageHeader, PageLoading, Panel, SearchBox, StatCard, StatusPill, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
type F = "unpaid" | "overdue" | "paid" | "individual" | "all";

// Money across the organizations this person looks after, plus individual
// learners' plan payments: what's paid, what's owed, and contracts ending.
export function StaffBilling() {
  const perms = useStaffPermissions();
  const [data, setData] = useState<{ monthly: BillingMonth[]; orders: BillingOrder[]; contracts: BillingContract[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<F>("unpaid");
  const [query, setQuery] = useState("");
  const load = () => {
    setError(null);
    getStaffBilling()
      .then(setData)
      .catch(() => setError(tr("Could not load billing.")));
  };
  useEffect(load, []);
  if (error) return <PageError message={error} onRetry={load} />;
  if (!data) return <PageLoading />;

  const { orders, contracts, monthly } = data;
  const cur = orders[0]?.currency ?? "USD";
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const paid = orders.filter((o) => o.status === "paid");
  const unpaid = orders.filter((o) => o.status === "created" && o.provider === "invoice");
  const total = (xs: BillingOrder[]) => xs.reduce((n, o) => n + o.total, 0);
  const match: Record<F, (o: BillingOrder) => boolean> = {
    unpaid: (o) => o.status === "created" && o.provider === "invoice",
    overdue: (o) => o.overdue,
    paid: (o) => o.status === "paid",
    individual: (o) => o.kind === "individual_plan",
    all: () => true,
  };
  const q = query.trim().toLowerCase();
  const shown = orders.filter(
    (o) => match[filter](o) && (!q || [o.orgName, o.buyerName, o.buyerEmail, o.invoiceNumber, o.quoteNumber, o.poNumber].some((v) => v?.toLowerCase().includes(q))),
  );
  const ending = contracts.filter((c) => new Date(c.contractEnd).getTime() - Date.now() < 90 * 86400000);

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Billing")}
        subtitle={perms.isSuper ? tr("Payments, unpaid invoices and contracts across Spica.") : tr("Payments, unpaid invoices and contracts for your organizations, and individual learners' plans.")}
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="rose" index={0} icon={CreditCard} value={money(total(paid.filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= monthStart)), cur)} label={tr("Paid this month")} sub={tr("{{money}} in total", { money: money(total(paid), cur) })} />
        <StatCard variant="ledger" palette="rose" index={1} icon={FileText} value={unpaid.length} label={tr("Unpaid invoices")} sub={money(total(unpaid), cur)} progress={orders.length ? unpaid.length / orders.length : 0} />
        <StatCard variant="ledger" palette="rose" index={2} icon={AlertTriangle} value={unpaid.filter((o) => o.overdue).length} label={tr("Overdue")} sub={money(total(unpaid.filter((o) => o.overdue)), cur)} progress={unpaid.length ? unpaid.filter((o) => o.overdue).length / unpaid.length : 0} />
        <StatCard variant="ledger" palette="rose" index={3} icon={CalendarClock} value={ending.length} label={tr("Contracts ending in 90 days")} sub={tr("{{length}} contracts in total", { length: contracts.length })} progress={contracts.length ? ending.length / contracts.length : 0} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Panel className="lg:col-span-2" title={tr("Money in, last 12 months")}>
          {(() => {
            const max = Math.max(1, ...monthly.map((m) => m.orgs + m.individuals));
            const yearTotal = monthly.reduce((n, m) => n + m.orgs + m.individuals, 0);
            return (
              <>
                <div className="flex items-end gap-1.5 h-44">
                  {monthly.map((m) => (
                    <div key={m.month} className="flex-1 h-full flex flex-col justify-end" title={tr("{{month}}: {{orgs}} organizations, {{individuals}} individuals, {{n}} licenses", { month: m.month, orgs: money(m.orgs, cur), individuals: money(m.individuals, cur), n: m.licenses })}>
                      <div style={{ height: `${(m.individuals / max) * 100}%`, background: "#7f9478" }} className="rounded-t-sm" />
                      <div style={{ height: `${(m.orgs / max) * 100}%`, background: "var(--color-navy)", minHeight: m.orgs ? 3 : 0 }} className={m.individuals ? "" : "rounded-t-sm"} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {monthly.map((m) => (
                    <span key={m.month} className="flex-1 text-center text-[10px] text-muted">
                      {new Date(`${m.month}-01`).toLocaleDateString(undefined, { month: "short" })}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-navy)" }} /> {tr("Organizations")}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#7f9478" }} /> {tr("Individual plans")}</span>
                  <span className="ml-auto">
                    {tr("12 months:")}{" "}<span className="font-semibold text-ink">{money(yearTotal, cur)}</span> · {monthly.reduce((n, m) => n + m.licenses, 0)} {tr("licenses sold")}</span>
                </div>
              </>
            );
          })()}
        </Panel>
        <Panel title={tr("Top customers")}>
          {(() => {
            const by = new Map<string, number>();
            for (const o of paid) {
              const k = o.orgName ?? o.buyerName ?? o.buyerEmail ?? tr("Unknown");
              by.set(k, (by.get(k) ?? 0) + o.total);
            }
            const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
            const max = top[0]?.[1] ?? 1;
            return top.length === 0 ? (
              <EmptyNote>{tr("No payments yet.")}</EmptyNote>
            ) : (
              top.map(([name, amt]) => (
                <div key={name} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink truncate">{name}</span>
                    <span className="text-muted">{money(amt, cur)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(amt / max) * 100}%`, background: "#c98a7a" }} />
                  </div>
                </div>
              ))
            );
          })()}
          {paid.length > 0 && <p className="text-xs text-muted">{tr("Average payment")}{" "}{money(Math.round(total(paid) / paid.length), cur)}</p>}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by organization, buyer, invoice, quote or PO")} />
          </div>
          <FilterPills<F>
            value={filter}
            onChange={setFilter}
            options={[
              ["unpaid", tr("Unpaid"), unpaid.length],
              ["overdue", tr("Overdue"), orders.filter(match.overdue).length],
              ["paid", tr("Paid"), paid.length],
              ["individual", tr("Individual plans"), orders.filter(match.individual).length],
              ["all", tr("All"), orders.length],
            ]}
          />
          {shown.length === 0 ? (
            <EmptyNote>{q ? tr("No payments match your search.") : tr("No payments in this view.")}</EmptyNote>
          ) : (
            <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-3">{tr("Customer")}</th>
                    <th className="px-4 py-3">{tr("For")}</th>
                    <th className="px-4 py-3">{tr("Amount")}</th>
                    <th className="px-4 py-3">{tr("Date")}</th>
                    <th className="px-4 py-3">{tr("Status")}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o) => (
                    <tr key={o.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3">
                        <p className="text-ink font-medium">{o.orgName ?? o.buyerName ?? o.buyerEmail ?? "—"}</p>
                        <p className="text-xs text-muted">{o.kind === "individual_plan" ? tr("Individual · {{v}}", { v: o.buyerEmail ?? "" }) : (o.buyerName ?? "")}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {o.kind === "individual_plan" ? tr("Plan") : o.quantity === 1 ? tr("1 license") : tr("{{n}} licenses", { n: o.quantity })}
                        {o.poNumber ? tr(" · PO {{poNumber}}", { poNumber: o.poNumber }) : ""}
                      </td>
                      <td className="px-4 py-3 text-ink font-medium">{money(o.total, o.currency)}</td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">
                        {o.status === "paid"
                          ? tr("Paid {{date}}", { date: shortDate(o.paidAt) })
                          : o.dueDate
                            ? tr("Due {{date}}", { date: shortDate(o.dueDate) })
                            : tr("Created {{date}}", { date: shortDate(o.createdAt) })}
                      </td>
                      <td className="px-4 py-3">
                        {o.status === "paid" ? (
                          <StatusPill tone="success">
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 size={12} /> {tr("Paid")}</span>
                          </StatusPill>
                        ) : o.overdue ? (
                          <StatusPill tone="error">{tr("Overdue")}</StatusPill>
                        ) : o.provider === "invoice" ? (
                          <StatusPill tone="warning">{tr("Awaiting payment")}</StatusPill>
                        ) : (
                          <StatusPill tone="muted">{tr("Checkout started")}</StatusPill>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {o.invoiceId ? (
                          <a href={`/invoice/${o.invoiceId}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-navy hover:underline">
                            {o.invoiceNumber ?? tr("Invoice")}
                          </a>
                        ) : o.quoteNumber ? (
                          <span className="text-xs text-muted">{o.quoteNumber}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">
            {tr("Mark invoices paid, cancel them or issue credit notes from the organization's details on the Organizations page.")}{" "}
            <Link to={perms.isSuper ? ROUTES.SUPER_ORGANIZATIONS : ROUTES.ADMIN_CONSOLE_ORGANIZATIONS} className="font-semibold text-navy hover:underline">
              {tr("Open Organizations")}
            </Link>
          </p>
        </div>

        <Panel title={tr("Contracts")}>
          {contracts.length === 0 ? (
            <EmptyNote>{tr("No contract dates recorded yet. Add them from an organization's details.")}</EmptyNote>
          ) : (
            contracts.map((c) => {
              const days = Math.ceil((new Date(c.contractEnd).getTime() - Date.now()) / 86400000);
              return (
                <div key={c.id} className="flex items-start justify-between gap-3 border-t border-rule pt-2.5 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm text-ink font-medium truncate">{c.name}</p>
                    <p className="text-xs text-muted">
                      {TIER_LABELS[c.planTier]}
                      {c.valueCents && c.currency ? ` · ${money(c.valueCents, c.currency)}` : ""}
                      {perms.isSuper && c.ownerName ? ` · ${c.ownerName}` : ""}
                    </p>
                  </div>
                  <StatusPill tone={days < 0 ? "error" : days <= 30 ? "error" : days <= 90 ? "warning" : "muted"}>
                    {days < 0 ? tr("Ended {{date}}", { date: shortDate(c.contractEnd) }) : tr("Ends {{date}}", { date: shortDate(c.contractEnd) })}
                  </StatusPill>
                </div>
              );
            })
          )}
        </Panel>
      </div>
    </div>
  );
}
