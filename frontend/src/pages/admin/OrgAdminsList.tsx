import { useCallback, useEffect, useState } from "react";
import { Building2, ShieldCheck, UserPlus, Users, UserX, X } from "lucide-react";
import { getAdminConsoleOverview, getOrgAdmins, replaceOrgAdmin, type AdminConsoleOrg, type OrgAdminAccount } from "@/api/admin";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { TIER_LABELS } from "@/api/plans";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { ago, shortDate } from "@/api/staff";
import { EmptyNote, FilterPills, PageHeader, SearchBox, StatCard, StatusPill, paletteColor, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
type F = "all" | "active" | "pending" | "quiet" | "deactivated";
const status = (a: OrgAdminAccount): Exclude<F, "all" | "quiet"> => (!a.active ? "deactivated" : !a.hasLoggedIn ? "pending" : "active");
const quiet = (a: OrgAdminAccount) => a.active && a.hasLoggedIn && (!a.lastLoginAt || Date.now() - new Date(a.lastLoginAt).getTime() > 30 * 86400000);

const inputCls = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

// Invite an Org Admin for one of the viewer's organizations. An
// organization has one Org Admin, so this replaces the current one.
function AddOrgAdminModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [orgs, setOrgs] = useState<AdminConsoleOrg[] | null>(null);
  const [form, setForm] = useState({ tenantId: "", firstName: "", lastName: "", email: "", phone: "", jobTitle: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminConsoleOverview()
      .then((r) => {
        const active = r.organizations.filter((o) => o.active);
        // Organizations without an Org Admin first: they need one most.
        active.sort((a, b) => Number(a.hasOrgAdmin) - Number(b.hasOrgAdmin) || a.name.localeCompare(b.name));
        setOrgs(active);
        if (active[0]) setForm((f) => ({ ...f, tenantId: active[0].id }));
      })
      .catch(() => setError(tr("Could not load your organizations.")));
  }, []);

  const org = orgs?.find((o) => o.id === form.tenantId);
  const set = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    setError(null);
    try {
      await replaceOrgAdmin(org.id, {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone || undefined,
        jobTitle: form.jobTitle || undefined,
      });
      onDone(tr("Invite sent to {{email}}. They are now the Org Admin of {{name}}.", { email: form.email, name: org.name }));
    } catch (err) {
      setError(err instanceof ApiError && err.message === "email_already_registered" ? tr("That email already has a Spica account.") : tr("Could not add the Org Admin. Try again."));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Add Org Admin")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 px-6 py-5">
          {!orgs ? (
            <p className="text-sm text-muted">{error ?? tr("Loading organizations…")}</p>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted">{tr("You have no active organizations yet. Onboard one on the Organizations page first.")}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Organization")}</span>
                <select {...set("tenantId")} className={`${inputCls} cursor-pointer`}>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.hasOrgAdmin ? (o.orgAdmin?.name ? tr(" — current: {{name}}", { name: o.orgAdmin.name }) : tr(" — current: Org Admin")) : tr(" — no Org Admin")}
                    </option>
                  ))}
                </select>
              </label>
              {org?.hasOrgAdmin && (
                <p className="text-xs text-navy-deep bg-warning/15 border border-warning/30 rounded-input px-3 py-2">
                  {tr("{{name}} already has an Org Admin (", { name: org.name })}{org.orgAdmin?.name}, {org.orgAdmin?.email}{tr("). Adding a new one replaces them, and they lose access.")}</p>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                {(
                  [
                    ["firstName", tr("First name"), true],
                    ["lastName", tr("Last name"), true],
                    ["email", tr("Work email"), true],
                    ["phone", tr("Phone"), false],
                    ["jobTitle", tr("Job title"), false],
                  ] as const
                ).map(([k, label, required]) => (
                  <label key={k} className={`flex flex-col gap-1.5 ${k === "jobTitle" ? "sm:col-span-2" : ""}`}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {label}
                      {!required && <span className="normal-case font-normal"> {tr("(optional)")}</span>}
                    </span>
                    <input {...set(k)} required={required} type={k === "email" ? "email" : "text"} className={inputCls} />
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">{tr("They get an email to set their password and sign in to the Org Admin console.")}</p>
              {error && <p className="text-sm text-error">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  {tr("Cancel")}</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? tr("Sending…") : org?.hasOrgAdmin ? tr("Replace and send invite") : tr("Send invite")}
                </Button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

// The one Org Admin of each organization the viewer can see.
export function OrgAdminsList() {
  const perms = useStaffPermissions();
  const [rows, setRows] = useState<OrgAdminAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<F>("all");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    getOrgAdmins()
      .then((r) => setRows(r.orgAdmins))
      .catch(() => setError(tr("Could not load Org Admins.")));
  }, []);
  useEffect(load, [load]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!rows) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (a) =>
      (filter === "all" || (filter === "quiet" ? quiet(a) : status(a) === filter)) &&
      (!q || [a.firstName, a.lastName, a.email, a.tenantName, a.jobTitle, a.ownerName].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Org Admins")}
        subtitle={
          perms.isSuper
            ? tr("The main contact at each organization and university. They manage batches, Managers, learners and licenses.")
            : tr("The main contact at each of your organizations. They manage batches, Managers, learners and licenses.")
        }
        actions={
          perms.manageOrganizations && (
            <Button onClick={() => setAdding(true)} className="flex items-center gap-2 shrink-0">
              <UserPlus size={18} /> {tr("Add Org Admin")}</Button>
          )
        }
      />
      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="split" palette="moss" index={0} icon={ShieldCheck} value={rows.filter((a) => status(a) === "active").length} label={tr("Active Org Admins")} />
        <StatCard variant="split" palette="moss" index={1} icon={UserX} value={rows.filter((a) => status(a) === "pending").length} label={tr("Invite not accepted")} />
        <StatCard variant="split" palette="moss" index={2} icon={Building2} value={rows.filter(quiet).length} label={tr("Not signed in for 30+ days")} />
        <StatCard variant="split" palette="moss" index={3} icon={Users} value={rows.reduce((n, a) => n + a.learnerCount, 0)} label={tr("Learners in their organizations")} />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by name, email, organization or owner")} />
        <FilterPills<F>
          value={filter}
          onChange={setFilter}
          options={[
            ["all", tr("All"), rows.length],
            ["active", tr("Active"), rows.filter((a) => status(a) === "active").length],
            ["pending", tr("Invite pending"), rows.filter((a) => status(a) === "pending").length],
            ["quiet", tr("Quiet 30+ days"), rows.filter(quiet).length],
            ["deactivated", tr("Deactivated"), rows.filter((a) => status(a) === "deactivated").length],
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <EmptyNote>{tr("No Org Admins match.")}</EmptyNote>
      ) : (
        <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((a, i) => {
            const s = status(a);
            return (
              <div key={a.id} className={`bg-surface rounded-card border border-rule shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col ${a.active ? "" : "opacity-60"}`}>
                <div
                  style={{ background: `linear-gradient(120deg, ${paletteColor("moss", i)}, color-mix(in srgb, ${paletteColor("moss", i)} 65%, black))` }}
                  className="px-5 py-4 text-white flex items-start gap-3"
                >
                  <span className="h-11 w-11 rounded-full bg-white/25 flex items-center justify-center text-sm font-bold shrink-0">
                    {`${a.firstName?.[0] ?? ""}${a.lastName?.[0] ?? ""}`.toUpperCase() || a.email.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold truncate">{[a.firstName, a.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25 uppercase tracking-wide">
                        {s === "active" ? tr("Active") : s === "pending" ? tr("Invite pending") : tr("Deactivated")}
                      </span>
                    </div>
                    <p className="text-xs text-white/80 truncate">{a.tenantName}</p>
                  </div>
                  <button onClick={() => setViewing(a.id)} className="text-xs font-semibold hover:underline cursor-pointer shrink-0">
                    {tr("View details")}</button>
                </div>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <p className="text-xs text-muted truncate">
                    {a.jobTitle ? `${a.jobTitle} · ` : ""}
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPill tone="navy">{a.tenantCategory === "university" ? tr("University") : tr("Company")}</StatusPill>
                    {a.planTier && <StatusPill tone="success">{TIER_LABELS[a.planTier]}</StatusPill>}
                    {a.orgActive === false && <StatusPill tone="error">{tr("Organization deactivated")}</StatusPill>}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(
                      [
                        [a.learnerCount, tr("Learners")],
                        [a.managers.length, tr("Managers")],
                        [a.activeBatches ?? 0, tr("Active batches")],
                      ] as const
                    ).map(([v, l]) => (
                      <div key={l} className="rounded-input bg-paper-warm px-3 py-2">
                        <p className="font-display font-bold text-xl text-ink">{v}</p>
                        <p className="text-[11px] text-muted">{l}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted">
                    {s === "pending" ? tr("Hasn't signed in yet") : tr("Last signed in {{ago}}", { ago: ago(a.lastLoginAt) })} {tr("· Added {{shortDate}}", { shortDate: shortDate(a.createdAt) })}
                    {perms.isSuper && a.ownerName ? tr(" · Owner: {{ownerName}}", { ownerName: a.ownerName }) : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">{tr("To resend an invite, open the organization on the Organizations page.")}</p>
      {viewing && <OrgAdminDetailModal orgAdminId={viewing} onClose={() => setViewing(null)} />}
      {adding && (
        <AddOrgAdminModal
          onClose={() => setAdding(false)}
          onDone={(m) => {
            setAdding(false);
            setNotice(m);
            load();
          }}
        />
      )}
    </div>
  );
}
