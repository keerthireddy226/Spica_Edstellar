import { useEffect, useState, type FormEvent } from "react";
import { TIER_LABELS } from "@/api/plans";
import { Building2, GraduationCap, Users, Mail, UserPlus, X, Briefcase, Pencil, Ban, RotateCcw, KeyRound } from "lucide-react";
import { EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, useStaffPermissions } from "@/components/staff/StaffKit";
import { ago, getOrgMetrics, getStaffAdmins, setOrgOwner, shortDate, type OrgMetrics } from "@/api/staff";
import { cardGradient } from "@/lib/cardGradients";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { OrganizationDetailModal } from "@/components/OrganizationDetailModal";
import { sortedCountries } from "@/constants/demographics";
import {
  getAdminConsoleOverview,
  onboardOrganization,
  editOrganization,
  deactivateOrganization,
  reactivateOrganization,
  type AdminConsoleOverview,
  type AdminConsoleOrg,
  type OnboardOrgPayload,
  type EditOrgPayload,
} from "@/api/admin";

function OnboardOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<"company" | "university">("company");
  const [industry, setIndustry] = useState("");
  const [expectedLearnerCount, setExpectedLearnerCount] = useState("");
  const [country, setCountry] = useState("");
  const [billingContactName, setBillingContactName] = useState("");
  const [billingContactEmail, setBillingContactEmail] = useState("");
  const [taxId, setTaxId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: OnboardOrgPayload = {
        name: name.trim(),
        category,
        industry: industry.trim() || undefined,
        expectedLearnerCount: expectedLearnerCount.trim() ? Number(expectedLearnerCount.trim()) : undefined,
        country: country || undefined,
        billingContactName: billingContactName.trim() || undefined,
        billingContactEmail: billingContactEmail.trim() || undefined,
        taxId: taxId.trim() || undefined,
        orgAdmin: {
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
        },
      };
      await onboardOrganization(payload);
      onCreated(payload.name);
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That org admin email is already registered.");
      } else {
        setError("Something went wrong onboarding that organization.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Onboard Organization</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Organization name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp, Anna University"
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Type</label>
            <div className="grid grid-cols-2 gap-3">
              {(["company", "university"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`flex items-center gap-2.5 rounded-input border px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                    category === c ? "border-accent bg-accent/10 text-accent" : "border-rule text-muted hover:border-rule-strong"
                  }`}
                >
                  {c === "company" ? <Briefcase size={16} /> : <GraduationCap size={16} />}
                  {c === "company" ? "Organization" : "University"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Industry (optional)</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. IT services, Higher education"
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Expected learners (optional)</label>
              <input
                type="number"
                min={1}
                value={expectedLearnerCount}
                onChange={(e) => setExpectedLearnerCount(e.target.value)}
                placeholder="e.g. 50"
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Country</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                <option value="">Select…</option>
                {sortedCountries("en").map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Tax ID — GST / VAT (optional)</label>
              <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">Billing contact (optional)</p>
            <p className="text-xs text-muted">Who receives license invoices. Leave blank if it's the Org Admin.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Name</label>
              <input value={billingContactName} onChange={(e) => setBillingContactName(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Email</label>
              <input type="email" value={billingContactEmail} onChange={(e) => setBillingContactEmail(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">Org Admin contact</p>
            <p className="text-xs text-muted">The real contact person at this organization. They'll get an invite to set their own password.</p>
          </div>

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

          <div className="grid grid-cols-2 gap-3">
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
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Creating…" : "Create & send invite"}
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

function EditOrgModal({
  org,
  onClose,
  onSaved,
}: {
  org: AdminConsoleOrg;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [category, setCategory] = useState<"company" | "university">(org.category === "university" ? "university" : "company");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: EditOrgPayload = { name: name.trim(), category };
      await editOrganization(org.id, payload);
      onSaved();
    } catch {
      setError("Something went wrong saving those changes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Edit organization</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Organization name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Type</label>
            <div className="grid grid-cols-2 gap-3">
              {(["company", "university"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`flex items-center gap-2.5 rounded-input border px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                    category === c ? "border-accent bg-accent/10 text-accent" : "border-rule text-muted hover:border-rule-strong"
                  }`}
                >
                  {c === "company" ? <Briefcase size={16} /> : <GraduationCap size={16} />}
                  {c === "company" ? "Organization" : "University"}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Saving…" : "Save changes"}
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

function DeactivateOrgModal({
  org,
  onClose,
  onConfirm,
  submitting,
}: {
  org: AdminConsoleOrg;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Deactivate organization</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5">
          <p className="text-sm text-ink">
            Deactivate <span className="font-semibold">{org.name}</span>? Its Org Admin and Managers lose access immediately.
          </p>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={onConfirm} disabled={submitting} className="flex-1 !bg-error hover:!bg-error/90">
              {submitting ? "Deactivating…" : "Deactivate"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnerModal({ org, current, onClose, onSaved }: { org: AdminConsoleOrg; current: string | null; onClose: () => void; onSaved: () => void }) {
  const [admins, setAdmins] = useState<{ id: string; name: string; email: string }[]>([]);
  const [adminId, setAdminId] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getStaffAdmins()
      .then((r) => setAdmins(r.admins))
      .catch(() => {});
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-ink">Owning Admin · {org.name}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-muted">The owning Admin sees and manages this organization in their console.</p>
        <select value={adminId} onChange={(e) => setAdminId(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink cursor-pointer">
          <option value="">Choose an Admin</option>
          {admins.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.email})
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex gap-3">
          <Button
            disabled={!adminId || saving || adminId === current}
            className="flex-1"
            onClick={async () => {
              setSaving(true);
              try {
                await setOrgOwner(org.id, adminId);
                onSaved();
              } catch {
                setError("Couldn't change the owner.");
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

type OrgFilter = "active" | "pilot" | "at_risk" | "invite" | "deactivated" | "all";

export function AdminOrganizations() {
  const perms = useStaffPermissions();
  const canManage = !perms.isSuper && perms.manageOrganizations;
  const [overview, setOverview] = useState<AdminConsoleOverview | null>(null);
  const [metrics, setMetrics] = useState<Map<string, OrgMetrics>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminConsoleOrg | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<AdminConsoleOrg | null>(null);
  const [viewingOrg, setViewingOrg] = useState<AdminConsoleOrg | null>(null);
  const [owning, setOwning] = useState<AdminConsoleOrg | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OrgFilter>("active");
  const [type, setType] = useState("all");
  const [tier, setTier] = useState("all");
  const [owner, setOwner] = useState("all");

  function load() {
    getAdminConsoleOverview()
      .then(setOverview)
      .catch(() => setError("Could not load organizations."));
    getOrgMetrics()
      .then((r) => setMetrics(new Map(r.metrics.map((m) => [m.id, m]))))
      .catch(() => {});
  }
  useEffect(load, []);

  async function handleDeactivate(org: AdminConsoleOrg) {
    setBusyId(org.id);
    try {
      await deactivateOrganization(org.id);
      setConfirmingDeactivate(null);
      load();
    } catch {
      setError("Could not deactivate that organization.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReactivate(org: AdminConsoleOrg) {
    setBusyId(org.id);
    try {
      await reactivateOrganization(org.id);
      load();
    } catch {
      setError("Could not reactivate that organization.");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Loading…</p>;

  const orgs = overview.organizations;
  const active = orgs.filter((o) => o.active);
  const m = (id: string) => metrics.get(id);
  const sum = (f: (x: OrgMetrics) => number) => active.reduce((n, o) => n + (m(o.id) ? f(m(o.id)!) : 0), 0);
  const isPilot = (o: AdminConsoleOrg) => !!o.pilotEndsAt && new Date(o.pilotEndsAt).getTime() > Date.now();
  const matches: Record<OrgFilter, (o: AdminConsoleOrg) => boolean> = {
    active: (o) => o.active,
    pilot: (o) => o.active && isPilot(o),
    at_risk: (o) => o.active && o.health?.band === "at_risk",
    invite: (o) => o.active && o.orgAdminStatus !== "active",
    deactivated: (o) => !o.active,
    all: () => true,
  };
  const owners = [...new Map([...metrics.values()].filter((x) => x.owner).map((x) => [x.owner!.id, x.owner!.name])).entries()];
  const q = query.trim().toLowerCase();
  const shown = orgs.filter(
    (o) =>
      matches[filter](o) &&
      (type === "all" || (type === "university" ? o.category === "university" : o.category !== "university")) &&
      (tier === "all" || o.planTier === tier) &&
      (owner === "all" || m(o.id)?.owner?.id === owner) &&
      (!q || [o.name, o.orgAdmin?.name, o.orgAdmin?.email, o.industry, m(o.id)?.owner?.name].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Organizations"
        subtitle={perms.isSuper ? "Every organization and university on Spica, and the Admin who owns each." : "The organizations and universities you look after."}
        actions={
          canManage && (
            <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
              <UserPlus size={18} /> Onboard Organization
            </Button>
          )
        }
      />

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          index={0}
          icon={Building2}
          value={active.length}
          label="Active organizations"
          sub={`${active.filter((o) => o.category !== "university").length} companies · ${active.filter((o) => o.category === "university").length} universities`}
        />
        <StatCard index={1} icon={Users} value={overview.totalLearners} label="Learners" sub={`${sum((x) => x.active7)} practised this week`} />
        <StatCard
          index={2}
          icon={KeyRound}
          value={`${sum((x) => x.licensesAssigned)} / ${sum((x) => x.licensesBought)}`}
          label="Licenses assigned / bought"
        />
        <StatCard
          index={3}
          icon={Mail}
          value={active.filter((o) => o.health?.band === "at_risk").length}
          label="At risk"
          sub={`${active.filter((o) => o.orgAdminStatus !== "active").length} Org Admin invites open · ${sum((x) => x.unpaidInvoices)} unpaid invoices`}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, Org Admin, industry or owner" />
        <SelectFilter label="Type" value={type} onChange={setType} options={[["all", "All types"], ["company", "Companies"], ["university", "Universities"]]} />
        <SelectFilter
          label="Plan"
          value={tier}
          onChange={setTier}
          options={[["all", "All plans"], ...(Object.entries(TIER_LABELS) as [string, string][])]}
        />
        {perms.isSuper && <SelectFilter label="Owner" value={owner} onChange={setOwner} options={[["all", "All Admins"], ...owners]} />}
      </div>
      <FilterPills<OrgFilter>
        value={filter}
        onChange={setFilter}
        options={[
          ["active", "Active", active.length],
          ["pilot", "On pilot", orgs.filter(matches.pilot).length],
          ["at_risk", "At risk", orgs.filter(matches.at_risk).length],
          ["invite", "Org Admin not active", orgs.filter(matches.invite).length],
          ["deactivated", "Deactivated", orgs.filter(matches.deactivated).length],
          ["all", "All", orgs.length],
        ]}
      />

      {orgs.length === 0 && <EmptyNote>{canManage ? "No organizations yet — onboard your first one." : "No organizations yet."}</EmptyNote>}
      {orgs.length > 0 && shown.length === 0 && <EmptyNote>No organizations match.</EmptyNote>}

      <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {shown.map((org, i) => {
          const x = m(org.id);
          const util = x && x.licensesBought ? Math.min(100, (x.licensesAssigned / x.licensesBought) * 100) : 0;
          return (
            <div key={org.id} style={cardGradient(i)} className={`rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-4 text-white ${org.active ? "" : "opacity-60"}`}>
              <div className="flex items-start gap-3">
                <span className="h-11 w-11 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                  {org.category === "university" ? <GraduationCap size={20} /> : <Briefcase size={20} />}
                </span>
                <div className="flex-1 min-w-0">
                  <button onClick={() => setViewingOrg(org)} className="font-display font-bold text-lg text-white truncate hover:underline cursor-pointer text-left block max-w-full">
                    {org.name}
                  </button>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25">{TIER_LABELS[org.planTier]}</span>
                    {isPilot(org) && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25">Pilot to {shortDate(org.pilotEndsAt)}</span>}
                    {org.health && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-black/15" title={org.health.flags.join("\n")}>
                        Health {org.health.score} · {org.health.band === "at_risk" ? "At risk" : org.health.band === "watch" ? "Watch" : "Healthy"}
                      </span>
                    )}
                    {!org.active && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-black/25 uppercase">Deactivated</span>}
                  </div>
                </div>
              </div>

              <div className="text-xs text-white/85">
                Org Admin:{" "}
                {org.orgAdmin ? (
                  <>
                    <span className="font-semibold text-white">{org.orgAdmin.name || org.orgAdmin.email}</span>
                    {org.orgAdminStatus === "pending" ? " · invite not accepted" : ""}
                  </>
                ) : (
                  <span className="font-semibold">none yet</span>
                )}
                {org.industry ? ` · ${org.industry}` : ""}
              </div>

              <div className="grid grid-cols-3 gap-3 bg-black/10 rounded-input px-3.5 py-3">
                <div>
                  <p className="font-display font-bold text-xl">{org.learnerCount}</p>
                  <p className="text-[11px] text-white/75">Learners · {x?.active7 ?? 0} active</p>
                </div>
                <div>
                  <p className="font-display font-bold text-xl">
                    {x?.activeBatches ?? 0}
                    <span className="text-xs font-normal text-white/75"> / {x?.managers ?? org.managers.length}</span>
                  </p>
                  <p className="text-[11px] text-white/75">Batches / Managers</p>
                </div>
                <div>
                  <p className="font-display font-bold text-xl">
                    {x?.licensesAssigned ?? 0}
                    <span className="text-xs font-normal text-white/75"> / {x?.licensesBought ?? 0}</span>
                  </p>
                  <div className="h-1.5 rounded-full bg-white/25 overflow-hidden mt-1">
                    <div className="h-full bg-white rounded-full" style={{ width: `${util}%` }} />
                  </div>
                </div>
              </div>

              <p className="text-xs text-white/80">
                {x?.contractEnd ? `Contract to ${shortDate(x.contractEnd)}` : "No contract dates"}
                {x?.unpaidInvoices ? ` · ${x.unpaidInvoices} unpaid invoice${x.unpaidInvoices === 1 ? "" : "s"}` : ""}
                {` · Last activity ${ago(x?.lastActivityAt)}`}
                {perms.isSuper ? ` · Owner: ${x?.owner?.name ?? "none"}` : ""}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <CardButton onClick={() => setViewingOrg(org)}>View details</CardButton>
                {perms.isSuper && <CardButton onClick={() => setOwning(org)}>Change owner</CardButton>}
                {canManage && org.active && (
                  <>
                    <CardButton onClick={() => setEditing(org)}>
                      <Pencil size={13} /> Edit
                    </CardButton>
                    <span className="flex-1" />
                    <CardButton onClick={() => setConfirmingDeactivate(org)} disabled={busyId === org.id}>
                      <Ban size={13} /> Deactivate
                    </CardButton>
                  </>
                )}
                {canManage && !org.active && (
                  <CardButton onClick={() => handleReactivate(org)} disabled={busyId === org.id}>
                    <RotateCcw size={13} /> {busyId === org.id ? "Activating…" : "Reactivate"}
                  </CardButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showOnboard && (
        <OnboardOrgModal
          onClose={() => setShowOnboard(false)}
          onCreated={(name) => {
            setShowOnboard(false);
            setNotice(`${name} created — their Org Admin will receive an email to set up their account.`);
            load();
          }}
        />
      )}

      {editing && (
        <EditOrgModal
          org={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmingDeactivate && (
        <DeactivateOrgModal
          org={confirmingDeactivate}
          onClose={() => setConfirmingDeactivate(null)}
          onConfirm={() => handleDeactivate(confirmingDeactivate)}
          submitting={busyId === confirmingDeactivate.id}
        />
      )}

      {owning && (
        <OwnerModal
          org={owning}
          current={m(owning.id)?.owner?.id ?? null}
          onClose={() => setOwning(null)}
          onSaved={() => {
            setNotice(`${owning.name} now belongs to its new Admin.`);
            setOwning(null);
            load();
          }}
        />
      )}

      {viewingOrg && (
        <OrganizationDetailModal
          org={viewingOrg}
          onClose={() => setViewingOrg(null)}
          onChanged={() =>
            getAdminConsoleOverview()
              .then((o) => {
                setOverview(o);
                setViewingOrg(o.organizations.find((y) => y.id === viewingOrg.id) ?? null);
              })
              .catch(() => {})
          }
        />
      )}
    </div>
  );
}

function CardButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill border border-white/35 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer disabled:opacity-50"
    >
      {children}
    </button>
  );
}
