// The rate card and what each tier includes. Every price, band and limit
// here is a starting point to validate with real buyers — change them here
// and both the API and the Org Admin's Plan page follow.

export const PLAN_TIERS = ["starter", "business", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const TIER_LABELS: Record<PlanTier, string> = {
  starter: "Starter",
  business: "Business",
  enterprise: "Enterprise",
};

// Price per license-month by how many licenses are bought in one purchase.
export const VOLUME_BANDS = [
  { minQuantity: 1, unitPriceCents: 10000 },
  { minQuantity: 50, unitPriceCents: 9000 },
  { minQuantity: 250, unitPriceCents: 8000 },
] as const;

// A tier's commitment earns its rate on every purchase, including small top-ups.
export const TIER_PRICE_FLOOR_CENTS: Record<PlanTier, number> = {
  starter: 10000,
  business: 9000,
  enterprise: 8000,
};

// One purchase this size or larger moves a Starter organization to Business.
export const BUSINESS_QUALIFYING_QUANTITY = 50;

// Universities get the same tiers with a discount off the rate card.
export const EDUCATION_DISCOUNT_PERCENT = 15;

export const PILOT_DEFAULT_LICENSES = 10;
export const PILOT_DEFAULT_DAYS = 30;

export type PlanLimit = "managers" | "batches";

export type PlanFeature =
  | "manager_pools"
  | "batch_allotments"
  | "license_requests"
  | "batch_analytics"
  | "custom_pool_expiry"
  | "audit_log"
  | "scheduled_reports"
  | "po_invoicing"
  | "sso"
  | "api_access"
  | "mfa_enforcement"
  | "data_governance"
  | "account_manager";

export interface FeatureInfo {
  label: string;
  description: string;
  minTier: PlanTier;
  // false = part of the plan on paper but not built yet; shown as "Coming soon".
  available: boolean;
}

export const FEATURES: Record<PlanFeature, FeatureInfo> = {
  manager_pools: {
    label: "Manager license pools",
    description: "Give each Manager a pool of licenses to use across their batches.",
    minTier: "business",
    available: true,
  },
  batch_allotments: {
    label: "Fixed batch allotments",
    description: "Reserve a fixed number of licenses for a batch.",
    minTier: "business",
    available: true,
  },
  license_requests: {
    label: "License requests and approvals",
    description: "Managers ask for more or fewer licenses; the Org Admin approves.",
    minTier: "business",
    available: true,
  },
  batch_analytics: {
    label: "Batch analytics and risk scores",
    description: "Per-batch progress, engagement and at-risk learners.",
    minTier: "business",
    available: true,
  },
  custom_pool_expiry: {
    label: "Custom license validity",
    description: "Licenses that stay usable longer than the standard 12 months.",
    minTier: "enterprise",
    available: true,
  },
  audit_log: { label: "Audit log", description: "Who changed what across the organization.", minTier: "business", available: true },
  scheduled_reports: { label: "Scheduled reports", description: "Progress reports emailed on a schedule.", minTier: "business", available: false },
  po_invoicing: { label: "Purchase orders and invoicing", description: "Pay by invoice against a PO.", minTier: "business", available: false },
  sso: { label: "Single sign-on and SCIM", description: "Sign in with your company identity provider.", minTier: "enterprise", available: false },
  api_access: { label: "API and webhooks", description: "Connect Spica to your LMS or HR system.", minTier: "enterprise", available: false },
  mfa_enforcement: { label: "Enforced two-factor sign-in", description: "Require MFA for every admin and manager.", minTier: "enterprise", available: false },
  data_governance: { label: "Data governance", description: "DPA, retention rules and data export.", minTier: "enterprise", available: false },
  account_manager: { label: "Dedicated account manager", description: "A named contact and an SLA.", minTier: "enterprise", available: false },
};

// null = unlimited.
export const TIER_LIMITS: Record<PlanTier, Record<PlanLimit, number | null>> = {
  starter: { managers: 3, batches: 5 },
  business: { managers: null, batches: null },
  enterprise: { managers: null, batches: null },
};

export const TIER_SUPPORT: Record<PlanTier, string> = {
  starter: "Email support",
  business: "Priority support",
  enterprise: "Account manager and SLA",
};

const TIER_RANK: Record<PlanTier, number> = { starter: 0, business: 1, enterprise: 2 };

export function tierIncludes(tier: PlanTier, feature: PlanFeature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURES[feature].minTier];
}

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}
