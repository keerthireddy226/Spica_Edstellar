import { useEffect, useState } from "react";
import { Layers, Users, CalendarCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { getManagerOverview, type ManagerOverview } from "@/api/manager";

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

  useEffect(() => {
    getManagerOverview()
      .then(setOverview)
      .catch(() => setError("Could not load your batches."));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Your batches</h1>
        <p className="text-sm text-muted mt-1">Only the batch(es) assigned to you — never the whole organization.</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Batches assigned to you" value={overview.batches.length} icon={Layers} index={0} />
        <StatCard label="Learners" value={overview.totalLearners} icon={Users} index={1} />
        <StatCard label="Sessions completed today" value={overview.sessionsCompletedToday} icon={CalendarCheck} index={2} />
      </div>

      {overview.batches.length === 0 ? (
        <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
          No batches assigned to you yet — ask your Org Admin to assign one.
        </p>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Learners</th>
              </tr>
            </thead>
            <tbody>
              {overview.batches.map((b) => (
                <tr key={b.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 text-ink font-medium">{b.name}</td>
                  <td className="px-4 py-3 text-muted">{b.learnerCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
