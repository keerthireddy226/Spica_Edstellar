import { z } from "zod";
import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { createAndInviteUser } from "../auth/invite.js";

export const managerRouter = Router();

const PG_UNIQUE_VIOLATION = "23505";
const MAX_BULK_ROWS = 200;

const GENUINELY_COMPLETED = `
  completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM attempts a WHERE a.session_id = sessions.id AND a.response_text IS NULL AND a.response_uri IS NULL
  )
`;

function requireManager(req: AuthedRequest, res: import("express").Response): boolean {
  if (!req.user || req.user.role !== "manager") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

// Every batch id a Manager is ever allowed to touch — batch_managers is the
// only source of truth for a Manager's scope, never their tenant_id alone
// (that would also include every other batch in the organization).
async function assignedBatchIds(userId: string): Promise<string[]> {
  const result = await pool.query(`SELECT batch_id FROM batch_managers WHERE user_id = $1`, [userId]);
  return result.rows.map((r) => r.batch_id);
}

managerRouter.get("/overview", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    if (batchIds.length === 0) {
      return res.json({ batches: [], totalLearners: 0, sessionsCompletedToday: 0 });
    }
    const [batches, sessionsToday] = await Promise.all([
      pool.query(
        `SELECT b.id, b.name, count(l.id)::int AS learner_count
         FROM batches b
         LEFT JOIN users l ON l.batch_id = b.id AND l.role = 'learner' AND l.deleted_at IS NULL
         WHERE b.id = ANY($1::uuid[])
         GROUP BY b.id
         ORDER BY b.created_at DESC`,
        [batchIds],
      ),
      pool.query(
        `SELECT count(*)::int AS n FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.batch_id = ANY($1::uuid[]) AND s.completed_at::date = current_date AND ${GENUINELY_COMPLETED.replace(/sessions\.id/g, "s.id")}`,
        [batchIds],
      ),
    ]);
    res.json({
      batches: batches.rows.map((r) => ({ id: r.id, name: r.name, learnerCount: r.learner_count })),
      totalLearners: batches.rows.reduce((sum, r) => sum + r.learner_count, 0),
      sessionsCompletedToday: sessionsToday.rows[0].n,
    });
  } catch (err) {
    next(err);
  }
});

managerRouter.get("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const batchIds = await assignedBatchIds(req.user!.id);
    if (batchIds.length === 0) return res.json({ learners: [] });
    const result = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.deleted_at, u.created_at, b.name AS batch_name,
         count(s.id) FILTER (WHERE ${GENUINELY_COMPLETED.replace(/sessions\./g, "s.")})::int AS session_count
       FROM users u
       LEFT JOIN batches b ON b.id = u.batch_id
       LEFT JOIN sessions s ON s.user_id = u.id
       WHERE u.batch_id = ANY($1::uuid[]) AND u.role = 'learner'
       GROUP BY u.id, b.name
       ORDER BY u.created_at DESC`,
      [batchIds],
    );
    res.json({
      learners: result.rows.map((r) => ({
        id: r.id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        batchName: r.batch_name,
        sessionCount: r.session_count,
        active: !r.deleted_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const onboardLearnerSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  batchId: z.string().uuid(),
});

managerRouter.post("/learners", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = onboardLearnerSchema.parse(req.body);
    const batchIds = await assignedBatchIds(req.user!.id);
    if (!batchIds.includes(body.batchId)) {
      return res.status(403).json({ error: "not_your_batch" });
    }
    const { id } = await createAndInviteUser({
      role: "learner",
      tenantId: req.user!.tenantId!,
      batchId: body.batchId,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      roleLabel: "a Learner",
    });
    res.status(201).json({ id, email: body.email });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  }
});

const bulkLearnerRowSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

managerRouter.post("/learners/bulk", requireAuth, async (req: AuthedRequest, res, next) => {
  if (!requireManager(req, res)) return;
  try {
    const body = z.object({ batchId: z.string().uuid(), rows: z.array(z.unknown()).max(MAX_BULK_ROWS) }).parse(req.body);
    const batchIds = await assignedBatchIds(req.user!.id);
    if (!batchIds.includes(body.batchId)) {
      return res.status(403).json({ error: "not_your_batch" });
    }

    const results: { email: string; status: "created" | "duplicate" | "invalid"; message?: string }[] = [];
    for (const raw of body.rows) {
      const parsed = bulkLearnerRowSchema.safeParse(raw);
      if (!parsed.success) {
        const emailGuess = typeof (raw as Record<string, unknown>)?.email === "string" ? (raw as { email: string }).email : "(unknown)";
        results.push({ email: emailGuess, status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid row" });
        continue;
      }
      try {
        await createAndInviteUser({
          role: "learner",
          tenantId: req.user!.tenantId!,
          batchId: body.batchId,
          email: parsed.data.email,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          roleLabel: "a Learner",
        });
        results.push({ email: parsed.data.email, status: "created" });
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
          results.push({ email: parsed.data.email, status: "duplicate" });
        } else {
          results.push({ email: parsed.data.email, status: "invalid", message: "Something went wrong creating this account." });
        }
      }
    }

    res.status(201).json({ results });
  } catch (err) {
    next(err);
  }
});
