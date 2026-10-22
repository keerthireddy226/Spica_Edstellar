import { useEffect, useState } from "react";
import { AlertTriangle, Building2, Layers, Timer } from "lucide-react";
import { JobQueuePanel } from "@/components/JobQueuePanel";
import { AtRiskOrganizations } from "@/components/AtRiskOrganizations";
import { commercialApi, getQueueStats, type QueueStats } from "@/api/admin";
import { PageHeader, StatCard } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
// Super Admin: how the platform itself is running.
export function SystemPage() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [slipping, setSlipping] = useState<number | null>(null);
  useEffect(() => {
    getQueueStats()
      .then(setStats)
      .catch(() => {});
    commercialApi
      .health()
      .then((r) => setSlipping(r.organizations.filter((o) => o.band !== "healthy").length))
      .catch(() => {});
  }, []);
  const count = (status: string) => stats?.counts.filter((c) => c.status === status).reduce((n, c) => n + c.n, 0) ?? 0;
  const queues = stats ? new Set(stats.counts.map((c) => c.queue)).size : 0;

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("System")} subtitle={tr("Background jobs (emails, reminders, reports, webhooks) and organizations whose health is slipping.")} />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          variant="outline"
          palette="sage"
          index={3}
          icon={AlertTriangle}
          value={stats ? count("failed") : "—"}
          label={tr("Failed jobs")}
          sub={stats?.recentFailures.length ? tr("Retry them below") : tr("Nothing to retry")}
        />
        <StatCard variant="outline" palette="sage" index={1} icon={Timer} value={stats ? stats.readyBacklog : "—"} label={tr("Waiting to run")} sub={stats ? tr("{{n}} queued or running", { n: count("queued") + count("running") }) : undefined} />
        <StatCard variant="outline" palette="sage" index={0} icon={Layers} value={stats ? queues : "—"} label={tr("Job queues")} sub={stats ? tr("{{n}} jobs done in 7 days", { n: count("done") }) : undefined} />
        <StatCard variant="outline" palette="sage" index={2} icon={Building2} value={slipping ?? "—"} label={tr("Organizations needing attention")} sub={tr("Watch or at risk")} />
      </div>
      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-3 min-w-0">
          <JobQueuePanel />
        </div>
        <div className="lg:col-span-2 min-w-0 lg:sticky lg:top-4">
          <AtRiskOrganizations />
        </div>
      </div>
    </div>
  );
}
