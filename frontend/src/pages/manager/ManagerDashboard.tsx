import { useEffect, useState } from "react";
import { PlanLimitHint } from "@/components/plans/usePlan";
import { Layers, Users, CalendarCheck } from "lucide-react";
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
  type LearnerLicenseRow,
  type LicenseRequest,
  type ManagerPool,
} from "@/api/licenses";
import { ManagerCreateBatchModal } from "@/components/ManagerCreateBatchModal";
import { Button } from "@/components/Button";
import { Plus, KeyRound } from "lucide-react";
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

export function ManagerDashboard() {
  const [overview, setOverview] = useState<ManagerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [licensed, setLicensed] = useState<LearnerLicenseRow[]>([]);
  const [requests, setRequests] = useState<LicenseRequest[]>([]);
  const [requestingFor, setRequestingFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [myPool, setMyPool] = useState<ManagerPool | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  function loadRequests() {
    getMyLicenseRequests()
      .then((r) => setRequests(r.requests))
      .catch(() => {});
  }

  function load() {
    loadRequests();
    getManagerOverview()
      .then(setOverview)
      .catch(() => setError("Could not load your batches."));
    getManagerLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setLicensed(res.learners);
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
          <h1 className="font-display font-bold text-2xl text-ink">Your batches</h1>
          <p className="text-sm text-muted mt-1">Only the batch(es) you manage — never the whole organization.</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2 shrink-0">
            <Plus size={18} /> New batch
          </Button>
          <PlanLimitHint limit="batches" />
        </div>
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

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Batches assigned to you" value={overview.batches.length} icon={Layers} index={0} />
        <StatCard label="Learners" value={overview.totalLearners} icon={Users} index={1} />
        <StatCard label="Sessions completed today" value={overview.sessionsCompletedToday} icon={CalendarCheck} index={2} />
      </div>

      {overview.batches.length === 0 ? (
        <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
          No batches yet — create one, or ask your Org Admin to assign you one.
        </p>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Learners</th>
                <th className="px-4 py-3">Licensed</th>
                <th className="px-4 py-3">Licenses</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {overview.batches.map((b) => {
                const budget = budgets.find((x) => x.batchId === b.id);
                const inBatch = licensed.filter((l) => l.batchId === b.id);
                const live = inBatch.filter((l) => l.license.status === "active" || l.license.status === "grace").length;
                return (
                  <tr key={b.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 text-ink font-medium">{b.name}</td>
                    <td className="px-4 py-3 text-muted">{b.learnerCount}</td>
                    <td className="px-4 py-3 text-muted">
                      {live} / {inBatch.length}
                    </td>
                    <td className="px-4 py-3">
                      {!budget || budget.budget === null ? (
                        <span className="text-xs text-muted">From your pool</span>
                      ) : (
                        <div className="flex items-center gap-3 min-w-40">
                          <div className="flex-1 h-1.5 rounded-full bg-rule overflow-hidden">
                            <div
                              className="h-full bg-navy rounded-full"
                              style={{ width: `${budget.budget ? Math.min(100, (budget.used / budget.budget) * 100) : 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted whitespace-nowrap">
                            {budget.remaining} of {budget.budget} left
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {budget?.budget != null && (
                      <button
                        onClick={() => setRequestingFor(b.id)}
                        className="text-xs font-semibold text-navy hover:underline cursor-pointer whitespace-nowrap"
                      >
                        Request change
                      </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

      {showCreate && (
        <ManagerCreateBatchModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setNotice("Batch created. You can invite learners into it from Learners.");
            load();
          }}
        />
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
