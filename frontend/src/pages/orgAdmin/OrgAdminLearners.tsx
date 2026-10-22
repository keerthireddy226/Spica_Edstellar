import { useEffect, useState } from "react";
import { EraseLearnerModal } from "@/components/EraseLearnerModal";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { Ban, RotateCcw, Trash2, Eraser, ArrowRightLeft, UserPlus, Users } from "lucide-react";
import { OrgEmptyState, OrgLoadError, OrgLoading, OrgNotice, OrgSearch, OrgTabs } from "@/components/OrgAdminUi";
import { getLearnerEngagement } from "@/api/notifications";
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
  const [view, setView] = useState<"all" | "follow_up">("all");
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);
  const q = query.trim().toLowerCase();
  const shown = (learners ?? []).filter(
    (l) =>
      !q ||
      [l.firstName, l.lastName, l.email, l.participantId, l.employeeId, l.department, l.jobTitle, l.batchName].some((v) => v?.toLowerCase().includes(q)),
  );

  function load() {
    setError(null);
    getLearnerEngagement()
      .then((d) => setFollowUpCount(d.learners.filter((l) => l.status === "not_started" || l.status === "inactive" || l.status === "slow").length))
      .catch(() => {});
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
        <OrgNotice tone="success" onClose={() => setNotice(null)}>
          {notice}
        </OrgNotice>
      )}

      {error && <OrgLoadError text={error} onRetry={load} />}
      {!learners && !error && <OrgLoading />}
      {learners?.length === 0 && (
        <OrgEmptyState
          icon={Users}
          title={tr("No learners yet")}
          text={tr("No learners yet — invite them here, or a Manager can invite them into their batch.")}
          action={
            <Button onClick={() => setShowInvite(true)} className="flex items-center gap-2">
              <UserPlus size={16} /> {tr("Invite Learners")}
            </Button>
          }
        />
      )}

      {learners && learners.length > 0 && (
        <OrgTabs
          value={view}
          onChange={setView}
          tabs={[
            ["all", tr("All learners ({{n}})", { n: learners.length })],
            ["follow_up", followUpCount ? tr("Follow up ({{n}})", { n: followUpCount }) : tr("Follow up")],
          ]}
        />
      )}

      {view === "follow_up" && <FollowUpPanel />}

      {view === "all" && learners && learners.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <OrgSearch
            value={query}
            onChange={setQuery}
            placeholder={tr("Search by name, email, employee ID, department or batch")}
            className="w-full sm:max-w-md"
          />
          {q && <span className="text-xs text-muted">{tr("{{n}} of {{total}} shown", { n: shown.length, total: learners.length })}</span>}
        </div>
      )}

      {view === "all" && learners && learners.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="border-b border-rule bg-paper-warm/50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-3">{tr("Learner")}</th>
                <th className="px-3 py-3">{tr("Department")}</th>
                <th className="px-3 py-3">{tr("Batch")}</th>
                <th className="px-3 py-3">{tr("Certified")}</th>
                <th className="px-3 py-3 text-center">{tr("Sessions completed")}</th>
                <th className="px-3 py-3">{tr("License")}</th>
                <th className="px-3 py-3">{tr("Status")}</th>
                <th className="px-3 py-3"><span className="sr-only">{tr("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    {tr("No learners match.")}
                  </td>
                </tr>
              )}
              {shown.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setViewingLearnerId(l.id)}
                  className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-warm transition-colors"
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(l.firstName, l.lastName, l.email)}
                      </span>
                      <div className="min-w-0 max-w-[200px]">
                        <p className="text-ink font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                        <p className="text-muted text-xs truncate" title={l.email}>
                          {l.participantId ? `${l.participantId} · ` : ""}
                          {l.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted">
                    <p>{l.department ?? "—"}</p>
                    {(l.employeeId || l.jobTitle) && <p className="text-xs">{[l.employeeId, l.jobTitle].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap">{l.batchName ?? <span className="text-xs italic">{tr("No batch yet")}</span>}</td>
                  <td className="px-3 py-3"><CertifiedCell c={l.certified} /></td>
                  <td className="px-3 py-3 text-muted tabular-nums text-center">{l.sessionCount}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{l.license && <LicenseStatusPill license={l.license} />}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {l.active && l.hasLoggedIn === false ? (
                      // Not signed in yet: one pill that resends the invite.
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResend(l);
                        }}
                        disabled={busyId === l.id}
                        title={tr("Invite pending · resend")}
                        className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-warning/15 text-warning hover:bg-warning/25 cursor-pointer disabled:opacity-50"
                      >
                        {tr("Invite pending")} · {tr("Resend")}
                      </button>
                    ) : (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                        {l.active ? tr("Active") : tr("Deactivated")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setMovingLearner(l)}
                        disabled={batches.filter((b) => b.id !== l.batchId && b.status === "active").length === 0}
                        title={l.batchId ? tr("Move to another batch") : tr("Put in a batch")}
                        aria-label={l.batchId ? tr("Move to another batch") : tr("Put in a batch")}
                        className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ArrowRightLeft size={16} />
                      </button>
                      <button
                        onClick={() => handleToggleActive(l)}
                        disabled={busyId === l.id}
                        title={l.active ? tr("Deactivate") : tr("Activate")}
                        aria-label={l.active ? tr("Deactivate") : tr("Activate")}
                        className={`p-1.5 rounded-input transition-colors cursor-pointer disabled:opacity-50 ${
                          l.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"
                        }`}
                      >
                        {l.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                      </button>
                      <button
                        onClick={() => setErasingLearner(l)}
                        title={tr("Erase personal data")}
                        aria-label={tr("Erase personal data")}
                        className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                      >
                        <Eraser size={16} />
                      </button>
                      <button
                        onClick={() => setDeletingLearner(l)}
                        disabled={busyId === l.id}
                        title={tr("Delete")}
                        aria-label={tr("Delete")}
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
