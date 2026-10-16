// Randomized exam forms. Every set of a product has the same sections in the
// same order, so a candidate's form takes each section's questions from all
// sets of that product. Questions that share one passage or story stay
// together and in order.
import { pool } from "../db.js";

export interface FormRow {
  id: string;
  exam_id: string;
  exam_order: number;
  sort_order: number;
  part_label: string;
  content: Record<string, unknown>;
}

// The longest text value in an item's content. Items that share one (a story
// read once, then several questions) belong to the same group.
function sharedText(content: Record<string, unknown>): string | null {
  let best: string | null = null;
  for (const v of Object.values(content ?? {})) {
    if (typeof v === "string" && v.length >= 80 && (!best || v.length > best.length)) best = v;
  }
  return best;
}

export function groupItems<T extends FormRow>(rows: T[]): T[][] {
  const groups: T[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const text = sharedText(row.content);
    if (prev && prev.exam_id === row.exam_id && text && text === sharedText(prev.content)) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Item ids for one randomized form, in section order, the same length per
// section as the chosen exam. Falls back to the exam's own items for any
// section the pool can't fill exactly.
export async function randomizedFormItemIds(examId: string): Promise<string[]> {
  const exam = (await pool.query(`SELECT code FROM exams WHERE id = $1`, [examId])).rows[0];
  if (!exam) return [];
  const prefix = String(exam.code).replace(/-\d+$/, "");
  const r = await pool.query(
    `SELECT i.id, e.id AS exam_id, i.exam_order, ep.sort_order, ep.part_label, i.content
     FROM exams e
     JOIN exam_parts ep ON ep.exam_id = e.id
     JOIN items i ON i.exam_part_id = ep.id
     WHERE e.is_active AND e.code LIKE $1 AND i.status = 'approved'
     ORDER BY ep.sort_order, e.code, i.exam_order`,
    [`${prefix}-%`],
  );
  const rows: FormRow[] = r.rows;
  const ids: string[] = [];
  for (const sortOrder of [...new Set(rows.map((x) => x.sort_order))]) {
    const section = rows.filter((x) => x.sort_order === sortOrder);
    const own = section.filter((x) => x.exam_id === examId);
    const target = own.length;
    if (target === 0) continue;
    const picked: FormRow[] = [];
    for (const g of shuffle(groupItems(section))) {
      if (picked.length + g.length <= target) picked.push(...g);
      if (picked.length === target) break;
    }
    ids.push(...(picked.length === target ? picked : own).map((x) => x.id));
  }
  return ids;
}
