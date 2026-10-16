// The exam catalogue: exam families and their test types, read from the
// database (see migrations/1794300000000_exam-catalogue.sql).
import { pool } from "../db.js";

export interface CatalogueTestType {
  id: string;
  familyId: string;
  name: string;
  skills: string[];
  cefrMin: string;
  cefrMax: string;
  durationMinutes: number;
  // Delivery formats and their times (paper, computer, online, face_to_face).
  formats: { kind: string; min: number; max: number }[];
  status: "live" | "coming_soon" | "retired";
  setCount: number;
}

export interface CatalogueFamily {
  id: string;
  name: string;
  publisher: string;
  testTypes: CatalogueTestType[];
}

// Every active family with its test types (retired ones left out) and how
// many active sets each has.
export async function listCatalogue(): Promise<CatalogueFamily[]> {
  const families = await pool.query(`SELECT id, name, publisher FROM exam_families WHERE active ORDER BY sort_order`);
  const types = await pool.query(
    `SELECT tt.id, tt.family_id, tt.name, tt.skills, tt.cefr_min, tt.cefr_max, tt.duration_minutes, tt.formats, tt.status,
       (SELECT count(*)::int FROM exams e WHERE e.test_type_id = tt.id AND e.is_active) AS set_count
     FROM test_types tt WHERE tt.status <> 'retired' ORDER BY tt.sort_order`,
  );
  return families.rows.map((f) => ({
    id: f.id,
    name: f.name,
    publisher: f.publisher,
    testTypes: types.rows
      .filter((t) => t.family_id === f.id)
      .map((t) => ({
        id: t.id,
        familyId: t.family_id,
        name: t.name,
        skills: t.skills,
        cefrMin: t.cefr_min,
        cefrMax: t.cefr_max,
        durationMinutes: t.duration_minutes,
        formats: t.formats ?? [],
        status: t.status,
        setCount: t.set_count,
      })),
  }));
}

export async function testTypeIds(): Promise<string[]> {
  return (await pool.query(`SELECT id FROM test_types WHERE status <> 'retired'`)).rows.map((r) => r.id);
}

export async function liveTestType(id: string): Promise<{ id: string; status: string } | null> {
  return (await pool.query(`SELECT id, status FROM test_types WHERE id = $1 AND status <> 'retired'`, [id])).rows[0] ?? null;
}

export async function testTypeOfExam(examId: string): Promise<string | null> {
  return (await pool.query(`SELECT test_type_id FROM exams WHERE id = $1`, [examId])).rows[0]?.test_type_id ?? null;
}
