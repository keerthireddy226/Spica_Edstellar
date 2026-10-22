import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { getLearnerEngagement } from "@/api/notifications";
import { ROUTES } from "@/constants/routes";
import { AlertTriangle, ArrowRight, Award, CalendarCheck, Clock, KeyRound, Layers, UserMinus, UserX, Users, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { getManagerBatches, getManagerOverview, type ManagerBatch, type ManagerOverview } from "@/api/manager";
import {
  getManagerLicenseOverview,
  getMyLicenseRequests,
  cancelLicenseRequest,
  describeLicenseRequest,
  formatShortDate,
  REQUEST_STATUS_CLASS,
  type BatchBudget,
  type LicenseRequest,
  type ManagerPool,
} from "@/api/licenses";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";

import { tr } from "@/i18n/tr";

const REQUEST_STATUS_TEXT: Record<LicenseRequest["status"], () => string> = {
  pending: () => tr("Pending"),
  approved: () => tr("Approved"),
  rejected: () => tr("Rejected"),
  cancelled: () => tr("Cancelled"),
};

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-4 sm:p-5 flex items-center gap-3 sm:gap-4 min-w-0">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/85 leading-snug">{label}</p>
      </div>
    </div>
  );
}

// A white card with a title row, used for every section below the stat tiles.
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const linkCls = "inline-flex items-center gap-1 text-xs font-semibold text-navy-deep hover:underline";

