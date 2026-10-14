import { useTranslation } from "react-i18next";
import type { AgeBand, Gender, JobRole } from "@/api/onboarding";
import { AGE_BANDS, GENDERS, JOB_ROLES, sortedCountries } from "@/constants/demographics";
import type { LearnerDetails } from "@/api/details";

const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-muted";

// Employee details and demographics an organization keeps for a learner.
// All optional. Gender and age stay out of any group shown to fewer than
// five people in analytics, and the learner can change them in onboarding.
export function LearnerDetailsFields({ value, onChange }: { value: LearnerDetails; onChange: (d: LearnerDetails) => void }) {
  const { t, i18n } = useTranslation();
  const set = <K extends keyof LearnerDetails>(k: K, v: LearnerDetails[K]) => onChange({ ...value, [k]: v });
  const text = (k: "employeeId" | "department" | "jobTitle" | "phone" | "city", label: string, placeholder: string, max: number) => (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>{label}</label>
      <input value={value[k] ?? ""} maxLength={max} onChange={(e) => set(k, e.target.value || null)} placeholder={placeholder} className={inputClass} />
    </div>
  );

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {text("employeeId", "Employee ID", "e.g. EMP-1042", 60)}
      {text("department", "Department", "e.g. Customer Support", 120)}
      {text("jobTitle", "Job title", "e.g. Support Associate", 120)}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Job role</label>
        <select value={value.jobRole ?? ""} onChange={(e) => set("jobRole", (e.target.value || null) as JobRole | null)} className={`${inputClass} cursor-pointer`}>
          <option value="">Not set</option>
          {JOB_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`demographics.jobRole.${r}`)}
            </option>
          ))}
        </select>
      </div>
      {text("phone", "Work phone", "e.g. +91 98765 43210", 40)}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Country</label>
        <select value={value.country ?? ""} onChange={(e) => set("country", e.target.value || null)} className={`${inputClass} cursor-pointer`}>
          <option value="">Not set</option>
          {sortedCountries(i18n.language).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {text("city", "City", "e.g. Hyderabad", 100)}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Gender</label>
        <select value={value.gender ?? ""} onChange={(e) => set("gender", (e.target.value || null) as Gender | null)} className={`${inputClass} cursor-pointer`}>
          <option value="">Not set</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {t(`demographics.gender.${g}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>Age</label>
        <select value={value.ageBand ?? ""} onChange={(e) => set("ageBand", (e.target.value || null) as AgeBand | null)} className={`${inputClass} cursor-pointer`}>
          <option value="">Not set</option>
          {AGE_BANDS.map((a) => (
            <option key={a} value={a}>
              {t(`demographics.ageBand.${a}`)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted sm:col-span-2">
        All optional. Gender and age are only shown in reports for groups of five or more, and the learner can update them when they sign in.
      </p>
    </div>
  );
}
