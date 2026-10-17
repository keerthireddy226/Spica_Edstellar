// The question library: every question in the bank, wherever it comes from
// (module sets, practice and mock sets, the placement pool, AI-written ones
// not in a set yet), with where it's used and how learners did.
import { pool } from "../db.js";
import { itemStats } from "../generation/stats.js";

export const SOURCES = ["module", "test_set", "placement", "ai", "unplaced"] as const;
export type Source = (typeof SOURCES)[number];

// Which exam family a question type belongs to.
export const FAMILY_SQL = `CASE WHEN i.item_type_id LIKE 'lc\\_%' THEN 'languagecert' ELSE 'versant' END`;

const SOURCE_SQL = `CASE
  WHEN i.exam_part_id IS NOT NULL THEN 'test_set'
  WHEN i.set_id IS NOT NULL THEN 'module'
  WHEN i.pool = 'placement' THEN 'placement'
  WHEN i.pipeline_version = 'gen-v1' THEN 'ai'
  ELSE 'unplaced' END`;

export interface LibraryFilters {
  family?: string;
  testTypeId?: string;
  itemTypeId?: string;
  skill?: string;
  levelMin?: string;
  levelMax?: string;
  domain?: string;
  sources?: Source[];
  status?: "approved" | "draft" | "retired";
  mockApproved?: boolean;
  q?: string;
  excludeIds?: string[];
  ids?: string[];
  // Only questions these AI requests wrote.
  generationJobIds?: string[];
}

// WHERE clause and parameters for the filters (shared by the library and the builder).
export function libraryWhere(f: LibraryFilters, params: unknown[]): string {
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const w: string[] = [];
  if (f.family) w.push(`${FAMILY_SQL} = ${add(f.family)}`);
  // Question types that fit the test type's sections.
  if (f.testTypeId)
    w.push(`i.item_type_id IN (SELECT DISTINCT ep.item_type_id FROM exam_parts ep JOIN exams e ON e.id = ep.exam_id WHERE e.is_active AND e.test_type_id = ${add(f.testTypeId)})`);
  if (f.itemTypeId) w.push(`i.item_type_id = ${add(f.itemTypeId)}`);
  if (f.skill) w.push(`${add(f.skill)} = ANY(it.skills)`);
  if (f.levelMin) w.push(`i.cefr_level >= ${add(f.levelMin)}`);
  if (f.levelMax) w.push(`i.cefr_level <= ${add(f.levelMax)}`);
  if (f.domain) w.push(`i.domain = ${add(f.domain)}`);
  if (f.sources?.length) w.push(`(${SOURCE_SQL}) = ANY(${add(f.sources)}::text[])`);
  if (f.status) w.push(`i.status = ${add(f.status)}`);
  if (f.mockApproved !== undefined) w.push(`i.mock_approved = ${add(f.mockApproved)}`);
  if (f.q) w.push(`(i.content::text ILIKE ${add(`%${f.q}%`)} OR i.topic ILIKE $${params.length})`);
  if (f.ids) w.push(`i.id = ANY(${add(f.ids)}::uuid[])`);
  if (f.generationJobIds) w.push(`i.generation_job_id = ANY(${add(f.generationJobIds)}::uuid[])`);
  if (f.excludeIds?.length) w.push(`NOT (i.id = ANY(${add(f.excludeIds)}::uuid[]))`);
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}

export const LIBRARY_SELECT = `
  SELECT i.id, i.item_type_id, it.name AS type_name, it.skills, i.cefr_level, i.topic, i.domain, i.status, i.mock_approved, i.content,
    i.exam_part_id, ${FAMILY_SQL} AS family, (${SOURCE_SQL}) AS source,
    e.id AS exam_id, e.test_id, e.name AS exam_name, ep.part_label, i.exam_order, ep.sort_order,
    un.name AS unit_name, st.name AS module_set_name,
    (SELECT count(*)::int FROM form_items fi JOIN forms f ON f.id = fi.form_id AND f.status <> 'retired' WHERE fi.item_id = i.id) AS form_count
  FROM items i
  JOIN item_types it ON it.id = i.item_type_id
  LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id
  LEFT JOIN sets st ON st.id = i.set_id LEFT JOIN units un ON un.id = st.unit_id`;

// A plain-text preview of what the learner sees or hears.
export function preview(content: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const main =
    s(content.question) || s(content.sentence) || s(content.prompt) || s(content.text) || s(content.audio) || s(content.passage) || s(content.story) || s(content.situation) || s(content.dialogue);
  const groups = Array.isArray(content.groups) ? (content.groups as string[]).join(" / ") : "";
  const text = (main || groups).replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

export function whereUsed(r: Record<string, unknown>): string | null {
  if (r.exam_name) return `${r.exam_name}${r.test_id ? ` (${r.test_id})` : ""} · ${r.part_label}`;
  if (r.unit_name) return `Module: ${r.type_name} › ${r.unit_name}${r.module_set_name ? ` › ${r.module_set_name}` : ""}`;
  return null;
}

export function libraryRow(r: Record<string, unknown>, stats?: { n: number; mean: number | null } | null, seconds?: number) {
  return {
    id: r.id as string,
    itemTypeId: r.item_type_id as string,
    typeName: r.type_name as string,
    family: r.family as string,
    skills: r.skills as string[],
    level: r.cefr_level as string | null,
    topic: r.topic as string | null,
    domain: r.domain as string,
    status: r.status as string,
    mockApproved: r.mock_approved as boolean,
    source: r.source as Source,
    usedIn: whereUsed(r),
    formCount: r.form_count as number,
    preview: preview((r.content ?? {}) as Record<string, unknown>),
    answered: stats?.n ?? 0,
    averageScore: stats?.mean ?? null,
    seconds: seconds ?? null,
  };
}

export async function listLibrary(f: LibraryFilters, page: number, pageSize = 50, preferDomain?: string) {
  const params: unknown[] = [];
  const where = libraryWhere(f, params);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM items i JOIN item_types it ON it.id = i.item_type_id ${where}`, params)).rows[0].n as number;
  let order = "i.item_type_id, i.cefr_level NULLS LAST, i.created_at";
  if (preferDomain) {
    params.push(preferDomain);
    order = `(i.domain = $${params.length}) DESC, ${order}`;
  }
  const r = await pool.query(`${LIBRARY_SELECT} ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${Math.max(0, page) * pageSize}`, params);
  const stats = await itemStats(r.rows.map((x) => x.id));
  const { mockLimits } = await import("../practiceTests/modes.js");
  const secs = await mockLimits(r.rows.map((x) => x.id));
  return { total, page, pageSize, items: r.rows.map((x) => libraryRow(x, stats.get(x.id), secs[x.id])) };
}

// Every test a question appears in: its set (or module) and the built forms.
export async function itemUsage(itemId: string) {
  const r = (await pool.query(`${LIBRARY_SELECT} WHERE i.id = $1`, [itemId])).rows[0];
  if (!r) return null;
  const forms = await pool.query(
    `SELECT f.id, f.name, f.code, f.purpose, f.status FROM form_items fi JOIN forms f ON f.id = fi.form_id WHERE fi.item_id = $1 ORDER BY f.created_at DESC`,
    [itemId],
  );
  return { place: whereUsed(r), source: r.source as Source, forms: forms.rows };
}
