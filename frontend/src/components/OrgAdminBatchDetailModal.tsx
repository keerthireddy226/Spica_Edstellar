import { useEffect, useState } from "react";
import { DetailModal } from "@/components/DetailModal";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { getBatchDetail, getOrgLearnerDetail, type OrgBatchDetail, type OrgBatchLearner } from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Reachable by clicking any batch card on the Org Admin's Batches page —
// shows the batch's own details plus every learner in it, each opening the
// same LearnerProfileModal used everywhere else in the console.
export function OrgAdminBatchDetailModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const [batch, setBatch] = useState<OrgBatchDetail | null>(null);
  const [learners, setLearners] = useState<OrgBatchLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);

  useEffect(() => {
    getBatchDetail(batchId)
      .then((res) => {
        setBatch(res.batch);
        setLearners(res.learners);
      })
      .catch(() => setError("Could not load this batch's details."));
  }, [batchId]);

  if (error) {
    return (
      <DetailModal title="Batch details" onClose={onClose}>
        <p className="text-sm text-error">{error}</p>
      </DetailModal>
    );
  }
  if (!batch || !learners) {
    return (
      <DetailModal title="Batch details" onClose={onClose}>
        <p className="text-sm text-muted">Loading…</p>
      </DetailModal>
    );
  }

  return (
    <DetailModal title={batch.name} subtitle={`Created ${formatDate(batch.createdAt)}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="border border-rule rounded-input px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Batch details</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted">Managed by</p>
              <p className="text-sm text-ink">{batch.managerNames.length === 0 ? "No manager assigned yet" : batch.managerNames.join(", ")}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Learners</p>
              <p className="text-sm text-ink">{learners.length}</p>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Learners</p>
          {learners.length === 0 ? (
            <p className="text-sm text-muted">No learners in this batch yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {learners.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setViewingLearnerId(l.id)}
                  className="border border-rule rounded-input px-4 py-3 flex items-center gap-3 text-left hover:border-rule-strong hover:bg-paper-warm transition-colors cursor-pointer"
                >
                  <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(l.firstName, l.lastName, l.email)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}</p>
                    <p className="text-xs text-muted">{l.sessionCount} session{l.sessionCount === 1 ? "" : "s"} completed</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                    {l.active ? "Active" : "Deactivated"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewingLearnerId && (
        <LearnerProfileModal
          learnerId={viewingLearnerId}
          onClose={() => setViewingLearnerId(null)}
          onBack={() => setViewingLearnerId(null)}
          fetcher={getOrgLearnerDetail}
        />
      )}
    </DetailModal>
  );
}
