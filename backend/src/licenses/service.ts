import type { PoolClient } from "pg";
import { assertFeature } from "../plans/service.js";
import { invalidateAccess } from "./accessCache.js";
import { emitEvent } from "../webhooks/service.js";
import { pool } from "../db.js";

export const LICENSE_PRICE_CENTS = 10000; // 100 USD per license-month
export const GRACE_DAYS = 3;
export const POOL_VALIDITY_MONTHS = 12;
export const EXPIRING_SOON_DAYS = 7;

export type LicenseSource = "purchase" | "credit" | "comp";
export type AccessStatus = "active" | "grace" | "expired" | "none";

export class LicenseError extends Error {
  constructor(
    public code:
      | "insufficient_licenses"
      | "insufficient_unreserved"
      | "below_used"
      | "no_budget"
      | "budget_exceeded"
      | "learner_not_found"
      | "nothing_to_reclaim"
      | "manager_not_found"
      | "batch_not_found",
  ) {
    super(code);
  }
}

export interface LearnerAccess {
  status: AccessStatus;
  accessEndsAt: string | null;
  graceEndsAt: string | null;
  currentEndsAt: string | null;
  queuedMonths: number;
  totalMonths: number;
}

const EMPTY_ACCESS: LearnerAccess = {
  status: "none",
  accessEndsAt: null,
  graceEndsAt: null,
  currentEndsAt: null,
  queuedMonths: 0,
  totalMonths: 0,
};

// Live status from assignments — nothing is stored, so it can never drift.
// Months are always contiguous (each new one starts where the last ends), so
// the latest end date is when access runs out.
export async function learnerAccessMap(userIds: string[]): Promise<Map<string, LearnerAccess>> {
  const map = new Map<string, LearnerAccess>();
  if (userIds.length === 0) return map;
  const result = await pool.query(
    `SELECT user_id,
       max(ends_at) AS access_ends_at,
       max(ends_at) FILTER (WHERE starts_at <= now() AND ends_at > now()) AS current_ends_at,
       count(*) FILTER (WHERE starts_at > now())::int AS queued,
       count(*)::int AS total
     FROM license_assignments
     WHERE user_id = ANY($1::uuid[]) AND reclaimed_at IS NULL
     GROUP BY user_id`,
    [userIds],
  );
  const now = Date.now();
  for (const r of result.rows) {
    const ends = new Date(r.access_ends_at);
    const graceEnds = new Date(ends.getTime() + GRACE_DAYS * 86400000);
    const status: AccessStatus = r.current_ends_at || ends.getTime() > now ? "active" : graceEnds.getTime() > now ? "grace" : "expired";
    map.set(r.user_id, {
      status,
      accessEndsAt: ends.toISOString(),
      graceEndsAt: graceEnds.toISOString(),
      currentEndsAt: r.current_ends_at ? new Date(r.current_ends_at).toISOString() : null,
      queuedMonths: r.queued,
      totalMonths: r.total,
    });
  }
  for (const id of userIds) if (!map.has(id)) map.set(id, { ...EMPTY_ACCESS });
  return map;
}

export async function learnerAccess(userId: string): Promise<LearnerAccess> {
  return (await learnerAccessMap([userId])).get(userId)!;
}

type Executor = Pick<PoolClient, "query">;

// Licenses set aside but not yet assigned: what's left of each batch's fixed
// allotment and each Manager's pool. These are off-limits to anyone else.
export async function reservedRemaining(tenantId: string, executor: Executor = pool) {
  const r = await executor.query(
    `SELECT
       (SELECT coalesce(sum(greatest(b.license_budget - (SELECT count(*) FROM license_assignments a
           WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL), 0)), 0)::int
        FROM batches b WHERE b.tenant_id = $1 AND b.license_budget IS NOT NULL) AS batches,
       (SELECT coalesce(sum(greatest(u.license_allotment - (SELECT count(*) FROM license_assignments a
           WHERE a.source = 'manager' AND a.source_manager_id = u.id AND a.reclaimed_at IS NULL), 0)), 0)::int
        FROM users u WHERE u.tenant_id = $1 AND u.role = 'manager' AND u.deleted_at IS NULL AND u.license_allotment IS NOT NULL) AS managers`,
    [tenantId],
  );
  const batches = r.rows[0].batches as number;
  const managers = r.rows[0].managers as number;
  return { batches, managers, total: batches + managers };
}

