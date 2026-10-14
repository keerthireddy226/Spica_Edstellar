import { z } from "zod";
import { pool } from "../db.js";

export const moveLearnerSchema = z.object({
  batchId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export type MoveResult = { ok: true } | { ok: false; error: "learner_not_found" | "already_in_batch" };

// A learner belongs to exactly one batch (users.batch_id). Moving swaps that
// one value and records the move, so the old batch never "keeps" them and
// history isn't lost. Callers have already checked the caller is allowed to
// touch both the learner and the target batch.
export async function moveLearnerToBatch(args: {
  learnerId: string;
  toBatchId: string;
  movedBy: string;
  reason?: string;
}): Promise<MoveResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT u.batch_id, b.name AS batch_name FROM users u LEFT JOIN batches b ON b.id = u.batch_id
       WHERE u.id = $1 AND u.role = 'learner' FOR UPDATE OF u`,
      [args.learnerId],
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "learner_not_found" };
    }
    if (current.rows[0].batch_id === args.toBatchId) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_in_batch" };
    }
    const target = await client.query(`SELECT name FROM batches WHERE id = $1`, [args.toBatchId]);
    await client.query(`UPDATE users SET batch_id = $1, updated_at = now() WHERE id = $2`, [args.toBatchId, args.learnerId]);
    await client.query(
      `INSERT INTO batch_moves (user_id, from_batch_id, to_batch_id, from_batch_name, to_batch_name, moved_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        args.learnerId,
        current.rows[0].batch_id,
        args.toBatchId,
        current.rows[0].batch_name,
        target.rows[0]?.name ?? null,
        args.movedBy,
        args.reason || null,
      ],
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
