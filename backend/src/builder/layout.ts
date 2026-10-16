// A test type's layout for the assessment builder: its sections (from its
// first set), how long each question takes, and how many questions each
// section needs for a chosen duration.
import { pool } from "../db.js";
import { mockLimits } from "../practiceTests/modes.js";

export interface Section {
  sortOrder: number;
  label: string;
  itemTypeId: string;
  // The template part this section maps to (for session part boundaries).
  templatePartId: string;
  officialCount: number;
  // Average seconds a question of this section takes (answer time,
  // recordings played twice, reading and preparation time).
  avgSeconds: number;
  // The template's question levels in order, as the target level spread.
  levels: (string | null)[];
  // The template questions' own time limits (e.g. the A1-B1 Reading's shorter times).
  timerSeconds: number | null;
}

export interface Layout {
  testTypeId: string;
  templateExamId: string;
  templateCode: string;
  templateTestId: string | null;
  officialMinutes: number;
  // What the template's questions add up to; the published duration is
  // scaled through this, so a full-length form has the template's counts.
  templateSeconds: number;
  cefrMin: string;
  cefrMax: string;
  sections: Section[];
}

export async function testTypeLayout(testTypeId: string): Promise<Layout | null> {
  const tt = (await pool.query(`SELECT id, duration_minutes, cefr_min, cefr_max FROM test_types WHERE id = $1`, [testTypeId])).rows[0];
  const exam = (await pool.query(`SELECT id, code, test_id FROM exams WHERE is_active AND test_type_id = $1 ORDER BY code LIMIT 1`, [testTypeId])).rows[0];
  if (!tt || !exam) return null;
  const rows = (
    await pool.query(
      `SELECT ep.id AS part_id, ep.part_label, ep.item_type_id, ep.sort_order, i.id, i.cefr_level, i.timer_seconds
       FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved'
       WHERE ep.exam_id = $1 ORDER BY ep.sort_order, i.exam_order`,
      [exam.id],
    )
  ).rows;
  const limits = await mockLimits(rows.map((r) => r.id));
  const sections: Section[] = [];
  for (const r of rows) {
    let s = sections.find((x) => x.sortOrder === r.sort_order);
    if (!s) {
      s = { sortOrder: r.sort_order, label: r.part_label, itemTypeId: r.item_type_id, templatePartId: r.part_id, officialCount: 0, avgSeconds: 0, levels: [], timerSeconds: r.timer_seconds };
      sections.push(s);
    }
    s.officialCount++;
    s.avgSeconds += limits[r.id] ?? 60;
    s.levels.push(r.cefr_level);
  }
  for (const s of sections) s.avgSeconds = Math.round(s.avgSeconds / s.officialCount);
  return {
    testTypeId,
    templateExamId: exam.id,
    templateCode: exam.code,
    templateTestId: exam.test_id,
    officialMinutes: tt.duration_minutes,
    templateSeconds: sections.reduce((n, s) => n + s.avgSeconds * s.officialCount, 0),
    cefrMin: tt.cefr_min,
    cefrMax: tt.cefr_max,
    sections,
  };
}

export interface PlannedSection {
  sortOrder: number;
  count: number;
  seconds: number;
}

// How many questions each section gets for `minutes`: every section keeps at
// least one question, counts scale in proportion to the published layout, and
// the total lands within about 5% of the duration where the sections allow it
// (one 30-minute writing task can't be made shorter).
export function planCounts(layout: Pick<Layout, "officialMinutes" | "templateSeconds" | "sections">, minutes: number): { sections: PlannedSection[]; plannedSeconds: number } {
  // Seconds the chosen duration stands for, in the template's own time scale.
  const target = minutes * 60 * (layout.templateSeconds / Math.max(1, layout.officialMinutes * 60));
  const factor = minutes / Math.max(1, layout.officialMinutes);
  const counts = layout.sections.map((s) => Math.max(1, Math.round(s.officialCount * factor)));
  const total = () => layout.sections.reduce((n, s, i) => n + counts[i] * s.avgSeconds, 0);
  // Most over-represented section first when cutting, most under-represented when adding.
  const share = (i: number) => counts[i] / layout.sections[i].officialCount;
  for (let guard = 0; guard < 500 && total() > target * 1.05; guard++) {
    const candidates = counts.map((c, i) => i).filter((i) => counts[i] > 1);
    if (!candidates.length) break;
    const i = candidates.sort((a, b) => share(b) - share(a) || layout.sections[b].avgSeconds - layout.sections[a].avgSeconds)[0];
    counts[i]--;
  }
  for (let guard = 0; guard < 500 && total() < target * 0.95; guard++) {
    const order = counts.map((c, i) => i).sort((a, b) => share(a) - share(b) || layout.sections[a].avgSeconds - layout.sections[b].avgSeconds);
    const i = order.find((k) => total() + layout.sections[k].avgSeconds <= target * 1.05) ?? null;
    if (i === null) break;
    counts[i]++;
  }
  return {
    sections: layout.sections.map((s, i) => ({ sortOrder: s.sortOrder, count: counts[i], seconds: counts[i] * s.avgSeconds })),
    plannedSeconds: total(),
  };
}

// The template's levels resampled to `count` questions (evenly spaced).
export function levelTargets(levels: (string | null)[], count: number): (string | null)[] {
  if (levels.length === 0) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => levels[Math.min(levels.length - 1, Math.floor(((i + 0.5) * levels.length) / count))]);
}
