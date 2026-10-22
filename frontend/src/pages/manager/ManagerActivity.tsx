import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/Button";
import { getManagerActivity } from "@/api/manager";
import type { AuditEntry } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";

// Functions, so each line is translated in the language chosen now, not the
// one loaded when this file was first imported.
const VERBS: Record<string, () => string> = {
  "batch.created": () => tr("created batch"),
  "batch.updated": () => tr("edited batch"),
  "batch.completed": () => tr("completed batch"),
  "batch.cloned": () => tr("started a new batch from"),
  "batch.archived": () => tr("archived batch"),
  "batch.reopened": () => tr("reopened batch"),
  "learner.invited": () => tr("invited"),
  "learner.bulk_invited": () => tr("invited learners in bulk"),
  "learner.deactivated": () => tr("deactivated"),
  "learner.reactivated": () => tr("reactivated"),
  "learner.moved": () => tr("moved"),
  "learner.details_updated": () => tr("updated the employee details of"),
  "learner.deleted": () => tr("deleted"),
  "learner.erased": () => tr("erased the data of"),
  "learner.invite_resent": () => tr("resent the invite to"),
  "certificate.issued": () => tr("issued a certificate"),
  "certificate.revoked": () => tr("revoked a certificate"),
  "license.assign": () => tr("assigned licenses to"),
  "license.extend": () => tr("extended licenses for"),
  "license.reclaim": () => tr("returned unused months from"),
  "license.budget": () => tr("set fixed licenses for"),
  "license.manager_allotment": () => tr("changed the license pool of"),
  "license.request": () => tr("decided a license request for"),
};

const ROLE_TEXT: Record<string, () => string> = {
  org_admin: () => tr("Org Admin"),
  manager: () => tr("Manager"),
  admin: () => tr("Admin"),
  super_admin: () => tr("Super Admin"),
  learner: () => tr("Learner"),
  recruiter: () => tr("Recruiter"),
};

function initials(label: string | null): string {
  if (!label) return "·";
  const parts = label.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || label.slice(0, 2).toUpperCase();
}

// Everything that happened to this Manager's batches and learners, and what
// they did themselves — whoever did it.
export function ManagerActivity() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(more = false) {
    setLoading(true);
    setError(null);
    getManagerActivity(more ? entries[entries.length - 1]?.createdAt : undefined)
      .then((r) => {
        setEntries((p) => (more ? [...p, ...r.entries] : r.entries));
        setHasMore(r.hasMore);
        setLoaded(true);
      })
      .catch(() => setError(tr("Could not load activity.")))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Activity")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Changes to your batches and learners, by you, your Org Admin, or anyone else.")}</p>
      </div>
      {error && (
        <div className="bg-error/10 border border-error/25 rounded-card px-4 py-3 text-sm text-error flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => load(entries.length > 0)} className="font-semibold underline cursor-pointer">
            {tr("Try again")}
          </button>
        </div>
      )}
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-rule bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3 w-48">{tr("When")}</th>
              <th className="px-5 py-3 w-56">{tr("Who")}</th>
              <th className="px-5 py-3">{tr("What")}</th>
            </tr>
          </thead>
          <tbody>
            {!loaded && loading &&
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-b border-rule last:border-0">
                  <td colSpan={3} className="px-5 py-3.5">
                    <div className="h-4 rounded bg-paper-warm animate-pulse" style={{ width: `${70 - i * 8}%` }} />
                  </td>
                </tr>
              ))}
            {loaded && entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 py-10 text-center text-muted">
                  <History size={22} className="mx-auto mb-2 text-muted/70" />
                  {tr("Nothing yet.")}
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const d = e.details as { quantity?: number; note?: string };
              const when = new Date(e.createdAt);
              return (
                <tr key={`${e.source}-${e.id}`} className="border-b border-rule last:border-0 align-top hover:bg-paper-warm/40 transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap">
                    <p className="text-ink">{when.toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
                    <p className="text-xs text-muted">{when.toLocaleTimeString(undefined, { timeStyle: "short" })}</p>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="h-8 w-8 rounded-full bg-navy/10 text-navy-deep flex items-center justify-center text-[11px] font-bold shrink-0">{initials(e.actorLabel)}</span>
                      <div className="min-w-0">
                        <p className="text-ink truncate">{e.actorLabel ?? tr("System")}</p>
                        {e.actorRole && <p className="text-xs text-muted">{ROLE_TEXT[e.actorRole]?.() ?? e.actorRole.replace(/_/g, " ")}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink">
                    {VERBS[e.action]?.() ?? e.action.replace(/[._]/g, " ")} <span className="font-medium">{e.targetLabel}</span>
                    {typeof d.quantity === "number" ? <span className="text-muted"> ({d.quantity})</span> : null}
                    {d.note ? <span className="block text-xs text-muted mt-0.5">{trServer(d.note)}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <Button variant="secondary" onClick={() => load(true)} disabled={loading} className="self-center">
          {loading ? tr("Loading…") : tr("Load more")}
        </Button>
      )}
    </div>
  );
}
