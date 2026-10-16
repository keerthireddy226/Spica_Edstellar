// Forms: tests built by staff from questions in the bank. A practice form is
// listed as a set learners can pick; a mock form is what learners' mocks are
// drawn from. Drafts can be edited; published forms are fixed (retire one and
// build another to change it).
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";
import { groupItems, shuffle, type FormRow } from "../proctoring/forms.js";
import { mockLimits } from "../practiceTests/modes.js";
import { SOURCES, libraryWhere, type LibraryFilters } from "./library.js";
import { levelTargets, planCounts, testTypeLayout, type Layout } from "./layout.js";

const level = z.enum(CEFR_LEVELS as [string, ...string[]]);

export const fillSchema = z.object({
  testTypeId: z.string().min(1).max(60),
  purpose: z.enum(["practice", "mock"]),
  durationMinutes: z.number().int().min(5).max(300),
  levelMin: level.optional(),
  levelMax: level.optional(),
  domain: z.string().max(40).optional(),
  sources: z.array(z.enum(SOURCES)).optional(),
  // Questions already chosen (kept), by section.
  keep: z.record(z.string(), z.array(z.string().uuid())).optional(),
});

export const formSchema = z.object({
  testTypeId: z.string().min(1).max(60),
  purpose: z.enum(["practice", "mock"]),
  name: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().min(5).max(300),
  levelMin: level.optional(),
  levelMax: level.optional(),
  domain: z.string().max(40).default("general"),
  // Question ids per section (the section's sort order as key), in order.
  sections: z.record(z.string(), z.array(z.string().uuid())),
});

export class FormError extends Error {
  constructor(
    public code: "unknown_test_type" | "form_not_found" | "not_draft" | "empty_section" | "wrong_type" | "not_approved" | "not_mock_approved" | "duplicate_item",
    public detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

const idx = (l: string | null | undefined) => CEFR_LEVELS.indexOf((l ?? "") as CefrLevel);

interface Candidate extends FormRow {
  item_type_id: string;
  cefr_level: string | null;
  domain: string;
  use_count: number;
}

// The chosen field is a preference: a question from another field (usually
// "general") counts like being 1.5 levels off target, so it's used when the
// field runs out, before leaving a gap.
const OTHER_FIELD_COST = 1.5;

// Approved questions that could fill one section.
async function candidates(itemTypeId: string, f: LibraryFilters, mock: boolean): Promise<Candidate[]> {
  const params: unknown[] = [];
  const where = libraryWhere({ ...f, itemTypeId, status: "approved", mockApproved: mock ? true : undefined }, params);
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.cefr_level, i.domain, i.content, coalesce(ep.exam_id::text, i.set_id::text, 'none') AS exam_id,
       coalesce(i.exam_order, i.set_order, 0) AS exam_order, coalesce(ep.sort_order, 0) AS sort_order, coalesce(ep.part_label, '') AS part_label,
       (SELECT count(*)::int FROM form_items fi JOIN forms fo ON fo.id = fi.form_id AND fo.status <> 'retired' WHERE fi.item_id = i.id)
         + (CASE WHEN i.exam_part_id IS NULL THEN 0 ELSE 1 END) AS use_count
     FROM items i JOIN item_types it ON it.id = i.item_type_id LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id
     ${where}
     ORDER BY exam_id, exam_order`,
    params,
  );
  return r.rows;
}

// Fills each section for the duration: the template's level spread, least-used
// questions first (random among equals), questions that share a passage kept
// together. Returns the chosen ids per section and what's missing.
export async function autofill(input: z.infer<typeof fillSchema>) {
  const layout = await testTypeLayout(input.testTypeId);
  if (!layout) throw new FormError("unknown_test_type");
  const plan = planCounts(layout, input.durationMinutes);
  const filters: LibraryFilters = { levelMin: input.levelMin ?? layout.cefrMin, levelMax: input.levelMax ?? layout.cefrMax, sources: input.sources };
  const field = input.domain && input.domain !== "general" ? input.domain : null;
  const chosen: Record<string, string[]> = {};
  const missing: { sortOrder: number; itemTypeId: string; count: number }[] = [];
  // Per section: how many chosen questions are from the chosen field.
  const fromField: Record<string, number> = {};
  const used = new Set<string>(Object.values(input.keep ?? {}).flat());
  for (const s of layout.sections) {
    const want = plan.sections.find((p) => p.sortOrder === s.sortOrder)!.count;
    const kept = (input.keep?.[String(s.sortOrder)] ?? []).slice(0, want);
    const picks = [...kept];
    const pool_ = (await candidates(s.itemTypeId, filters, input.purpose === "mock")).filter((c) => !used.has(c.id));
    const groups = shuffle(groupItems(pool_)).sort((a, b) => Math.min(...a.map((x) => x.use_count)) - Math.min(...b.map((x) => x.use_count)));
    const cost = (g: Candidate[], target: string | null) => Math.abs(idx(g[0].cefr_level) - idx(target)) + (field && g[0].domain !== field ? OTHER_FIELD_COST : 0);
    // One target level per remaining slot; a group is taken by its first question's level.
    for (const target of levelTargets(s.levels, want).slice(picks.length)) {
      if (picks.length >= want) break;
      const room = want - picks.length;
      const fits = groups.filter((g) => g.length <= room && !g.some((x) => used.has(x.id)));
      if (!fits.length) break;
      fits.sort((a, b) => cost(a, target) - cost(b, target) || a[0].use_count - b[0].use_count);
      for (const x of fits[0]) {
        picks.push(x.id);
        used.add(x.id);
      }
    }
    chosen[String(s.sortOrder)] = picks;
    if (field) {
      const domains = new Map((await pool.query(`SELECT id, domain FROM items WHERE id = ANY($1::uuid[])`, [picks])).rows.map((r) => [r.id, r.domain]));
      fromField[String(s.sortOrder)] = picks.filter((id) => domains.get(id) === field).length;
    }
    if (picks.length < want) missing.push({ sortOrder: s.sortOrder, itemTypeId: s.itemTypeId, count: want - picks.length });
  }
  return { layout, plan, chosen, missing, fromField };
}

// Seconds the chosen questions take, per section and in total. A question
// without its own time limit takes the section's (the template's) limit.
export async function formSeconds(sections: Record<string, string[]>, sectionTimers: Record<string, number | null> = {}): Promise<{ bySection: Record<string, number>; total: number }> {
  const ids = Object.values(sections).flat();
  const own = new Map((await pool.query(`SELECT id, timer_seconds FROM items WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => [r.id as string, r.timer_seconds as number | null]));
  const timers: Record<string, number> = {};
  for (const [k, list] of Object.entries(sections)) for (const id of list) if (own.get(id) == null && sectionTimers[k] != null) timers[id] = sectionTimers[k]!;
  const limits = await mockLimits(ids, timers);
  const bySection = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.reduce((n, id) => n + (limits[id] ?? 60), 0)]));
  return { bySection, total: Object.values(bySection).reduce((a, b) => a + b, 0) };
}

