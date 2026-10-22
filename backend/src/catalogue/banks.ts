// Question banks (owner decision 2026-10-22): practice sets, mock tests and
// real tests never share questions. Each exams row belongs to one bank:
// 'practice' (the sets learners pick from), 'mock' (the mock-test bank) or
// 'assessment' (the real-test bank: certified attempts and recruitment
// candidates).
import { pool } from "../db.js";

export type ExamPurpose = "practice" | "mock" | "assessment";
export const EXAM_PURPOSES: ExamPurpose[] = ["practice", "mock", "assessment"];

// Until a test type's mock or real-test bank is loaded, its tests use the
// practice sets so the app keeps working. Warned once per test type and bank,
// so the log shows the gap without repeating on every test started.
const warned = new Set<string>();

// The bank a test of this type actually draws from: the one asked for when it
// has an active exam, else the practice sets.
export function bankToUse(wanted: ExamPurpose, hasBank: boolean): ExamPurpose {
  return wanted === "practice" || hasBank ? wanted : "practice";
}

export async function resolveBank(testTypeId: string, wanted: ExamPurpose): Promise<ExamPurpose> {
  if (wanted === "practice") return wanted;
  const has = (await pool.query(`SELECT 1 FROM exams WHERE is_active AND test_type_id = $1 AND purpose = $2 LIMIT 1`, [testTypeId, wanted])).rowCount! > 0;
  const bank = bankToUse(wanted, has);
  if (bank !== wanted && !warned.has(`${testTypeId}:${wanted}`)) {
    warned.add(`${testTypeId}:${wanted}`);
    console.warn(`[banks] ${testTypeId} has no ${wanted} exams yet; using its practice sets until that bank is loaded`);
  }
  return bank;
}

// Active exam ids of one bank of a test type (falling back as above).
export async function bankExamIds(testTypeId: string, wanted: ExamPurpose): Promise<string[]> {
  const bank = await resolveBank(testTypeId, wanted);
  const r = await pool.query(`SELECT id FROM exams WHERE is_active AND test_type_id = $1 AND purpose = $2 ORDER BY code`, [testTypeId, bank]);
  return r.rows.map((x) => x.id as string);
}
