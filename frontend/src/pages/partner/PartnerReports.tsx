import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, StatusPill, useStaffPermissions } from "@/components/staff/StaffKit";
import { DetailModal } from "@/components/DetailModal";
import { money } from "@/pages/partner/PartnerOrders";
import { tr } from "@/i18n/tr";
import { appLocale } from "@/lib/locale";

// Channel Partners stage 9: partner performance and commission (staff), and
// the partner's own commission page.
interface Perf {
  id: string;
  name: string;
  code: string;
  active: boolean;
  commissionPercent: number;
  organisationsAdded: number;
  organisationsTotal: number;
  organisationsConverted: number;
  demoAllocation: number;
  demoGiven: number;
  demoUsed: number;
  learners: number;
  learnersStarted: number;
  mocksDone: number;
  realTestsDone: number;
  certificates: number;
  ordersPaid: number;
  revenue: Record<string, number>;
  commission: Record<string, number>;
  commissionUnpaid: Record<string, number>;
  paidLicencesAllocated: number;
  paidLicencesAssigned: number;
}
interface CommissionRow {
  orderId: string;
  orderNumber: string;
  status: string;
  partner: { id: string; name: string; code: string };
  organisations: string[];
  confirmedAt: string | null;
  currency: string;
  subtotal: number;
  commissionPercent: number;
  commission: number;
  paidAt: string | null;
  paidReference: string | null;
}

const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(appLocale(), { day: "numeric", month: "short", year: "numeric" }) : "—");
const sums = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => Number(v) !== 0).map(([c, v]) => money(Number(v), c)).join(" + ") || "—";
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS = [
  { key: "all", label: tr("All time"), from: () => null },
  { key: "month", label: tr("This month"), from: () => iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) },
  { key: "3m", label: tr("Last 3 months"), from: () => iso(new Date(Date.now() - 91 * 86400000)) },
  { key: "year", label: tr("This year"), from: () => `${new Date().getFullYear()}-01-01` },
];

