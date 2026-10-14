import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { creditPool } from "../licenses/service.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import {
  BUSINESS_QUALIFYING_QUANTITY,
  EDUCATION_DISCOUNT_PERCENT,
  FEATURES,
  TIER_LABELS,
  TIER_LIMITS,
  TIER_PRICE_FLOOR_CENTS,
  TIER_SUPPORT,
  VOLUME_BANDS,
  tierIncludes,
  type PlanFeature,
  type PlanLimit,
  type PlanTier,
} from "./config.js";

type Executor = Pick<PoolClient, "query">;

// Thrown wherever a plan blocks an action; the app's error handler turns it
// into a 403 the frontend can explain ("Available on Business").
export class PlanError extends Error {
  constructor(
    public code: "plan_feature_locked" | "plan_limit_reached",
    public detail: { tier: PlanTier; feature?: PlanFeature; limit?: PlanLimit; max?: number },
  ) {
    super(code);
  }
}

export interface TenantPlan {
  tier: PlanTier;
  category: string | null;
  customPriceCents: number | null;
  pilotEndsAt: string | null;
}

export async function getTenantPlan(tenantId: string, executor: Executor = pool): Promise<TenantPlan | null> {
  const r = await executor.query(
    `SELECT plan_tier, category, custom_price_cents, pilot_ends_at FROM tenants WHERE id = $1 AND type = 'cohort'`,
    [tenantId],
  );
  const t = r.rows[0];
  if (!t) return null;
  return {
    tier: t.plan_tier,
    category: t.category,
    customPriceCents: t.custom_price_cents,
    pilotEndsAt: t.pilot_ends_at ? new Date(t.pilot_ends_at).toISOString() : null,
  };
}

export async function assertFeature(tenantId: string, feature: PlanFeature, executor: Executor = pool): Promise<void> {
  const plan = await getTenantPlan(tenantId, executor);
  if (!plan) return; // not an organization (e.g. an individual learner) — plans don't apply
  if (!tierIncludes(plan.tier, feature)) throw new PlanError("plan_feature_locked", { tier: plan.tier, feature });
}