async function physicallyAvailable(tenantId: string, executor: Executor = pool): Promise<number> {
  const r = await executor.query(
    `SELECT coalesce(sum(p.quantity - (SELECT count(*) FROM license_assignments a WHERE a.purchase_id = p.id AND a.reclaimed_at IS NULL)), 0)::int AS n
     FROM license_purchases p WHERE p.tenant_id = $1 AND p.pool_expires_at > now()`,
    [tenantId],
  );
  return r.rows[0].n;
}

export async function unreservedAvailable(tenantId: string, executor: Executor = pool): Promise<number> {
  const [avail, reserved] = await Promise.all([physicallyAvailable(tenantId, executor), reservedRemaining(tenantId, executor)]);
  return Math.max(0, avail - reserved.total);
}

export interface PoolSummary {
  reservedForBatches: number;
  reservedForManagers: number;
  unreserved: number;
  purchased: number;
  available: number;
  assigned: number;
  expiredUnused: number;
  nextPoolExpiry: string | null;
  nextPoolExpiryQuantity: number;
  activeLearners: number;
  graceLearners: number;
  expiredLearners: number;
  unlicensedLearners: number;
  expiringSoonLearners: number;
  queuedMonths: number;
}

export async function poolSummary(tenantId: string): Promise<PoolSummary> {
  const [lots, learners] = await Promise.all([
    pool.query(
      `SELECT p.quantity, p.pool_expires_at, count(a.id) FILTER (WHERE a.reclaimed_at IS NULL)::int AS used
       FROM license_purchases p LEFT JOIN license_assignments a ON a.purchase_id = p.id
       WHERE p.tenant_id = $1
       GROUP BY p.id
       ORDER BY p.pool_expires_at`,
      [tenantId],
    ),
    pool.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'learner' AND deleted_at IS NULL`, [tenantId]),
  ]);
  const now = Date.now();
  let purchased = 0;
  let available = 0;
  let assigned = 0;
  let expiredUnused = 0;
  let nextPoolExpiry: string | null = null;
  let nextPoolExpiryQuantity = 0;
  for (const lot of lots.rows) {
    const remaining = lot.quantity - lot.used;
    purchased += lot.quantity;
    assigned += lot.used;
    const expires = new Date(lot.pool_expires_at);
    if (expires.getTime() > now) {
      available += remaining;
      if (remaining > 0 && !nextPoolExpiry) {
        nextPoolExpiry = expires.toISOString();
        nextPoolExpiryQuantity = remaining;
      }
    } else {
      expiredUnused += remaining;
    }
  }

  const access = await learnerAccessMap(learners.rows.map((r) => r.id));
  let activeLearners = 0;
  let graceLearners = 0;
  let expiredLearners = 0;
  let unlicensedLearners = 0;
  let expiringSoonLearners = 0;
  let queuedMonths = 0;
  for (const a of access.values()) {
    queuedMonths += a.queuedMonths;
    if (a.status === "active") {
      activeLearners++;
      if (a.accessEndsAt && new Date(a.accessEndsAt).getTime() - now < EXPIRING_SOON_DAYS * 86400000) expiringSoonLearners++;
    } else if (a.status === "grace") graceLearners++;
    else if (a.status === "expired") expiredLearners++;
    else unlicensedLearners++;
  }

  const reserved = await reservedRemaining(tenantId);
  return {
    reservedForBatches: reserved.batches,
    reservedForManagers: reserved.managers,
    unreserved: Math.max(0, available - reserved.total),
    purchased,
    available,
    assigned,
    expiredUnused,
    nextPoolExpiry,
    nextPoolExpiryQuantity,
    activeLearners,
    graceLearners,
    expiredLearners,
    unlicensedLearners,
    expiringSoonLearners,
    queuedMonths,
  };
}

export async function creditPool(args: {
  tenantId: string;
  quantity: number;
  source: LicenseSource;
  unitPriceCents?: number;
  reference?: string | null;
  note?: string | null;
  actorId: string;
  // Defaults to the standard 12 months; pilots end on a date, Enterprise may run longer.
  validityMonths?: number;
  expiresAt?: Date;
}): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const price = args.source === "comp" ? 0 : (args.unitPriceCents ?? LICENSE_PRICE_CENTS);
    const purchase = await client.query(
      `INSERT INTO license_purchases (tenant_id, quantity, unit_price_cents, source, reference, note, created_by, pool_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($9::timestamptz, now() + make_interval(months => $8)))
       RETURNING id`,
      [
        args.tenantId,
        args.quantity,
        price,
        args.source,
        args.reference ?? null,
        args.note ?? null,
        args.actorId,
        args.validityMonths ?? POOL_VALIDITY_MONTHS,
        args.expiresAt ?? null,
      ],
    );
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, actor_id, note) VALUES ($1, $2, $3, $4, $5)`,
      [args.tenantId, args.source, args.quantity, args.actorId, [args.reference, args.note].filter(Boolean).join(" — ") || null],
    );
    await client.query("COMMIT");
    return purchase.rows[0].id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// One lock per organization, always taken first, so every license mutation
// (assign, reclaim, allotment changes) runs one at a time per tenant. Row locks
// alone miss the case where a tenant has no purchase rows yet, and they never
// covered the allotment changes at all.
async function lockTenantLicenses(client: PoolClient, tenantId: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`licenses:${tenantId}`]);
}

