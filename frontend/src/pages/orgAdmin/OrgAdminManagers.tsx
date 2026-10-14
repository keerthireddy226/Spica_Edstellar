import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, X, Mail, Ban, RotateCcw, Trash2, Pencil } from "lucide-react";
import { getOrgLicenseOverview, LICENSE_ERROR_TEXT, type BatchBudget } from "@/api/licenses";
import { ApiError } from "@/lib/api";
import { planErrorMessage } from "@/api/plans";
import { PlanLimitHint, PlanLockNote, refreshPlan, useHasFeature } from "@/components/plans/usePlan";
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
  updateManager,
  resendInvite,
  type OrgManager,
  type OrgBatch,
} from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function ManagerFormModal({
  manager,
  batches,
  budgets,
  poolAvailable,
  onClose,
  onSaved,
}: {
  manager: OrgManager | null;
  batches: OrgBatch[];
  budgets: BatchBudget[];
  poolAvailable: number | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = manager !== null;
  const [firstName, setFirstName] = useState(manager?.firstName ?? "");
  const [lastName, setLastName] = useState(manager?.lastName ?? "");
  const [email, setEmail] = useState(manager?.email ?? "");
  const [batchIds, setBatchIds] = useState<string[]>(manager?.batchIds ?? []);
  const [pool, setPool] = useState(manager?.licensesAllotted != null ? String(manager.licensesAllotted) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poolsAllowed = useHasFeature("manager_pools") !== false;

  function toggleBatch(id: string) {
    setBatchIds((prev) => (prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]));
  }

  const selfName = manager ? [manager.firstName, manager.lastName].filter(Boolean).join(" ") : "";
  const poolNumber = pool.trim() ? Math.max(0, Math.floor(Number(pool))) : null;
  const poolUsed = manager?.licensesUsed ?? 0;
  // Unreserved + whatever this Manager already has set aside = the most they can hold.
  const maxPool = poolAvailable === null ? null : poolAvailable + Math.max(0, (manager?.licensesAllotted ?? 0) - poolUsed) + poolUsed;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (poolNumber !== null && maxPool !== null && poolNumber > maxPool) {
      setError(`Only ${maxPool} licenses can be set aside for this Manager right now.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    // Without pools on this plan, leave whatever is already set untouched.
    const licenseAllotment = poolsAllowed ? poolNumber : (manager?.licensesAllotted ?? null);
    try {
      if (editing) {
        await updateManager(manager.id, { firstName: firstName.trim(), lastName: lastName.trim(), batchIds, licenseAllotment });
        onSaved(`${firstName.trim()} ${lastName.trim()} updated.`);
      } else {
        await onboardManager({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), batchIds, licenseAllotment });
        onSaved(`Invite sent to ${email.trim()} — they'll receive an email to set their password.`);
      }
    } catch (err) {
      if (planErrorMessage(err)) {
        setError(planErrorMessage(err));
      } else if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That email is already registered.");
      } else if (err instanceof ApiError && LICENSE_ERROR_TEXT[err.message]) {
        setError(LICENSE_ERROR_TEXT[err.message]);
      } else {
        setError(editing ? "Something went wrong saving this manager." : "Something went wrong onboarding that manager.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{editing ? "Edit Manager" : "Onboard Manager"}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">First name</label>
              <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Last name</label>
              <input required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
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
              disabled={editing}
              className={`${inputClass} ${editing ? "opacity-60 cursor-not-allowed" : ""}`}
            />
            {editing && <p className="text-xs text-muted">Email is their login, so it can't be changed here.</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">License pool for this Manager</label>
            {!poolsAllowed ? (
              <PlanLockNote feature="manager_pools" compact />
            ) : (
            <>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={poolUsed}
                value={pool}
                onChange={(e) => setPool(e.target.value)}
                placeholder="0"
                className="w-32 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
              <span className="text-xs text-muted">
                {editing && poolUsed ? `${poolUsed} already assigned from it · ` : ""}
                {maxPool !== null ? `up to ${maxPool} available to set aside` : ""}
              </span>
            </div>
            <p className="text-xs text-muted">
              Set aside from your pool for this Manager to use in any of their batches, including batches they create themselves. They can't change it —
              they send you a request.
            </p>
            </>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Batches they manage</label>
            {batches.length === 0 ? (
              <p className="text-sm text-muted">No batches yet — the Manager can create their own.</p>
            ) : (
              <div className="border border-rule rounded-input overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-paper-warm/60 border-b border-rule text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2 text-right">Fixed batch licenses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => {
                      const checked = batchIds.includes(b.id);
                      const fixed = budgets.find((x) => x.batchId === b.id);
                      const others = b.managerNames.filter((n) => n.trim() !== selfName);
                      return (
                        <tr key={b.id} className="border-b border-rule last:border-0">
                          <td className="px-3 py-2.5">
                            <label className="flex items-center gap-2.5 text-ink cursor-pointer min-w-0">
                              <input type="checkbox" checked={checked} onChange={() => toggleBatch(b.id)} className="h-4 w-4 rounded accent-navy cursor-pointer" />
                              <span className="truncate">{b.name}</span>
                            </label>
                            {others.length > 0 && <p className="text-[11px] text-muted ml-6 truncate">also managed by {others.join(", ")}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted">
                            {fixed?.budget != null ? `${fixed.used} / ${fixed.budget} used` : "None — uses Manager's pool"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">Fixed batch licenses are set when you create a batch (or in Licenses → Allotments) and are used first for that batch's learners.</p>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          {!editing && <p className="text-xs text-muted">They'll get an email to set their own password.</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? (editing ? "Saving…" : "Sending invite…") : editing ? "Save changes" : "Send invite"}
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
  const [editingManager, setEditingManager] = useState<OrgManager | null>(null);
  const [justInvited, setJustInvited] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);
  const [deletingManager, setDeletingManager] = useState<OrgManager | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    getManagers()
      .then((res) => setManagers(res.managers))
      .catch(() => setError("Could not load managers."));
    getBatches().then((res) => setBatches(res.batches));
    getOrgLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setPoolAvailable(res.summary.unreserved);
      })
      .catch(() => {});
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
      const r = await deleteManager(manager.id);
      setDeletingManager(null);
      if (r.releasedLicenses) setJustInvited(`${r.releasedLicenses} unused license${r.releasedLicenses === 1 ? "" : "s"} from their pool went back to yours.`);
      load();
      refreshPlan();
    } catch {
      setError("Could not delete that manager.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(manager: OrgManager) {
    setBusyId(manager.id);
    try {
      if (manager.active) {
        const r = await deactivateManager(manager.id);
        if (r.releasedLicenses) setJustInvited(`${r.releasedLicenses} unused license${r.releasedLicenses === 1 ? "" : "s"} from their pool went back to yours.`);
      } else await reactivateManager(manager.id);
      load();
      refreshPlan();
    } catch (err) {
      setError(planErrorMessage(err) ?? "Could not update that manager's status.");
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
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
            <UserPlus size={18} /> Onboard Manager
          </Button>
          <PlanLimitHint limit="managers" />
        </div>
      </div>

      {justInvited && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          {justInvited}
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
                <th className="px-4 py-3">License pool</th>
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
                      {m.licensesAllotted === null ? (
                        <span className="text-xs text-muted">No pool</span>
                      ) : (
                        <div className="flex items-center gap-2 min-w-32">
                          <div className="flex-1 h-1.5 rounded-full bg-rule overflow-hidden">
                            <div
                              className="h-full bg-navy rounded-full"
                              style={{ width: `${m.licensesAllotted ? Math.min(100, (m.licensesUsed / m.licensesAllotted) * 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted whitespace-nowrap">
                            {m.licensesUsed} / {m.licensesAllotted} used
                          </span>
                        </div>
                      )}
                    </td>
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
                      {status === "pending" && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const r = await resendInvite("managers", m.id);
                              setJustInvited(`A new invite link was sent to ${r.email}.`);
                            } catch {
                              setError("Could not resend the invite.");
                            }
                          }}
                          className="block mt-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
                        >
                          Resend invite
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditingManager(m)}
                          title="Edit"
                          className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer"
                        >
                          <Pencil size={16} />
                        </button>
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

      {(showOnboard || editingManager) && (
        <ManagerFormModal
          key={editingManager?.id ?? "new"}
          manager={editingManager}
          batches={batches}
          budgets={budgets}
          poolAvailable={poolAvailable}
          onClose={() => {
            setShowOnboard(false);
            setEditingManager(null);
          }}
          onSaved={(message) => {
            refreshPlan();
            setShowOnboard(false);
            setEditingManager(null);
            setJustInvited(message);
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
