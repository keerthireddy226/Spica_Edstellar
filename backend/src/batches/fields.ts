import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { BatchStateError } from "./lifecycle.js";

type Executor = Pick<PoolClient, "query">;

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export const EXAM_FOCUS = [
  "general",
  "versant_four_skills",
  "versant_speaking_listening",
  "versant_writing",
  "versant_professional",
  "versant_placement",
  "ielts",
  "toefl",
  "pte",
  "cambridge",
] as const;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

// Everything an Org Admin or Manager can say about a batch. Every field but
// the name is optional; on edit, a field left out is left alone.
export const batchDetailsBase = z.object({
    name: z.string().trim().min(1).max(200),
    description: optText(1000),
    department: optText(120),
    location: optText(120),
    examFocus: z.enum(EXAM_FOCUS).nullable().optional(),
    startDate: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ? v : v === "" ? null : v)),
    durationMonths: z.coerce.number().int().min(1).max(36).nullable().optional(),
    startCefr: z.enum(CEFR).nullable().optional(),
    targetCefr: z.enum(CEFR).nullable().optional(),
    targetCutScore: z.coerce.number().min(0).max(100).nullable().optional(),
    weeklyMinutesGoal: z.coerce.number().int().min(10).max(2000).nullable().optional(),
    capacity: z.coerce.number().int().min(1).max(10000).nullable().optional(),
    defaultLicenseMonths: z.coerce.number().int().min(0).max(24).nullable().optional(),
    autoReminders: z.boolean().optional(),
});

const levelsInOrder = (b: { startCefr?: string | null; targetCefr?: string | null }) =>
  !b.startCefr || !b.targetCefr || CEFR.indexOf(b.targetCefr as (typeof CEFR)[number]) > CEFR.indexOf(b.startCefr as (typeof CEFR)[number]);
const levelsMessage = { message: "target_level_must_be_above_start", path: ["targetCefr"] };

export const batchDetailsSchema = batchDetailsBase.refine(levelsInOrder, levelsMessage);
export const batchEditSchema = batchDetailsBase.partial().refine(levelsInOrder, levelsMessage);

export type BatchDetails = z.infer<typeof batchDetailsBase>;

const COLUMNS: Record<Exclude<keyof BatchDetails, "name">, string> = {
  description: "description",
  department: "department",
  location: "location",
  examFocus: "exam_focus",
  startDate: "start_date",
  durationMonths: "duration_months",
  startCefr: "start_cefr",
  targetCefr: "target_cefr",
  targetCutScore: "target_cut_score",
  weeklyMinutesGoal: "weekly_minutes_goal",
  capacity: "capacity",
  defaultLicenseMonths: "default_license_months",
  autoReminders: "auto_reminders",
};

