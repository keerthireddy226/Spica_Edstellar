import { api, ApiError } from "@/lib/api";

export type PlanTier = "starter" | "business" | "enterprise";
export type PlanLimitKey = "managers" | "batches";
export type PlanFeatureKey =
  | "manager_pools"
  | "batch_allotments"
  | "license_requests"
  | "batch_analytics"
  | "custom_pool_expiry"
  | "security_policies"
  | "ip_allowlist"
  | "audit_log"
  | "scheduled_reports"
  | "po_invoicing"
  | "sso"
  | "api_access"
  | "mfa_enforcement"
  | "data_governance"
  | "account_manager";

export const TIER_LABELS: Record<PlanTier, string> = { starter: "Starter", business: "Business", enterprise: "Enterprise" };

export interface PlanFeature {
  key: PlanFeatureKey;
  label: string;
  description: string;
  minTier: PlanTier;
  available: boolean;
  included: boolean;
}

export interface PlanSummary {
  tier: PlanTier;
  tierLabel: string;
  support: string;
  customPriceCents: number | null;
  educationDiscountPercent: number;
  businessQualifyingQuantity: number;
  pilotEndsAt: string | null;
  contract?: { start: string | null; end: string | null } | null;
  accountManager?: { name: string; email: string } | null;
  limits: { key: PlanLimitKey; max: number | null; used: number }[];
  features: PlanFeature[];
  bands: { minQuantity: number; maxQuantity: number | null; unitPriceCents: number }[];
}

export interface CatalogTier {
  tier: PlanTier;
  label: string;
  support: string;
  limits: Record<PlanLimitKey, number | null>;
  features: PlanFeatureKey[];
  fromPriceCents: number;
}

export interface PlanEvent {
  id: string;
  kind: "tier_change" | "price_change" | "pilot_started" | "pilot_ended" | "enterprise_inquiry";
  fromTier: PlanTier | null;
  toTier: PlanTier | null;
  customPriceCents: number | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

export function getMyPlan() {
  return api<PlanSummary & { catalog: CatalogTier[] }>("/plans/me");
}

export function sendEnterpriseInquiry(message: string) {
  return api<{ ok: true }>("/plans/enterprise-inquiry", { method: "POST", body: JSON.stringify({ message }) });
}

export function getOrgPlanAdmin(tenantId: string) {
  return api<PlanSummary & { events: PlanEvent[] }>(`/plans/admin/orgs/${tenantId}`);
}

export function updateOrgPlan(tenantId: string, body: { tier?: PlanTier; customPriceCents?: number | null; note?: string }) {
  return api<{ ok: true }>(`/plans/admin/orgs/${tenantId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function startPilot(tenantId: string, body: { licenses: number; days: number }) {
  return api<{ pilotEndsAt: string }>(`/plans/admin/orgs/${tenantId}/pilot`, { method: "POST", body: JSON.stringify(body) });
}

export function endPilot(tenantId: string) {
  return api<{ ok: true }>(`/plans/admin/orgs/${tenantId}/pilot/end`, { method: "POST" });
}

const FEATURE_LABELS: Record<string, string> = {
  manager_pools: "Manager license pools",
  batch_allotments: "Fixed batch allotments",
  license_requests: "License requests",
  batch_analytics: "Batch analytics",
  custom_pool_expiry: "Custom license validity",
  security_policies: "Security policies",
  ip_allowlist: "IP allowlist",
  mfa_enforcement: "Enforced two-step sign-in",
  audit_log: "The audit log",
  scheduled_reports: "Scheduled reports",
};
const LIMIT_LABELS: Record<string, string> = { managers: "Managers", batches: "Batches" };

// Turns a plan gate from the API into a sentence; null if it wasn't one.
export function planErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: string; feature?: string; limit?: string; max?: number; tier?: PlanTier } | null;
  if (body?.error === "plan_feature_locked") {
    const tier = ["custom_pool_expiry", "ip_allowlist", "mfa_enforcement", "sso", "api_access", "data_governance"].includes(body.feature ?? "")
      ? "Enterprise plan"
      : "Business plan and above";
    return `${FEATURE_LABELS[body.feature ?? ""] ?? "This feature"} is available on the ${tier}.`;
  }
  if (body?.error === "plan_limit_reached") {
    const what = (LIMIT_LABELS[body.limit ?? ""] ?? "items").toLowerCase();
    return `Your ${TIER_LABELS[body.tier ?? "starter"]} plan allows up to ${body.max} ${what}. Upgrade to Business for unlimited ${what}.`;
  }
  return null;
}

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
