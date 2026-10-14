import { useEffect, useState, type FormEvent } from "react";
import { TIER_LABELS } from "@/api/plans";
import { Building2, GraduationCap, Users, Mail, UserPlus, X, Briefcase, Pencil, Ban, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
      </div>
    </div>
  );
}

export function AdminOrganizations() {
  const [overview, setOverview] = useState<AdminConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminConsoleOrg | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<AdminConsoleOrg | null>(null);
  const [viewingOrg, setViewingOrg] = useState<AdminConsoleOrg | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    getAdminConsoleOverview()
      .then(setOverview)
      .catch(() => setError("Could not load organizations."));
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

  useEffect(() => {
    if (!justCreated) return;
    const timer = setTimeout(() => setJustCreated(null), 5000);
    return () => clearTimeout(timer);
  }, [justCreated]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Loading…</p>;

  const universityCount = overview.organizations.filter((o) => o.category === "university").length;
  const organizationCount = overview.organizations.filter((o) => o.category !== "university").length;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Organizations</h1>
          <p className="text-sm text-muted mt-1">The organizations and universities you work with.</p>
        </div>
        <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
          <UserPlus size={18} /> Onboard Organization
        </Button>
      </div>

      {justCreated && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          {justCreated} created — their org admin will receive an email to set up their account.
        </p>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Organizations" value={organizationCount} icon={Building2} index={0} />
        <StatCard label="Universities" value={universityCount} icon={GraduationCap} index={1} />
        <StatCard label="Learners across orgs" value={overview.totalLearners} icon={Users} index={2} />
      </div>


      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Learners</th>
              <th className="px-4 py-3">Org Admin assigned</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {overview.organizations.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted">
                  No organizations yet.
                </td>
              </tr>
            )}
            {overview.organizations.map((org) => (
              <tr key={org.id} className="border-b border-rule last:border-0">
                <td className="px-4 py-3">
                  <button
                    onClick={() => setViewingOrg(org)}
                    title="View details"
                    className="flex items-center gap-2.5 text-ink font-medium hover:text-navy transition-colors cursor-pointer"
                  >
                    <span className="h-8 w-8 rounded-full bg-navy text-lime flex items-center justify-center shrink-0 hover:ring-2 hover:ring-navy/40 transition-shadow">
                      {org.category === "university" ? <GraduationCap size={15} /> : <Briefcase size={15} />}
                    </span>
                    {org.name}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-pill bg-accent/10 text-accent capitalize">
                    {org.category === "university" ? <GraduationCap size={13} /> : <Briefcase size={13} />}
                    {org.category === "university" ? "University" : "Organization"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-navy/10 text-navy">{TIER_LABELS[org.planTier]}</span>
                  {org.pilotEndsAt && <span className="ml-1.5 text-xs font-semibold px-2 py-0.5 rounded-pill bg-warning/15 text-navy-deep">Pilot</span>}
                </td>
                <td className="px-4 py-3 text-muted">{org.learnerCount}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                      org.orgAdminStatus === "active"
                        ? "bg-success/15 text-success"
                        : org.orgAdminStatus === "pending"
                          ? "bg-warning/15 text-navy-deep"
                          : "bg-warning/15 text-warning"
                    }`}
                  >
                    {org.orgAdminStatus === "active" ? "Active" : org.orgAdminStatus === "pending" ? "Invite pending" : "Not yet"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${org.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                    {org.active ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {org.active ? (
                      <>
                        <button
                          onClick={() => setEditing(org)}
                          title="Edit"
                          className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => setConfirmingDeactivate(org)}
                          disabled={busyId === org.id}
                          title="Deactivate"
                          className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Ban size={16} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleReactivate(org)}
                        disabled={busyId === org.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold bg-success/10 text-success hover:bg-success/20 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                        {busyId === org.id ? "Activating…" : "Activate"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showOnboard && (
        <OnboardOrgModal
          onClose={() => setShowOnboard(false)}
          onCreated={(name) => {
            setShowOnboard(false);
            setJustCreated(name);
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

      {viewingOrg && (
        <OrganizationDetailModal
          org={viewingOrg}
          onClose={() => setViewingOrg(null)}
          onChanged={() =>
            getAdminConsoleOverview()
              .then((o) => {
                setOverview(o);
                setViewingOrg(o.organizations.find((x) => x.id === viewingOrg.id) ?? null);
              })
              .catch(() => {})
          }
        />
      )}
    </div>
  );
}
