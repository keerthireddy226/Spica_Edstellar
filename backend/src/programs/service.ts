// Programs: an organization's goal for one batch, and each member's plan of
// practice tests and mock exams towards it (ASSESSMENT_ENGINE.md section 8).
import { z } from "zod";
import { pool } from "../db.js";
import { CEFR_LEVELS } from "../placement/cefr.js";
import { learnerQuota, quotaWindow } from "./quotas.js";
import { buildSchedule, programGap } from "./schedule.js";
import type { DeliveryMode } from "../practiceTests/modes.js";

const cefr = z.enum(CEFR_LEVELS as [string, ...string[]]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const DOMAINS = ["general", "banking", "bpo", "it", "insurance", "healthcare"] as const;
const SKILLS = ["listening", "speaking", "reading", "writing"] as const;

export const programSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    batchId: z.string().uuid(),
    testTypeId: z.string().min(1).max(60),
    domain: z.enum(DOMAINS).default("general"),
    targetLevel: cefr,
    targetSkills: z.partialRecord(z.enum(SKILLS), cefr).default({}),
    startsOn: isoDate,
    targetDate: isoDate,
  })
  .refine((p) => p.targetDate > p.startsOn, { message: "targetDate must be after startsOn", path: ["targetDate"] });

export const programEditSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  domain: z.enum(DOMAINS).optional(),
  targetLevel: cefr.optional(),
  targetSkills: z.partialRecord(z.enum(SKILLS), cefr).optional(),
  targetDate: isoDate.optional(),
  status: z.enum(["active", "completed", "archived"]).optional(),
});

export class ProgramError extends Error {
  constructor(public code: "batch_not_found" | "batch_not_active" | "unknown_test_type" | "test_type_not_enabled" | "batch_has_program" | "program_not_found" | "bad_dates") {
    super(code);
  }
}

interface ProgramRow {
  id: string;
  tenant_id: string;
  name: string;
  domain: string;
  test_type_id: string;
  target_level: string;
  target_skills: Record<string, string>;
  batch_id: string;
  starts_on: string;
  target_date: string;
  status: "active" | "completed" | "archived";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// node-pg returns DATE columns as local-midnight Date objects; programs
// work in plain YYYY-MM-DD strings.
function dateStr(v: unknown): string {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}

function normalizeRow(r: Record<string, unknown>): ProgramRow {
  return { ...(r as unknown as ProgramRow), starts_on: dateStr(r.starts_on), target_date: dateStr(r.target_date) };
}

export async function getProgram(id: string, tenantId?: string): Promise<ProgramRow | null> {
  const r = await pool.query(`SELECT * FROM programs WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [id, tenantId ?? null]);
  return r.rows[0] ? normalizeRow(r.rows[0]) : null;
}

// The learner's active program (one per batch, one batch per learner).
export async function activeProgramOf(userId: string): Promise<ProgramRow | null> {
  const r = await pool.query(
    `SELECT p.* FROM programs p JOIN users u ON u.batch_id = p.batch_id WHERE u.id = $1 AND p.status = 'active'`,
    [userId],
  );
  return r.rows[0] ? normalizeRow(r.rows[0]) : null;
}

// A learner's latest estimated level for a test type: from their latest
// finished mock of it (practice tests are often partly done), else their
// placement test.
export async function latestLevel(userId: string, testTypeId: string): Promise<{ overall: string | null; skills: Record<string, string> }> {
  const s = (
    await pool.query(
      `SELECT s.result FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
         AND s.result->>'cefrLevel' IS NOT NULL AND coalesce(s.composition->>'testTypeId', e.test_type_id) = $2
       ORDER BY s.completed_at DESC LIMIT 1`,
      [userId, testTypeId],
    )
  ).rows[0];
  if (s) return { overall: s.result.cefrLevel, skills: s.result.skillLevels ?? {} };
  const p = (await pool.query(`SELECT cefr_level, skill_levels FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId])).rows[0];
  return { overall: p?.cefr_level ?? null, skills: p?.skill_levels ?? {} };
}

export async function programMemberIds(p: Pick<ProgramRow, "batch_id">): Promise<string[]> {
  const r = await pool.query(`SELECT id FROM users WHERE batch_id = $1 AND role = 'learner' AND deleted_at IS NULL`, [p.batch_id]);
  return r.rows.map((x) => x.id as string);
}