async function nextCode(layout: Layout): Promise<string> {
  const prefix = String(layout.templateTestId ?? layout.templateCode).replace(/-\d+$/, "");
  const r = await pool.query(`SELECT count(*)::int AS n FROM forms WHERE code LIKE $1`, [`${prefix}-F%`]);
  return `${prefix}-F${String(r.rows[0].n + 1).padStart(3, "0")}`;
}

async function writeItems(client: PoolClient, formId: string, layout: Layout, sections: Record<string, string[]>) {
  await client.query(`DELETE FROM form_items WHERE form_id = $1`, [formId]);
  for (const s of layout.sections) {
    for (const [i, itemId] of (sections[String(s.sortOrder)] ?? []).entries()) {
      // A question placed in this test type's sets brings its time limit; else the section's.
      await client.query(
        `INSERT INTO form_items (form_id, item_id, sort_order, position, timer_seconds)
         SELECT $1, $2, $3, $4, coalesce(i.timer_seconds, $5) FROM items i WHERE i.id = $2`,
        [formId, itemId, s.sortOrder, i + 1, s.timerSeconds],
      );
    }
  }
}

function checkDuplicates(sections: Record<string, string[]>) {
  const all = Object.values(sections).flat();
  if (new Set(all).size !== all.length) throw new FormError("duplicate_item");
}

