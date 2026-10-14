import { useEffect, useState, type FormEvent } from "react";
import { BulkLearnerUpload } from "@/components/BulkLearnerUpload";
import { validateBulkEmails } from "@/api/orgAdmin";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { UserPlus, X, Mail, ArrowRightLeft, Ban, RotateCcw } from "lucide-react";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { MoveLearnerModal } from "@/components/MoveLearnerModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { AssignLicenseModal } from "@/components/licenses/AssignLicenseModal";
import { getManagerLicenseOverview, managerAssignLicenses, type BatchBudget, type ManagerPool } from "@/api/licenses";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { getManagerOverview } from "@/api/manager";
import {
  getManagerLearners,
  managerOnboardLearner,
  managerOnboardLearnersBulk,
  managerMoveLearner,
  managerResendInvite,
  managerDeactivateLearner,
  managerReactivateLearner,
  getManagerLearnerDetail,
} from "@/api/manager";
import type { OrgLearner } from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function BulkUploadForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  return (
    <div className="px-8 py-6">
      <BulkLearnerUpload
        maxRows={200}
        checkExisting={(emails) => validateBulkEmails("manager", emails).then((r) => r.existing)}
        submit={async (rows) => (await managerOnboardLearnersBulk(batchId, rows)).results}
        onDone={onDone}
      />
    </div>
  );
}