async function lockAvailableLots(client: PoolClient, tenantId: string) {
  // Lock the tenant's lots first so two concurrent assignments can't both
  // spend the same last license.
  await client.query(`SELECT id FROM license_purchases WHERE tenant_id = $1 FOR UPDATE`, [tenantId]);
  const lots = await client.query(
    `SELECT p.id, p.quantity - count(a.id) FILTER (WHERE a.reclaimed_at IS NULL)::int AS remaining
     FROM license_purchases p LEFT JOIN license_assignments a ON a.purchase_id = p.id
     WHERE p.tenant_id = $1 AND p.pool_expires_at > now()
     GROUP BY p.id
     HAVING p.quantity - count(a.id) FILTER (WHERE a.reclaimed_at IS NULL) > 0
     ORDER BY p.pool_expires_at, p.purchased_at`,
    [tenantId],
  );
  return lots.rows as { id: string; remaining: number }[];
}

// Assign (first time) or extend (already has months) — same operation: add N
// back-to-back months after the learner's current end date, or from now if
// they've lapsed. Licenses come out of the soonest-expiring lot first.
export async function assignMonths(args: {
  tenantId: string;
  userId: string;
  months: number;
  actorId: string;
  // Decides where the licenses come from when the learner's batch has no
  // fixed allotment left: a Manager spends their own pool, everyone else
  // (Org Admin, an individual's own purchase) the unreserved pool.
  actorRole: "org_admin" | "manager" | "system";
}): Promise<{ kind: "assign" | "extend"; accessEndsAt: string; source: "org" | "batch" | "manager" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockTenantLicenses(client, args.tenantId);
    const learner = await client.query(
      `SELECT u.email, u.batch_id, b.name AS batch_name, b.license_budget
       FROM users u LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'learner'
       FOR UPDATE OF u`,
      [args.userId, args.tenantId],
    );
    if (learner.rowCount === 0) throw new LicenseError("learner_not_found");
    const l = learner.rows[0];

    const lots = await lockAvailableLots(client, args.tenantId);
    const available = lots.reduce((sum, lot) => sum + lot.remaining, 0);
    if (available < args.months) throw new LicenseError("insufficient_licenses");

    // Fixed batch allotment first; then the Manager's pool or the unreserved pool.
    let source: "org" | "batch" | "manager" = "org";
    let sourceManagerId: string | null = null;
    let batchLeft = 0;
    if (l.batch_id !== null && l.license_budget !== null) {
      const used = await client.query(
        `SELECT count(*)::int AS n FROM license_assignments WHERE batch_id = $1 AND source = 'batch' AND reclaimed_at IS NULL`,
        [l.batch_id],
      );
      batchLeft = l.license_budget - used.rows[0].n;
    }
    if (batchLeft >= args.months) {
      source = "batch";
    } else if (args.actorRole === "manager") {
      const m = await client.query(
        `SELECT license_allotment,
           (SELECT count(*)::int FROM license_assignments WHERE source = 'manager' AND source_manager_id = $1 AND reclaimed_at IS NULL) AS used
         FROM users WHERE id = $1 FOR UPDATE`,
        [args.actorId],
      );
      const allotment = m.rows[0]?.license_allotment;
      if (allotment === null || allotment === undefined) throw new LicenseError(batchLeft > 0 ? "budget_exceeded" : "no_budget");
      if (allotment - m.rows[0].used < args.months) throw new LicenseError("budget_exceeded");
      source = "manager";
      sourceManagerId = args.actorId;
    } else if ((await unreservedAvailable(args.tenantId, client)) < args.months) {
      throw new LicenseError(available >= args.months ? "insufficient_unreserved" : "insufficient_licenses");
    }

    const chain = await client.query(
      `SELECT greatest(now(), coalesce(max(ends_at), now())) AS start_at, count(*)::int AS prior
       FROM license_assignments WHERE user_id = $1 AND reclaimed_at IS NULL`,
      [args.userId],
    );
    const startAt = chain.rows[0].start_at;
    const kind = chain.rows[0].prior > 0 ? "extend" : "assign";

    let lotIndex = 0;
    let lotLeft = lots[0].remaining;
    for (let i = 0; i < args.months; i++) {
      while (lotLeft === 0) {
        lotIndex++;
        lotLeft = lots[lotIndex].remaining;
      }
      await client.query(
        `INSERT INTO license_assignments (tenant_id, purchase_id, user_id, batch_id, starts_at, ends_at, assigned_by, source, source_manager_id)
         VALUES ($1, $2, $3, $4, $5::timestamptz + make_interval(months => $6), $5::timestamptz + make_interval(months => $6 + 1), $7, $8, $9)`,
        [args.tenantId, lots[lotIndex].id, args.userId, l.batch_id, startAt, i, args.actorId, source, sourceManagerId],
      );
      lotLeft--;
    }

    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, user_id, user_email, batch_id, batch_name, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [args.tenantId, kind, args.months, args.userId, l.email, l.batch_id, l.batch_name, args.actorId],
    );
    const end = await client.query(
      `SELECT max(ends_at) AS e FROM license_assignments WHERE user_id = $1 AND reclaimed_at IS NULL`,
      [args.userId],
    );
    await client.query("COMMIT");
    invalidateAccess(args.userId);
    const accessEndsAt = new Date(end.rows[0].e).toISOString();
    await emitEvent(args.tenantId, "license.assigned", { learnerId: args.userId, months: args.months, kind, accessEndsAt });
    return { kind, accessEndsAt, source };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Return queued (not yet started) months to the pool, latest first. The
