import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download, Printer } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { OverviewView } from "@/components/analytics/OverviewView";
import { BatchView } from "@/components/analytics/BatchView";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { ReportSubscriptionCard } from "@/components/ReportSubscriptionCard";
import { planErrorMessage } from "@/api/plans";
import {
  downloadCsv,
  getAnalyticsBatches,
  getAnalyticsOverview,
  getBatchAnalytics,
  type AnalyticsOverview,
  type BatchAnalytics,
} from "@/api/analytics";

import { tr } from "@/i18n/tr";
// One analytics page for every console; the server decides the scope by role.
export function AnalyticsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const hasBatches = role === "org_admin" || role === "manager";
  // Batch analytics is a Business feature; null while the plan loads.
  const batchAnalyticsAllowed = useHasFeature("batch_analytics");
  const [params, setParams] = useSearchParams();
  const tab = hasBatches && params.get("tab") === "batches" ? "batches" : "overview";

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [batches, setBatches] = useState<{ id: string; name: string; batchCode: string; learners: number }[]>([]);
  const [batchId, setBatchId] = useState<string>(params.get("batch") ?? "");
  const [batch, setBatch] = useState<BatchAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getAnalyticsOverview()
      .then(setOverview)
      .catch(() => setError(tr("Could not load analytics.")));
    if (hasBatches) {
      getAnalyticsBatches()
        .then((r) => {
          setBatches(r.batches);
          setBatchId((cur) => cur || r.batches[0]?.id || "");
        })
        .catch(() => {});
    }
  }, [hasBatches]);

  useEffect(() => {
    if (tab !== "batches" || !batchId || batchAnalyticsAllowed === false) return;
    setBatch(null);
    getBatchAnalytics(batchId)
      .then(setBatch)
      .catch((err) => !planErrorMessage(err) && setError(tr("Could not load batch analytics.")));
  }, [tab, batchId, batchAnalyticsAllowed]);

  function setTab(next: "overview" | "batches") {
    const p = new URLSearchParams(params);
    if (next === "batches") p.set("tab", "batches");
    else p.delete("tab");
    setParams(p, { replace: true });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      if (tab === "batches" && batchId) await downloadCsv(`/analytics/batches/${batchId}/export.csv`, "batch.csv");
      else await downloadCsv("/analytics/learners/export.csv", "learners.csv");
    } catch {
      setError(tr("Export failed."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Analytics")}</h1>
          <p className="text-sm text-muted mt-1">
            {overview?.scope ?? tr("Loading…")} {tr("· generated")}{" "}{new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button variant="secondary" onClick={exportCsv} disabled={exporting || (tab === "batches" && batchAnalyticsAllowed === false)} className="flex items-center gap-2 !px-3.5 !py-2 !text-sm">
            <Download size={15} /> {exporting ? tr("Exporting…") : tab === "batches" ? tr("Export batch CSV") : tr("Export learners CSV")}
          </Button>
          <Button variant="secondary" onClick={() => window.print()} className="flex items-center gap-2 !px-3.5 !py-2 !text-sm">
            <Printer size={15} /> {tr("Print / PDF")}</Button>
        </div>
      </div>

      {hasBatches && (
        <div className="flex items-center gap-1 border-b border-rule print:hidden">
          {(
            [
              ["overview", role === "manager" ? tr("Your batches overview") : tr("Organization overview")],
              ["batches", tr("Batch analytics")],
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
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      {hasBatches && tab === "overview" && <ReportSubscriptionCard />}

      {tab === "overview" && (overview ? <OverviewView data={overview} showCompanies={role === "super_admin" || role === "admin"} /> : !error && <p className="text-sm text-muted">{tr("Loading…")}</p>)}

      {tab === "batches" && batchAnalyticsAllowed === false && <PlanLockNote feature="batch_analytics" />}

      {tab === "batches" && batchAnalyticsAllowed !== false && (
        <div className="flex flex-col gap-4">
          {batches.length === 0 ? (
            <p className="text-sm text-muted">{tr("No batches yet.")}</p>
          ) : (
            <div className="flex items-center gap-3 print:hidden">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Batch")}</label>
              <select
                value={batchId}
                onChange={(e) => {
                  setBatchId(e.target.value);
                  const p = new URLSearchParams(params);
                  p.set("batch", e.target.value);
                  setParams(p, { replace: true });
                }}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} · {b.batchCode} · {b.learners} {tr("learner")}{b.learners === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </div>
          )}
          {batch && (
            <>
              <h2 className="hidden print:block font-display font-bold text-xl text-ink">
                {batch.batch.name} ({batch.batch.batchCode})
              </h2>
              <BatchView data={batch} />
            </>
          )}
          {batchId && !batch && !error && <p className="text-sm text-muted">{tr("Loading…")}</p>}
        </div>
      )}
    </div>
  );
}
