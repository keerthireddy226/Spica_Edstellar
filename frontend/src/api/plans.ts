import { api, ApiError } from "@/lib/api";

import { tr } from "@/i18n/tr";
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
  | "secure_proctoring"
  | "data_governance"
  | "account_manager";

export const TIER_LABELS: Record<PlanTier, string> = { starter: tr("Starter"), business: tr("Business"), enterprise: tr("Enterprise") };

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
  manager_pools: tr("Manager license pools"),
  batch_allotments: tr("Fixed batch allotments"),
  license_requests: tr("License requests"),
  batch_analytics: tr("Batch analytics"),
  custom_pool_expiry: tr("Custom license validity"),
  security_policies: tr("Security policies"),
  ip_allowlist: tr("IP allowlist"),
  mfa_enforcement: tr("Enforced two-step sign-in"),
  audit_log: tr("The audit log"),
  scheduled_reports: tr("Scheduled reports"),
  sso: tr("Single sign-on"),
  api_access: tr("API and webhooks"),
  data_governance: tr("Data governance"),
  secure_proctoring: tr("Secure proctoring"),
  po_invoicing: tr("Paying by invoice"),
};
const LIMIT_LABELS: Record<string, string> = { managers: tr("Managers"), batches: tr("Batches") };

// Turns a plan gate from the API into a sentence; null if it wasn't one.
export function planErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { error?: string; feature?: string; limit?: string; max?: number; tier?: PlanTier } | null;
  if (body?.error === "plan_feature_locked") {
    const tier = ["custom_pool_expiry", "ip_allowlist", "mfa_enforcement", "sso", "api_access", "data_governance"].includes(body.feature ?? "")
      ? tr("Enterprise plan")
      : tr("Business plan and above");
    return tr("{{v}} is available on the {{tier}}.", { v: FEATURE_LABELS[body.feature ?? ""] ?? "This feature", tier: tier });
  }
  if (body?.error === "plan_limit_reached") {
    const what = (LIMIT_LABELS[body.limit ?? ""] ?? "items").toLowerCase();
    return tr("Your {{v}} plan allows up to {{max}} {{what}}. Upgrade to Business for unlimited {{what2}}.", { v: TIER_LABELS[body.tier ?? "starter"], max: body.max, what: what, what2: what });
  }
  return null;
}

export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