// month already running is consumed and never refunded.
export async function reclaimMonths(args: { tenantId: string; userId: string; months: number; actorId: string; reason?: string | null }): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockTenantLicenses(client, args.tenantId);
    const learner = await client.query(
      `SELECT u.email, u.batch_id, b.name AS batch_name FROM users u LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'learner'`,
      [args.userId, args.tenantId],
    );
    if (learner.rowCount === 0) throw new LicenseError("learner_not_found");
    const rows = await client.query(
      `SELECT id FROM license_assignments
       WHERE user_id = $1 AND reclaimed_at IS NULL AND starts_at > now()
       ORDER BY starts_at DESC LIMIT $2 FOR UPDATE`,
      [args.userId, args.months],
    );
    if (rows.rowCount === 0) throw new LicenseError("nothing_to_reclaim");
    await client.query(`UPDATE license_assignments SET reclaimed_at = now() WHERE id = ANY($1::uuid[])`, [rows.rows.map((r) => r.id)]);
    const l = learner.rows[0];
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, user_id, user_email, batch_id, batch_name, actor_id, note)
       VALUES ($1, 'reclaim', $2, $3, $4, $5, $6, $7, $8)`,
      [args.tenantId, rows.rowCount, args.userId, l.email, l.batch_id, l.batch_name, args.actorId, args.reason ?? null],
    );
    await client.query("COMMIT");
    invalidateAccess(args.userId);
    await emitEvent(args.tenantId, "license.reclaimed", { learnerId: args.userId, months: rows.rowCount ?? 0, reason: args.reason ?? null });
    return rows.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Raising an allotment sets aside more licenses, so the increase has to fit in
// what's unreserved; it can never go below what's already been assigned from it.
async function checkReservation(tenantId: string, oldBudget: number | null, newBudget: number | null, used: number, executor: Executor) {
  if (newBudget !== null && newBudget < used) throw new LicenseError("below_used");
  const oldRemaining = oldBudget === null ? 0 : Math.max(0, oldBudget - used);
  const newRemaining = newBudget === null ? 0 : newBudget - used;
  if (newRemaining - oldRemaining > (await unreservedAvailable(tenantId, executor))) throw new LicenseError("insufficient_unreserved");
}

// Runs fn inside a transaction that already holds the tenant's license lock.
async function withTenantLock<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockTenantLicenses(client, tenantId);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setBatchBudget(args: { tenantId: string; batchId: string; budget: number | null; actorId: string | null }): Promise<boolean> {
  return withTenantLock(args.tenantId, async (client) => {
    const current = await client.query(
      `SELECT license_budget, (SELECT count(*)::int FROM license_assignments WHERE batch_id = $1 AND source = 'batch' AND reclaimed_at IS NULL) AS used
       FROM batches WHERE id = $1 AND tenant_id = $2`,
      [args.batchId, args.tenantId],
    );
    if (current.rowCount === 0) return false;
    // Removing or lowering an allotment is always allowed, so a downgraded organization can unwind it.
    if (args.budget !== null && args.budget > (current.rows[0].license_budget ?? 0)) await assertFeature(args.tenantId, "batch_allotments", client);
    await checkReservation(args.tenantId, current.rows[0].license_budget, args.budget, current.rows[0].used, client);
    const result = await client.query(`UPDATE batches SET license_budget = $1 WHERE id = $2 AND tenant_id = $3 RETURNING name`, [
      args.budget,
      args.batchId,
      args.tenantId,
    ]);
    if (result.rowCount === 0) return false;
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, batch_id, batch_name, actor_id, note) VALUES ($1, 'budget', $2, $3, $4, $5, $6)`,
      [args.tenantId, args.budget ?? 0, args.batchId, result.rows[0].name, args.actorId, args.budget === null ? "Fixed allotment removed" : null],
    );
    return true;
  });
}

