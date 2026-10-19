import { pool } from "../db.js";
import { notify, orgAdminIds } from "../notifications/service.js";
import { LicenseError, assignMonths, reclaimMonths, setBatchBudget, setManagerAllotment } from "./service.js";

export type RequestKind = "increase_allotment" | "decrease_allotment" | "unassign_learner" | "learner_extension";

export class RequestError extends Error {
  constructor(
    public code:
      | "request_not_found"
      | "not_pending"
      | "invalid_batch"
      | "invalid_learner"
      | "nothing_to_unassign"
      | "insufficient_unreserved"
      | "no_licenses_left",
  ) {
    super(code);
  }
}

// Whole phrases for one and for several, so they translate.
function describe(kind: RequestKind, quantity: number, batchName: string | null, learner: string | null): string {
  const target = batchName ?? "their own pool";
  const who = learner ?? "a learner";
  const one = quantity === 1;
  if (kind === "increase_allotment") return one ? `1 license more for ${target}` : `${quantity} licenses more for ${target}`;
  if (kind === "decrease_allotment") return one ? `1 license fewer for ${target}` : `${quantity} licenses fewer for ${target}`;
  if (kind === "learner_extension") return one ? `1 more month of access for ${who}` : `${quantity} more months of access for ${who}`;
  return one ? `Return 1 unused month from ${who}` : `Return ${quantity} unused months from ${who}`;
}

