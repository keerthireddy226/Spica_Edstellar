import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { getQueueStats, retryQueueJob, type QueueStats } from "@/api/admin";

import { tr } from "@/i18n/tr";
// Health of the background job queue (emails, alerts, rollups, reports).
export function JobQueuePanel() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const load = () => getQueueStats().then(setStats).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!stats) return null;

  const queues = [...new Set(stats.counts.map((c) => c.queue))];
  const n = (queue: string, status: string) => stats.counts.find((c) => c.queue === queue && c.status === status)?.n ?? 0;

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-lg text-ink">{tr("Background jobs")}</h2>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${stats.readyBacklog > 50 ? "bg-warning/15 text-navy-deep" : "bg-success/15 text-success"}`}>
          {tr("{{readyBacklog}} waiting", { readyBacklog: stats.readyBacklog })}</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1">{tr("Queue")}</th>
            <th className="py-1 text-right">{tr("Queued")}</th>
            <th className="py-1 text-right">{tr("Done (7d)")}</th>
            <th className="py-1 text-right">{tr("Failed")}</th>
          </tr>
        </thead>
        <tbody>
          {queues.map((q) => (
            <tr key={q} className="border-t border-rule">
              <td className="py-1.5 text-ink">{q}</td>
              <td className="py-1.5 text-right text-muted">{n(q, "queued") + n(q, "running")}</td>
              <td className="py-1.5 text-right text-muted">{n(q, "done")}</td>
              <td className={`py-1.5 text-right ${n(q, "failed") ? "text-error font-semibold" : "text-muted"}`}>{n(q, "failed")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stats.recentFailures.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Recent failures")}</p>
          {stats.recentFailures.slice(0, 5).map((f) => (
            <div key={f.id} className="flex items-start justify-between gap-3 text-xs">
              <span className="text-ink min-w-0 truncate" title={f.last_error ?? ""}>
                {f.queue} · {f.last_error}
              </span>
              <button onClick={() => retryQueueJob(f.id).then(load)} className="flex items-center gap-1 text-navy font-semibold hover:underline cursor-pointer shrink-0">
                <RotateCcw size={12} /> {tr("Retry")}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