// A Manager sets licenses from their own pool aside for one of their
// batches: the pool shrinks and the batch's fixed licenses grow by the same
// amount, under one lock, so nothing else in the organization changes.
export async function movePoolToBatch(args: { tenantId: string; managerId: string; batchId: string; quantity: number }): Promise<number> {
  return withTenantLock(args.tenantId, async (client) => {
    await assertFeature(args.tenantId, "batch_allotments", client);
    const m = (
      await client.query(
        `SELECT license_allotment, email, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS name,
           (SELECT count(*)::int FROM license_assignments WHERE source = 'manager' AND source_manager_id = $1 AND reclaimed_at IS NULL) AS used
         FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager'`,
        [args.managerId, args.tenantId],
      )
    ).rows[0];
    if (!m) throw new LicenseError("manager_not_found");
    if (m.license_allotment === null || m.license_allotment - m.used < args.quantity) throw new LicenseError("budget_exceeded");
    const b = (
      await client.query(`UPDATE batches SET license_budget = coalesce(license_budget, 0) + $1 WHERE id = $2 AND tenant_id = $3 RETURNING name, license_budget`, [
        args.quantity,
        args.batchId,
        args.tenantId,
      ])
    ).rows[0];
    if (!b) throw new LicenseError("batch_not_found");
    const left = m.license_allotment - args.quantity;
    await client.query(`UPDATE users SET license_allotment = $1, updated_at = now() WHERE id = $2`, [left, args.managerId]);
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, user_id, user_email, actor_id, note) VALUES ($1, 'manager_allotment', $2, $3, $4, $3, $5)`,
      [args.tenantId, left, args.managerId, m.email, `${m.name} moved ${args.quantity} from their pool to ${b.name}`],
    );
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, batch_id, batch_name, actor_id, note) VALUES ($1, 'budget', $2, $3, $4, $5, $6)`,
      [args.tenantId, b.license_budget, args.batchId, b.name, args.managerId, `${args.quantity} from ${m.name}'s pool`],
    );
    return b.license_budget as number;
  });
}

