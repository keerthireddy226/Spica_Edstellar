import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { getManagerActivity } from "@/api/manager";
import type { AuditEntry } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
const VERBS: Record<string, string> = {
  "batch.created": tr("created batch"),
  "batch.updated": tr("edited batch"),
  "batch.completed": tr("completed batch"),
  "batch.cloned": tr("started a new batch from"),
  "batch.archived": tr("archived batch"),
  "batch.reopened": tr("reopened batch"),
  "learner.invited": "invited",
  "learner.bulk_invited": tr("invited learners in bulk"),
  "learner.deactivated": "deactivated",
  "learner.reactivated": "reactivated",
  "learner.moved": "moved",
  "learner.details_updated": tr("updated the employee details of"),
  "learner.deleted": "deleted",
  "learner.erased": tr("erased the data of"),
  "learner.invite_resent": tr("resent the invite to"),
  "certificate.issued": tr("issued a certificate"),
  "certificate.revoked": tr("revoked a certificate"),
  "license.assign": tr("assigned licenses to"),
  "license.extend": tr("extended licenses for"),
  "license.reclaim": tr("returned unused months from"),
  "license.budget": tr("set fixed licenses for"),
  "license.manager_allotment": tr("changed the license pool of"),
  "license.request": tr("decided a license request for"),
};

// Everything that happened to this Manager's batches and learners, and what
// they did themselves — whoever did it.
export function ManagerActivity() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load(more = false) {
    setLoading(true);
    getManagerActivity(more ? entries[entries.length - 1]?.createdAt : undefined)
      .then((r) => {
        setEntries((p) => (more ? [...p, ...r.entries] : r.entries));
        setHasMore(r.hasMore);
      })
      .catch(() => setError(tr("Could not load activity.")))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Activity")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Changes to your batches and learners, by you, your Org Admin, or anyone else.")}</p>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
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
                  {tr("Nothing yet.")}</td>
              </tr>
            )}
            {entries.map((e) => {
              const d = e.details as { quantity?: number; note?: string };
              return (
                <tr key={`${e.source}-${e.id}`} className="border-b border-rule last:border-0 align-top">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{e.actorLabel ?? tr("System")}</p>
                    {e.actorRole && <p className="text-xs text-muted">{e.actorRole.replace("_", " ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {VERBS[e.action] ?? e.action.replace(/[._]/g, " ")} {e.targetLabel}
                    {typeof d.quantity === "number" ? ` (${d.quantity})` : ""}
                    {d.note ? <span className="text-muted"> — {trServer(d.note)}</span> : null}
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
