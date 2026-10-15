import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { downloadCsv } from "@/api/analytics";
import { AUDIT_VERBS as VERBS } from "@/lib/auditVerbs";
import { auditExportPath, getAuditLog, type AuditEntry, type AuditFilters } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
const ACTION_GROUPS: [string, string][] = [
  ["", tr("All activity")],
  ["batch.", tr("Batches")],
  ["manager.", tr("Managers")],
  ["learner.", tr("Learners")],
  ["license.", tr("Licenses")],
  ["plan.", tr("Plan")],
  ["organization.", tr("Organization profile and settings")],
  ["org_admin.", tr("Org Admin changes")],
  ["api_key.", tr("API keys")],
  ["webhook.", tr("Webhooks")],
  ["sso.", tr("Single sign-on")],
  ["data.", tr("Data exports")],
];


function describe(e: AuditEntry): string {
  const verb = VERBS[e.action] ?? e.action.replace(/[._]/g, " ");
  const extra: string[] = [];
  const d = e.details as Record<string, unknown>;
  if (typeof d.quantity === "number") extra.push(`${d.quantity}`);
  if (d.fromTier && d.toTier) extra.push(`${d.fromTier} → ${d.toTier}`);
  if (typeof d.note === "string" && d.note) extra.push(trServer(d.note));
  if (d.learners && typeof d.learners === "object" && "count" in (d.learners as object)) extra.push(`${(d.learners as { count: number }).count} rows`);
  return [verb, e.targetLabel, extra.length ? `(${extra.join(" · ")})` : ""].filter(Boolean).join(" ");
}

export function OrgAdminAudit() {
  const allowed = useHasFeature("audit_log");
  const [filters, setFilters] = useState<AuditFilters>({});
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actors, setActors] = useState<{ id: string; name: string; role: string }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(more = false) {
    setLoading(true);
    setError(null);
    const before = more ? entries[entries.length - 1]?.createdAt : undefined;
    getAuditLog({ ...filters, before, limit: 50 })
      .then((r) => {
        setEntries((prev) => (more ? [...prev, ...r.entries] : r.entries));
        setActors(r.actors);
        setHasMore(r.hasMore);
      })
      .catch(() => setError(tr("Could not load the audit log.")))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (allowed) load();
  }, [allowed, filters]);

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Audit log")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Every change made in your organization — who did it and when.")}</p>
        </div>
        {allowed && (
          <Button
            variant="secondary"
            onClick={() => downloadCsv(auditExportPath(filters), "audit-log.csv").catch(() => setError(tr("Export failed.")))}
            className="flex items-center gap-2 !px-3.5 !py-2"
          >
            <Download size={15} /> {tr("Export CSV")}</Button>
        )}
      </div>

      {allowed === false && <PlanLockNote feature="audit_log" />}

      {allowed && (
        <>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">{tr("Activity")}</label>
              <select
                value={filters.action ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value || undefined }))}
                className={`${inputClass} cursor-pointer`}
              >
                {ACTION_GROUPS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">{tr("Person")}</label>
              <select
                value={filters.actorId ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value || undefined }))}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">{tr("Anyone")}</option>
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">{tr("From")}</label>
              <input type="date" value={filters.from ?? ""} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">{tr("To")}</label>
              <input type="date" value={filters.to ?? ""} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))} className={inputClass} />
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 w-44">{tr("When")}</th>
                  <th className="px-4 py-3 w-48">{tr("Who")}</th>
                  <th className="px-4 py-3">{tr("What")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && !loading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted">
                      {tr("Nothing recorded for these filters yet.")}</td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={`${e.source}-${e.id}`} className="border-b border-rule last:border-0 align-top">
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink">{e.actorLabel ?? tr("System")}</p>
                      {e.actorRole && <p className="text-xs text-muted">{e.actorRole.replace("_", " ")}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink">{describe(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <Button variant="secondary" onClick={() => load(true)} disabled={loading} className="self-center">
              {loading ? tr("Loading…") : tr("Load more")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