// The Manager's day at a glance: their learners, licenses and requests.
// Batches have their own page.
export function ManagerDashboard() {
  const [attention, setAttention] = useState<{ ending: number; grace: number; inactive: number; notStarted: number } | null>(null);
  const [overview, setOverview] = useState<ManagerOverview | null>(null);
  const [batches, setBatches] = useState<ManagerBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [requestingFor, setRequestingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [myPool, setMyPool] = useState<ManagerPool | undefined>(undefined);

  function loadRequests() {
    getMyLicenseRequests()
      .then((r) => setRequests(r.requests))
      .catch(() => {});
  }

  function loadAttention() {
    getLearnerEngagement()
      .then((r) => {
        const now = Date.now();
        setAttention({
          ending: r.learners.filter((l) => l.license.status === "active" && l.license.accessEndsAt && new Date(l.license.accessEndsAt).getTime() - now <= 7 * 86400000).length,
          grace: r.learners.filter((l) => l.license.status === "grace").length,
          inactive: r.learners.filter((l) => l.status === "inactive").length,
          notStarted: r.learners.filter((l) => l.status === "not_started").length,
        });
      })
      .catch(() => {});
  }

  function load() {
    setError(null);
    loadAttention();
    loadRequests();
    getManagerOverview()
      .then(setOverview)
      .catch(() => setError(tr("Could not load your dashboard.")));
    getManagerBatches()
      .then((r) => setBatches(r.batches.filter((b) => b.status === "active")))
      .catch(() => setBatches([]));
    getManagerLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setMyPool(res.myPool);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  const header = (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Dashboard")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Your learners and licenses, across the batches you manage.")}</p>
      </div>
      <Link
        to={ROUTES.MANAGER_BATCHES}
        className="inline-flex items-center gap-1.5 rounded-pill border border-rule bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-rule-strong transition-colors"
      >
        {tr("Go to your batches")} <ArrowRight size={15} />
      </Link>
    </div>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6 w-full">
        {header}
        <div className="bg-error/10 border border-error/25 rounded-card px-4 py-3 text-sm text-error flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={load} className="font-semibold underline cursor-pointer">
            {tr("Try again")}
          </button>
        </div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="flex flex-col gap-6 w-full" aria-busy="true">
        {header}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[88px] rounded-card bg-paper-warm border border-rule animate-pulse" />
          ))}
        </div>
        <div className="h-24 rounded-card bg-paper-warm border border-rule animate-pulse" />
        <p className="sr-only">{tr("Loading…")}</p>
      </div>
    );
  }

  const poolLow = myPool?.allotment != null && (myPool.remaining ?? 0) <= 2;

  return (
    <div className="flex flex-col gap-6 w-full">
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label={tr("Active batches")} value={overview.activeBatches} icon={Layers} index={0} />
        <StatCard label={tr("Learners")} value={overview.totalLearners} icon={Users} index={1} />
        <StatCard label={tr("Certified")} value={overview.certifiedLearners ?? 0} icon={Award} index={2} />
        <StatCard label={tr("Sessions completed today")} value={overview.sessionsCompletedToday} icon={CalendarCheck} index={3} />
      </div>

      {notice && (
        <div className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} title={tr("Dismiss")} className="text-success/80 hover:text-success cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex items-center gap-5 flex-wrap">
        <span className="h-11 w-11 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
          <KeyRound size={22} strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-48">
          <p className="font-display font-bold text-ink">{tr("Your license pool")}</p>
          <p className="text-xs text-muted mt-0.5">
            {myPool?.allotment != null
              ? tr("Use these in any batch you manage. Batches with fixed licenses use those first.")
              : tr("None allotted yet — request licenses from your Org Admin.")}
          </p>
        </div>
        {myPool?.allotment != null && (
          <div className="flex items-center divide-x divide-rule">
            {(
              [
                [tr("Allotted"), myPool.allotment, "text-ink"],
                [tr("Assigned"), myPool.used, "text-ink"],
                [tr("Left"), myPool.remaining ?? 0, poolLow ? ((myPool.remaining ?? 0) === 0 ? "text-error" : "text-warning") : "text-success"],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="text-center px-5 first:pl-0">
                <p className={`font-display font-bold text-xl ${tone}`}>{value}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setRequestingFor("")}
          className="rounded-pill border border-rule px-4 py-2 text-xs font-semibold text-ink hover:border-rule-strong hover:bg-paper-warm transition-colors cursor-pointer"
        >
          {tr("Request change")}
        </button>
      </div>

      {poolLow && (
        <p className={`text-sm rounded-card px-4 py-3 border flex items-center gap-2 ${(myPool!.remaining ?? 0) === 0 ? "bg-error/10 border-error/25 text-error" : "bg-warning/15 border-warning/30 text-navy-deep"}`}>
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            {(myPool!.remaining ?? 0) === 0 ? tr("Your license pool is empty.") : myPool!.remaining === 1 ? tr("Only 1 license left in your pool.") : tr("Only {{n}} licenses left in your pool.", { n: myPool!.remaining })}{" "}
            <button onClick={() => setRequestingFor("")} className="font-semibold underline cursor-pointer">
              {tr("Request more")}
            </button>
          </span>
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Section
          title={tr("Learner licenses")}
          action={
            <Link to={ROUTES.MANAGER_LEARNERS} className={linkCls}>
              {tr("Assign or extend licenses in Learners")} <ArrowRight size={13} />
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                [tr("Licensed now"), overview.licenses.licensed, "text-success"],
                [tr("Ending in 14 days"), overview.licenses.endingSoon, "text-warning"],
                [tr("In grace period"), overview.licenses.grace, "text-error"],
                [tr("Without a license"), overview.licenses.unlicensed, "text-error"],
              ] as const
            ).map(([label, n, tone]) => (
              <div key={label} className="bg-paper-warm/60 border border-rule rounded-input px-4 py-3">
                <p className={`font-display font-bold text-2xl ${n ? tone : "text-ink"}`}>{n}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted leading-relaxed">
            {overview.licenses.fromFixed === 1
              ? tr("1 license-month came from batches' fixed licenses and {{fromPool}} from your pool.", { fromPool: overview.licenses.fromPool })
              : tr("{{n}} license-months came from batches' fixed licenses and {{fromPool}} from your pool.", { n: overview.licenses.fromFixed, fromPool: overview.licenses.fromPool })}
            {budgets.some((b) => b.budget != null) &&
              tr(" Fixed licenses left: {{join}}.", {
                join: budgets
                  .filter((b) => b.budget != null)
                  .map((b) => `${b.batchName} ${b.remaining}`)
                  .join(", "),
              })}
          </p>
        </Section>

        <Section
          title={tr("Needs attention")}
          action={
            <Link to={`${ROUTES.MANAGER_LEARNERS}?view=follow-up`} className={linkCls}>
              {tr("Follow up with learners")} <ArrowRight size={13} />
            </Link>
          }
        >
          {attention ? (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  [tr("Access ending in 7 days"), attention.ending, "text-warning", Clock, ROUTES.MANAGER_LEARNERS],
                  [tr("In grace period"), attention.grace, "text-error", AlertTriangle, ROUTES.MANAGER_LEARNERS],
                  [tr("Stopped practising"), attention.inactive, "text-error", UserMinus, `${ROUTES.MANAGER_LEARNERS}?view=follow-up`],
                  [tr("Haven't started"), attention.notStarted, "text-warning", UserX, `${ROUTES.MANAGER_LEARNERS}?view=follow-up`],
                ] as const
              ).map(([label, n, tone, Icon, to]) => (
                <Link
                  key={label}
                  to={to}
                  className="group bg-paper-warm/60 border border-rule rounded-input px-4 py-3 flex items-start justify-between gap-2 hover:border-rule-strong hover:bg-paper-warm transition-colors"
                >
                  <span className="min-w-0">
                    <span className={`block font-display font-bold text-2xl ${n ? tone : "text-ink"}`}>{n}</span>
                    <span className="block text-xs text-muted">{label}</span>
                  </span>
                  <Icon size={16} className={`shrink-0 mt-1 ${n ? tone : "text-muted"} opacity-80`} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[72px] rounded-input bg-paper-warm border border-rule animate-pulse" />
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section
        title={tr("Your batches")}
        action={
          <Link to={ROUTES.MANAGER_BATCHES} className={linkCls}>
            {tr("Go to your batches")} <ArrowRight size={13} />
          </Link>
        }
      >
        {batches === null ? (
          <div className="h-16 rounded-input bg-paper-warm border border-rule animate-pulse" />
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
            {tr("No batches yet — create one, or ask your Org Admin to assign you one.")}
          </p>
        ) : (
          <ul className="divide-y divide-rule -my-1">
            {batches.map((b) => {
              const L = b.licenses;
              const pct = L.learners ? Math.round((L.licensed / L.learners) * 100) : 0;
              return (
                <li key={b.id}>
                  <Link to={`${ROUTES.MANAGER_BATCHES}?batch=${b.id}`} className="py-3 flex items-center gap-4 flex-wrap sm:flex-nowrap group">
                    <span className="h-9 w-9 rounded-xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
                      <Layers size={17} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink truncate group-hover:underline">{b.name}</span>
                      <span className="block text-xs text-muted truncate">
                        {[b.batchCode, b.startCefr || b.targetCefr ? `${b.startCefr ?? "?"} → ${b.targetCefr ?? "?"}` : null, b.endDate ? tr("Ends {{date}}", { date: formatShortDate(b.endDate) }) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="text-xs text-muted w-24 shrink-0">{L.learners === 1 ? tr("1 learner") : tr("{{n}} learners", { n: L.learners })}</span>
                    <span className="w-40 shrink-0">
                      <span className="flex justify-between text-[11px] text-muted mb-1">
                        <span>{tr("Licensed now")}</span>
                        <span className="font-semibold text-ink">
                          {L.licensed}/{L.learners}
                        </span>
                      </span>
                      <span className="block h-1.5 rounded-pill bg-rule overflow-hidden">
                        <span className={`block h-full rounded-pill ${pct === 100 ? "bg-success" : "bg-navy"}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="w-28 shrink-0 text-right">
                      {L.endingSoon > 0 ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-warning/15 text-navy-deep whitespace-nowrap">
                          {L.endingSoon} · {tr("Ending soon")}
                        </span>
                      ) : L.unlicensed > 0 ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-error/15 text-error whitespace-nowrap">
                          {L.unlicensed} · {tr("Without a license")}
                        </span>
                      ) : null}
                    </span>
                    <ArrowRight size={15} className="text-muted shrink-0 hidden sm:block" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {requests.length > 0 && (
        <Section title={tr("Your license requests")}>
          <ul className="divide-y divide-rule -my-1">
            {requests.map((r) => (
              <li key={r.id} className="py-3 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="text-ink font-medium">{describeLicenseRequest(r)}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {formatShortDate(r.createdAt)} · “{r.reason}”
                    {r.decisionNote ? tr(" · Org Admin: {{decisionNote}}", { decisionNote: r.decisionNote }) : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${REQUEST_STATUS_CLASS[r.status]}`}>{REQUEST_STATUS_TEXT[r.status]()}</span>
                  {r.status === "pending" && (
                    <button onClick={() => cancelLicenseRequest(r.id).then(loadRequests)} className="text-xs font-semibold text-muted hover:text-error cursor-pointer">
                      {tr("Cancel")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {requestingFor !== null && (
        <RequestLicenseChangeModal
          myPool={myPool}
          batches={budgets}
          initialBatchId={requestingFor}
          onClose={() => setRequestingFor(null)}
          onSent={() => {
            setRequestingFor(null);
            setNotice(tr("Request sent to your Org Admin."));
            loadRequests();
          }}
        />
      )}
    </div>
  );
}
