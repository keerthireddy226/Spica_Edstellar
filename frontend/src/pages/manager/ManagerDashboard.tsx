import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getLearnerEngagement } from "@/api/notifications";
import { ROUTES } from "@/constants/routes";
import { Layers, Users, CalendarCheck, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { getManagerOverview, type ManagerOverview } from "@/api/manager";
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
import { KeyRound } from "lucide-react";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
      </div>
    </div>
  );
}

// The Manager's day at a glance: their learners, licenses and requests.
// Batches have their own page.
export function ManagerDashboard() {
  const [attention, setAttention] = useState<{ ending: number; grace: number; inactive: number; notStarted: number } | null>(null);
  const [overview, setOverview] = useState<ManagerOverview | null>(null);
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
    loadAttention();
    loadRequests();
    getManagerOverview()
      .then(setOverview)
      .catch(() => setError("Could not load your dashboard."));
    getManagerLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setMyPool(res.myPool);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Dashboard</h1>
          <p className="text-sm text-muted mt-1">Your learners and licenses, across the batches you manage.</p>
        </div>
        <Link to={ROUTES.MANAGER_BATCHES} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
          Go to your batches <ArrowRight size={15} />
        </Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Active batches" value={overview.activeBatches} icon={Layers} index={0} />
        <StatCard label="Learners" value={overview.totalLearners} icon={Users} index={1} />
        <StatCard label="Sessions completed today" value={overview.sessionsCompletedToday} icon={CalendarCheck} index={2} />
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex items-center gap-5 flex-wrap">
        <span className="h-11 w-11 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
          <KeyRound size={22} strokeWidth={1.8} />
        </span>
        <div className="flex-1 min-w-48">
          <p className="font-display font-bold text-ink">Your license pool</p>
          <p className="text-xs text-muted">
            {myPool?.allotment != null
              ? "Use these in any batch you manage. Batches with fixed licenses use those first."
              : "None allotted yet — request licenses from your Org Admin."}
          </p>
        </div>
        {myPool?.allotment != null && (
          <div className="flex items-center gap-6">
            {(
              [
                ["Allotted", myPool.allotment],
                ["Assigned", myPool.used],
                ["Left", myPool.remaining ?? 0],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="text-center">
                <p className="font-display font-bold text-xl text-ink">{value}</p>
                <p className="text-[11px] text-muted">{label}</p>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setRequestingFor("")} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
          Request change
        </button>
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-display font-bold text-ink">Learner licenses</h2>
          <Link to={ROUTES.MANAGER_LEARNERS} className="text-xs font-semibold text-navy hover:underline">
            Assign or extend licenses in Learners
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              ["Licensed now", overview.licenses.licensed, "text-success"],
              ["Ending in 14 days", overview.licenses.endingSoon, "text-warning"],
              ["In grace period", overview.licenses.grace, "text-error"],
              ["Without a license", overview.licenses.unlicensed, "text-error"],
            ] as const
          ).map(([label, n, tone]) => (
            <div key={label} className="border border-rule rounded-input px-4 py-3">
              <p className={`font-display font-bold text-2xl ${n ? tone : "text-ink"}`}>{n}</p>
              <p className="text-xs text-muted">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          {overview.licenses.fromFixed} license-month{overview.licenses.fromFixed === 1 ? "" : "s"} came from batches' fixed licenses and{" "}
          {overview.licenses.fromPool} from your pool.
          {budgets.some((b) => b.budget != null) &&
            ` Fixed licenses left: ${budgets
              .filter((b) => b.budget != null)
              .map((b) => `${b.batchName} ${b.remaining}`)
              .join(", ")}.`}
        </p>
      </div>

      {myPool?.allotment != null && (myPool.remaining ?? 0) <= 2 && (
        <p className={`text-sm rounded-card px-4 py-3 border ${(myPool.remaining ?? 0) === 0 ? "bg-error/10 border-error/25 text-error" : "bg-warning/15 border-warning/30 text-navy-deep"}`}>
          {(myPool.remaining ?? 0) === 0 ? "Your license pool is empty." : `Only ${myPool.remaining} license${myPool.remaining === 1 ? "" : "s"} left in your pool.`}{" "}
          <button onClick={() => setRequestingFor("")} className="font-semibold underline cursor-pointer">
            Request more
          </button>
        </p>
      )}

      {attention && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(
            [
              ["Access ending in 7 days", attention.ending, "text-warning"],
              ["In grace period", attention.grace, "text-error"],
              ["Stopped practising", attention.inactive, "text-error"],
              ["Haven't started", attention.notStarted, "text-muted"],
            ] as const
          ).map(([label, n, tone]) => (
            <Link key={label} to={ROUTES.MANAGER_LEARNERS} className="bg-surface border border-rule rounded-card px-4 py-3 hover:border-rule-strong transition-colors">
              <p className={`font-display font-bold text-2xl ${n ? tone : "text-ink"}`}>{n}</p>
              <p className="text-xs text-muted">{label}</p>
            </Link>
          ))}
        </div>
      )}

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}

      {requests.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
          <h2 className="font-display font-bold text-ink">Your license requests</h2>
          {requests.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 text-sm border-b border-rule last:border-0 pb-2 last:pb-0">
              <div className="min-w-0">
                <p className="text-ink">{describeLicenseRequest(r)}</p>
                <p className="text-xs text-muted">
                  {formatShortDate(r.createdAt)} · “{r.reason}”
                  {r.decisionNote ? ` · Org Admin: ${r.decisionNote}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill capitalize ${REQUEST_STATUS_CLASS[r.status]}`}>{r.status}</span>
                {r.status === "pending" && (
                  <button
                    onClick={() => cancelLicenseRequest(r.id).then(loadRequests)}
                    className="text-xs text-muted hover:text-error cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {requestingFor !== null && (
        <RequestLicenseChangeModal
          myPool={myPool}
          batches={budgets}
          initialBatchId={requestingFor}
          onClose={() => setRequestingFor(null)}
          onSent={() => {
            setRequestingFor(null);
            setNotice("Request sent to your Org Admin.");
            loadRequests();
          }}
        />
      )}
    </div>
  );
}