export async function createForm(userId: string, input: z.infer<typeof formSchema>) {
  const layout = await testTypeLayout(input.testTypeId);
  if (!layout) throw new FormError("unknown_test_type");
  checkDuplicates(input.sections);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('forms-code'))`);
    const f = (
      await client.query(
        `INSERT INTO forms (test_type_id, template_exam_id, purpose, name, code, duration_minutes, short_form, level_min, level_max, domain, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          input.testTypeId,
          layout.templateExamId,
          input.purpose,
          input.name,
          await nextCode(layout),
          input.durationMinutes,
          input.durationMinutes !== layout.officialMinutes,
          input.levelMin ?? null,
          input.levelMax ?? null,
          input.domain,
          userId,
        ],
      )
    ).rows[0];
    await writeItems(client, f.id, layout, input.sections);
    await client.query("COMMIT");
    return f.id as string;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateForm(formId: string, input: z.infer<typeof formSchema>) {
  const f = (await pool.query(`SELECT status, test_type_id FROM forms WHERE id = $1`, [formId])).rows[0];
  if (!f) throw new FormError("form_not_found");
  if (f.status !== "draft") throw new FormError("not_draft");
  const layout = await testTypeLayout(f.test_type_id);
  if (!layout) throw new FormError("unknown_test_type");
  checkDuplicates(input.sections);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE forms SET name = $2, purpose = $3, duration_minutes = $4, short_form = $5, level_min = $6, level_max = $7, domain = $8, updated_at = now() WHERE id = $1`,
      [formId, input.name, input.purpose, input.durationMinutes, input.durationMinutes !== layout.officialMinutes, input.levelMin ?? null, input.levelMax ?? null, input.domain],
    );
    await writeItems(client, formId, layout, input.sections);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Replaces a draft's questions (the one-click build fills a draft in steps).
export async function replaceItems(formId: string, layout: Layout, sections: Record<string, string[]>) {
  checkDuplicates(sections);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeItems(client, formId, layout, sections);
    await client.query(`UPDATE forms SET updated_at = now() WHERE id = $1`, [formId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getForm(formId: string) {
  const f = (
    await pool.query(
      `SELECT f.*, tt.name AS test_type_name, fam.name AS family_name,
         coalesce(nullif(concat_ws(' ', cu.first_name, cu.last_name), ''), cu.email) AS created_by_name,
         coalesce(nullif(concat_ws(' ', au.first_name, au.last_name), ''), au.email) AS approved_by_name
       FROM forms f JOIN test_types tt ON tt.id = f.test_type_id JOIN exam_families fam ON fam.id = tt.family_id
       LEFT JOIN users cu ON cu.id = f.created_by LEFT JOIN users au ON au.id = f.approved_by WHERE f.id = $1`,
      [formId],
    )
  ).rows[0];
  if (!f) return null;
  const items = await pool.query(`SELECT item_id, sort_order FROM form_items WHERE form_id = $1 ORDER BY sort_order, position`, [formId]);
  const sections: Record<string, string[]> = {};
  for (const r of items.rows) (sections[String(r.sort_order)] ??= []).push(r.item_id);
  return { form: formJson(f), sections };
}

export function formJson(f: Record<string, unknown>) {
  return {
    id: f.id as string,
    testTypeId: f.test_type_id as string,
    testTypeName: f.test_type_name as string | undefined,
    familyName: f.family_name as string | undefined,
    purpose: f.purpose as "practice" | "mock",
    name: f.name as string,
    code: f.code as string,
    durationMinutes: f.duration_minutes as number,
    shortForm: f.short_form as boolean,
    levelMin: f.level_min as string | null,
    levelMax: f.level_max as string | null,
    domain: f.domain as string,
    status: f.status as "draft" | "published" | "retired",
    createdBy: (f.created_by_name as string | null) ?? null,
    approvedBy: (f.approved_by_name as string | null) ?? null,
    approvedAt: f.approved_at ?? null,
    createdAt: f.created_at,
    itemCount: (f.item_count as number | undefined) ?? undefined,
    buildStatus: (f.build_status as "ready" | "waiting_for_ai" | "short" | undefined) ?? "ready",
    buildSummary: (f.build_summary as Record<string, unknown> | null | undefined) ?? null,
    publishWhenReady: !!f.publish_when_ready,
  };
}

export async function listForms() {
  const r = await pool.query(
    `SELECT f.*, tt.name AS test_type_name, fam.name AS family_name,
       coalesce(nullif(concat_ws(' ', cu.first_name, cu.last_name), ''), cu.email) AS created_by_name,
       (SELECT count(*)::int FROM form_items fi WHERE fi.form_id = f.id) AS item_count
     FROM forms f JOIN test_types tt ON tt.id = f.test_type_id JOIN exam_families fam ON fam.id = tt.family_id
     LEFT JOIN users cu ON cu.id = f.created_by
     ORDER BY (f.status = 'retired'), f.created_at DESC`,
  );
  return r.rows.map(formJson);
}

// Publishing checks every question still fits: right type for its section,
// approved, and approved for mocks in a mock form; no empty section.
export async function publishForm(formId: string, userId: string) {
  const data = await getForm(formId);
  if (!data) throw new FormError("form_not_found");
  if (data.form.status !== "draft") throw new FormError("not_draft");
  const layout = (await testTypeLayout(data.form.testTypeId))!;
  const ids = Object.values(data.sections).flat();
  const items = new Map((await pool.query(`SELECT id, item_type_id, status, mock_approved FROM items WHERE id = ANY($1::uuid[])`, [ids])).rows.map((r) => [r.id, r]));
  for (const s of layout.sections) {
    const list = data.sections[String(s.sortOrder)] ?? [];
    if (!list.length) throw new FormError("empty_section", { section: s.label });
    for (const id of list) {
      const it = items.get(id);
      if (!it || it.item_type_id !== s.itemTypeId) throw new FormError("wrong_type", { section: s.label, itemId: id });
      if (it.status !== "approved") throw new FormError("not_approved", { section: s.label, itemId: id });
      if (data.form.purpose === "mock" && !it.mock_approved) throw new FormError("not_mock_approved", { section: s.label, itemId: id });
    }
  }
  await pool.query(`UPDATE forms SET status = 'published', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [formId, userId]);
}

