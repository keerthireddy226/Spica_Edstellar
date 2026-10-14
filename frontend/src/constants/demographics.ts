import type { AgeBand, Gender, JobRole } from "@/api/onboarding";

export const JOB_ROLES: JobRole[] = [
  "student",
  "it_engineering",
  "customer_support",
  "sales_marketing",
  "healthcare",
  "education",
  "finance",
  "operations",
  "management",
  "other",
];

export const GENDERS: Gender[] = ["female", "male", "non_binary", "prefer_not"];

export const AGE_BANDS: AgeBand[] = ["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"];

// ISO 3166-1 alpha-2. Names are rendered per UI language via Intl.DisplayNames,
// so no country-name translations need maintaining.
export const COUNTRY_CODES = [
  "IN", "US", "GB", "CA", "AU", "NZ", "IE", "AE", "SA", "QA", "SG", "MY", "PH", "ID", "TH", "VN",
  "JP", "CN", "HK", "TW", "KR", "BD", "LK", "NP", "PK", "DE", "FR", "ES", "IT", "NL", "BE", "PL",
  "DK", "NO", "SE", "FI", "CH", "AT", "PT", "BR", "MX", "AR", "CO", "ZA", "NG", "KE", "EG",
];

export function countryName(code: string | null | undefined, locale: string): string {
  if (!code) return "—";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function sortedCountries(locale: string): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

export const EMPLOYEE_COUNT_BANDS: { value: "1_50" | "51_200" | "201_1000" | "1001_5000" | "5000_plus"; label: string }[] = [
  { value: "1_50", label: "1–50" },
  { value: "51_200", label: "51–200" },
  { value: "201_1000", label: "201–1,000" },
  { value: "1001_5000", label: "1,001–5,000" },
  { value: "5000_plus", label: "5,000+" },
];

export function employeeCountLabel(band: string | null | undefined): string {
  return EMPLOYEE_COUNT_BANDS.find((b) => b.value === band)?.label ?? "—";
}
