// Form assembly: a new set (exam) of a test type, laid out like its first set
// (same parts, same question types and counts), filled with approved
// questions that aren't in any set yet. Each question takes the level of the
// question in the same place in the first set where it can, else the nearest
// level, so a new set has the same level spread.
import { pool } from "../db.js";
import { CEFR_LEVELS, type CefrLevel } from "../placement/cefr.js";

interface TemplateRow {
  part_id: string;
  part_label: string;
  item_type_id: string;
  sort_order: number;
  cefr_level: string | null;
  timer_seconds: number | null;
}

export class AssemblyError extends Error {
  constructor(
    public code: "no_template" | "not_enough_questions",
    public detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function template(testTypeId: string) {
  const exam = (await pool.query(`SELECT id, code, name FROM exams WHERE is_active AND purpose = 'practice' AND test_type_id = $1 ORDER BY code LIMIT 1`, [testTypeId])).rows[0];
  if (!exam) throw new AssemblyError("no_template");
  const rows: TemplateRow[] = (
    await pool.query(
      `SELECT ep.id AS part_id, ep.part_label, ep.item_type_id, ep.sort_order, i.cefr_level, i.timer_seconds
       FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved'
       WHERE ep.exam_id = $1 ORDER BY ep.sort_order, i.exam_order`,
      [exam.id],
    )
  ).rows;
  return { exam, rows };
}

// Unplaced approved questions per type (only mock-approved ones for a mock-ready set).
async function pool_(itemTypeIds: string[], mockOnly: boolean, maxLevel: string | null) {
  const r = await pool.query(
    `SELECT id, item_type_id, cefr_level FROM items
     WHERE exam_part_id IS NULL AND status = 'approved' AND item_type_id = ANY($1::text[]) AND ($2::boolean IS FALSE OR mock_approved)
       AND ($3::text IS NULL OR cefr_level <= $3)
     ORDER BY created_at`,
    [itemTypeIds, mockOnly, maxLevel],
  );
  return r.rows as { id: string; item_type_id: string; cefr_level: string }[];
}

const levelIndex = (l: string | null) => CEFR_LEVELS.indexOf((l ?? "B1") as CefrLevel);

// What can be assembled now: per part, questions needed and available.
export async function assemblyPlan(testTypeId: string, mockOnly: boolean) {
  const { rows } = await template(testTypeId);
  const tt = (await pool.query(`SELECT cefr_max FROM test_types WHERE id = $1`, [testTypeId])).rows[0];
  const types = [...new Set(rows.map((r) => r.item_type_id))];
  const available = await pool_(types, mockOnly, tt?.cefr_max ?? null);
  const parts = [...new Set(rows.map((r) => r.sort_order))].map((so) => {
    const inPart = rows.filter((r) => r.sort_order === so);
    return { label: inPart[0].part_label, itemTypeId: inPart[0].item_type_id, needed: inPart.length };
  });
  // Several parts can share a type (4 Skills repeats Listening & Reading types).
  const neededByType = new Map<string, number>();
  for (const p of parts) neededByType.set(p.itemTypeId, (neededByType.get(p.itemTypeId) ?? 0) + p.needed);
  const byType = (t: string) => available.filter((a) => a.item_type_id === t).length;
  return {
    parts: parts.map((p) => ({ ...p, available: byType(p.itemTypeId) })),
    complete: [...neededByType.entries()].every(([t, n]) => byType(t) >= n),
    setsPossible: Math.min(...[...neededByType.entries()].map(([t, n]) => Math.floor(byType(t) / n))),
  };
}

export async function assembleSet(testTypeId: string, opts: { mockOnly: boolean }): Promise<{ examId: string; code: string; testId: string }> {
  const { exam, rows } = await template(testTypeId);
  const tt = (await pool.query(`SELECT cefr_max FROM test_types WHERE id = $1`, [testTypeId])).rows[0];
  const available = await pool_([...new Set(rows.map((r) => r.item_type_id))], opts.mockOnly, tt?.cefr_max ?? null);
  const used = new Set<string>();
  const picks: (TemplateRow & { itemId: string })[] = [];
  for (const slot of rows) {
    const candidates = available.filter((a) => a.item_type_id === slot.item_type_id && !used.has(a.id));
    if (candidates.length === 0) throw new AssemblyError("not_enough_questions", { part: slot.part_label, itemTypeId: slot.item_type_id });
    candidates.sort((a, b) => Math.abs(levelIndex(a.cefr_level) - levelIndex(slot.cefr_level)) - Math.abs(levelIndex(b.cefr_level) - levelIndex(slot.cefr_level)));
    used.add(candidates[0].id);
    picks.push({ ...slot, itemId: candidates[0].id });
  }

  const prefix = String(exam.code).replace(/-\d+$/, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize assemblies of one test type, so two can't take the same code.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [testTypeId]);
    const last = await client.query(`SELECT code FROM exams WHERE code LIKE $1`, [`${prefix}-%`]);
    const n = Math.max(0, ...last.rows.map((r) => Number(String(r.code).split("-").pop()) || 0)) + 1;
    const code = `${prefix}-${n}`;
    const name = String(exam.name).replace(/Set \d+$/, `Set ${n}`);
    const e = (
      await client.query(`INSERT INTO exams (code, name, test_type_id, is_active, test_id) VALUES ($1, $2, $3, true, exam_test_id($1)) RETURNING id, test_id`, [
        code,
        name,
        testTypeId,
      ])
    ).rows[0];
    const partIds = new Map<number, string>();
    for (const p of picks) {
      if (!partIds.has(p.sort_order)) {
        const r = await client.query(`INSERT INTO exam_parts (exam_id, part_label, item_type_id, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`, [
          e.id,
          p.part_label,
          p.item_type_id,
          p.sort_order,
        ]);
        partIds.set(p.sort_order, r.rows[0].id);
      }
    }
    const order = new Map<number, number>();
    for (const p of picks) {
      const k = (order.get(p.sort_order) ?? 0) + 1;
      order.set(p.sort_order, k);
      // The first set's per-question time limit (e.g. the A1-B1 Reading's shorter times).
      const placed = await client.query(
        `UPDATE items SET exam_part_id = $2, exam_order = $3, timer_seconds = $4, updated_at = now() WHERE id = $1 AND exam_part_id IS NULL RETURNING id`,
        [p.itemId, partIds.get(p.sort_order), k, p.timer_seconds],
      );
      if (placed.rowCount === 0) throw new AssemblyError("not_enough_questions", { part: p.part_label, itemTypeId: p.item_type_id });
    }
    await client.query("COMMIT");
    return { examId: e.id, code, testId: e.test_id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