function OnboardLearnerModal({
  batches,
  onClose,
  onCreated,
}: {
  batches: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await managerOnboardLearner({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), batchId });
      onCreated(email.trim());
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That email is already registered.");
      } else {
        setError("Something went wrong onboarding that learner.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Invite Learner</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-6 pt-4">
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm font-semibold rounded-input transition-colors cursor-pointer ${
                mode === m ? "bg-navy/10 text-navy" : "text-muted hover:text-ink"
              }`}
            >
              {m === "single" ? "Single learner" : "Bulk upload (CSV)"}
            </button>
          ))}
        </div>

        {batches.length > 1 && (
          <div className="px-8 pt-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Batch</label>
            <select
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
              className="w-full mt-1.5 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "bulk" ? (
          <BulkUploadForm batchId={batchId} onDone={onClose} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">First name</label>
                <input
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">Last name</label>
                <input
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
                <Mail size={13} /> Email
              </label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <p className="text-xs text-muted">They'll get an email to set their own password.</p>
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? "Sending invite…" : "Send invite"}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ManagerLearners() {
  const [learners, setLearners] = useState<OrgLearner[] | null>(null);
  const [batches, setBatches] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [justInvited, setJustInvited] = useState<string | null>(null);
  const [movingLearner, setMovingLearner] = useState<OrgLearner | null>(null);
  const [assigning, setAssigning] = useState<OrgLearner | null>(null);
  const [returning, setReturning] = useState<OrgLearner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingLearner, setViewingLearner] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [myPool, setMyPool] = useState<ManagerPool | undefined>(undefined);

  function load() {
    getManagerLearners()
      .then((res) => setLearners(res.learners))
      .catch(() => setError("Could not load learners."));
    // Learners can only be added to, or moved into, active batches.
    getManagerOverview().then((res) => setBatches(res.batches.filter((b) => (b.status ?? "active") === "active")));
    getManagerLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setMyPool(res.myPool);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  useEffect(() => {
    if (!justInvited) return;
    const timer = setTimeout(() => setJustInvited(null), 5000);
    return () => clearTimeout(timer);
  }, [justInvited]);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Learners</h1>
          <p className="text-sm text-muted mt-1">Only learners in your assigned batch(es).</p>
        </div>
        <Button
          onClick={() => setShowOnboard(true)}
          disabled={batches.length === 0}
          className="flex items-center gap-2 shrink-0"
        >
          <UserPlus size={18} /> Invite Learner
        </Button>
      </div>

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}

      {justInvited && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          Invite sent to {justInvited} — they'll receive an email to set their password.
        </p>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {!learners && !error && <p className="text-sm text-muted">Loading…</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">No learners yet.</p>}

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
                <tr key={l.id} onClick={() => setViewingLearner(l.id)} className="border-b border-rule last:border-0 hover:bg-paper-warm cursor-pointer">
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
                  <td className="px-4 py-3 text-muted">{l.batchName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                  <td className="px-4 py-3">{l.license && <LicenseStatusPill license={l.license} />}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? "Active" : "Deactivated"}
                    </span>
                    {l.active && l.hasLoggedIn === false && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          managerResendInvite(l.id)
                            .then((r) => setNotice(`A new invite link was sent to ${r.email}.`))
                            .catch(() => setError("Could not resend the invite."));
                        }}
                        className="block mt-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
                      >
                        Invite pending · resend
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {l.license && l.license.queuedMonths > 0 && (
                      <button
                        onClick={() => setReturning(l)}
                        title="Ask your Org Admin to return this learner's unused months to the pool"
                        className="text-xs font-semibold text-muted hover:text-error cursor-pointer mr-2"
                      >
                        Request unassign
                      </button>
                    )}
                    <Button
                      variant={l.license && (l.license.status === "active" || l.license.status === "grace") ? "secondary" : "primary"}
                      onClick={() => setAssigning(l)}
                      disabled={!l.active}
                      className="!px-3 !py-1.5 !text-xs mr-1"
                    >
                      {l.license && (l.license.status === "active" || l.license.status === "grace") ? "Extend" : "Assign"}
                    </Button>
                    <button
                      onClick={async () => {
                        try {
                          if (l.active) {
                            const r = await managerDeactivateLearner(l.id);
                            setNotice(
                              r.returnRequested
                                ? `Deactivated. A request to return ${r.returnRequested} unused month${r.returnRequested === 1 ? "" : "s"} went to your Org Admin.`
                                : "Deactivated.",
                            );
                          } else {
                            await managerReactivateLearner(l.id);
                            setNotice("Reactivated.");
                          }
                          load();
                        } catch {
                          setError("Couldn't change that learner's status.");
                        }
                      }}
                      title={l.active ? "Deactivate" : "Reactivate"}
                      className={`p-1.5 rounded-input transition-colors cursor-pointer ${l.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"}`}
                    >
                      {l.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                    </button>
                    <button
                      onClick={() => setMovingLearner(l)}
                      disabled={batches.length < 2}
                      title={batches.length < 2 ? "You only manage one batch" : "Move to another batch"}
                      className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ArrowRightLeft size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showOnboard && (
        <OnboardLearnerModal
          batches={batches}
          onClose={() => setShowOnboard(false)}
          onCreated={(email) => {
            setShowOnboard(false);
            setJustInvited(email);
            load();
          }}
        />
      )}

      {assigning && assigning.license && (
        <AssignLicenseModal
          learnerName={[assigning.firstName, assigning.lastName].filter(Boolean).join(" ") || assigning.email}
          license={assigning.license}
          poolHint={(() => {
            const b = budgets.find((x) => x.batchId === assigning.batchId);
            const pool = myPool?.allotment != null ? `${myPool.remaining} left in your pool` : "no pool allotted to you yet";
            if (b && b.budget !== null && (b.remaining ?? 0) > 0) return `Uses ${b.batchName}'s fixed licenses first (${b.remaining} left), then your pool (${pool}).`;
            return `Uses your pool — ${pool}.`;
          })()}
          onAssign={(months) => managerAssignLicenses(assigning.id, months)}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            load();
          }}
        />
      )}

      {returning && returning.license && (
        <RequestLicenseChangeModal
          batches={budgets}
          learner={{
            id: returning.id,
            name: [returning.firstName, returning.lastName].filter(Boolean).join(" ") || returning.email,
            queuedMonths: returning.license.queuedMonths,
          }}
          onClose={() => setReturning(null)}
          onSent={() => {
            setReturning(null);
            setNotice("Unassign request sent to your Org Admin.");
          }}
        />
      )}

      {viewingLearner && (
        <LearnerProfileModal learnerId={viewingLearner} onClose={() => setViewingLearner(null)} fetcher={getManagerLearnerDetail} />
      )}

      {movingLearner && (
        <MoveLearnerModal
          learnerName={[movingLearner.firstName, movingLearner.lastName].filter(Boolean).join(" ") || movingLearner.email}
          currentBatchName={movingLearner.batchName}
          batches={batches}
          onMove={(batchId, reason) => managerMoveLearner(movingLearner.id, batchId, reason)}
          onClose={() => setMovingLearner(null)}
          onMoved={() => {
            setMovingLearner(null);
            load();
          }}
        />
      )}
    </div>
  );
}
