import { useEffect, useState } from "react";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { Ban, RotateCcw, Trash2, ArrowRightLeft, UserPlus } from "lucide-react";
import { Button } from "@/components/Button";
import { OrgInviteLearnerModal, batchLabel } from "@/components/OrgInviteLearnerModal";
import { getOrgLicenseSummary } from "@/api/licenses";
import { MoveLearnerModal } from "@/components/MoveLearnerModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import {
  getOrgLearners,
  getOrgLearnerDetail,
  deleteLearner,
  deactivateLearner,
  reactivateLearner,
  getBatches,
  moveLearner,
  type OrgLearner,
  type OrgBatch,
} from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

// Org Admins add learners directly (any batch, or none yet) and can move
// them under a Manager's batch later. Managers only ever see learners in
// their own batches.
export function OrgAdminLearners() {
  const [learners, setLearners] = useState<OrgLearner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);
  const [deletingLearner, setDeletingLearner] = useState<OrgLearner | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  const [movingLearner, setMovingLearner] = useState<OrgLearner | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    getOrgLearners()
      .then((res) => setLearners(res.learners))
      .catch(() => setError("Could not load learners."));
    getBatches().then((res) => setBatches(res.batches)).catch(() => {});
    getOrgLicenseSummary()
      .then((s) => setPoolAvailable(s.unreserved))
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleDelete(learner: OrgLearner) {
    setBusyId(learner.id);
    try {
      await deleteLearner(learner.id);
      setDeletingLearner(null);
      load();
    } catch {
      setError("Could not delete that learner.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(learner: OrgLearner) {
    setBusyId(learner.id);
    try {
      if (learner.active) await deactivateLearner(learner.id);
      else await reactivateLearner(learner.id);
      load();
    } catch {
      setError("Could not update that learner's status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Learners</h1>
          <p className="text-sm text-muted mt-1">Everyone in your organization, across every batch.</p>
        </div>
        <Button onClick={() => setShowInvite(true)} className="flex items-center gap-2 shrink-0">
          <UserPlus size={18} /> Invite Learners
        </Button>
      </div>

      {notice && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {!learners && !error && <p className="text-sm text-muted">Loading…</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">No learners yet — invite them here, or a Manager can invite them into their batch.</p>}

      <FollowUpPanel />

      {learners && learners.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Sessions completed</th>
                <th className="px-4 py-3">License</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setViewingLearnerId(l.id)}
                  className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-warm transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(l.firstName, l.lastName, l.email)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-ink font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                        <p className="text-muted text-xs truncate">
                          {l.participantId ? `${l.participantId} · ` : ""}
                          {l.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">{l.batchName ?? <span className="text-xs italic">No batch yet</span>}</td>
                  <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                  <td className="px-4 py-3">{l.license && <LicenseStatusPill license={l.license} />}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setMovingLearner(l)}
                        disabled={batches.filter((b) => b.id !== l.batchId).length === 0}
                        title={l.batchId ? "Move to another batch" : "Put in a batch"}
                        className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowRightLeft size={16} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(l)}
                        disabled={busyId === l.id}
                        title={l.active ? "Deactivate" : "Activate"}
                        className={`p-1.5 rounded-input transition-colors cursor-pointer disabled:opacity-50 ${
                          l.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"
                        }`}
                      >
                        {l.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                      </button>
                      <button
                        onClick={() => setDeletingLearner(l)}
                        disabled={busyId === l.id}
                        title="Delete"
                        className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewingLearnerId && (
        <LearnerProfileModal learnerId={viewingLearnerId} onClose={() => setViewingLearnerId(null)} fetcher={getOrgLearnerDetail} />
      )}

      {movingLearner && (
        <MoveLearnerModal
          learnerName={[movingLearner.firstName, movingLearner.lastName].filter(Boolean).join(" ") || movingLearner.email}
          currentBatchId={movingLearner.batchId ?? null}
          currentBatchName={movingLearner.batchName}
          batches={batches.map((b) => ({ id: b.id, name: b.name, label: batchLabel(b) }))}
          onMove={(batchId, reason) => moveLearner(movingLearner.id, batchId, reason)}
          onClose={() => setMovingLearner(null)}
          onMoved={() => {
            setMovingLearner(null);
            load();
          }}
        />
      )}

      {showInvite && (
        <OrgInviteLearnerModal
          batches={batches}
          poolAvailable={poolAvailable}
          onClose={() => setShowInvite(false)}
          onDone={(message) => {
            setShowInvite(false);
            setNotice(message);
            load();
          }}
        />
      )}

      {deletingLearner && (
        <ConfirmActionModal
          title="Delete learner"
          message={`Delete ${[deletingLearner.firstName, deletingLearner.lastName].filter(Boolean).join(" ") || deletingLearner.email}? All their progress and session history are removed. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          submitting={busyId === deletingLearner.id}
          onClose={() => setDeletingLearner(null)}
          onConfirm={() => handleDelete(deletingLearner)}
        />
      )}
    </div>
  );
}