function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Performance() {
  const [period, setPeriod] = useState("all");
  const [rows, setRows] = useState<Perf[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const from = PERIODS.find((p) => p.key === period)!.from();
    setRows(null);
    api<{ partners: Perf[] }>(`/admin/partner-reports/performance${from ? `?from=${from}` : ""}`)
      .then((r) => setRows(r.partners))
      .catch(() => setError(true));
  }, [period]);
  if (error) return <PageError message={tr("Could not load the report.")} />;
  const csv = () =>
    downloadCsv(`partner-performance-${period}.csv`, [
      ["Partner", "Code", "Organisations added (period)", "Organisations in total", "Converted to paid", "Demo licences given", "Demo licences used", "Learners", "Learners started", "Mock tests finished", "Real tests finished", "Certificates", "Paid orders (period)", "Revenue excl. tax (period)", "Commission (period)", "Commission unpaid", "Paid licences allocated", "Paid licences assigned"],
      ...(rows ?? []).map((p) => [p.name, p.code, p.organisationsAdded, p.organisationsTotal, p.organisationsConverted, p.demoGiven, p.demoUsed, p.learners, p.learnersStarted, p.mocksDone, p.realTestsDone, p.certificates, p.ordersPaid, sums(p.revenue), sums(p.commission), sums(p.commissionUnpaid), p.paidLicencesAllocated, p.paidLicencesAssigned]),
    ]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select className={`${input} !w-auto`} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" disabled={!rows?.length} onClick={csv} className="flex items-center gap-1.5">
          <Download size={15} /> {tr("Download CSV")}
        </Button>
      </div>
      <p className="text-xs text-muted">{tr("The period applies to organisations added, paid orders, revenue and commission. Use of licences and tests is all-time.")}</p>
      {!rows ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <EmptyNote>{tr("No Channel Partners yet.")}</EmptyNote>
      ) : (
        <div className="overflow-x-auto bg-surface border border-rule rounded-card">
          <table className="w-full text-sm">
            <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
              <tr>
                {[tr("Partner"), tr("Organisations"), tr("Demo licences"), tr("Learners"), tr("Tests finished"), tr("Paid orders"), tr("Revenue (excl. tax)"), tr("Commission"), tr("Paid licences")].map((h) => (
                  <th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-rule align-top">
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-muted">
                      {p.code} {!p.active && <StatusPill tone="muted">{tr("Deactivated")}</StatusPill>}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p>{tr("{{n}} added", { n: p.organisationsAdded })}</p>
                    <p className="text-xs text-muted">{tr("{{c}} of {{t}} converted to paid", { c: p.organisationsConverted, t: p.organisationsTotal })}</p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p>{tr("{{u}} used of {{g}} given", { u: p.demoUsed, g: p.demoGiven })}</p>
                    <p className="text-xs text-muted">{tr("{{n}} allocated by Spica", { n: p.demoAllocation })}</p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p>{p.learners}</p>
                    <p className="text-xs text-muted">{tr("{{n}} started", { n: p.learnersStarted })}</p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p>{tr("{{m}} mock · {{r}} real", { m: p.mocksDone, r: p.realTestsDone })}</p>
                    <p className="text-xs text-muted">{tr("{{n}} certificates", { n: p.certificates })}</p>
                  </td>
                  <td className="px-3 py-2.5">{p.ordersPaid}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{sums(p.revenue)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <p>{sums(p.commission)}</p>
                    <p className="text-xs text-muted">
                      {p.commissionPercent}% · {tr("unpaid {{a}}", { a: sums(p.commissionUnpaid) })}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{tr("{{a}} of {{l}} assigned", { a: p.paidLicencesAssigned, l: p.paidLicencesAllocated })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CommissionTable({ mode }: { mode: "staff" | "partner" }) {
  const perms = useStaffPermissions();
  const [rows, setRows] = useState<CommissionRow[] | null>(null);
  const [error, setError] = useState(false);
  const [unpaid, setUnpaid] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [paying, setPaying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => {
    setRows(null);
    api<{ rows: CommissionRow[] }>(mode === "staff" ? `/admin/partner-reports/commission${unpaid ? "?unpaid=1" : ""}` : "/partner/orders/commission/list")
      .then((r) => setRows(r.rows))
      .catch(() => setError(true));
  };
  useEffect(load, [unpaid]);
  if (error) return <PageError message={tr("Could not load the commission.")} />;
  if (!rows) return <PageLoading />;
  const canPay = mode === "staff" && perms.finance;
  const totals = new Map<string, { all: number; open: number }>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? { all: 0, open: 0 };
    t.all += r.commission;
    if (!r.paidAt) t.open += r.commission;
    totals.set(r.currency, t);
  }
  return (
    <div className="flex flex-col gap-4">
      {msg && (
        <Notice tone="success" onClose={() => setMsg(null)}>
          {msg}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {[...totals].map(([c, t]) => tr("{{all}} earned · {{open}} not paid yet", { all: money(t.all, c), open: money(t.open, c) })).join(" | ") || tr("No commission yet.")}
        </p>
        <div className="flex items-center gap-3">
          {mode === "staff" && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> {tr("Only not paid")}
            </label>
          )}
          {canPay && (
            <Button disabled={!picked.length} onClick={() => setPaying(true)}>
              {tr("Mark paid ({{n}})", { n: picked.length })}
            </Button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyNote>{tr("Commission shows here for every confirmed order.")}</EmptyNote>
      ) : (
        <div className="overflow-x-auto bg-surface border border-rule rounded-card">
          <table className="w-full text-sm">
            <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
              <tr>
                {[...(canPay ? [""] : []), tr("Order ID"), ...(mode === "staff" ? [tr("Partner")] : []), tr("Organisations"), tr("Confirmed"), tr("Order value (excl. tax)"), tr("Rate"), tr("Commission"), tr("Paid")].map((h, i) => (
                  <th key={i} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orderId} className="border-t border-rule">
                  {canPay && (
                    <td className="px-3 py-2.5">
                      {!r.paidAt && r.commission > 0 && <input type="checkbox" checked={picked.includes(r.orderId)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.orderId] : picked.filter((x) => x !== r.orderId))} />}
                    </td>
                  )}
                  <td className="px-3 py-2.5 font-semibold whitespace-nowrap">{r.orderNumber}</td>
                  {mode === "staff" && <td className="px-3 py-2.5">{`${r.partner.name} (${r.partner.code})`}</td>}
                  <td className="px-3 py-2.5">{r.organisations.join(", ")}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted">{day(r.confirmedAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{money(r.subtotal, r.currency)}</td>
                  <td className="px-3 py-2.5">{r.commissionPercent}%</td>
                  <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{money(r.commission, r.currency)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {r.paidAt ? (
                      <>
                        <StatusPill tone="success">{tr("Paid {{d}}", { d: day(r.paidAt) })}</StatusPill>
                        {r.paidReference && <p className="text-xs text-muted">{r.paidReference}</p>}
                      </>
                    ) : r.commission > 0 ? (
                      <StatusPill tone="warning">{tr("Not paid yet")}</StatusPill>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && (
        <PayCommission
          orderIds={picked}
          onClose={() => setPaying(false)}
          onDone={(n) => {
            setPaying(false);
            setPicked([]);
            setMsg(tr("Commission marked paid on {{n}} orders. The partner has been told.", { n }));
            load();
          }}
        />
      )}
    </div>
  );
}

function PayCommission({ orderIds, onClose, onDone }: { orderIds: string[]; onClose: () => void; onDone: (n: number) => void }) {
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!ref.trim()) return setErr(tr("Enter the payment reference."));
    setBusy(true);
    try {
      const r = await api<{ paid: number }>("/admin/partner-reports/commission/paid", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds, reference: ref.trim() }) });
      onDone(r.paid);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "").includes("payout_details_missing") ? tr("This partner hasn't added payout details yet, so they can't be paid. They're reminded to add them in their Profile.") : tr("That didn't work. Try again."));
      setBusy(false);
    }
  };
  return (
    <DetailModal title={tr("Mark commission paid")} subtitle={tr("{{n}} orders", { n: orderIds.length })} icon={Download} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted uppercase tracking-wide">{tr("Payment reference (UTR or transaction ID)")}</span>
          <input className={input} value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} />
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button disabled={busy} onClick={save}>
            {tr("Mark paid")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}

export function StaffPartnerReports() {
  const [tab, setTab] = useState<"performance" | "commission">("performance");
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Partner reports")} subtitle={tr("How each Channel Partner performs, and the commission due on their confirmed orders.")} />
      <div className="flex gap-2">
        {(
          [
            ["performance", tr("Performance")],
            ["commission", tr("Commission")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-pill text-sm font-semibold cursor-pointer ${tab === k ? "bg-navy text-white" : "bg-surface border border-rule text-ink"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "performance" ? <Performance /> : <CommissionTable mode="staff" />}
    </div>
  );
}

export function PartnerCommission() {
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("Commission")} subtitle={tr("Your commission on each confirmed order: your rate times the order value without tax. Spica pays it and tells you the reference.")} />
      <CommissionTable mode="partner" />
    </div>
  );
}
