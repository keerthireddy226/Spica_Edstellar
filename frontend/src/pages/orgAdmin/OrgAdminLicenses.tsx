import { useEffect, useMemo, useState } from "react";
import { KeyRound, Users, CalendarClock, AlertTriangle, PackageCheck, UserX, Search, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { AssignLicenseModal } from "@/components/licenses/AssignLicenseModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { UnassignLicenseModal } from "@/components/licenses/UnassignLicenseModal";
import { BuyLicensesModal } from "@/components/licenses/BuyLicensesModal";
import { LicenseRequestsTab } from "@/components/licenses/LicenseRequestsTab";
import { PlanLockNote } from "@/components/plans/usePlan";
import { planErrorMessage } from "@/api/plans";
import { getOrgLicenseRequests, type LicenseRequest } from "@/api/licenses";
import { useSearchParams } from "react-router-dom";
import { getInvoices, formatAmount, type InvoiceSummary } from "@/api/payments";
import { Link } from "react-router-dom";
import { getOrgOverview } from "@/api/orgAdmin";
import {
  getOrgLicenseOverview,
  orgAssignLicenses,
  orgReclaimLicenses,
  setBatchBudget,
  setManagerPoolAllotment,
  LICENSE_ERROR_TEXT,
  formatMoney,
  formatShortDate,
  type OrgLicenseOverview,
  type LearnerLicenseRow,
  type LicenseEvent,
  type AccessStatus,
} from "@/api/licenses";

type Tab = "learners" | "requests" | "budgets" | "purchases" | "invoices" | "activity";
type StatusFilter = "all" | AccessStatus | "expiring";

const SOURCE_LABEL = { purchase: "Purchase", credit: "Credit", comp: "Complimentary" } as const;

function StatCard({ label, value, hint, icon: Icon, index }: { label: string; value: number; hint?: string; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
        {hint && <p className="text-[11px] text-white/70 truncate">{hint}</p>}
      </div>
    </div>
  );
}

function eventSentence(e: LicenseEvent): string {
  const n = `${e.quantity} license${e.quantity === 1 ? "" : "s"}`;
  switch (e.kind) {
    case "purchase":
      return `${n} purchased${e.note ? ` (${e.note})` : ""}`;
    case "credit":
      return `${n} credited by Edstellar${e.note ? ` (${e.note})` : ""}`;
    case "comp":
      return `${n} added complimentary${e.note ? ` (${e.note})` : ""}`;
    case "assign":
      return `${n} assigned to ${e.learnerEmail ?? "a learner"}${e.batchName ? ` · ${e.batchName}` : ""}`;
    case "extend":
      return `${e.learnerEmail ?? "A learner"} extended by ${e.quantity} month${e.quantity === 1 ? "" : "s"}`;
    case "reclaim":
      return `${n} unassigned from ${e.learnerEmail ?? "a learner"} back to the pool${e.note ? ` — ${e.note}` : ""}`;
    case "budget":
      return e.note ?? `${e.batchName} budget set to ${e.quantity}`;
  }
}

// One editable allotment line — a batch's fixed licenses or a Manager's pool.
function AllotmentRow({
  title,
  subtitle,
  allotment,
  used,
  onSave,
}: {
  title: string;
  subtitle: string;
  allotment: number | null;
  used: number;
  onSave: (value: number | null) => Promise<unknown>;
}) {
  const [value, setValue] = useState(allotment?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== (allotment?.toString() ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(value.trim() === "" ? null : Number(value));
    } catch (err) {
      setError(planErrorMessage(err) ?? LICENSE_ERROR_TEXT[err instanceof ApiError ? err.message : ""] ?? "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-rule last:border-0 align-top">
      <td className="px-4 py-3">
        <p className="text-ink font-medium">{title}</p>
        <p className="text-xs text-muted">{subtitle}</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={used}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="None"
            className="w-24 rounded-input border border-rule bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-navy focus:outline-none"
          />
          {dirty && (
            <button
              onClick={save}
              disabled={saving}
              title="Save"
              className="p-1.5 rounded-input text-success hover:bg-success/10 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check size={16} />
            </button>
          )}
        </div>
        {error && <p className="text-xs text-error mt-1 max-w-xs">{error}</p>}
      </td>
      <td className="px-4 py-3 text-muted">{used}</td>
      <td className="px-4 py-3 text-muted">{allotment === null ? "—" : Math.max(0, allotment - used)}</td>
    </tr>
  );
}

export function OrgAdminLicenses() {
  const [data, setData] = useState<OrgLicenseOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "requests" ? "requests" : "learners");
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [assigning, setAssigning] = useState<LearnerLicenseRow | null>(null);
  const [unassigning, setUnassigning] = useState<LearnerLicenseRow | null>(null);
  const [contact, setContact] = useState<{ name: string; email: string } | null>(null);
  const [showBuy, setShowBuy] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);

  function load() {
    getOrgLicenseOverview()
      .then(setData)
      .catch(() => setError("Could not load licenses."));
    getInvoices()
      .then((r) => setInvoices(r.invoices))
      .catch(() => {});
    getOrgLicenseRequests()
      .then((r) => {
        setRequests(r.requests);
        setPendingRequests(r.pending);
      })
      .catch(() => {});
  }

  useEffect(() => {
    load();
    getOrgOverview()
      .then((o) => setContact(o.onboardedBy))
      .catch(() => {});
  }, []);

  const learners = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.learners.filter((l) => {
      const soon =
        l.license.status === "active" && l.license.accessEndsAt && new Date(l.license.accessEndsAt).getTime() - Date.now() < 7 * 86400000;
      if (filter === "expiring" && !soon) return false;
      if (filter !== "all" && filter !== "expiring" && l.license.status !== filter) return false;
      if (!q) return true;
      return [l.firstName, l.lastName, l.email, l.participantId, l.batchName].some((v) => v?.toLowerCase().includes(q));
    });
  }, [data, filter, query]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const s = data.summary;
  const poolExpiringSoon = s.nextPoolExpiry && new Date(s.nextPoolExpiry).getTime() - Date.now() < 30 * 86400000;

  const FILTERS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: data.learners.length },
    { key: "active", label: "Active", count: s.activeLearners },
    { key: "expiring", label: "Ending ≤ 7 days", count: s.expiringSoonLearners },
    { key: "grace", label: "Grace", count: s.graceLearners },
    { key: "expired", label: "Expired", count: s.expiredLearners },
    { key: "none", label: "No license", count: s.unlicensedLearners },
  ];

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Licenses</h1>
          <p className="text-sm text-muted mt-1">
            1 license = 1 learner's access for 1 month, starting when you assign it · {formatMoney(data.pricePerLicenseCents)} per license
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowBuy(true)} className="flex items-center gap-2">
            <KeyRound size={16} /> Buy licenses
          </Button>
          <p className="text-[11px] text-muted max-w-xs text-right">
            Large order or paying by PO? Contact {contact ? `${contact.name} (${contact.email})` : "your Edstellar account manager"}.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Unreserved in pool" value={s.unreserved} hint={s.reservedForBatches + s.reservedForManagers ? `${s.reservedForBatches + s.reservedForManagers} set aside` : undefined} icon={PackageCheck} index={0} />
        <StatCard label="Purchased (all time)" value={s.purchased} hint={`${s.assigned} assigned`} icon={KeyRound} index={1} />
        <StatCard label="Learners active" value={s.activeLearners} hint={s.queuedMonths ? `${s.queuedMonths} months queued` : undefined} icon={Users} index={2} />
        <StatCard label="Ending in 7 days" value={s.expiringSoonLearners} icon={CalendarClock} index={3} />
        <StatCard label="Expired / grace" value={s.expiredLearners + s.graceLearners} icon={AlertTriangle} index={4} />
        <StatCard label="No license yet" value={s.unlicensedLearners} icon={UserX} index={5} />
      </div>

      {(poolExpiringSoon || s.expiredUnused > 0 || (s.unlicensedLearners > 0 && s.available > 0)) && (
        <div className="flex flex-col gap-2">
          {poolExpiringSoon && (
            <p className="text-sm text-navy-deep bg-warning/10 border border-warning/25 rounded-input px-3.5 py-2.5">
              {s.nextPoolExpiryQuantity} unassigned license{s.nextPoolExpiryQuantity === 1 ? "" : "s"} expire on {formatShortDate(s.nextPoolExpiry)} — assign them before then.
            </p>
          )}
          {s.unlicensedLearners > 0 && s.available > 0 && (
            <p className="text-sm text-ink bg-navy/5 border border-rule rounded-input px-3.5 py-2.5">
              {s.unlicensedLearners} learner{s.unlicensedLearners === 1 ? " has" : "s have"} no license and can't practice yet.{" "}
              <button onClick={() => { setTab("learners"); setFilter("none"); }} className="font-semibold underline cursor-pointer">
                Show them
              </button>
            </p>
          )}
          {s.expiredUnused > 0 && (
            <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
              {s.expiredUnused} license{s.expiredUnused === 1 ? "" : "s"} expired unused (pool licenses are valid for 12 months after purchase).
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-rule">
        {(
          [
            ["learners", "Learners"],
            ["requests", pendingRequests ? `Requests (${pendingRequests})` : "Requests"],
            ["budgets", "Allotments"],
            ["purchases", "Purchases"],
            ["invoices", "Invoices"],
            ["activity", "Activity"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors cursor-pointer ${
              tab === key ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "learners" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition-colors cursor-pointer ${
                    filter === f.key ? "bg-navy text-white" : "bg-paper-warm text-muted hover:text-ink"
                  }`}
                >
                  {f.label} · {f.count}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, ID, batch"
                className="w-64 rounded-input border border-rule bg-paper pl-8 pr-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Learner</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">License</th>
                  <th className="px-4 py-3">Months used</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {learners.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted">
                      No learners match.
                    </td>
                  </tr>
                )}
                {learners.map((l) => {
                  const live = l.license.status === "active" || l.license.status === "grace";
                  return (
                    <tr key={l.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3">
                        <p className="text-ink font-medium">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                        <p className="text-xs text-muted">
                          {l.participantId ? `${l.participantId} · ` : ""}
                          {l.email}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-muted">{l.batchName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <LicenseStatusPill license={l.license} />
                      </td>
                      <td className="px-4 py-3 text-muted">{l.license.totalMonths}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {l.license.queuedMonths > 0 && (
                          <button
                            onClick={() => setUnassigning(l)}
                            className="text-xs font-semibold text-error hover:underline cursor-pointer mr-3"
                          >
                            Unassign
                          </button>
                        )}
                        <Button
                          variant={live ? "secondary" : "primary"}
                          onClick={() => setAssigning(l)}
                          disabled={!l.active}
                          className="!px-3 !py-1.5 !text-xs"
                        >
                          {live ? "Extend" : l.license.status === "none" ? "Assign" : "Renew"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "requests" && (
        <div className="flex flex-col gap-3">
          <PlanLockNote feature="license_requests" />
          <LicenseRequestsTab requests={requests} onChanged={load} />
        </div>
      )}

      {tab === "budgets" && (
        <div className="flex flex-col gap-5">
          <PlanLockNote feature="manager_pools" />
          <p className="text-sm text-muted">
            Allotted licenses are set aside from your pool: <span className="text-ink font-medium">{s.unreserved}</span> unreserved ·{" "}
            {s.reservedForBatches} set aside for batches · {s.reservedForManagers} for Managers. A batch's fixed licenses are used first for its
            learners; otherwise a Manager uses their own pool, and you use the unreserved licenses.
          </p>

          {(
            [
              {
                heading: "Manager pools",
                hint: "Usable by the Manager in any batch they manage, including ones they create.",
                firstCol: "Manager",
                rows: data.managers.map((m) => ({
                  key: m.managerId,
                  title: m.name,
                  subtitle: m.email,
                  allotment: m.allotment,
                  used: m.used,
                  save: (v: number | null) => setManagerPoolAllotment(m.managerId, v).then(load),
                })),
                empty: "No Managers yet.",
              },
              {
                heading: "Fixed batch licenses",
                hint: "Reserved for one batch's learners, whoever assigns them.",
                firstCol: "Batch",
                rows: data.batches.map((b) => ({
                  key: b.batchId,
                  title: b.batchName,
                  subtitle: b.batchCode,
                  allotment: b.budget,
                  used: b.used,
                  save: (v: number | null) => setBatchBudget(b.batchId, v).then(load),
                })),
                empty: "No batches yet.",
              },
            ] as const
          ).map((section) => (
            <div key={section.heading} className="flex flex-col gap-2">
              <div>
                <p className="font-display font-bold text-ink">{section.heading}</p>
                <p className="text-xs text-muted">{section.hint}</p>
              </div>
              <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">{section.firstCol}</th>
                      <th className="px-4 py-3">Allotted</th>
                      <th className="px-4 py-3">Assigned</th>
                      <th className="px-4 py-3">Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-muted">
                          {section.empty}
                        </td>
                      </tr>
                    )}
                    {section.rows.map((r) => (
                      <AllotmentRow key={r.key} title={r.title} subtitle={r.subtitle} allotment={r.allotment} used={r.used} onSave={r.save} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "purchases" && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Licenses</th>
                <th className="px-4 py-3">Assigned / left</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Unassigned expire</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted">
                    No licenses purchased yet.
                  </td>
                </tr>
              )}
              {data.purchases.map((p) => (
                <tr key={p.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 text-ink">{formatShortDate(p.purchasedAt)}</td>
                  <td className="px-4 py-3 text-ink font-medium">{p.quantity}</td>
                  <td className="px-4 py-3 text-muted">
                    {p.used} / {p.poolExpired ? 0 : p.remaining}
                  </td>
                  <td className="px-4 py-3 text-muted">{SOURCE_LABEL[p.source]}</td>
                  <td className="px-4 py-3 text-muted">{p.reference ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{p.source === "comp" ? "—" : formatMoney(p.totalCents, p.currency)}</td>
                  <td className="px-4 py-3">
                    <span className={p.poolExpired ? "text-error" : "text-muted"}>
                      {p.poolExpired ? "Expired " : ""}
                      {formatShortDate(p.poolExpiresAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "invoices" && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Licenses</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No invoices yet — online purchases appear here. Licenses added by Edstellar directly are invoiced outside the platform.
                  </td>
                </tr>
              )}
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-mono text-ink">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-muted">{formatShortDate(inv.issuedAt)}</td>
                  <td className="px-4 py-3 text-muted">{inv.quantity}</td>
                  <td className="px-4 py-3 text-ink">{formatAmount(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/invoice/${inv.id}`} target="_blank" className="text-xs font-semibold text-navy hover:underline">
                      View / print
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBuy && <BuyLicensesModal onClose={() => setShowBuy(false)} />}

      {tab === "activity" && (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
          {data.events.length === 0 && <p className="text-sm text-muted">No license activity yet.</p>}
          {data.events.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-4 text-sm">
              <span className="text-ink">{eventSentence(e)}</span>
              <span className="text-xs text-muted shrink-0 text-right">
                {e.actor ?? "System"} · {formatShortDate(e.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {unassigning && (
        <UnassignLicenseModal
          learnerName={[unassigning.firstName, unassigning.lastName].filter(Boolean).join(" ") || unassigning.email}
          license={unassigning.license}
          onUnassign={(months, reason) => orgReclaimLicenses(unassigning.id, months, reason)}
          onClose={() => setUnassigning(null)}
          onDone={() => {
            setUnassigning(null);
            load();
          }}
        />
      )}

      {assigning && (
        <AssignLicenseModal
          learnerName={[assigning.firstName, assigning.lastName].filter(Boolean).join(" ") || assigning.email}
          license={assigning.license}
          poolHint={`Uses the batch's fixed licenses if it has any left, otherwise your unreserved pool (${s.unreserved} available).`}
          onAssign={(months) => orgAssignLicenses(assigning.id, months)}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            load();
          }}
        />
      )}
    </div>
  );
}