export async function createRequest(args: {
  tenantId: string;
  managerId: string;
  managerBatchIds: string[];
  kind: RequestKind;
  quantity: number;
  batchId?: string | null;
  learnerId?: string | null;
  reason: string;
}): Promise<string> {
  let batchId = args.batchId ?? null;
  let learnerLabel: string | null = null;
  if (args.kind === "unassign_learner") {
    const l = await pool.query(
      `SELECT u.batch_id, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS label FROM users u
       WHERE u.id = $1 AND u.role = 'learner' AND u.batch_id = ANY($2::uuid[])`,
      [args.learnerId, args.managerBatchIds],
    );
    if (l.rowCount === 0) throw new RequestError("invalid_learner");
    batchId = l.rows[0].batch_id;
    learnerLabel = l.rows[0].label;
  } else if (batchId && !args.managerBatchIds.includes(batchId)) {
    // No batch = a change to the Manager's own pool.
    throw new RequestError("invalid_batch");
  }

  const batch = batchId ? (await pool.query(`SELECT name FROM batches WHERE id = $1`, [batchId])).rows[0] : null;
  const manager = (await pool.query(`SELECT first_name, last_name, email FROM users WHERE id = $1`, [args.managerId])).rows[0];
  const managerName = [manager?.first_name, manager?.last_name].filter(Boolean).join(" ") || manager?.email || "A Manager";

  const inserted = await pool.query(
    `INSERT INTO license_requests (tenant_id, batch_id, learner_id, requested_by, kind, quantity, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [args.tenantId, batchId, args.kind === "unassign_learner" ? args.learnerId : null, args.managerId, args.kind, args.quantity, args.reason],
  );
  const id = inserted.rows[0].id;
  for (const adminId of await orgAdminIds(args.tenantId)) {
    await notify({
      userId: adminId,
      kind: "license_request",
      title: `${managerName} requests ${describe(args.kind, args.quantity, batch?.name ?? null, learnerLabel)}`,
      body: `Reason: ${args.reason}`,
      link: "/orgadmin/licenses?tab=requests",
      email: true,
      sentBy: args.managerId,
      batchId,
      meta: { requestId: id },
    });
  }
  return id;
}

// A learner asks their organization for more time. One open request at a
// time: asking again returns the one already waiting. Org admins and the
// learner's batch managers are told, with the learner's progress attached.
export async function createLearnerRequest(args: { tenantId: string; learnerId: string; months: number; reason: string; progress: string }): Promise<string> {
  const open = (
    await pool.query(`SELECT id FROM license_requests WHERE learner_id = $1 AND kind = 'learner_extension' AND status = 'pending' LIMIT 1`, [args.learnerId])
  ).rows[0];
  if (open) return open.id;
  const learner = (
    await pool.query(
      `SELECT batch_id, coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS label FROM users WHERE id = $1 AND role = 'learner' AND tenant_id = $2`,
      [args.learnerId, args.tenantId],
    )
  ).rows[0];
  if (!learner) throw new RequestError("invalid_learner");
  const reason = args.reason.trim() || "More time to reach my goal.";
  const id = (
    await pool.query(
      `INSERT INTO license_requests (tenant_id, batch_id, learner_id, requested_by, kind, quantity, reason)
       VALUES ($1, $2, $3, $3, 'learner_extension', $4, $5) RETURNING id`,
      // The learner's note, then their progress on its own line for the admin.
      [args.tenantId, learner.batch_id, args.learnerId, args.months, `${reason}\n${args.progress}`],
    )
  ).rows[0].id;
  const managers = learner.batch_id
    ? (await pool.query(`SELECT user_id FROM batch_managers WHERE batch_id = $1`, [learner.batch_id])).rows.map((r) => r.user_id as string)
    : [];
  const admins = await orgAdminIds(args.tenantId);
  for (const userId of [...new Set([...admins, ...managers])]) {
    const isAdmin = admins.includes(userId);
    await notify({
      userId,
      kind: "license_request",
      // Whole sentences, so they translate in the reader's language.
      title: args.months === 1 ? `${learner.label} asks for 1 more month of access` : `${learner.label} asks for ${args.months} more months of access`,
      body: isAdmin ? `${args.progress} Reason: ${reason}` : `${args.progress} Reason: ${reason} (Your Org Admin decides.)`,
      link: isAdmin ? "/orgadmin/licenses?tab=requests" : "/manager/dashboard",
      email: true,
      sentBy: args.learnerId,
      batchId: learner.batch_id,
      meta: { requestId: id },
    });
  }
  return id;
}

// The learner's latest request for more time, for their "keep going" card.
export async function latestLearnerRequest(learnerId: string) {
  const r = (
    await pool.query(
      `SELECT id, quantity, status, created_at, decided_at, decision_note FROM license_requests
       WHERE learner_id = $1 AND requested_by = $1 AND kind = 'learner_extension' ORDER BY created_at DESC LIMIT 1`,
      [learnerId],
    )
  ).rows[0];
  return r ? { id: r.id, months: r.quantity, status: r.status as string, createdAt: r.created_at, decidedAt: r.decided_at, note: r.decision_note } : null;
}

export async function listRequests(filter: { tenantId: string; requestedBy?: string }) {
  const params: unknown[] = [filter.tenantId];
  let where = "r.tenant_id = $1";
  if (filter.requestedBy) {
    params.push(filter.requestedBy);
    where += ` AND r.requested_by = $${params.length}`;
  }
  const result = await pool.query(
    `SELECT r.*, b.name AS batch_name, b.license_budget,
       (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = r.batch_id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS batch_used,
       m.license_allotment AS pool_allotment,
       (SELECT count(*)::int FROM license_assignments a WHERE a.source = 'manager' AND a.source_manager_id = r.requested_by AND a.reclaimed_at IS NULL) AS pool_used,
       coalesce(nullif(concat_ws(' ', l.first_name, l.last_name), ''), l.email) AS learner_name,
       coalesce(nullif(concat_ws(' ', m.first_name, m.last_name), ''), m.email) AS requester_name,
       coalesce(nullif(concat_ws(' ', d.first_name, d.last_name), ''), d.email) AS decider_name
     FROM license_requests r
     LEFT JOIN batches b ON b.id = r.batch_id
     LEFT JOIN users l ON l.id = r.learner_id
     LEFT JOIN users m ON m.id = r.requested_by
     LEFT JOIN users d ON d.id = r.decided_by
     WHERE ${where}
     ORDER BY (r.status = 'pending') DESC, r.created_at DESC
     LIMIT 100`,
    params,
  );
  return result.rows.map((r) => ({
    id: r.id,
    kind: r.kind as RequestKind,
    quantity: r.quantity,
    reason: r.reason,
    status: r.status,
    batchId: r.batch_id,
    batchName: r.batch_name,
    batchAllotment: r.batch_id ? r.license_budget : r.pool_allotment,
    batchUsed: r.batch_id ? r.batch_used : r.pool_used,
    learnerId: r.learner_id,
    learnerName: r.learner_name,
    requestedBy: r.requester_name,
    decidedBy: r.decider_name,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    appliedQuantity: r.applied_quantity,
    createdAt: r.created_at,
  }));
}

export async function pendingRequestCount(tenantId: string): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int AS n FROM license_requests WHERE tenant_id = $1 AND status = 'pending'`, [tenantId]);
  return r.rows[0].n;
}

// Approving applies the change right away; the Manager is told either way.
async function applyDecision(args: {
  tenantId: string;
  requestId: string;
  approve: boolean;
  note?: string | null;
  actorId: string;
}): Promise<{ status: "approved" | "rejected"; appliedQuantity: number | null }> {
  const r = (await pool.query(`SELECT * FROM license_requests WHERE id = $1 AND tenant_id = $2`, [args.requestId, args.tenantId])).rows[0];
  if (!r) throw new RequestError("request_not_found");
  if (r.status !== "pending") throw new RequestError("not_pending");

  let applied: number | null = null;
  let note = args.note ?? null;
  if (args.approve) {
    if (r.kind === "learner_extension") {
      try {
        await assignMonths({ tenantId: args.tenantId, userId: r.learner_id, months: r.quantity, actorId: args.actorId, actorRole: "org_admin" });
        applied = r.quantity;
      } catch (err) {
        if (err instanceof LicenseError) throw new RequestError("no_licenses_left");
        throw err;
      }
    } else if (r.kind === "unassign_learner") {
      try {
        applied = await reclaimMonths({
          tenantId: args.tenantId,
          userId: r.learner_id,
          months: r.quantity,
          actorId: args.actorId,
          reason: `Manager request: ${r.reason}`,
        });
      } catch {
        throw new RequestError("nothing_to_unassign");
      }
    } else if (!r.batch_id) {
      const m = (
        await pool.query(
          `SELECT license_allotment, (SELECT count(*)::int FROM license_assignments WHERE source = 'manager' AND source_manager_id = $1 AND reclaimed_at IS NULL) AS used
           FROM users WHERE id = $1`,
          [r.requested_by],
        )
      ).rows[0];
      const current = m?.license_allotment ?? 0;
      const target = r.kind === "increase_allotment" ? current + r.quantity : Math.max(m?.used ?? 0, current - r.quantity);
      applied = Math.abs(target - current);
      if (r.kind === "decrease_allotment" && applied < r.quantity) {
        note = [note, `Reduced by ${applied} — ${m.used} already assigned from this pool.`].filter(Boolean).join(" ");
      }
      try {
        await setManagerAllotment({ tenantId: args.tenantId, managerId: r.requested_by, allotment: target, actorId: args.actorId });
      } catch (err) {
        if (err instanceof LicenseError && err.code === "insufficient_unreserved") throw new RequestError("insufficient_unreserved");
        throw err;
      }
    } else {
      const b = (
        await pool.query(
          `SELECT license_budget, (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = $1 AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS used
           FROM batches WHERE id = $1`,
          [r.batch_id],
        )
      ).rows[0];
      const current = b?.license_budget ?? 0;
      const target = r.kind === "increase_allotment" ? current + r.quantity : Math.max(b?.used ?? 0, current - r.quantity);
      applied = Math.abs(target - current);
      if (r.kind === "decrease_allotment" && applied < r.quantity) {
        note = [note, `Reduced by ${applied} — ${b.used} already assigned in this batch.`].filter(Boolean).join(" ");
      }
      try {
        await setBatchBudget({ tenantId: args.tenantId, batchId: r.batch_id, budget: target, actorId: args.actorId });
      } catch (err) {
        if (err instanceof LicenseError && err.code === "insufficient_unreserved") throw new RequestError("insufficient_unreserved");
        throw err;
      }
    }
  }

  await pool.query(
    `UPDATE license_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4, applied_quantity = $5 WHERE id = $1`,
    [r.id, args.approve ? "approved" : "rejected", args.actorId, note, applied],
  );

  const batch = r.batch_id ? (await pool.query(`SELECT name FROM batches WHERE id = $1`, [r.batch_id])).rows[0] : null;
  const learner = r.learner_id
    ? (await pool.query(`SELECT coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) AS n FROM users WHERE id = $1`, [r.learner_id])).rows[0]
    : null;
  if (r.requested_by) {
    await notify({
      userId: r.requested_by,
      kind: "license_request_decided",
      title: args.approve
        ? `Request approved: ${describe(r.kind, r.quantity, batch?.name ?? null, learner?.n ?? null)}`
        : `Request declined: ${describe(r.kind, r.quantity, batch?.name ?? null, learner?.n ?? null)}`,
      body:
        note ??
        (r.kind === "learner_extension"
          ? args.approve
            ? "Your access has been extended. Keep going!"
            : "Your admin declined this request."
          : args.approve
            ? "The change has been applied."
            : "Your Org Admin declined this request."),
      link: r.kind === "learner_extension" ? "/dashboard" : "/manager/dashboard",
      email: true,
      sentBy: args.actorId,
      batchId: r.batch_id,
      meta: { requestId: r.id },
    });
  }
  return { status: args.approve ? "approved" : "rejected", appliedQuantity: applied };
}

const requestLockKey = (requestId: string) => `licreq:${requestId}`;

// Only one decision per request can run at a time, and a Manager cancelling
// can't slip in halfway through. Without this, two quick approvals of the same
// increase request would both apply it. Different key from the tenant lock, so
// the allotment change inside can still take that one.
export async function decideRequest(args: {
  tenantId: string;
  requestId: string;
  approve: boolean;
  note?: string | null;
  actorId: string;
}): Promise<{ status: "approved" | "rejected"; appliedQuantity: number | null }> {
  const client = await pool.connect();
  try {
    const got = await client.query(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`, [requestLockKey(args.requestId)]);
    if (!got.rows[0].ok) throw new RequestError("not_pending");
    try {
      return await applyDecision(args);
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [requestLockKey(args.requestId)]);
    }
  } finally {
    client.release();
  }
}

export async function cancelRequest(requestId: string, managerId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const got = await client.query(`SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS ok`, [requestLockKey(requestId)]);
    if (!got.rows[0].ok) {
      await client.query("ROLLBACK");
      return false;
    }
    const r = await client.query(
      `UPDATE license_requests SET status = 'cancelled', decided_at = now() WHERE id = $1 AND requested_by = $2 AND status = 'pending' RETURNING id`,
      [requestId, managerId],
    );
    await client.query("COMMIT");
    return (r.rowCount ?? 0) > 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