export async function setManagerAllotment(args: { tenantId: string; managerId: string; allotment: number | null; actorId: string }): Promise<boolean> {
  return withTenantLock(args.tenantId, async (client) => {
    const current = await client.query(
      `SELECT license_allotment, email, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS name,
         (SELECT count(*)::int FROM license_assignments WHERE source = 'manager' AND source_manager_id = $1 AND reclaimed_at IS NULL) AS used
       FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager'`,
      [args.managerId, args.tenantId],
    );
    if (current.rowCount === 0) return false;
    const c = current.rows[0];
    if ((c.license_allotment ?? null) === args.allotment) return true;
    if (args.allotment !== null && args.allotment > (c.license_allotment ?? 0)) await assertFeature(args.tenantId, "manager_pools", client);
    await checkReservation(args.tenantId, c.license_allotment, args.allotment, c.used, client);
    await client.query(`UPDATE users SET license_allotment = $1, updated_at = now() WHERE id = $2`, [args.allotment, args.managerId]);
    await client.query(
      `INSERT INTO license_events (tenant_id, kind, quantity, user_id, user_email, actor_id, note) VALUES ($1, 'manager_allotment', $2, $3, $4, $5, $6)`,
      [args.tenantId, args.allotment ?? 0, args.managerId, c.email, args.actorId, `${c.name}'s pool set to ${args.allotment ?? 0}`],
    );
    return true;
  });
}

export async function managerPools(tenantId: string, managerIds?: string[]) {
  const result = await pool.query(
    `SELECT u.id, u.email, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, u.license_allotment,
       (SELECT count(*)::int FROM license_assignments a WHERE a.source = 'manager' AND a.source_manager_id = u.id AND a.reclaimed_at IS NULL) AS used
     FROM users u WHERE u.tenant_id = $1 AND u.role = 'manager' AND u.deleted_at IS NULL ${managerIds ? "AND u.id = ANY($2::uuid[])" : ""}
     ORDER BY u.first_name NULLS LAST, u.email`,
    managerIds ? [tenantId, managerIds] : [tenantId],
  );
  return result.rows.map((r) => ({
    managerId: r.id as string,
    name: r.name as string,
    email: r.email as string,
    allotment: r.license_allotment as number | null,
    used: r.used as number,
    remaining: r.license_allotment === null ? null : Math.max(0, r.license_allotment - r.used),
  }));
}

export async function batchBudgets(tenantId: string, batchIds?: string[]) {
  const result = await pool.query(
    `SELECT b.id, b.name, b.batch_code, b.license_budget, b.status,
       (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS used
     FROM batches b
     WHERE b.tenant_id = $1 ${batchIds ? "AND b.id = ANY($2::uuid[])" : ""}
     ORDER BY b.created_at DESC`,
    batchIds ? [tenantId, batchIds] : [tenantId],
  );
  return result.rows.map((r) => ({
    batchId: r.id,
    batchName: r.name,
    batchCode: r.batch_code,
    status: r.status as "active" | "completed" | "archived",
    budget: r.license_budget as number | null,
    used: r.used as number,
    remaining: r.license_budget === null ? null : Math.max(r.license_budget - r.used, 0),
  }));
}

export async function listPurchases(tenantId: string) {
  const result = await pool.query(
    `SELECT p.*, concat_ws(' ', u.first_name, u.last_name) AS created_by_name,
       count(a.id) FILTER (WHERE a.reclaimed_at IS NULL)::int AS used
     FROM license_purchases p
     LEFT JOIN users u ON u.id = p.created_by
     LEFT JOIN license_assignments a ON a.purchase_id = p.id
     WHERE p.tenant_id = $1
     GROUP BY p.id, u.first_name, u.last_name
     ORDER BY p.purchased_at DESC`,
    [tenantId],
  );
  return result.rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    used: r.used,
    remaining: r.quantity - r.used,
    unitPriceCents: r.unit_price_cents,
    totalCents: r.unit_price_cents * r.quantity,
    currency: r.currency,
    source: r.source,
    reference: r.reference,
    note: r.note,
    createdBy: r.created_by_name || null,
    purchasedAt: r.purchased_at,
    poolExpiresAt: r.pool_expires_at,
    poolExpired: new Date(r.pool_expires_at).getTime() <= Date.now(),
  }));
}