async function usage(tenantId: string, executor: Executor = pool): Promise<Record<PlanLimit, number>> {
  const r = await executor.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE tenant_id = $1 AND role = 'manager' AND deleted_at IS NULL) AS managers,
       (SELECT count(*)::int FROM batches WHERE tenant_id = $1 AND status <> 'archived') AS batches`,
    [tenantId],
  );
  return { managers: r.rows[0].managers, batches: r.rows[0].batches };
}

// Call before creating (or reactivating) one more of `limit`.
export async function assertWithinLimit(tenantId: string, limit: PlanLimit, executor: Executor = pool): Promise<void> {
  const plan = await getTenantPlan(tenantId, executor);
  if (!plan) return;
  const max = TIER_LIMITS[plan.tier][limit];
  if (max === null) return;
  const used = (await usage(tenantId, executor))[limit];
  if (used >= max) throw new PlanError("plan_limit_reached", { tier: plan.tier, limit, max });
}

// ---- Pricing ----

function bandPriceCents(quantity: number): number {
  let price: number = VOLUME_BANDS[0].unitPriceCents;
  for (const band of VOLUME_BANDS) if (quantity >= band.minQuantity) price = band.unitPriceCents;
  return price;
}

// USD cents per license-month for one purchase of `quantity`. A negotiated
// price wins outright; otherwise the better of the volume band and the
// tier's own rate, then the education discount.
export function orgUnitPriceCents(plan: Pick<TenantPlan, "tier" | "category" | "customPriceCents">, quantity: number): number {
  if (plan.customPriceCents !== null) return plan.customPriceCents;
  const base = Math.min(bandPriceCents(quantity), TIER_PRICE_FLOOR_CENTS[plan.tier]);
  const discount = plan.category === "university" ? EDUCATION_DISCOUNT_PERCENT : 0;
  return Math.round((base * (100 - discount)) / 100);
}

export function purchaseUpgradesTo(plan: Pick<TenantPlan, "tier">, quantity: number): PlanTier | null {
  return plan.tier === "starter" && quantity >= BUSINESS_QUALIFYING_QUANTITY ? "business" : null;
}

// ---- Changing tiers ----

export async function setTier(args: {
  tenantId: string;
  tier: PlanTier;
  actorId: string | null;
  note?: string | null;
  executor?: Executor;
}): Promise<boolean> {
  const ex = args.executor ?? pool;
  const current = await ex.query(`SELECT plan_tier FROM tenants WHERE id = $1 AND type = 'cohort' FOR UPDATE`, [args.tenantId]);
  if (current.rowCount === 0) return false;
  const from = current.rows[0].plan_tier as PlanTier;
  if (from === args.tier) return true;
  await ex.query(`UPDATE tenants SET plan_tier = $2, plan_changed_at = now() WHERE id = $1`, [args.tenantId, args.tier]);
  await ex.query(
    `INSERT INTO tenant_plan_events (tenant_id, kind, from_tier, to_tier, note, actor_id) VALUES ($1, 'tier_change', $2, $3, $4, $5)`,
    [args.tenantId, from, args.tier, args.note ?? null, args.actorId],
  );
  return true;
}

export async function setCustomPrice(args: { tenantId: string; customPriceCents: number | null; actorId: string; note?: string | null }) {
  const r = await pool.query(`UPDATE tenants SET custom_price_cents = $2 WHERE id = $1 AND type = 'cohort' RETURNING id`, [
    args.tenantId,
    args.customPriceCents,
  ]);
  if (r.rowCount === 0) return false;
  await pool.query(
    `INSERT INTO tenant_plan_events (tenant_id, kind, custom_price_cents, note, actor_id) VALUES ($1, 'price_change', $2, $3, $4)`,
    [args.tenantId, args.customPriceCents, args.note ?? (args.customPriceCents === null ? "Back to the standard rate card" : null), args.actorId],
  );
  return true;
}

// ---- Pilots ----

// A pilot is a free batch of licenses that lapse when the pilot ends, so an
// organization can try Spica before buying.
export async function startPilot(args: { tenantId: string; licenses: number; days: number; actorId: string }) {
  const endsAt = new Date(Date.now() + args.days * 86400000);
  const r = await pool.query(`UPDATE tenants SET pilot_ends_at = $2 WHERE id = $1 AND type = 'cohort' RETURNING id`, [args.tenantId, endsAt]);
  if (r.rowCount === 0) return null;
  await creditPool({
    tenantId: args.tenantId,
    quantity: args.licenses,
    source: "comp",
    note: `Pilot — ends ${endsAt.toISOString().slice(0, 10)}`,
    actorId: args.actorId,
    expiresAt: endsAt,
  });
  await pool.query(
    `INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'pilot_started', $2, $3)`,
    [args.tenantId, `${args.licenses} licenses for ${args.days} days`, args.actorId],
  );
  for (const id of await orgAdminIds(args.tenantId)) {
    await notify({
      userId: id,
      kind: "pilot",
      title: `Your pilot has started: ${args.licenses} free licenses`,
      body: `Assign them to learners any time before ${endsAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`,
      link: "/orgadmin/plan",
      email: true,
      sentBy: args.actorId,
    });
  }
  return endsAt.toISOString();
}

export async function endPilot(args: { tenantId: string; actorId: string | null; note: string }) {
  const r = await pool.query(
    `UPDATE tenants SET pilot_ends_at = NULL WHERE id = $1 AND pilot_ends_at IS NOT NULL RETURNING id`,
    [args.tenantId],
  );
  if (r.rowCount === 0) return false;
  await pool.query(`INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'pilot_ended', $2, $3)`, [
    args.tenantId,
    args.note,
    args.actorId,
  ]);
  return true;
}

// ---- Enterprise enquiries ----

// Goes to the Admin who manages the organization, or every Super Admin if
// nobody does.
export async function enterpriseInquiry(args: { tenantId: string; actorId: string; message: string }) {
  const t = (await pool.query(`SELECT name, managed_by FROM tenants WHERE id = $1`, [args.tenantId])).rows[0];
  if (!t) return false;
  const recipients = t.managed_by
    ? [t.managed_by as string]
    : (await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows.map((r) => r.id as string);
  await pool.query(`INSERT INTO tenant_plan_events (tenant_id, kind, note, actor_id) VALUES ($1, 'enterprise_inquiry', $2, $3)`, [
    args.tenantId,
    args.message,
    args.actorId,
  ]);
  for (const id of recipients) {
    await notify({
      userId: id,
      kind: "plan_inquiry",
      title: `${t.name} asked about Enterprise`,
      body: args.message,
      link: t.managed_by ? "/admin/organizations" : "/superadmin/dashboard",
      email: true,
      sentBy: args.actorId,
      meta: { tenantId: args.tenantId },
    });
  }
  return true;
}

// ---- What an organization sees on its Plan page ----

export async function planSummary(tenantId: string) {
  const plan = await getTenantPlan(tenantId);
  if (!plan) return null;
  const used = await usage(tenantId);
  const limits = TIER_LIMITS[plan.tier];
  const bands = VOLUME_BANDS.map((b, i) => ({
    minQuantity: b.minQuantity,
    maxQuantity: VOLUME_BANDS[i + 1] ? VOLUME_BANDS[i + 1].minQuantity - 1 : null,
    unitPriceCents: orgUnitPriceCents({ ...plan, customPriceCents: null }, b.minQuantity),
  }));
  return {
    tier: plan.tier,
    tierLabel: TIER_LABELS[plan.tier],
    support: TIER_SUPPORT[plan.tier],
    customPriceCents: plan.customPriceCents,
    educationDiscountPercent: plan.category === "university" ? EDUCATION_DISCOUNT_PERCENT : 0,
    businessQualifyingQuantity: BUSINESS_QUALIFYING_QUANTITY,
    pilotEndsAt: plan.pilotEndsAt,
    limits: (Object.keys(limits) as PlanLimit[]).map((key) => ({ key, max: limits[key], used: used[key] })),
    features: (Object.keys(FEATURES) as PlanFeature[]).map((key) => ({
      key,
      ...FEATURES[key],
      included: tierIncludes(plan.tier, key),
    })),
    bands,
  };
}

// Same rate card for every tier, for the comparison table.
export function planCatalog(category: string | null) {
  return (["starter", "business", "enterprise"] as PlanTier[]).map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    support: TIER_SUPPORT[tier],
    limits: TIER_LIMITS[tier],
    features: (Object.keys(FEATURES) as PlanFeature[]).filter((f) => tierIncludes(tier, f)),
    fromPriceCents: orgUnitPriceCents({ tier, category, customPriceCents: null }, 1),
  }));
}

export async function listPlanEvents(tenantId: string, limit = 50) {
  const r = await pool.query(
    `SELECT e.*, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS actor_name
     FROM tenant_plan_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.tenant_id = $1 ORDER BY e.created_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  return r.rows.map((e) => ({
    id: e.id as string,
    kind: e.kind as string,
    fromTier: e.from_tier as PlanTier | null,
    toTier: e.to_tier as PlanTier | null,
    customPriceCents: e.custom_price_cents as number | null,
    note: e.note as string | null,
    actorName: e.actor_name as string | null,
    createdAt: e.created_at as string,
  }));
}
