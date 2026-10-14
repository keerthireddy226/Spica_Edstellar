import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { getManagerActivity } from "@/api/manager";
import type { AuditEntry } from "@/api/orgAdmin";

const VERBS: Record<string, string> = {
  "batch.created": "created batch",
  "batch.updated": "edited batch",
  "batch.completed": "completed batch",
  "batch.cloned": "started a new batch from",
  "batch.archived": "archived batch",
  "batch.reopened": "reopened batch",
  "learner.invited": "invited",
  "learner.bulk_invited": "invited learners in bulk",
  "learner.deactivated": "deactivated",
  "learner.reactivated": "reactivated",
  "learner.moved": "moved",
  "learner.deleted": "deleted",
  "learner.erased": "erased the data of",
  "learner.invite_resent": "resent the invite to",
  "certificate.issued": "issued a certificate",
  "certificate.revoked": "revoked a certificate",
  "license.assign": "assigned licenses to",
  "license.extend": "extended licenses for",
  "license.reclaim": "returned unused months from",
  "license.budget": "set fixed licenses for",
  "license.manager_allotment": "changed the license pool of",
  "license.request": "decided a license request for",
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
      .catch(() => setError("Could not load activity."))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Activity</h1>
        <p className="text-sm text-muted mt-1">Changes to your batches and learners, by you, your Org Admin, or anyone else.</p>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3 w-44">When</th>
              <th className="px-4 py-3 w-48">Who</th>
              <th className="px-4 py-3">What</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted">
                  Nothing yet.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const d = e.details as { quantity?: number; note?: string };
              return (
                <tr key={`${e.source}-${e.id}`} className="border-b border-rule last:border-0 align-top">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{e.actorLabel ?? "System"}</p>
                    {e.actorRole && <p className="text-xs text-muted">{e.actorRole.replace("_", " ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {VERBS[e.action] ?? e.action.replace(/[._]/g, " ")} {e.targetLabel}
                    {typeof d.quantity === "number" ? ` (${d.quantity})` : ""}
                    {d.note ? <span className="text-muted"> — {d.note}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <Button variant="secondary" onClick={() => load(true)} disabled={loading} className="self-center">
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