export async function listEvents(tenantId: string, limit = 50) {
  const result = await pool.query(
    `SELECT e.*, concat_ws(' ', u.first_name, u.last_name) AS actor_name, u.role AS actor_role
     FROM license_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.tenant_id = $1
     ORDER BY e.created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    quantity: r.quantity,
    learnerEmail: r.user_email,
    batchName: r.batch_name,
    actor: r.actor_name || null,
    actorRole: r.actor_role,
    note: r.note,
    createdAt: r.created_at,
  }));
}

// Learner rows + live license status, for the Licenses page and Manager view.
export async function learnerLicenseRows(tenantId: string, batchIds?: string[]) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.participant_id, u.deleted_at, b.id AS batch_id, b.name AS batch_name
     FROM users u LEFT JOIN batches b ON b.id = u.batch_id
     WHERE u.tenant_id = $1 AND u.role = 'learner' ${batchIds ? "AND u.batch_id = ANY($2::uuid[])" : ""}
     ORDER BY u.first_name NULLS LAST, u.email`,
    batchIds ? [tenantId, batchIds] : [tenantId],
  );
  const access = await learnerAccessMap(result.rows.map((r) => r.id));
  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.first_name,
    lastName: r.last_name,
    participantId: r.participant_id,
    active: !r.deleted_at,
    batchId: r.batch_id,
    batchName: r.batch_name,
    license: access.get(r.id)!,
  }));
}

// ---- Individual learners: free tier unless they hold an active plan ----

export const FREE_PRACTICE_SESSIONS_PER_WEEK = 3;

export async function learnerKind(userId: string): Promise<"org" | "individual" | "other"> {
  const result = await pool.query(
    `SELECT t.type FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.role = 'learner'`,
    [userId],
  );
  const type = result.rows[0]?.type;
  if (!type) return "other";
  return type === "cohort" ? "org" : "individual";
}

export async function freeTierUsage(userId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND started_at > now() - interval '7 days') AS practice_used,
       EXISTS (SELECT 1 FROM sessions WHERE user_id = $1 AND session_type = 'practice' AND completed_at IS NULL) AS has_open_practice,
       EXISTS (SELECT 1 FROM placements WHERE user_id = $1) AS placement_taken`,
    [userId],
  );
  const r = result.rows[0];
  return {
    practiceUsed: r.practice_used as number,
    practiceLimit: FREE_PRACTICE_SESSIONS_PER_WEEK,
    hasOpenPractice: r.has_open_practice as boolean,
    placementTaken: r.placement_taken as boolean,
  };
}

// ---- Offboarding: give back what a departing person no longer needs ----

// A learner who leaves keeps the month that's already running (it's
// consumed) but every month that hasn't started goes back to the pool.
export async function releaseQueuedMonths(args: { tenantId: string; userId: string; actorId: string; reason: string }): Promise<number> {
  try {
    return await reclaimMonths({ ...args, months: 1000 });
  } catch (err) {
    if (err instanceof LicenseError && (err.code === "nothing_to_reclaim" || err.code === "learner_not_found")) return 0;
    throw err;
  }
}

// A Manager who leaves stops holding licenses they never assigned: their
// pool shrinks to what's already been used from it.
export async function releaseManagerPool(args: { tenantId: string; managerId: string; actorId: string }): Promise<number> {
  const m = await pool.query(
    `SELECT license_allotment,
       (SELECT count(*)::int FROM license_assignments WHERE source = 'manager' AND source_manager_id = $1 AND reclaimed_at IS NULL) AS used
     FROM users WHERE id = $1 AND tenant_id = $2 AND role = 'manager'`,
    [args.managerId, args.tenantId],
  );
  const row = m.rows[0];
  if (!row || row.license_allotment === null || row.license_allotment <= row.used) return 0;
  await setManagerAllotment({ tenantId: args.tenantId, managerId: args.managerId, allotment: row.used === 0 ? null : row.used, actorId: args.actorId });
  return row.license_allotment - row.used;
}