// Replans one member's open items from today: done and missed items stay as
// they are; items still due are replaced by a fresh plan.
export async function planMember(p: ProgramRow, userId: string): Promise<number> {
  await pool.query(`DELETE FROM schedule_items WHERE program_id = $1 AND user_id = $2 AND status = 'due' AND due_on >= $3`, [p.id, userId, today()]);
  if (p.status !== "active") return 0;
  const quota = await learnerQuota(userId);
  const window = await quotaWindow(userId);
  const from = p.starts_on > today() ? p.starts_on : today();
  const items = buildSchedule({
    from,
    targetDate: p.target_date,
    gap: programGap(p, await latestLevel(userId, p.test_type_id)),
    practicePerMonth: quota?.practicePerMonth ?? null,
    mocksPerMonth: quota?.mocksPerMonth ?? null,
    // Limits count per license month, from the start of the learner's license.
    monthStart: window.licensed ? window.from.toISOString().slice(0, 10) : undefined,
  });
  if (items.length === 0) return 0;
  await pool.query(
    `INSERT INTO schedule_items (program_id, user_id, due_on, kind)
     SELECT $1, $2, d, k FROM unnest($3::date[], $4::text[]) AS x(d, k)`,
    [p.id, userId, items.map((i) => i.dueOn), items.map((i) => i.kind)],
  );
  return items.length;
}

// Every member's plan; members who left the batch lose their open items.
export async function planProgram(p: ProgramRow): Promise<void> {
  const members = await programMemberIds(p);
  await pool.query(`DELETE FROM schedule_items WHERE program_id = $1 AND status = 'due' AND NOT (user_id = ANY($2::uuid[]))`, [p.id, members]);
  for (const userId of members) await planMember(p, userId);
}

async function checkBatchAndType(tenantId: string, batchId: string, testTypeId: string) {
  const b = (await pool.query(`SELECT status FROM batches WHERE id = $1 AND tenant_id = $2`, [batchId, tenantId])).rows[0];
  if (!b) throw new ProgramError("batch_not_found");
  if (b.status !== "active") throw new ProgramError("batch_not_active");
  const tt = (await pool.query(`SELECT status FROM test_types WHERE id = $1`, [testTypeId])).rows[0];
  if (!tt || tt.status !== "live") throw new ProgramError("unknown_test_type");
  const t = (await pool.query(`SELECT allowed_test_products FROM tenants WHERE id = $1`, [tenantId])).rows[0];
  const allowed = t?.allowed_test_products as string[] | null | undefined;
  if (allowed && !allowed.includes(testTypeId)) throw new ProgramError("test_type_not_enabled");
}

export async function createProgram(tenantId: string, actorId: string, input: z.infer<typeof programSchema>): Promise<ProgramRow> {
  await checkBatchAndType(tenantId, input.batchId, input.testTypeId);
  let row;
  try {
    row = (
      await pool.query(
        `INSERT INTO programs (tenant_id, name, domain, test_type_id, target_level, target_skills, batch_id, starts_on, target_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [tenantId, input.name, input.domain, input.testTypeId, input.targetLevel, JSON.stringify(input.targetSkills), input.batchId, input.startsOn, input.targetDate, actorId],
      )
    ).rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ProgramError("batch_has_program");
    throw err;
  }
  const p = normalizeRow(row);
  await planProgram(p);
  return p;
}

export async function updateProgram(tenantId: string, id: string, input: z.infer<typeof programEditSchema>): Promise<ProgramRow> {
  const p = await getProgram(id, tenantId);
  if (!p) throw new ProgramError("program_not_found");
  if (input.targetDate && input.targetDate <= p.starts_on) throw new ProgramError("bad_dates");
  let row;
  try {
    row = (
      await pool.query(
        `UPDATE programs SET name = coalesce($3, name), domain = coalesce($4, domain), target_level = coalesce($5, target_level),
           target_skills = coalesce($6, target_skills), target_date = coalesce($7, target_date), status = coalesce($8, status), updated_at = now()
         WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [id, tenantId, input.name ?? null, input.domain ?? null, input.targetLevel ?? null, input.targetSkills ? JSON.stringify(input.targetSkills) : null, input.targetDate ?? null, input.status ?? null],
      )
    ).rows[0];
  } catch (err) {
    // Reactivating while the batch has another active program.
    if ((err as { code?: string }).code === "23505") throw new ProgramError("batch_has_program");
    throw err;
  }
  const updated = normalizeRow(row);
  await planProgram(updated);
  return updated;
}

// A finished practice test or mock ticks off the member's earliest open item
// of that kind (missed, or due within the next week). A test left entirely
// blank doesn't count. A mock gives a new level, so the rest of the plan is
// redone.
export async function recordProgramSession(userId: string, sessionId: string, kind: DeliveryMode): Promise<void> {
  const s = (
    await pool.query(
      `SELECT program_id, EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)) AS answered
       FROM sessions s WHERE id = $1`,
      [sessionId],
    )
  ).rows[0];
  if (!s?.program_id || !s.answered) return;
  const p = await getProgram(s.program_id);
  if (!p) return;
  await pool.query(
    `UPDATE schedule_items SET status = 'done', session_id = $3, done_at = now()
     WHERE id = (
       SELECT id FROM schedule_items
       WHERE program_id = $1 AND user_id = $2 AND kind = $4 AND status IN ('due', 'missed') AND due_on <= $5::date + 7
       ORDER BY (status = 'due') DESC, due_on LIMIT 1
     )`,
    [p.id, userId, sessionId, kind, today()],
  );
  if (kind === "mock") await planMember(p, userId);
}