export async function retireForm(formId: string) {
  const r = await pool.query(`UPDATE forms SET status = 'retired', updated_at = now() WHERE id = $1 AND status <> 'retired' RETURNING id`, [formId]);
  if (!r.rowCount) throw new FormError("form_not_found");
}

// ---- Used by practice tests and mocks ----

// A form's questions in session order, in the same shape as a set's
// (selectExamItems), with the form's time limits and the template's part ids.
export async function formSessionRows(formId: string) {
  const f = (await pool.query(`SELECT template_exam_id FROM forms WHERE id = $1`, [formId])).rows[0];
  if (!f) return { rows: [], partIdByOrder: new Map<number, string>(), timers: {} as Record<string, number> };
  const r = await pool.query(
    `SELECT i.id, i.item_type_id, i.content, it.skills, it.input_method, it.instruction_text, it.question_instruction,
       COALESCE(fi.timer_seconds, i.timer_seconds, it.timer_seconds) AS timer_seconds, it.two_phase_read_seconds, it.two_phase_write_seconds,
       it.prep_seconds, it.min_words, it.max_words, ep.id AS exam_part_id, ep.part_label, fi.sort_order, fi.timer_seconds AS form_timer
     FROM form_items fi JOIN items i ON i.id = fi.item_id JOIN item_types it ON it.id = i.item_type_id
     JOIN exam_parts ep ON ep.exam_id = $2 AND ep.sort_order = fi.sort_order
     WHERE fi.form_id = $1 AND i.status <> 'retired'
     ORDER BY fi.sort_order, fi.position`,
    [formId, f.template_exam_id],
  );
  const parts = await pool.query(`SELECT id, sort_order FROM exam_parts WHERE exam_id = $1`, [f.template_exam_id]);
  return {
    rows: r.rows,
    partIdByOrder: new Map<number, string>(parts.rows.map((p) => [p.sort_order, p.id])),
    // Kept with the session, so a resumed test has the same time limits.
    timers: Object.fromEntries(r.rows.filter((x) => x.form_timer != null).map((x) => [x.id, x.form_timer as number])),
  };
}

// Published practice forms of a test type, for the learner's list of sets.
export async function practiceForms(testTypeId: string, userId: string) {
  const r = await pool.query(
    `SELECT f.id, f.code, f.name, f.duration_minutes, f.short_form,
       (SELECT count(*)::int FROM form_items fi WHERE fi.form_id = f.id) AS item_count,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
               AND s.composition->>'formId' = f.id::text
               AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)) AS completed,
       EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = $2 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NULL
               AND s.composition->>'formId' = f.id::text) AS in_progress
     FROM forms f WHERE f.test_type_id = $1 AND f.purpose = 'practice' AND f.status = 'published'
     ORDER BY f.approved_at`,
    [testTypeId, userId],
  );
  return r.rows;
}

// The published mock form this learner has seen least of (random among
// equals), or null when the test type has none.
export async function pickMockForm(testTypeId: string, userId: string): Promise<{ id: string; durationMinutes: number; shortForm: boolean } | null> {
  const r = await pool.query(
    `SELECT f.id, f.duration_minutes, f.short_form,
       (SELECT count(*) FROM form_items fi WHERE fi.form_id = f.id AND fi.item_id IN (
          SELECT a.item_id FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = $2 AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL)
          UNION SELECT v.item_id FROM session_item_views v JOIN sessions s ON s.id = v.session_id WHERE s.user_id = $2))::float
       / greatest(1, (SELECT count(*) FROM form_items fi WHERE fi.form_id = f.id)) AS seen
     FROM forms f WHERE f.test_type_id = $1 AND f.purpose = 'mock' AND f.status = 'published'
     ORDER BY seen, random() LIMIT 1`,
    [testTypeId, userId],
  );
  const f = r.rows[0];
  return f ? { id: f.id, durationMinutes: f.duration_minutes, shortForm: f.short_form } : null;
}
