import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { Building2, GraduationCap, MapPin, Pencil, Receipt, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { EMPLOYEE_COUNT_BANDS, countryName, employeeCountLabel, sortedCountries } from "@/constants/demographics";
import {
  getOrganization,
  updateOrganization,
  getOrgAdminContact,
  updateOrgAdminContact,
  type OrganizationProfile,
  type OrgAdminContact,
  type EmployeeCountBand,
} from "@/api/orgAdmin";

type Draft = Omit<OrganizationProfile, "category" | "createdAt" | "expectedLearnerCount"> & {
  expectedLearnerCount: string;
  jobTitle: string;
  contactPhone: string;
};

// Fields counted toward "profile completeness" — the ones Edstellar actually
// needs for billing, reporting, and account management.
const COMPLETENESS_FIELDS: (keyof Draft)[] = [
  "legalName",
  "industry",
  "employeeCountBand",
  "expectedLearnerCount",
  "website",
  "phone",
  "addressLine",
  "city",
  "state",
  "postalCode",
  "country",
  "taxId",
  "trainingGoal",
  "billingContactName",
  "billingContactEmail",
  "jobTitle",
  "contactPhone",
];

function toDraft(org: OrganizationProfile, contact: OrgAdminContact): Draft {
  return {
    name: org.name,
    legalName: org.legalName ?? "",
    industry: org.industry ?? "",
    employeeCountBand: org.employeeCountBand,
    expectedLearnerCount: org.expectedLearnerCount?.toString() ?? "",
    website: org.website ?? "",
    phone: org.phone ?? "",
    addressLine: org.addressLine ?? "",
    city: org.city ?? "",
    state: org.state ?? "",
    postalCode: org.postalCode ?? "",
    country: org.country ?? "",
    taxId: org.taxId ?? "",
    trainingGoal: org.trainingGoal ?? "",
    billingContactName: org.billingContactName ?? "",
    billingContactEmail: org.billingContactEmail ?? "",
    billingContactPhone: org.billingContactPhone ?? "",
    purchaseOrderRef: org.purchaseOrderRef ?? "",
    jobTitle: contact.jobTitle ?? "",
    contactPhone: contact.phone ?? "",
  };
}

const inputClass =
  "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

const GROUP_ICON: Record<string, { icon: LucideIcon; color: string }> = {
  Company: { icon: Building2, color: "#b5653f" },
  Address: { icon: MapPin, color: "#c9965c" },
  Training: { icon: GraduationCap, color: "#6e9660" },
  Billing: { icon: Receipt, color: "#a8613f" },
  "You (primary contact)": { icon: UserRound, color: "#8a8f4f" },
};

function Group({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const g = GROUP_ICON[title] ?? { icon: Building2, color: "var(--color-navy)" };
  return (
    <div className={`rounded-card border border-rule bg-paper/40 p-4 flex flex-col gap-3 ${wide ? "lg:col-span-2" : ""}`}>
      <p className="flex items-center gap-2 text-sm font-display font-bold text-ink">
        <span className="h-7 w-7 rounded-lg flex items-center justify-center text-white" style={{ background: g.color }}>
          <g.icon size={14} />
        </span>
        {title}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{children}</div>
    </div>
  );
}

function View({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm text-ink break-words">{value || "—"}</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <label className="text-xs text-muted">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
    </div>
  );
}

// Org Admin's view/edit of their own organization's full profile. The
// Admin's onboarding form only captures the essentials; the rest is filled
// in here by the person who actually knows it.
export function OrganizationProfileCard() {
  const [org, setOrg] = useState<OrganizationProfile | null>(null);
  const [contact, setContact] = useState<OrgAdminContact | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getOrganization(), getOrgAdminContact()])
      .then(([o, c]) => {
        setOrg(o);
        setContact(c);
      })
      .catch(() => setError("Could not load organization details."));
  }, []);

  if (error && !org) return <p className="text-sm text-error">{error}</p>;
  if (!org || !contact) return null;

  const current = toDraft(org, contact);
  const filled = COMPLETENESS_FIELDS.filter((k) => String(current[k] ?? "").trim() !== "").length;
  const completeness = Math.round((filled / COMPLETENESS_FIELDS.length) * 100);

  function patch(fields: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...fields } : d));
  }

  async function handleSave() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Organization name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [o, c] = await Promise.all([
        updateOrganization({
          name: draft.name.trim(),
          legalName: draft.legalName,
          industry: draft.industry,
          employeeCountBand: draft.employeeCountBand,
          expectedLearnerCount: draft.expectedLearnerCount.trim() ? Number(draft.expectedLearnerCount) : null,
          website: draft.website,
          phone: draft.phone,
          addressLine: draft.addressLine,
          city: draft.city,
          state: draft.state,
          postalCode: draft.postalCode,
          country: draft.country || null,
          taxId: draft.taxId,
          trainingGoal: draft.trainingGoal,
          billingContactName: draft.billingContactName,
          billingContactEmail: draft.billingContactEmail,
          billingContactPhone: draft.billingContactPhone,
          purchaseOrderRef: draft.purchaseOrderRef,
        }),
        updateOrgAdminContact({ jobTitle: draft.jobTitle || null, phone: draft.contactPhone || null }),
      ]);
      setOrg(o);
      setContact(c);
      setDraft(null);
    } catch (err) {
      // A tax ID that doesn't match the country's format gets the reason back.
      setError(err instanceof ApiError && err.message === "invalid_tax_id" ? ((err.body as { message?: string })?.message ?? "Check the tax ID.") : "Couldn't save — check the email and number fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  const addressText = [org.addressLine, org.city, org.state, org.postalCode].filter(Boolean).join(", ");

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm" style={{ background: "var(--color-navy)" }}>
            <Building2 size={18} />
          </span>
          <div>
            <h2 className="font-display font-bold text-ink">Organization details</h2>
            <p className="text-xs text-muted">
              {org.name} · {org.category === "university" ? "University" : "Organization"}
            </p>
          </div>
        </div>
        {!draft && (
          <Button variant="secondary" onClick={() => setDraft(current)} className="flex items-center gap-2 !px-3.5 !py-1.5 !text-xs shrink-0">
            <Pencil size={13} /> Edit details
          </Button>
        )}
      </div>

      {!draft && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Profile completeness</span>
            <span className="font-semibold text-ink">
              {filled} of {COMPLETENESS_FIELDS.length} details · {completeness}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-rule overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(completeness, 2)}%`, background: completeness === 100 ? "var(--color-success)" : "linear-gradient(90deg, var(--color-navy), #c9965c)" }}
            />
          </div>
          {completeness < 100 && <p className="text-xs text-muted">Add the missing details so invoices and reports are correct. Click Edit details.</p>}
        </div>
      )}

      {draft ? (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Group title="Company">
            <Input label="Display name" value={draft.name} onChange={(v) => patch({ name: v })} />
            <Input label="Registered legal name" value={draft.legalName ?? ""} onChange={(v) => patch({ legalName: v })} />
            <Input label="Industry" value={draft.industry ?? ""} onChange={(v) => patch({ industry: v })} placeholder="e.g. IT services" />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Employees</label>
              <select
                value={draft.employeeCountBand ?? ""}
                onChange={(e) => patch({ employeeCountBand: (e.target.value || null) as EmployeeCountBand | null })}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">Select…</option>
                {EMPLOYEE_COUNT_BANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Website" value={draft.website ?? ""} onChange={(v) => patch({ website: v })} placeholder="https://" />
            <Input label="Main phone" type="tel" value={draft.phone ?? ""} onChange={(v) => patch({ phone: v })} />
          </Group>

          <Group title="Address">
            <Input label="Street address" value={draft.addressLine ?? ""} onChange={(v) => patch({ addressLine: v })} wide />
            <Input label="City" value={draft.city ?? ""} onChange={(v) => patch({ city: v })} />
            <Input label="State / province" value={draft.state ?? ""} onChange={(v) => patch({ state: v })} />
            <Input label="Postal code" value={draft.postalCode ?? ""} onChange={(v) => patch({ postalCode: v })} />
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Country</label>
              <select value={draft.country ?? ""} onChange={(e) => patch({ country: e.target.value })} className={`${inputClass} cursor-pointer`}>
                <option value="">Select…</option>
                {sortedCountries("en").map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </Group>

          <Group title="Training">
            <Input
              label="Learners expected"
              type="number"
              value={draft.expectedLearnerCount}
              onChange={(v) => patch({ expectedLearnerCount: v })}
            />
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs text-muted">What do you want learners to achieve?</label>
              <textarea
                rows={3}
                value={draft.trainingGoal ?? ""}
                onChange={(e) => patch({ trainingGoal: e.target.value })}
                placeholder="e.g. Customer-facing staff to reach B2 speaking before the Q1 client rollout"
                className={inputClass}
              />
            </div>
          </Group>

          <Group title="Billing">
            <Input label="Tax ID (GST / VAT)" value={draft.taxId ?? ""} onChange={(v) => patch({ taxId: v })} />
            <Input label="PO / reference number" value={draft.purchaseOrderRef ?? ""} onChange={(v) => patch({ purchaseOrderRef: v })} />
            <Input label="Billing contact name" value={draft.billingContactName ?? ""} onChange={(v) => patch({ billingContactName: v })} />
            <Input
              label="Billing contact email"
              type="email"
              value={draft.billingContactEmail ?? ""}
              onChange={(v) => patch({ billingContactEmail: v })}
            />
            <Input
              label="Billing contact phone"
              type="tel"
              value={draft.billingContactPhone ?? ""}
              onChange={(v) => patch({ billingContactPhone: v })}
            />
          </Group>

          <Group title="You (primary contact)" wide>
            <Input label="Your designation" value={draft.jobTitle} onChange={(v) => patch({ jobTitle: v })} placeholder="e.g. L&D Manager" />
            <Input label="Your phone" type="tel" value={draft.contactPhone} onChange={(v) => patch({ contactPhone: v })} />
          </Group>

          {error && <p className="text-sm text-error lg:col-span-2">{error}</p>}
          <div className="flex items-center gap-3 lg:col-span-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <Group title="Company">
            <View label="Registered legal name" value={org.legalName} />
            <View label="Industry" value={org.industry} />
            <View label="Employees" value={org.employeeCountBand ? employeeCountLabel(org.employeeCountBand) : null} />
            <View label="Website" value={org.website} />
            <View label="Main phone" value={org.phone} />
          </Group>
          <Group title="Address">
            <View label="Address" value={addressText} wide />
            <View label="Country" value={org.country ? countryName(org.country, "en") : null} />
          </Group>
          <Group title="Training">
            <View label="Learners expected" value={org.expectedLearnerCount?.toString()} />
            <View label="Goal" value={org.trainingGoal} wide />
          </Group>
          <Group title="Billing">
            <View label="Tax ID" value={org.taxId} />
            <View label="PO / reference" value={org.purchaseOrderRef} />
            <View label="Billing contact" value={[org.billingContactName, org.billingContactEmail, org.billingContactPhone].filter(Boolean).join(" · ")} wide />
          </Group>
          <Group title="You (primary contact)" wide>
            <View label="Designation" value={contact.jobTitle} />
            <View label="Phone" value={contact.phone} />
          </Group>
        </div>
      )}
    </div>
  );
}
