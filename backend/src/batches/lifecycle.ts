import { pool } from "../db.js";
import { setBatchBudget } from "../licenses/service.js";
import { assertWithinLimit } from "../plans/service.js";
import { batchManagerIds, notify, orgAdminIds } from "../notifications/service.js";
import { issueForBatch } from "../certificates/service.js";
import { emitEvent } from "../webhooks/service.js";

// A batch ends `duration_months` after it starts (its start date, or the day
// it was created). Batches without a duration never end on their own.
export const BATCH_END_SQL = `(coalesce(b.start_date, b.created_at::date) + make_interval(months => b.duration_months))::date`;

export class BatchStateError extends Error {
  constructor(public code: "batch_not_found" | "batch_not_active" | "batch_not_closed" | "batch_closed" | "batch_full") {
    super(code);
  }
}

// New learners, moves and licenses only ever go into active batches.
export async function assertBatchActive(batchId: string | null | undefined): Promise<void> {
  if (!batchId) return;
  const r = await pool.query(`SELECT status FROM batches WHERE id = $1`, [batchId]);
  if (r.rowCount === 0) throw new BatchStateError("batch_not_found");
  if (r.rows[0].status !== "active") throw new BatchStateError("batch_closed");
}

async function summary(batchId: string) {
  const r = await pool.query(
    `SELECT b.name, b.target_cefr,
       count(u.id)::int AS learners,
       count(u.id) FILTER (WHERE b.target_cefr IS NOT NULL AND EXISTS (
         SELECT 1 FROM placements pl WHERE pl.user_id = u.id AND pl.cefr_level >= b.target_cefr))::int AS reached_goal,
       count(u.id) FILTER (WHERE EXISTS (SELECT 1 FROM learner_activity_daily d WHERE d.user_id = u.id AND d.sessions > 0))::int AS practised
     FROM batches b LEFT JOIN users u ON u.batch_id = b.id AND u.role = 'learner' AND u.deleted_at IS NULL
     WHERE b.id = $1 GROUP BY b.id`,
    [batchId],
  );
  return r.rows[0];
}

export async function completeBatch(args: { tenantId: string; batchId: string; actorId: string | null; automatic?: boolean }) {
  const r = await pool.query(
    `UPDATE batches SET status = 'completed', completed_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'active'
     RETURNING license_budget,
       (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = $1 AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS used`,
    [args.batchId, args.tenantId],
  );
  if (r.rowCount === 0) {
    const exists = await pool.query(`SELECT 1 FROM batches WHERE id = $1 AND tenant_id = $2`, [args.batchId, args.tenantId]);
    throw new BatchStateError(exists.rowCount ? "batch_not_active" : "batch_not_found");
  }
  // A finished batch doesn't need licenses set aside for new learners.
  const { license_budget: budget, used } = r.rows[0];
  let released = 0;
  if (budget !== null && budget > used) {
    await setBatchBudget({ tenantId: args.tenantId, batchId: args.batchId, budget: used === 0 ? null : used, actorId: args.actorId }).catch(() => {});
    released = budget - used;
  }

  // Everyone who practised gets a completion certificate.
  const certificates = await issueForBatch(args.batchId, args.actorId);
  const s = await summary(args.batchId);
  const recipients = [...new Set([...(await orgAdminIds(args.tenantId)), ...(await batchManagerIds(args.batchId))])];
  // Separate sentences, each translated on its own.
  const goal = s.target_cefr ? `${s.reached_goal} of ${s.learners} reached ${s.target_cefr}.` : null;
  for (const userId of recipients) {
    await notify({
      userId,
      kind: "batch_completed",
      title: `${s.name} is complete`,
      body: [
        args.automatic ? "The batch reached its end date." : null,
        `${s.practised} of ${s.learners} learners practised.`,
        goal,
        released ? (released === 1 ? "1 unused fixed license went back to the pool." : `${released} unused fixed licenses went back to the pool.`) : null,
        certificates ? (certificates === 1 ? "1 completion certificate issued." : `${certificates} completion certificates issued.`) : null,
      ]
        .filter(Boolean)
        .join(" "),
      link: "/orgadmin/batches",
      dedupeKey: `batchdone:${args.batchId}:${new Date().toISOString().slice(0, 10)}`,
      email: true,
      batchId: args.batchId,
    });
  }
  await emitEvent(args.tenantId, "batch.completed", {
    batchId: args.batchId,
    name: s.name,
    learners: s.learners,
    practised: s.practised,
    reachedGoal: s.reached_goal,
    automatic: !!args.automatic,
  });
  return { releasedLicenses: released, certificatesIssued: certificates };
}

export async function archiveBatch(tenantId: string, batchId: string) {
  const r = await pool.query(
    `UPDATE batches SET status = 'archived', archived_at = now(), completed_at = coalesce(completed_at, now())
     WHERE id = $1 AND tenant_id = $2 AND status <> 'archived' RETURNING id`,
    [batchId, tenantId],
  );
  if (r.rowCount === 0) throw new BatchStateError("batch_not_found");
}

export async function reopenBatch(tenantId: string, batchId: string) {
  // Reopening an archived batch brings it back under the plan's batch cap.
  const cur = await pool.query(`SELECT status FROM batches WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId]);
  if (cur.rowCount === 0) throw new BatchStateError("batch_not_found");
  if (cur.rows[0].status === "active") throw new BatchStateError("batch_not_closed");
  if (cur.rows[0].status === "archived") await assertWithinLimit(tenantId, "batches");
  await pool.query(`UPDATE batches SET status = 'active', completed_at = NULL, archived_at = NULL WHERE id = $1`, [batchId]);
}

// Same setup, fresh start: goals, duration, reminders and Managers carry
// over; learners, dates and licenses don't.
export async function cloneBatch(args: { tenantId: string; batchId: string; name: string; startDate?: string | null; copyManagers: boolean; actorId: string }) {
  await assertWithinLimit(args.tenantId, "batches");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO batches (tenant_id, name, duration_months, start_date, target_cut_score, start_cefr, target_cefr, auto_reminders, created_by, cloned_from)
       SELECT tenant_id, $3, duration_months, $4, target_cut_score, start_cefr, target_cefr, auto_reminders, $5, id
       FROM batches WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [args.batchId, args.tenantId, args.name, args.startDate ?? null, args.actorId],
    );
    if (r.rowCount === 0) throw new BatchStateError("batch_not_found");
    const id = r.rows[0].id as string;
    if (args.copyManagers) {
      await client.query(
        `INSERT INTO batch_managers (batch_id, user_id)
         SELECT $1, bm.user_id FROM batch_managers bm JOIN users u ON u.id = bm.user_id WHERE bm.batch_id = $2 AND u.deleted_at IS NULL`,
        [id, args.batchId],
      );
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Periodic: close batches whose end date has passed in the organization's
// own time zone.
export async function autoCompleteBatches(): Promise<number> {
  const due = await pool.query(
    `SELECT b.id, b.tenant_id FROM batches b JOIN tenants t ON t.id = b.tenant_id
     WHERE b.status = 'active' AND b.duration_months IS NOT NULL AND t.deactivated_at IS NULL
       AND ${BATCH_END_SQL} < (now() AT TIME ZONE t.timezone)::date`,
  );
  for (const b of due.rows) {
    await completeBatch({ tenantId: b.tenant_id, batchId: b.id, actorId: null, automatic: true }).catch((err) =>
      console.error(`auto-complete of batch ${b.id} failed:`, err),
    );
  }
  return due.rowCount ?? 0;
}
