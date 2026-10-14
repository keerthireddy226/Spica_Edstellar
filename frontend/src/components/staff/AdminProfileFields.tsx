import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PERMISSION_LABELS, getAdminConsoleOverview, type AdminPermissions } from "@/api/admin";
import { sortedCountries } from "@/constants/demographics";
import { useStaffPermissions } from "@/components/staff/StaffKit";

export interface AdminProfile {
  department: string;
  jobTitle: string;
  phone: string;
  region: string;
  city: string;
  country: string;
  notes: string;
  organizationIds: string[];
  permissions: AdminPermissions;
}

const DEPARTMENTS = ["Sales", "Delivery", "L&D", "Customer Success", "Account Management", "Finance", "Operations", "Support"];

// What each kind of Admin usually needs; the boxes can still be changed.
const PRESETS: { label: string; perms: (keyof AdminPermissions)[] }[] = [
  { label: "Sales / Account manager", perms: ["manageOrganizations", "inviteLearners", "viewReports"] },
  { label: "Delivery / L&D", perms: ["inviteLearners", "viewLearnerInfo", "viewReports", "contentReview"] },
  { label: "Assessment reviewer", perms: ["viewLearnerInfo", "scoreReview", "contentReview"] },
  { label: "Team lead", perms: ["manageOrganizations", "inviteLearners", "viewLearnerInfo", "viewReports", "manageAdmins"] },
  { label: "Full access", perms: Object.keys(PERMISSION_LABELS) as (keyof AdminPermissions)[] },
];

const PERMISSION_HELP: Record<keyof AdminPermissions, string> = {
  manageOrganizations: "Onboard, edit and deactivate organizations; plans, licenses, contracts and invoices",
  inviteLearners: "Invite individual learners and give them free months",
  viewLearnerInfo: "Open learners' full profiles",
  contentReview: "Review practice content",
  scoreReview: "Decide flagged placement tests",
  viewReports: "Analytics, insights and reports",
  manageAdmins: "Onboard and edit other Admins (team lead)",
};

const input = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const label = "text-xs font-semibold uppercase tracking-wide text-muted";

export function AdminProfileFields({ value, onChange }: { value: AdminProfile; onChange: (v: AdminProfile) => void }) {
  const { i18n } = useTranslation();
  const perms = useStaffPermissions();
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    // Only a Super Admin hands organizations to Admins.
    if (!perms.isSuper) return;
    getAdminConsoleOverview()
      .then((o) => setOrgs(o.organizations.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, [perms.isSuper]);
  const set = <K extends keyof AdminProfile>(k: K, v: AdminProfile[K]) => onChange({ ...value, [k]: v });
  const customDept = value.department && !DEPARTMENTS.includes(value.department);

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="text-sm font-semibold text-ink mb-2">Role and contact</legend>
        <div className="flex flex-col gap-1.5">
          <label className={label}>Department</label>
          <select value={customDept ? "__other" : value.department} onChange={(e) => set("department", e.target.value === "__other" ? " " : e.target.value)} className={`${input} cursor-pointer`}>
            <option value="">Not set</option>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
            <option value="__other">Other…</option>
          </select>
          {customDept && <input autoFocus value={value.department.trim()} onChange={(e) => set("department", e.target.value || " ")} placeholder="Department name" className={input} />}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>Job title</label>
          <input value={value.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="e.g. Key Account Manager" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>Phone</label>
          <input value={value.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. +91 98765 43210" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>Region or territory</label>
          <input value={value.region} onChange={(e) => set("region", e.target.value)} placeholder="e.g. India South, EMEA" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>City</label>
          <input value={value.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Hyderabad" className={input} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={label}>Country</label>
          <select value={value.country} onChange={(e) => set("country", e.target.value)} className={`${input} cursor-pointer`}>
            <option value="">Not set</option>
            {sortedCountries(i18n.language).map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className={label}>Notes</label>
          <textarea rows={2} value={value.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the team should know" className={input} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink mb-1">Permissions</legend>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => set("permissions", Object.fromEntries(Object.keys(PERMISSION_LABELS).map((k) => [k, p.perms.includes(k as keyof AdminPermissions)])) as unknown as AdminPermissions)}
              className="text-xs font-semibold px-3 py-1.5 rounded-pill border border-rule text-ink hover:bg-paper-warm cursor-pointer"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(PERMISSION_LABELS) as (keyof AdminPermissions)[]).filter((k) => perms.isSuper || perms[k]).map((k) => (
            <label key={k} className="flex items-start gap-2.5 text-sm text-ink cursor-pointer rounded-input border border-rule px-3 py-2">
              <input type="checkbox" checked={!!value.permissions[k]} onChange={() => set("permissions", { ...value.permissions, [k]: !value.permissions[k] })} className="h-4 w-4 mt-0.5 accent-navy" />
              <span>
                <span className="font-medium">{PERMISSION_LABELS[k]}</span>
                <span className="block text-xs text-muted">{PERMISSION_HELP[k]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {orgs.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink mb-1">Organizations they own</legend>
          <p className="text-xs text-muted">They'll see and manage these in their console. Ticking one moves it from its current owner.</p>
          <div className="grid sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
            {orgs.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={value.organizationIds.includes(o.id)}
                  onChange={(e) => set("organizationIds", e.target.checked ? [...value.organizationIds, o.id] : value.organizationIds.filter((x) => x !== o.id))}
                  className="h-4 w-4 accent-navy"
                />
                {o.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

export function toAdminPayloadExtras(p: AdminProfile) {
  return {
    department: p.department.trim() || undefined,
    jobTitle: p.jobTitle.trim() || undefined,
    phone: p.phone.trim() || undefined,
    region: p.region.trim() || undefined,
    city: p.city.trim() || undefined,
    country: p.country || undefined,
    notes: p.notes.trim() || undefined,
    organizationIds: p.organizationIds,
    permissions: p.permissions,
  };
}
