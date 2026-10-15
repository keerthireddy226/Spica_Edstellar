import { useEffect, useState, type FormEvent } from "react";
import { TIER_LABELS } from "@/api/plans";
import { Building2, GraduationCap, Users, Mail, UserPlus, X, Briefcase, Pencil, Ban, RotateCcw, KeyRound } from "lucide-react";
import { EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, paletteColor, useStaffPermissions } from "@/components/staff/StaffKit";
import { ago, getOrgMetrics, getStaffAdmins, setOrgOwner, shortDate, type OrgMetrics } from "@/api/staff";
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

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
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
  const [x, setX] = useState<Record<string, string>>({ planTier: "business", contractCurrency: "USD" });
  // What the organization buys: employee skills, recruitment, or both.
  const [products, setProducts] = useState<("skills" | "recruitment")[]>(["skills"]);
  const [initialCredits, setInitialCredits] = useState("");
  const isSuper = useStaffPermissions().isSuper;
  const [admins, setAdmins] = useState<{ id: string; name: string; email: string }[]>([]);
  useEffect(() => {
    if (isSuper) getStaffAdmins().then((r) => setAdmins(r.admins)).catch(() => {});
  }, [isSuper]);
  const f = (k: string) => ({ value: x[k] ?? "", onChange: (e: { target: { value: string } }) => setX((p) => ({ ...p, [k]: e.target.value })) });
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
        legalName: x.legalName?.trim() || undefined,
        website: x.website?.trim() || undefined,
        phone: x.phone?.trim() || undefined,
        addressLine: x.addressLine?.trim() || undefined,
        city: x.city?.trim() || undefined,
        state: x.state?.trim() || undefined,
        postalCode: x.postalCode?.trim() || undefined,
        employeeCountBand: (x.employeeCountBand || undefined) as OnboardOrgPayload["employeeCountBand"],
        trainingGoal: x.trainingGoal?.trim() || undefined,
        billingContactPhone: x.billingContactPhone?.trim() || undefined,
        purchaseOrderRef: x.purchaseOrderRef?.trim() || undefined,
        planTier: (x.planTier || undefined) as OnboardOrgPayload["planTier"],
        products,
        initialCredits: products.includes("recruitment") && initialCredits.trim() ? Number(initialCredits.trim()) : undefined,
        contractStart: x.contractStart || undefined,
        contractEnd: x.contractEnd || undefined,
        contractValue: x.contractValue ? Number(x.contractValue) : undefined,
        contractCurrency: x.contractCurrency || undefined,
        ownerId: x.ownerId || undefined,
        orgAdmin: {
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          jobTitle: x.orgAdminJobTitle?.trim() || undefined,
        },
      };
      await onboardOrganization(payload);
      onCreated(payload.name);
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError(tr("That org admin email is already registered."));
      } else {
        setError(tr("Something went wrong onboarding that organization."));
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
          <h2 className="font-display font-bold text-lg text-ink">{tr("Onboard Organization")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          {isSuper && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Owning Admin")}</label>
              <select {...f("ownerId")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                <option value="">{tr("Me (Super Admin) — assign later")}</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted">{tr("The Admin who will look after this organization in their console.")}</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Organization name")}</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr("e.g. Acme Corp, Anna University")}
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Type")}</label>
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
                  {c === "company" ? tr("Organization") : tr("University")}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Industry (optional)")}</label>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder={tr("e.g. IT services, Higher education")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Expected learners (optional)")}</label>
              <input
                type="number"
                min={1}
                value={expectedLearnerCount}
                onChange={(e) => setExpectedLearnerCount(e.target.value)}
                placeholder={tr("e.g. 50")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Country")}</label>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                <option value="">{tr("Select…")}</option>
                {sortedCountries("en").map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Tax ID — GST / VAT (optional)")}</label>
              <input value={taxId} onChange={(e) => setTaxId(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{tr("Company details (optional)")}</p>
            <p className="text-xs text-muted">{tr("Used on quotes and invoices; the Org Admin can complete them later.")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Registered legal name")}</label>
              <input type="text" {...f("legalName")} placeholder={tr("e.g. Acme Technologies Pvt Ltd")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Website")}</label>
              <input type="text" {...f("website")} placeholder={tr("https://")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Main phone")}</label>
              <input type="tel" {...f("phone")} placeholder="+91 …" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Employees")}</label>
              <select {...f("employeeCountBand")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                <option value="">{tr("Not set")}</option>
                <option value="1_50">1–50</option>
                <option value="51_200">51–200</option>
                <option value="201_1000">201–1,000</option>
                <option value="1001_5000">1,001–5,000</option>
                <option value="5000_plus">5,000+</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Address")}</label>
              <input type="text" {...f("addressLine")} placeholder={tr("Street and building")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("City")}</label>
              <input type="text" {...f("city")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("State / province")}</label>
              <input type="text" {...f("state")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Postal code")}</label>
              <input type="text" {...f("postalCode")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{tr("Products")}</p>
            <p className="text-xs text-muted">{tr("What the organization buys. Only these parts of Spica are switched on for them; this can change later.")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                [["skills"], tr("Employee skills"), tr("Assess and train their employees' English: licenses, batches, Managers.")],
                [["recruitment"], tr("Recruitment"), tr("Proctored English tests for job candidates, paid per assessment.")],
                [["skills", "recruitment"], tr("Both"), tr("Employees and candidates, each with their own proctoring settings.")],
              ] as [("skills" | "recruitment")[], string, string][]
            ).map(([value, label, hint]) => {
              const selected = value.length === products.length && value.every((v) => products.includes(v));
              return (
                <button
                  type="button"
                  key={label}
                  onClick={() => setProducts(value)}
                  className={`text-left rounded-card border p-3 flex flex-col gap-1 cursor-pointer ${selected ? "border-navy bg-navy/10" : "border-rule bg-paper hover:border-navy/40"}`}
                >
                  <span className="text-sm font-semibold text-ink">{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </button>
              );
            })}
          </div>
          {products.includes("recruitment") && (
            <div className="flex flex-col gap-1.5 max-w-xs">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Starting assessment credits")}</label>
              <input
                type="number"
                min={0}
                value={initialCredits}
                onChange={(e) => setInitialCredits(e.target.value)}
                placeholder={tr("e.g. 50")}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          )}

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{tr("Plan, contract and goals")}</p>
            <p className="text-xs text-muted">{tr("Licenses are added after onboarding from the organization's details.")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Plan")}</label>
              <select {...f("planTier")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                <option value="starter">{tr("Starter")}</option>
                <option value="business">{tr("Business")}</option>
                <option value="enterprise">{tr("Enterprise")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Purchase order reference")}</label>
              <input type="text" {...f("purchaseOrderRef")} placeholder={tr("e.g. PO-2026-118")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Contract start")}</label>
              <input type="date" {...f("contractStart")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Contract end")}</label>
              <input type="date" {...f("contractEnd")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Contract value")}</label>
              <input type="number" {...f("contractValue")} placeholder={tr("e.g. 12000")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Currency")}</label>
              <select {...f("contractCurrency")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer">
                {["USD", "INR", "EUR", "GBP", "AED", "SGD"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Training goal")}</label>
              <textarea rows={2} {...f("trainingGoal")} placeholder={tr("e.g. Get 200 support agents from B1 to B2 for the Versant Professional test by March")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{tr("Billing contact (optional)")}</p>
            <p className="text-xs text-muted">{tr("Who receives license invoices. Leave blank if it's the Org Admin.")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Name")}</label>
              <input value={billingContactName} onChange={(e) => setBillingContactName(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Email")}</label>
              <input type="email" value={billingContactEmail} onChange={(e) => setBillingContactEmail(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Phone")}</label>
              <input type="tel" {...f("billingContactPhone")} placeholder="" className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-rule pt-4 flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{tr("Org Admin contact")}</p>
            <p className="text-xs text-muted">{tr("The real contact person at this organization. They'll get an invite to set their own password.")}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("First name")}</label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Last name")}</label>
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
                <Mail size={13} /> {tr("Email")}</label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Phone (optional)")}</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Job title (optional)")}</label>
              <input type="text" {...f("orgAdminJobTitle")} placeholder={tr("e.g. L&D Head")} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none" />
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? tr("Creating…") : tr("Create & send invite")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
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
      setError(tr("Something went wrong saving those changes."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Edit organization")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Organization name")}</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Type")}</label>
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
                  {c === "company" ? tr("Organization") : tr("University")}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? tr("Saving…") : tr("Save changes")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr("Cancel")}</Button>
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
          <h2 className="font-display font-bold text-lg text-ink">{tr("Deactivate organization")}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5">
          <p className="text-sm text-ink">
            {tr("Deactivate")}{" "}<span className="font-semibold">{org.name}</span>{tr("? Its Org Admin and Managers lose access immediately.")}</p>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={onConfirm} disabled={submitting} className="flex-1 !bg-error hover:!bg-error/90">
              {submitting ? tr("Deactivating…") : tr("Deactivate")}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              {tr("Cancel")}</Button>
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
          <h2 className="font-display font-bold text-lg text-ink">{tr("Owning Admin · {{name}}", { name: org.name })}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-muted">{tr("The owning Admin sees and manages this organization in their console.")}</p>
        <select value={adminId} onChange={(e) => setAdminId(e.target.value)} className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink cursor-pointer">
          <option value="">{tr("Choose an Admin")}</option>
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
                setError(tr("Couldn't change the owner."));
                setSaving(false);
              }
            }}
          >
            {saving ? tr("Saving…") : tr("Save")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}</Button>
        </div>
      </div>
    </div>
  );
}

type OrgFilter = "active" | "pilot" | "at_risk" | "invite" | "deactivated" | "all";

export function AdminOrganizations() {
  const perms = useStaffPermissions();
  const canManage = perms.manageOrganizations;
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
  const [product, setProduct] = useState("all");
  const [owner, setOwner] = useState("all");

  function load() {
    getAdminConsoleOverview()
      .then(setOverview)
      .catch(() => setError(tr("Could not load organizations.")));
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
      setError(tr("Could not deactivate that organization."));
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
      setError(tr("Could not reactivate that organization."));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">{tr("Loading…")}</p>;

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
      (product === "all" || (product === "both" ? o.products?.length === 2 : o.products?.length === 1 && o.products[0] === product)) &&
      (owner === "all" || m(o.id)?.owner?.id === owner) &&
      (!q || [o.name, o.orgAdmin?.name, o.orgAdmin?.email, o.industry, m(o.id)?.owner?.name].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Organizations")}
        subtitle={perms.isSuper ? tr("Every organization and university on Spica, and the Admin who owns each.") : tr("The organizations and universities you look after.")}
        actions={
          canManage && (
            <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
              <UserPlus size={18} /> {tr("Onboard Organization")}</Button>
          )
        }
      />

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          variant="tint"
          palette="terracotta"
          index={0}
          icon={Building2}
          value={active.length}
          label={tr("Active organizations")}
          sub={tr("{{length}} companies · {{length2}} universities", { length: active.filter((o) => o.category !== "university").length, length2: active.filter((o) => o.category === "university").length })}
        />
        <StatCard variant="tint" palette="terracotta" index={1} icon={Users} value={overview.totalLearners} label={tr("Learners")} sub={tr("{{sum}} practised this week", { sum: sum((x) => x.active7) })} />
        <StatCard
          variant="tint"
          palette="terracotta"
          index={2}
          icon={KeyRound}
          value={`${sum((x) => x.licensesAssigned)} / ${sum((x) => x.licensesBought)}`}
          label={tr("Licenses assigned / bought")}
        />
        <StatCard
          variant="tint"
          palette="terracotta"
          index={3}
          icon={Mail}
          value={active.filter((o) => o.health?.band === "at_risk").length}
          label={tr("At risk")}
          sub={tr("{{length}} Org Admin invites open · {{sum}} unpaid invoices", { length: active.filter((o) => o.orgAdminStatus !== "active").length, sum: sum((x) => x.unpaidInvoices) })}
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by name, Org Admin, industry or owner")} />
        <SelectFilter label={tr("Type")} value={type} onChange={setType} options={[["all", tr("All types")], ["company", tr("Companies")], ["university", tr("Universities")]]} />
        <SelectFilter
          label={tr("Plan")}
          value={tier}
          onChange={setTier}
          options={[["all", tr("All plans")], ...(Object.entries(TIER_LABELS) as [string, string][])]}
        />
        <SelectFilter
          label={tr("Product")}
          value={product}
          onChange={setProduct}
          options={[
            ["all", tr("All products")],
            ["skills", tr("Employee skills only")],
            ["recruitment", tr("Recruitment only")],
            ["both", tr("Both")],
          ]}
        />
        {perms.isSuper && <SelectFilter label={tr("Owner")} value={owner} onChange={setOwner} options={[["all", tr("All Admins")], ...owners]} />}
      </div>
      <FilterPills<OrgFilter>
        value={filter}
        onChange={setFilter}
        options={[
          ["active", tr("Active"), active.length],
          ["pilot", tr("On pilot"), orgs.filter(matches.pilot).length],
          ["at_risk", tr("At risk"), orgs.filter(matches.at_risk).length],
          ["invite", tr("Org Admin not active"), orgs.filter(matches.invite).length],
          ["deactivated", tr("Deactivated"), orgs.filter(matches.deactivated).length],
          ["all", tr("All"), orgs.length],
        ]}
      />

      {orgs.length === 0 && <EmptyNote>{canManage ? tr("No organizations yet — onboard your first one.") : tr("No organizations yet.")}</EmptyNote>}
      {orgs.length > 0 && shown.length === 0 && <EmptyNote>{tr("No organizations match.")}</EmptyNote>}

      <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
        {shown.map((org, i) => {
          const x = m(org.id);
          const util = x && x.licensesBought ? Math.min(100, (x.licensesAssigned / x.licensesBought) * 100) : 0;
          return (
            <div
              key={org.id}
              style={{ background: `linear-gradient(135deg, ${paletteColor("terracotta", i)}, color-mix(in srgb, ${paletteColor("terracotta", i)} 62%, black))` }}
              className={`rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-4 text-white ${org.active ? "" : "opacity-60"}`}>
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
                    {org.products?.includes("recruitment") && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25">
                        {org.products.includes("skills") ? tr("Skills + Recruitment") : tr("Recruitment")} · {tr("{{n}} credits", { n: org.assessmentCredits })}
                      </span>
                    )}
                    {isPilot(org) && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-white/25">{tr("Pilot to {{shortDate}}", { shortDate: shortDate(org.pilotEndsAt) })}</span>}
                    {org.health && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-black/15" title={org.health.flags.map((f) => trServer(f)).join("\n")}>
                        {tr("Health {{score}}", { score: org.health.score })} · {org.health.band === "at_risk" ? tr("At risk") : org.health.band === "watch" ? tr("Watch") : tr("Healthy")}
                      </span>
                    )}
                    {!org.active && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-black/25 uppercase">{tr("Deactivated")}</span>}
                  </div>
                </div>
              </div>

              <div className="text-xs text-white/85">
                {tr("Org Admin:")}{" "}
                {org.orgAdmin ? (
                  <>
                    <span className="font-semibold text-white">{org.orgAdmin.name || org.orgAdmin.email}</span>
                    {org.orgAdminStatus === "pending" ? tr(" · invite not accepted") : ""}
                  </>
                ) : (
                  <span className="font-semibold">{tr("none yet")}</span>
                )}
                {org.industry ? ` · ${org.industry}` : ""}
              </div>

              <div className="grid grid-cols-3 gap-3 bg-black/10 rounded-input px-3.5 py-3">
                <div>
                  <p className="font-display font-bold text-xl">{org.learnerCount}</p>
                  <p className="text-[11px] text-white/75">{tr("Learners ·")}{" "}{x?.active7 ?? 0} {tr("active")}</p>
                </div>
                <div>
                  <p className="font-display font-bold text-xl">
                    {x?.activeBatches ?? 0}
                    <span className="text-xs font-normal text-white/75"> / {x?.managers ?? org.managers.length}</span>
                  </p>
                  <p className="text-[11px] text-white/75">{tr("Batches / Managers")}</p>
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
                {x?.contractEnd ? tr("Contract to {{shortDate}}", { shortDate: shortDate(x.contractEnd) }) : tr("No contract dates")}
                {x?.unpaidInvoices ? tr(" · {{unpaidInvoices}} unpaid invoice{{v}}", { unpaidInvoices: x.unpaidInvoices, v: x.unpaidInvoices === 1 ? "" : "s" }) : ""}
                {tr(" · Last activity {{ago}}", { ago: ago(x?.lastActivityAt) })}
                {perms.isSuper ? tr(" · Owner: {{v}}", { v: x?.owner?.name ?? "none" }) : ""}
              </p>

              <div className="flex items-center gap-2 flex-wrap">
                <CardButton onClick={() => setViewingOrg(org)}>{tr("View details")}</CardButton>
                {perms.isSuper && <CardButton onClick={() => setOwning(org)}>{tr("Change owner")}</CardButton>}
                {canManage && org.active && (
                  <>
                    <CardButton onClick={() => setEditing(org)}>
                      <Pencil size={13} /> {tr("Edit")}</CardButton>
                    <span className="flex-1" />
                    <CardButton onClick={() => setConfirmingDeactivate(org)} disabled={busyId === org.id}>
                      <Ban size={13} /> {tr("Deactivate")}</CardButton>
                  </>
                )}
                {canManage && !org.active && (
                  <CardButton onClick={() => handleReactivate(org)} disabled={busyId === org.id}>
                    <RotateCcw size={13} /> {busyId === org.id ? tr("Activating…") : tr("Reactivate")}
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
            setNotice(tr("{{name}} created — their Org Admin will receive an email to set up their account.", { name: name }));
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
            setNotice(tr("{{name}} now belongs to its new Admin.", { name: owning.name }));
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
