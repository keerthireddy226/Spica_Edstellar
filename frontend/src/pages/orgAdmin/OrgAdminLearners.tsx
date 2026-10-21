import { useEffect, useState } from "react";
import { EraseLearnerModal } from "@/components/EraseLearnerModal";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { Ban, RotateCcw, Trash2, Eraser, ArrowRightLeft, UserPlus } from "lucide-react";
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
  resendInvite,
  reactivateLearner,
  getBatches,
  moveLearner,
  updateOrgLearnerDetails,
  type OrgLearner,
  type OrgBatch,
} from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
import { CertifiedCell } from "@/components/CertifiedCell";
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
  const [erasingLearner, setErasingLearner] = useState<OrgLearner | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = (learners ?? []).filter(
    (l) =>
      !q ||
      [l.firstName, l.lastName, l.email, l.participantId, l.employeeId, l.department, l.jobTitle, l.batchName].some((v) => v?.toLowerCase().includes(q)),
  );

  function load() {
    getOrgLearners()
      .then((res) => setLearners(res.learners))
      .catch(() => setError(tr("Could not load learners.")));
    getBatches().then((res) => setBatches(res.batches)).catch(() => {});
    getOrgLicenseSummary()
      .then((s) => setPoolAvailable(s.unreserved))
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleDelete(learner: OrgLearner) {
    setBusyId(learner.id);
    try {
      const r = await deleteLearner(learner.id);
      setDeletingLearner(null);
      if (r.reclaimedMonths) setNotice(r.reclaimedMonths === 1 ? tr("1 unused month went back to your license pool.") : tr("{{n}} unused months went back to your license pool.", { n: r.reclaimedMonths }));
      load();
    } catch {
      setError(tr("Could not delete that learner."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleResend(learner: OrgLearner) {
    setBusyId(learner.id);
    try {
      const r = await resendInvite("learners", learner.id);
      setNotice(tr("A new invite link was sent to {{email}}.", { email: r.email }));
    } catch {
      setError(tr("Could not resend the invite."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(learner: OrgLearner) {
    setBusyId(learner.id);
    try {
      if (learner.active) {
        const r = await deactivateLearner(learner.id);
        if (r.reclaimedMonths) setNotice(r.reclaimedMonths === 1 ? tr("1 unused month went back to your license pool.") : tr("{{n}} unused months went back to your license pool.", { n: r.reclaimedMonths }));
      } else await reactivateLearner(learner.id);
      load();
    } catch {
      setError(tr("Could not update that learner's status."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Learners")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Everyone in your organization, across every batch.")}</p>
        </div>
        <Button onClick={() => setShowInvite(true)} className="flex items-center gap-2 shrink-0">
          <UserPlus size={18} /> {tr("Invite Learners")}</Button>
      </div>

      {notice && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {!learners && !error && <p className="text-sm text-muted">{tr("Loading…")}</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">{tr("No learners yet — invite them here, or a Manager can invite them into their batch.")}</p>}

      <FollowUpPanel />

      {learners && learners.length > 0 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("Search by name, email, employee ID, department or batch")}
          className="w-full sm:max-w-md rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
        />
      )}

      {learners && learners.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">{tr("Learner")}</th>
                <th className="px-4 py-3">{tr("Department")}</th>
                <th className="px-4 py-3">{tr("Batch")}</th>
                <th className="px-4 py-3">{tr("Certified")}</th>
                <th className="px-4 py-3">{tr("Sessions completed")}</th>
                <th className="px-4 py-3">{tr("License")}</th>
                <th className="px-4 py-3">{tr("Status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
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
                        <p className="text-ink font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                        <p className="text-muted text-xs truncate">
                          {l.participantId ? `${l.participantId} · ` : ""}
                          {l.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <p>{l.department ?? "—"}</p>
                    {(l.employeeId || l.jobTitle) && <p className="text-xs">{[l.employeeId, l.jobTitle].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted">{l.batchName ?? <span className="text-xs italic">{tr("No batch yet")}</span>}</td>
                  <td className="px-4 py-3"><CertifiedCell c={l.certified} /></td>
                  <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                  <td className="px-4 py-3">{l.license && <LicenseStatusPill license={l.license} />}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? tr("Active") : tr("Deactivated")}
                    </span>
                    {l.active && l.hasLoggedIn === false && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResend(l);
                        }}
                        disabled={busyId === l.id}
                        className="block mt-1 text-xs font-semibold text-navy hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {tr("Invite pending · resend")}</button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setMovingLearner(l)}
                        disabled={batches.filter((b) => b.id !== l.batchId && b.status === "active").length === 0}
                        title={l.batchId ? tr("Move to another batch") : tr("Put in a batch")}
                        className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowRightLeft size={16} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(l)}
                        disabled={busyId === l.id}
                        title={l.active ? tr("Deactivate") : tr("Activate")}
                        className={`p-1.5 rounded-input transition-colors cursor-pointer disabled:opacity-50 ${
                          l.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"
                        }`}
                      >
                        {l.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                      </button>
                      <button
                        onClick={() => setErasingLearner(l)}
                        title={tr("Erase personal data")}
                        className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                      >
                        <Eraser size={16} />
                      </button>
                      <button
                        onClick={() => setDeletingLearner(l)}
                        disabled={busyId === l.id}
                        title={tr("Delete")}
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
        <LearnerProfileModal
          learnerId={viewingLearnerId}
          onClose={() => setViewingLearnerId(null)}
          fetcher={getOrgLearnerDetail}
          saveDetails={(id, d) => updateOrgLearnerDetails(id, d).then(load)}
        />
      )}

      {movingLearner && (
        <MoveLearnerModal
          learnerName={[movingLearner.firstName, movingLearner.lastName].filter(Boolean).join(" ") || movingLearner.email}
          currentBatchId={movingLearner.batchId ?? null}
          currentBatchName={movingLearner.batchName}
          batches={batches.filter((b) => b.status === "active").map((b) => ({ id: b.id, name: b.name, label: batchLabel(b) }))}
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

      {erasingLearner && (
        <EraseLearnerModal
          learner={{ id: erasingLearner.id, name: [erasingLearner.firstName, erasingLearner.lastName].filter(Boolean).join(" ") || erasingLearner.email }}
          onClose={() => setErasingLearner(null)}
          onErased={() => {
            setErasingLearner(null);
            setNotice(tr("Personal data erased."));
            load();
          }}
        />
      )}

      {deletingLearner && (
        <ConfirmActionModal
          title={tr("Delete learner")}
          message={tr("Delete {{v}}? All their progress and session history are removed, and any months that haven't started go back to your license pool. This cannot be undone.", { v: [deletingLearner.firstName, deletingLearner.lastName].filter(Boolean).join(" ") || deletingLearner.email })}
          confirmLabel={tr("Delete")}
          destructive
          submitting={busyId === deletingLearner.id}
          onClose={() => setDeletingLearner(null)}
          onConfirm={() => handleDelete(deletingLearner)}
        />
      )}
    </div>
  );
}