// Daily: items past their day become missed, programs past their target
// date complete, and new batch members get a plan.
export async function runProgramsDaily(): Promise<{ missed: number; completed: number; planned: number }> {
  const missed = await pool.query(`UPDATE schedule_items SET status = 'missed' WHERE status = 'due' AND due_on < $1`, [today()]);
  const completed = await pool.query(`UPDATE programs SET status = 'completed', updated_at = now() WHERE status = 'active' AND target_date < $1`, [today()]);
  const newcomers = await pool.query(
    `SELECT p.id, u.id AS user_id FROM programs p JOIN users u ON u.batch_id = p.batch_id AND u.role = 'learner' AND u.deleted_at IS NULL
     WHERE p.status = 'active' AND NOT EXISTS (SELECT 1 FROM schedule_items si WHERE si.program_id = p.id AND si.user_id = u.id)`,
  );
  for (const n of newcomers.rows) {
    const p = await getProgram(n.id);
    if (p) await planMember(p, n.user_id);
  }
  return { missed: missed.rowCount ?? 0, completed: completed.rowCount ?? 0, planned: newcomers.rows.length };
}

// ---- Views ----

const STATUS_COUNTS = `
  count(*) FILTER (WHERE si.status = 'done')::int AS done,
  count(*) FILTER (WHERE si.status = 'missed')::int AS missed,
  count(*) FILTER (WHERE si.status = 'due')::int AS due`;

export async function listPrograms(tenantId: string) {
  const r = await pool.query(
    `SELECT p.*, b.name AS batch_name,
       (SELECT count(*)::int FROM users u WHERE u.batch_id = p.batch_id AND u.role = 'learner' AND u.deleted_at IS NULL) AS members,
       (SELECT json_build_object('done', count(*) FILTER (WHERE si.status = 'done'), 'missed', count(*) FILTER (WHERE si.status = 'missed'),
          'due', count(*) FILTER (WHERE si.status = 'due')) FROM schedule_items si WHERE si.program_id = p.id) AS items
     FROM programs p JOIN batches b ON b.id = p.batch_id
     WHERE p.tenant_id = $1 AND p.status <> 'archived'
     ORDER BY p.status, p.target_date`,
    [tenantId],
  );
  return r.rows.map((row) => ({ ...programJson(normalizeRow(row)), batchName: row.batch_name, members: row.members, items: row.items }));
}

export function programJson(p: ProgramRow) {
  return {
    id: p.id,
    name: p.name,
    domain: p.domain,
    testTypeId: p.test_type_id,
    targetLevel: p.target_level,
    targetSkills: p.target_skills ?? {},
    batchId: p.batch_id,
    startsOn: p.starts_on,
    targetDate: p.target_date,
    status: p.status,
  };
}

// Each member's latest level, how many items they've done or missed, and
// what's next.
export async function programMembers(p: ProgramRow) {
  const r = await pool.query(
    `SELECT u.id, u.email, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name, ${STATUS_COUNTS},
       min(si.due_on) FILTER (WHERE si.status = 'due') AS next_due,
       (SELECT kind FROM schedule_items x WHERE x.program_id = $1 AND x.user_id = u.id AND x.status = 'due' ORDER BY due_on LIMIT 1) AS next_kind
     FROM users u LEFT JOIN schedule_items si ON si.user_id = u.id AND si.program_id = $1
     WHERE u.batch_id = $2 AND u.role = 'learner' AND u.deleted_at IS NULL
     GROUP BY u.id ORDER BY name`,
    [p.id, p.batch_id],
  );
  return Promise.all(
    r.rows.map(async (m) => {
      const level = await latestLevel(m.id, p.test_type_id);
      return {
        userId: m.id,
        name: m.name,
        email: m.email,
        latestLevel: level.overall,
        gap: programGap(p, level),
        done: m.done,
        missed: m.missed,
        due: m.due,
        next: m.next_due ? { dueOn: dateStr(m.next_due), kind: m.next_kind } : null,
      };
    }),
  );
}

// The learner's own view: the program, their level and the next items.
export async function learnerProgram(userId: string) {
  const p = await activeProgramOf(userId);
  if (!p) return null;
  const items = await pool.query(
    `SELECT id, due_on, kind, status FROM schedule_items WHERE program_id = $1 AND user_id = $2 ORDER BY due_on`,
    [p.id, userId],
  );
  const level = await latestLevel(userId, p.test_type_id);
  const all = items.rows.map((i) => ({ id: i.id as string, dueOn: dateStr(i.due_on), kind: i.kind as DeliveryMode, status: i.status as string }));
  return {
    program: programJson(p),
    latestLevel: level.overall,
    done: all.filter((i) => i.status === "done").length,
    missed: all.filter((i) => i.status === "missed").length,
    upcoming: all.filter((i) => i.status === "due").slice(0, 5),
  };
}