export async function insertBatch(tenantId: string, d: BatchDetails, createdBy: string, ex: Executor = pool): Promise<string> {
  const cols = ["tenant_id", "name", "created_by"];
  const vals: unknown[] = [tenantId, d.name, createdBy];
  for (const [k, col] of Object.entries(COLUMNS)) {
    const v = d[k as keyof BatchDetails];
    if (v === undefined || v === null) continue;
    cols.push(col);
    vals.push(v);
  }
  const r = await ex.query(
    `INSERT INTO batches (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    vals,
  );
  return r.rows[0].id;
}

export async function updateBatch(batchId: string, tenantId: string, d: Partial<BatchDetails>): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (d.name !== undefined) {
    vals.push(d.name);
    sets.push(`name = $${vals.length}`);
  }
  for (const [k, col] of Object.entries(COLUMNS)) {
    const v = d[k as keyof BatchDetails];
    if (v === undefined) continue;
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length === 0) return true;
  vals.push(batchId, tenantId);
  const r = await pool.query(`UPDATE batches SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} RETURNING id`, vals);
  return (r.rowCount ?? 0) > 0;
}

// The detail fields of a batches row, as the API returns them.
export function batchDetailsJson(r: Record<string, any>) {
  return {
    description: r.description ?? null,
    department: r.department ?? null,
    location: r.location ?? null,
    examFocus: r.exam_focus ?? null,
    weeklyMinutesGoal: r.weekly_minutes_goal ?? null,
    capacity: r.capacity ?? null,
    defaultLicenseMonths: r.default_license_months ?? null,
    autoReminders: r.auto_reminders ?? false,
  };
}

// A batch with a capacity takes no more active learners than that.
export async function assertBatchCapacity(batchId: string | null | undefined, adding = 1): Promise<void> {
  if (!batchId) return;
  const r = await pool.query(
    `SELECT b.capacity, (SELECT count(*)::int FROM users u WHERE u.batch_id = b.id AND u.role = 'learner' AND u.deleted_at IS NULL) AS n
     FROM batches b WHERE b.id = $1`,
    [batchId],
  );
  const b = r.rows[0];
  if (b?.capacity && b.n + adding > b.capacity) throw new BatchStateError("batch_full");
}

// Detail columns of batches, for SELECTs that alias the table as b.
export const BATCH_DETAIL_SQL = `b.description, b.department, b.location, b.exam_focus,
  b.weekly_minutes_goal, b.capacity, b.default_license_months, b.auto_reminders`;

// License picture of one batch (aliased b): where its learners' licenses
// came from, and how many active learners have access now.
export const BATCH_LICENSE_SQL = `(SELECT json_build_object(
    'fixedUsed', (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL),
    'fromPool', (SELECT count(*)::int FROM license_assignments a JOIN users pu ON pu.id = a.user_id
                 WHERE pu.batch_id = b.id AND a.source = 'manager' AND a.reclaimed_at IS NULL),
    'fromOrg', (SELECT count(*)::int FROM license_assignments a JOIN users pu ON pu.id = a.user_id
                WHERE pu.batch_id = b.id AND a.source = 'org' AND a.reclaimed_at IS NULL),
    'learners', count(*)::int,
    'licensed', (count(*) FILTER (WHERE x.ends > now()))::int,
    'endingSoon', (count(*) FILTER (WHERE x.ends > now() AND x.ends < now() + interval '14 days'))::int,
    'unlicensed', (count(*) FILTER (WHERE x.ends IS NULL OR x.ends <= now()))::int)
  FROM (SELECT (SELECT max(a.ends_at) FROM license_assignments a WHERE a.user_id = lu.id AND a.reclaimed_at IS NULL) AS ends
        FROM users lu WHERE lu.batch_id = b.id AND lu.role = 'learner' AND lu.deleted_at IS NULL) x) AS license_stats`;

export type BatchLicenseStats = {
  fixedUsed: number;
  fromPool: number;
  fromOrg: number;
  learners: number;
  licensed: number;
  endingSoon: number;
  unlicensed: number;
};

// How many months a Manager can give one learner in this batch right now:
// the batch's fixed licenses, or else the Manager's own pool (one source per
// assignment, as assignMonths does it).
export async function managerLicenseRoom(managerId: string, batchId: string): Promise<{ fixedLeft: number | null; poolLeft: number | null; room: number }> {
  const r = await pool.query(
    `SELECT b.license_budget - (SELECT count(*)::int FROM license_assignments a WHERE a.batch_id = b.id AND a.source = 'batch' AND a.reclaimed_at IS NULL) AS fixed_left,
       m.license_allotment - (SELECT count(*)::int FROM license_assignments a WHERE a.source = 'manager' AND a.source_manager_id = m.id AND a.reclaimed_at IS NULL) AS pool_left
     FROM batches b, users m WHERE b.id = $1 AND m.id = $2`,
    [batchId, managerId],
  );
  const row = r.rows[0] ?? {};
  const fixedLeft = row.fixed_left ?? null;
  const poolLeft = row.pool_left ?? null;
  return { fixedLeft, poolLeft, room: Math.max(0, fixedLeft ?? 0, poolLeft ?? 0) };
}
