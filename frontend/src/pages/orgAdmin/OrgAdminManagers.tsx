import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, X, Mail, Ban, RotateCcw, Trash2, Pencil, Repeat, Eye, ShieldCheck, Users, KeyRound, Inbox } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { cardGradient } from "@/lib/cardGradients";
import { OrgEmptyState, OrgLoadError, OrgLoading, OrgNotice, OrgSearch, OrgStatTile } from "@/components/OrgAdminUi";
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

import { tr } from "@/i18n/tr";
type ManagerStatus = "active" | "pending" | "deactivated";
const statusOf = (m: OrgManager): ManagerStatus => (!m.active ? "deactivated" : !m.hasLoggedIn ? "pending" : "active");

function relative(iso: string | null | undefined): string {
  if (!iso) return tr("never");
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? tr("just now") : tr("{{mins}} min ago", { mins: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return tr("{{hours}} h ago", { hours: hours });
  const days = Math.round(hours / 24);
  return days < 30 ? (days === 1 ? tr("1 day ago") : tr("{{n}} days ago", { n: days })) : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
  const color = tone === "danger" ? "hover:bg-black/25 hover:border-white/60" : tone === "success" ? "bg-white/20 hover:bg-white/30" : "hover:bg-white/20";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill border border-white/35 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 ${color}`}
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
  const [profile, setProfile] = useState({ phone: manager?.phone ?? "", jobTitle: manager?.jobTitle ?? "", department: manager?.department ?? "", city: manager?.city ?? "" });
  const pf = (k: keyof typeof profile) => ({ value: profile[k], onChange: (e: { target: { value: string } }) => setProfile((p) => ({ ...p, [k]: e.target.value })) });
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
      setError(tr("Only {{maxPool}} licenses can be set aside for this Manager right now.", { maxPool: maxPool }));
      return;
    }
    setError(null);
    setSubmitting(true);
    // Without pools on this plan, leave whatever is already set untouched.
    const licenseAllotment = poolsAllowed ? poolNumber : (manager?.licensesAllotted ?? null);
    try {
      if (editing) {
        await updateManager(manager.id, { firstName: firstName.trim(), lastName: lastName.trim(), batchIds, licenseAllotment, ...profile });
        onSaved(tr("{{name}} updated.", { name: `${firstName.trim()} ${lastName.trim()}`.trim() }));
      } else {
        await onboardManager({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), batchIds, licenseAllotment, ...profile });
        onSaved(tr("Invite sent to {{trim}} — they'll receive an email to set their password.", { trim: email.trim() }));
      }
    } catch (err) {
      if (planErrorMessage(err)) {
        setError(planErrorMessage(err));
      } else if (err instanceof ApiError && err.message === "email_already_registered") {
        setError(tr("That email is already registered."));
      } else if (err instanceof ApiError && LICENSE_ERROR_TEXT[err.message]) {
        setError(LICENSE_ERROR_TEXT[err.message]);
      } else {
        setError(editing ? tr("Something went wrong saving this manager.") : tr("Something went wrong onboarding that manager."));
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
          <h2 className="font-display font-bold text-lg text-ink">{editing ? tr("Edit Manager") : tr("Onboard Manager")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("First name")}</label>
              <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Last name")}</label>
              <input required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
              <Mail size={13} /> {tr("Email")}</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={editing}
              className={`${inputClass} ${editing ? "opacity-60 cursor-not-allowed" : ""}`}
            />
            {editing && <p className="text-xs text-muted">{tr("Email is their login, so it can't be changed here.")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Job title")}</label>
              <input {...pf("jobTitle")} placeholder={tr("e.g. Training Lead")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Department")}</label>
              <input {...pf("department")} placeholder={tr("e.g. Customer Support")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Phone")}</label>
              <input {...pf("phone")} placeholder={tr("e.g. +91 98765 43210")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("City")}</label>
              <input {...pf("city")} placeholder={tr("e.g. Pune")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("License pool for this Manager")}</label>
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
                {editing && poolUsed ? tr("{{poolUsed}} already assigned from it · ", { poolUsed: poolUsed }) : ""}
                {maxPool !== null ? tr("up to {{maxPool}} available to set aside", { maxPool: maxPool }) : ""}
              </span>
            </div>
            <p className="text-xs text-muted">
              {tr("Set aside from your pool for this Manager to use in any of their batches, including batches they create themselves. They can't change it — they send you a request.")}</p>
            </>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Batches they manage")}</label>
            {batches.length === 0 ? (
              <p className="text-sm text-muted">{tr("No batches yet — the Manager can create their own.")}</p>
            ) : (
              <div className="border border-rule rounded-input overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-paper-warm/60 border-b border-rule text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">{tr("Batch")}</th>
                      <th className="px-3 py-2 text-right">{tr("Fixed batch licenses")}</th>
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
                            {others.length > 0 && <p className="text-[11px] text-muted ml-6 truncate">{tr("also managed by {{join}}", { join: others.join(", ") })}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-muted">
                            {fixed?.budget != null ? tr("{{used}} / {{budget}} used", { used: fixed.used, budget: fixed.budget }) : tr("None — uses Manager's pool")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted">{tr("Fixed batch licenses are set when you create a batch (or in Licenses → Allotments) and are used first for that batch's learners.")}</p>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}
          {!editing && <p className="text-xs text-muted">{tr("They'll get an email to set their own password.")}</p>}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? (editing ? tr("Saving…") : tr("Sending invite…")) : editing ? tr("Save changes") : tr("Send invite")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
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
    setError(null);
    getManagers()
      .then((res) => setManagers(res.managers))
      .catch(() => setError(tr("Could not load managers.")));
    getBatches()
      .then((res) => setBatches(res.batches))
      .catch(() => {});
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
      if (r.releasedLicenses) setJustInvited(r.releasedLicenses === 1 ? tr("1 unused license from their pool went back to yours.") : tr("{{n}} unused licenses from their pool went back to yours.", { n: r.releasedLicenses }));
      load();
      refreshPlan();
    } catch {
      setError(tr("Could not delete that manager."));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleActive(manager: OrgManager) {
    setBusyId(manager.id);
    try {
      if (manager.active) {
        const r = await deactivateManager(manager.id);
        if (r.releasedLicenses) setJustInvited(r.releasedLicenses === 1 ? tr("1 unused license from their pool went back to yours.") : tr("{{n}} unused licenses from their pool went back to yours.", { n: r.releasedLicenses }));
      } else await reactivateManager(manager.id);
      load();
      refreshPlan();
    } catch (err) {
      setError(planErrorMessage(err) ?? tr("Could not update that manager's status."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Managers")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Each one scoped to only the batch(es) you assign them.")}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
            <UserPlus size={18} /> {tr("Onboard Manager")}</Button>
          <PlanLimitHint limit="managers" />
        </div>
      </div>

      {justInvited && (
        <OrgNotice tone="success" onClose={() => setJustInvited(null)}>
          {justInvited}
        </OrgNotice>
      )}

      {error && (managers ? <OrgNotice tone="error" onClose={() => setError(null)}>{error}</OrgNotice> : <OrgLoadError text={error} onRetry={load} />)}
      {!managers && !error && <OrgLoading />}
      {managers?.length === 0 && (
        <OrgEmptyState
          icon={ShieldCheck}
          title={tr("No managers yet.")}
          text={tr("Each one scoped to only the batch(es) you assign them.")}
          action={
            <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2">
              <UserPlus size={16} /> {tr("Onboard Manager")}
            </Button>
          }
        />
      )}

      {managers && managers.length > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OrgStatTile index={0} icon={ShieldCheck} value={counts.active} label={counts.active === 1 ? tr("Active manager") : tr("Active managers")} />
            <OrgStatTile index={1} icon={Users} value={counts.learners} label={tr("Learners in their batches")} to={ROUTES.ORG_ADMIN_LEARNERS} />
            <OrgStatTile
              index={2}
              icon={KeyRound}
              value={counts.allotted ? `${counts.used} / ${counts.allotted}` : "—"}
              label={counts.allotted ? tr("Pool licenses used · {{v}} left", { v: counts.allotted - counts.used }) : tr("No manager pools yet")}
            />
            <OrgStatTile
              index={3}
              icon={Inbox}
              value={counts.requests}
              label={counts.requests === 1 ? tr("Pending license request") : tr("Pending license requests")}
              to={`${ROUTES.ORG_ADMIN_LICENSES}?tab=requests`}
            />
          </div>

          {(counts.pending > 0 || counts.requests > 0) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {counts.pending > 0 && (
                <span className="bg-warning/15 text-navy-deep border border-warning/30 rounded-pill px-3 py-1">
                  {counts.pending === 1 ? tr("1 invite not accepted yet") : tr("{{n}} invites not accepted yet", { n: counts.pending })}</span>
              )}
              {counts.requests > 0 && (
                <Link to={`${ROUTES.ORG_ADMIN_LICENSES}?tab=requests`} className="bg-navy/10 text-navy rounded-pill px-3 py-1 font-semibold hover:underline">
                  {counts.requests === 1 ? tr("Review 1 license request") : tr("Review {{n}} license requests", { n: counts.requests })} →
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <OrgSearch value={query} onChange={setQuery} placeholder={tr("Search by name, email, job title or batch")} className="flex-1 min-w-56 max-w-md" />
            <div className="flex items-center gap-1 bg-surface border border-rule rounded-pill p-1 max-w-full overflow-x-auto">
              {(
                [
                  ["all", tr("All"), managers.length],
                  ["active", tr("Active"), counts.active],
                  ["pending", tr("Invite pending"), counts.pending],
                  ["deactivated", tr("Deactivated"), counts.deactivated],
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

          {shown.length === 0 && (
            <p className="text-sm text-muted bg-surface border border-dashed border-rule-strong rounded-card px-5 py-8 text-center">{tr("No managers match.")}</p>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {shown.map((m, i) => {
              const status = statusOf(m);
              const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || tr("Not named yet");
              const left = m.licensesAllotted != null ? Math.max(0, m.licensesAllotted - m.licensesUsed) : null;
              return (
                <div
                  key={m.id}
                  style={cardGradient(i)}
                  className={`rounded-card shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow text-white ${
                    status === "deactivated" ? "opacity-60 grayscale-[40%]" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="h-11 w-11 rounded-full bg-white/25 text-white flex items-center justify-center text-sm font-bold shrink-0">
                      {initials(m.firstName, m.lastName, m.email)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-bold text-white truncate">{name}</p>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 text-white uppercase tracking-wide">
                          {status === "active" ? tr("Active") : status === "pending" ? tr("Invite pending") : tr("Deactivated")}
                        </span>
                      </div>
                      <p className="text-xs text-white/75 truncate">
                        {m.jobTitle ? `${m.jobTitle} · ` : ""}
                        {m.email}
                        {m.phone ? ` · ${m.phone}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => setViewingManagerId(m.id)}
                      className="text-xs font-semibold text-white underline-offset-2 hover:underline cursor-pointer shrink-0"
                    >
                      {tr("View details")}</button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {m.batchNames.length === 0 ? (
                      <span className="text-xs text-white/75 italic">{tr("No batches yet — they can create their own.")}</span>
                    ) : (
                      m.batchNames.map((b) => (
                        <span key={b} className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-white/20 text-white">
                          {b}
                        </span>
                      ))
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 bg-black/10 rounded-input px-3.5 py-3">
                    <div>
                      <p className="font-display font-bold text-xl text-white">{m.learnerCount ?? 0}</p>
                      <p className="text-[11px] text-white/75">{tr("Learners")}</p>
                    </div>
                    <div>
                      <p className="font-display font-bold text-xl text-white">{m.activeLearners7d ?? 0}</p>
                      <p className="text-[11px] text-white/75">{tr("Practised this week")}</p>
                    </div>
                    <div>
                      {m.licensesAllotted == null ? (
                        <>
                          <p className="font-display font-bold text-xl text-white/60">—</p>
                          <p className="text-[11px] text-white/75">{tr("No license pool")}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-display font-bold text-xl text-white">
                            {left}
                            <span className="text-xs font-normal text-white/75"> / {tr("{{licensesAllotted}} left", { licensesAllotted: m.licensesAllotted })}</span>
                          </p>
                          <div className="h-1.5 rounded-full bg-white/25 overflow-hidden mt-1">
                            <div
                              className={`h-full rounded-full ${left === 0 ? "bg-white/60" : "bg-white"}`}
                              style={{ width: `${m.licensesAllotted ? Math.min(100, (m.licensesUsed / m.licensesAllotted) * 100) : 0}%` }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-white/80">
                    <span>
                      {status === "pending" ? tr("Hasn't signed in yet") : tr("Last active {{relative}}", { relative: relative(m.lastLoginAt) })}
                      {" · "}{tr("Added")}{" "}{new Date(m.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      {m.invitedByName ? tr(" by {{name}}", { name: m.invitedByName }) : ""}
                    </span>
                    {(m.pendingRequests ?? 0) > 0 && (
                      <Link to={`${ROUTES.ORG_ADMIN_LICENSES}?tab=requests`} className="font-semibold text-white bg-white/20 rounded-pill px-2.5 py-0.5 hover:bg-white/30">
                        {m.pendingRequests === 1 ? tr("1 license request waiting") : tr("{{n}} license requests waiting", { n: m.pendingRequests })}</Link>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {status === "pending" && (
                      <ActionButton
                        icon={Mail}
                        label={tr("Resend invite")}
                        onClick={async () => {
                          try {
                            const r = await resendInvite("managers", m.id);
                            setJustInvited(tr("A new invite link was sent to {{email}}.", { email: r.email }));
                          } catch {
                            setError(tr("Could not resend the invite."));
                          }
                        }}
                      />
                    )}
                    <ActionButton icon={Pencil} label={tr("Edit")} onClick={() => setEditingManager(m)} />
                    <ActionButton icon={Repeat} label={tr("Hand over")} title={tr("Move their batches and pool to another Manager")} onClick={() => setHandingOver(m)} />
                    {m.active && (
                      <ActionButton
                        icon={Eye}
                        label={tr("View as")}
                        title={tr("See their console, read-only (recorded in the audit log)")}
                        onClick={async () => {
                          try {
                            await viewAsManager(m.id);
                            window.location.assign("/manager/dashboard");
                          } catch {
                            setError(tr("Couldn't open their console."));
                          }
                        }}
                      />
                    )}
                    <span className="flex-1" />
                    <ActionButton
                      icon={m.active ? Ban : RotateCcw}
                      label={m.active ? tr("Deactivate") : tr("Reactivate")}
                      tone={m.active ? "danger" : "success"}
                      disabled={busyId === m.id}
                      onClick={() => handleToggleActive(m)}
                    />
                    <ActionButton icon={Trash2} label={tr("Delete")} tone="danger" disabled={busyId === m.id} onClick={() => setDeletingManager(m)} />
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
          title={tr("Delete manager")}
          message={tr("Delete {{v}}? They lose access immediately and their batch assignments are removed. This cannot be undone.", { v: [deletingManager.firstName, deletingManager.lastName].filter(Boolean).join(" ") || deletingManager.email })}
          confirmLabel={tr("Delete")}
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
