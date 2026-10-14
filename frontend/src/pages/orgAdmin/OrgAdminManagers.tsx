import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, X, Mail, Ban, RotateCcw, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";
import {
  getManagers,
  onboardManager,
  getBatches,
  getOrgManagerDetail,
  getOrgLearnerDetail,
  deleteManager,
  deactivateManager,
  reactivateManager,
  type OrgManager,
  type OrgBatch,
} from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function OnboardManagerModal({
  batches,
  onClose,
  onCreated,
}: {
  batches: OrgBatch[];
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleBatch(id: string) {
    setBatchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (batchIds.length === 0) {
      setError("Pick at least one batch for this Manager.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onboardManager({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), batchIds });
      onCreated(email.trim());
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That email is already registered.");
      } else {
        setError("Something went wrong onboarding that manager.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Onboard Manager</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
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

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Assign to batch(es)</label>
            {batches.length === 0 ? (
              <p className="text-sm text-muted">Create a batch first before onboarding a Manager.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {batches.map((b) => (
                  <label key={b.id} className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchIds.includes(b.id)}
                      onChange={() => toggleBatch(b.id)}
                      className="h-4 w-4 rounded accent-navy cursor-pointer"
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <p className="text-xs text-muted">They'll get an email to set their own password.</p>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting || batches.length === 0} className="flex-1">
              {submitting ? "Sending invite…" : "Send invite"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function OrgAdminManagers() {
  const [managers, setManagers] = useState<OrgManager[] | null>(null);
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [justInvited, setJustInvited] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);
  const [deletingManager, setDeletingManager] = useState<OrgManager | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    getManagers()
      .then((res) => setManagers(res.managers))
      .catch(() => setError("Could not load managers."));
    getBatches().then((res) => setBatches(res.batches));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!justInvited) return;
    const timer = setTimeout(() => setJustInvited(null), 5000);
    return () => clearTimeout(timer);
  }, [justInvited]);

  async function handleDelete(manager: OrgManager) {
    setBusyId(manager.id);
    try {
      await deleteManager(manager.id);
      setDeletingManager(null);
      load();
    } catch {
      setError("Could not delete that manager.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(manager: OrgManager) {
    setBusyId(manager.id);
    try {
      if (manager.active) await deactivateManager(manager.id);
      else await reactivateManager(manager.id);
      load();
    } catch {
      setError("Could not update that manager's status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Managers</h1>
          <p className="text-sm text-muted mt-1">Each one scoped to only the batch(es) you assign them.</p>
        </div>
        <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
          <UserPlus size={18} /> Onboard Manager
        </Button>
      </div>

      {justInvited && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          Invite sent to {justInvited} — they'll receive an email to set their password.
        </p>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {!managers && !error && <p className="text-sm text-muted">Loading…</p>}
      {managers?.length === 0 && <p className="text-sm text-muted">No managers yet.</p>}

      {managers && managers.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Manager</th>
                <th className="px-4 py-3">Batches</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {managers.map((m) => {
                const status = !m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active";
                return (
                  <tr
                    key={m.id}
                    onClick={() => setViewingManagerId(m.id)}
                    className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-warm transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                          {initials(m.firstName, m.lastName, m.email)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">
                            {[m.firstName, m.lastName].filter(Boolean).join(" ") || "Not named yet"}
                          </p>
                          <p className="text-muted text-xs truncate">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{m.batchNames.join(", ") || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                          status === "active"
                            ? "bg-success/15 text-success"
                            : status === "pending"
                              ? "bg-warning/15 text-navy-deep"
                              : "bg-error/15 text-error"
                        }`}
                      >
                        {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleToggleActive(m)}
                          disabled={busyId === m.id}
                          title={m.active ? "Deactivate" : "Activate"}
                          className={`p-1.5 rounded-input transition-colors cursor-pointer disabled:opacity-50 ${
                            m.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"
                          }`}
                        >
                          {m.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                        </button>
                        <button
                          onClick={() => setDeletingManager(m)}
                          disabled={busyId === m.id}
                          title="Delete"
                          className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showOnboard && (
        <OnboardManagerModal
          batches={batches}
          onClose={() => setShowOnboard(false)}
          onCreated={(email) => {
            setShowOnboard(false);
            setJustInvited(email);
            load();
          }}
        />
      )}

      {viewingManagerId && (
        <ManagerDetailModal
          managerId={viewingManagerId}
          onClose={() => setViewingManagerId(null)}
          fetcher={getOrgManagerDetail}
          learnerFetcher={getOrgLearnerDetail}
        />
      )}

      {deletingManager && (
        <ConfirmActionModal
          title="Delete manager"
          message={`Delete ${[deletingManager.firstName, deletingManager.lastName].filter(Boolean).join(" ") || deletingManager.email}? They lose access immediately and their batch assignments are removed. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          submitting={busyId === deletingManager.id}
          onClose={() => setDeletingManager(null)}
          onConfirm={() => handleDelete(deletingManager)}
        />
      )}
    </div>
  );
}
