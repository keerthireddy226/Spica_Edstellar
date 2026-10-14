import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, X, Mail, Ban, RotateCcw, Trash2, Pencil, Repeat, Eye, Search, ShieldCheck, Users, KeyRound, Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { cardGradient } from "@/lib/cardGradients";
import { ManagerHandoverModal } from "@/components/ManagerHandoverModal";
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
  viewAsManager,
  type OrgManager,
  type OrgBatch,
} from "@/api/orgAdmin";

type ManagerStatus = "active" | "pending" | "deactivated";
const statusOf = (m: OrgManager): ManagerStatus => (!m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active");

function relative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? "" : "s"} ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number | string; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  title,
  onClick,
  tone,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  tone?: "danger" | "success";
  disabled?: boolean;
}) {
  const color = tone === "danger" ? "hover:border-error/40 hover:text-error" : tone === "success" ? "text-success hover:border-success/40" : "hover:border-rule-strong hover:text-ink";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill border border-rule text-xs font-semibold text-muted transition-colors cursor-pointer disabled:opacity-50 ${color}`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

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
                    {batches.filter((b) => b.status !== "archived").map((b) => {
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
  const [handingOver, setHandingOver] = useState<OrgManager | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [poolAvailable, setPoolAvailable] = useState<number | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ManagerStatus>("all");
  const all = managers ?? [];
  const counts = {
    active: all.filter((m) => statusOf(m) === "active").length,
    pending: all.filter((m) => statusOf(m) === "pending").length,
    deactivated: all.filter((m) => statusOf(m) === "deactivated").length,
    learners: all.filter((m) => m.active).reduce((n, m) => n + (m.learnerCount ?? 0), 0),
    allotted: all.filter((m) => m.active).reduce((n, m) => n + (m.licensesAllotted ?? 0), 0),
    used: all.filter((m) => m.active).reduce((n, m) => n + m.licensesUsed, 0),
    requests: all.reduce((n, m) => n + (m.pendingRequests ?? 0), 0),
  };
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (m) =>
      (filter === "all" || statusOf(m) === filter) &&
      (!q || [m.firstName, m.lastName, m.email, m.jobTitle, ...m.batchNames].some((v) => v?.toLowerCase().includes(q))),
  );
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
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard index={0} icon={ShieldCheck} value={counts.active} label={`Active manager${counts.active === 1 ? "" : "s"}`} />
            <StatCard index={1} icon={Users} value={counts.learners} label="Learners in their batches" />
            <StatCard
              index={2}
              icon={KeyRound}
              value={counts.allotted ? `${counts.used} / ${counts.allotted}` : "—"}
              label={counts.allotted ? `Pool licenses used · ${counts.allotted - counts.used} left` : "No manager pools yet"}
            />
            <StatCard index={3} icon={Inbox} value={counts.requests} label={`Pending license request${counts.requests === 1 ? "" : "s"}`} />
          </div>

          {(counts.pending > 0 || counts.requests > 0) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {counts.pending > 0 && (
                <span className="bg-warning/15 text-navy-deep border border-warning/30 rounded-pill px-3 py-1">
                  {counts.pending} invite{counts.pending === 1 ? "" : "s"} not accepted yet
                </span>
              )}
              {counts.requests > 0 && (
                <Link to={ROUTES.ORG_ADMIN_LICENSES} className="bg-navy/10 text-navy rounded-pill px-3 py-1 font-semibold hover:underline">
                  Review {counts.requests} license request{counts.requests === 1 ? "" : "s"} →
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-56 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email, job title or batch"
                className="w-full rounded-input border border-rule bg-paper pl-9 pr-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1 bg-surface border border-rule rounded-pill p-1 max-w-full overflow-x-auto">
              {(
                [
                  ["all", "All", managers.length],
                  ["active", "Active", counts.active],
                  ["pending", "Invite pending", counts.pending],
                  ["deactivated", "Deactivated", counts.deactivated],
                ] as const
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1 text-xs font-semibold rounded-pill whitespace-nowrap transition-colors cursor-pointer ${
                    filter === key ? "bg-navy text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {label} ({n})
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 && <p className="text-sm text-muted">No managers match.</p>}

          <div className="grid lg:grid-cols-2 gap-4">
            {shown.map((m) => {
              const status = statusOf(m);
              const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "Not named yet";
              const left = m.licensesAllotted != null ? Math.max(0, m.licensesAllotted - m.licensesUsed) : null;
              return (
                <div
                  key={m.id}
                  className={`bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow ${
                    status === "deactivated" ? "opacity-70" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="h-11 w-11 rounded-full bg-navy text-lime flex items-center justify-center text-sm font-bold shrink-0">
                      {initials(m.firstName, m.lastName, m.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-bold text-ink truncate">{name}</p>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill ${
                            status === "active" ? "bg-success/15 text-success" : status === "pending" ? "bg-warning/15 text-navy-deep" : "bg-error/15 text-error"
                          }`}
                        >
                          {status === "active" ? "Active" : status === "pending" ? "Invite pending" : "Deactivated"}
                        </span>
                      </div>
                      <p className="text-xs text-muted truncate">
                        {m.jobTitle ? `${m.jobTitle} · ` : ""}
                        {m.email}
                        {m.phone ? ` · ${m.phone}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => setViewingManagerId(m.id)}
                      className="text-xs font-semibold text-navy hover:underline cursor-pointer shrink-0"
                    >
                      View details
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {m.batchNames.length === 0 ? (
                      <span className="text-xs text-muted italic">No batches yet — they can create their own.</span>
                    ) : (
                      m.batchNames.map((b) => (
                        <span key={b} className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-navy/10 text-navy">
                          {b}
                        </span>
                      ))
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 border-y border-rule py-3">
                    <div>
                      <p className="font-display font-bold text-xl text-ink">{m.learnerCount ?? 0}</p>
                      <p className="text-[11px] text-muted">Learners</p>
                    </div>
                    <div>
                      <p className="font-display font-bold text-xl text-ink">{m.activeLearners7d ?? 0}</p>
                      <p className="text-[11px] text-muted">Practised this week</p>
                    </div>
                    <div>
                      {m.licensesAllotted == null ? (
                        <>
                          <p className="font-display font-bold text-xl text-muted">—</p>
                          <p className="text-[11px] text-muted">No license pool</p>
                        </>
                      ) : (
                        <>
                          <p className="font-display font-bold text-xl text-ink">
                            {left}
                            <span className="text-xs font-normal text-muted"> / {m.licensesAllotted} left</span>
                          </p>
                          <div className="h-1.5 rounded-full bg-rule overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${left === 0 ? "bg-error" : "bg-navy"}`}
                              style={{ width: `${m.licensesAllotted ? Math.min(100, (m.licensesUsed / m.licensesAllotted) * 100) : 0}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted">
                    <span>
                      {status === "pending" ? "Hasn't signed in yet" : `Last active ${relative(m.lastLoginAt)}`}
                      {" · "}Added {new Date(m.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      {m.invitedByName ? ` by ${m.invitedByName}` : ""}
                    </span>
                    {(m.pendingRequests ?? 0) > 0 && (
                      <Link to={ROUTES.ORG_ADMIN_LICENSES} className="font-semibold text-navy hover:underline">
                        {m.pendingRequests} license request{m.pendingRequests === 1 ? "" : "s"} waiting
                      </Link>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {status === "pending" && (
                      <ActionButton
                        icon={Mail}
                        label="Resend invite"
                        onClick={async () => {
                          try {
                            const r = await resendInvite("managers", m.id);
                            setJustInvited(`A new invite link was sent to ${r.email}.`);
                          } catch {
                            setError("Could not resend the invite.");
                          }
                        }}
                      />
                    )}
                    <ActionButton icon={Pencil} label="Edit" onClick={() => setEditingManager(m)} />
                    <ActionButton icon={Repeat} label="Hand over" title="Move their batches and pool to another Manager" onClick={() => setHandingOver(m)} />
                    {m.active && (
                      <ActionButton
                        icon={Eye}
                        label="View as"
                        title="See their console, read-only (recorded in the audit log)"
                        onClick={async () => {
                          try {
                            await viewAsManager(m.id);
                            window.location.assign("/manager/dashboard");
                          } catch {
                            setError("Couldn't open their console.");
                          }
                        }}
                      />
                    )}
                    <span className="flex-1" />
                    <ActionButton
                      icon={m.active ? Ban : RotateCcw}
                      label={m.active ? "Deactivate" : "Reactivate"}
                      tone={m.active ? "danger" : "success"}
                      disabled={busyId === m.id}
                      onClick={() => handleToggleActive(m)}
                    />
                    <ActionButton icon={Trash2} label="Delete" tone="danger" disabled={busyId === m.id} onClick={() => setDeletingManager(m)} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
      {handingOver && managers && (
        <ManagerHandoverModal
          from={handingOver}
          managers={managers}
          onClose={() => setHandingOver(null)}
          onDone={(msg) => {
            setHandingOver(null);
            setJustInvited(msg);
            load();
            refreshPlan();
          }}
        />
      )}
    </div>
  );
}
