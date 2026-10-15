import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { AUDIT_VERBS, auditDetailParts } from "@/lib/auditVerbs";
import { getAdminConsoleOverview } from "@/api/admin";
import { getStaffAudit, type StaffAuditEntry, type StaffAuditFilters } from "@/api/staff";
import { EmptyNote, PageHeader, SelectFilter, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
const GROUPS: [string, string][] = [
  ["", tr("All activity")],
  ["organization.", tr("Organizations")],
  ["staff.", tr("Admins")],
  ["org_admin.", tr("Org Admins")],
  ["manager.", tr("Managers")],
  ["batch.", tr("Batches")],
  ["learner.", tr("Learners")],
  ["test.", tr("Tests started and finished")],
  ["recruitment.", tr("Recruitment")],
  ["integrity.", tr("Test integrity")],
  ["plan.", tr("Plan")],
  ["license.", tr("Licenses")],
  ["certificate.", tr("Certificates")],
  ["sso.", tr("Single sign-on")],
  ["api_key.", tr("API keys")],
  ["data.", tr("Data")],
];

const ROLES: [string, string][] = [
  ["", tr("Anyone")],
  ["super_admin", tr("Super Admin")],
  ["admin", tr("Admin")],
  ["org_admin", tr("Org Admin")],
  ["manager", tr("Manager")],
  ["recruiter", tr("Recruiter")],
  ["learner", tr("Learner")],
  ["candidate", tr("Candidate")],
  ["system", tr("System / API")],
];

function describe(e: StaffAuditEntry) {
  const verb = AUDIT_VERBS[e.action] ?? e.action.replace(/[._]/g, " ");
  const d = (e.details ?? {}) as Record<string, unknown>;
  const parts = auditDetailParts(d);
  if (typeof d.quantity === "number") parts.unshift(String(d.quantity));
  const extra = parts.length ? ` (${parts.join(" · ")})` : "";
  return `${verb} ${e.targetLabel ?? ""}${extra}`.trim();
}

// Who did what, across the organizations this person can see — including
// Edstellar staff's own actions.
export function StaffAudit() {
  const perms = useStaffPermissions();
  const [filters, setFilters] = useState<StaffAuditFilters>({});
  const [entries, setEntries] = useState<StaffAuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [orgs, setOrgs] = useState<[string, string][]>([]);

  useEffect(() => {
    getAdminConsoleOverview()
      .then((o) => setOrgs(o.organizations.map((x) => [x.id, x.name])))
      .catch(() => {});
  }, []);

  function load(more = false) {
    setLoading(true);
    getStaffAudit({ ...filters, before: more ? entries[entries.length - 1]?.createdAt : undefined })
      .then((r) => {
        setEntries((p) => (more ? [...p, ...r.entries] : r.entries));
        setHasMore(r.hasMore);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [filters]);

  const set = (k: keyof StaffAuditFilters) => (v: string) => setFilters((f) => ({ ...f, [k]: v || undefined }));
  const dateClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader
        title={tr("Audit log")}
        subtitle={perms.isSuper ? tr("Every recorded change on Spica, by anyone.") : tr("Changes in your organizations, and everything you did yourself.")}
      />
      <div className="flex items-center gap-3 flex-wrap">
        <SelectFilter label={tr("Activity")} value={filters.action ?? ""} onChange={set("action")} options={GROUPS} />
        <SelectFilter label={tr("Organization")} value={filters.tenantId ?? ""} onChange={set("tenantId")} options={[["", tr("All organizations")], ...orgs]} />
        <SelectFilter label={tr("Who")} value={filters.actorRole ?? ""} onChange={set("actorRole")} options={ROLES} />
        <input type="date" aria-label={tr("From")} value={filters.from ?? ""} onChange={(e) => set("from")(e.target.value)} className={dateClass} />
        <input type="date" aria-label={tr("To")} value={filters.to ?? ""} onChange={(e) => set("to")(e.target.value)} className={dateClass} />
      </div>
      {entries.length === 0 && !loading ? (
        <EmptyNote>{tr("Nothing recorded for these filters.")}</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3 w-44">{tr("When")}</th>
                <th className="px-4 py-3 w-48">{tr("Who")}</th>
                <th className="px-4 py-3">{tr("What")}</th>
                <th className="px-4 py-3 w-44">{tr("Organization")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-rule last:border-0 align-top">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{e.actorLabel ?? tr("System")}</p>
                    {e.actorRole && <p className="text-xs text-muted">{e.actorRole.replace("_", " ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink">{describe(e)}</td>
                  <td className="px-4 py-3 text-muted">{e.orgName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && (
        <Button variant="secondary" onClick={() => load(true)} disabled={loading} className="self-center">
          {loading ? tr("Loading…") : tr("Load more")}
        </Button>
      )}
    </div>
  );
}
