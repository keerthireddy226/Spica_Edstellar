import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { JOB_ROLES } from "../onboarding/schemas.js";

type Executor = Pick<PoolClient, "query">;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

// What an organization records about a learner who works there. All
// optional; gender and age band also optional for the learner to change.
export const learnerDetailsSchema = z.object({
  employeeId: optText(60),
  department: optText(120),
  jobTitle: optText(120),
  phone: optText(40),
  country: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  city: optText(100),
  jobRole: z.enum(JOB_ROLES).nullable().optional(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not"]).nullable().optional(),
  ageBand: z.enum(["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"]).nullable().optional(),
});

export type LearnerDetails = Partial<z.infer<typeof learnerDetailsSchema>>;

export class DetailsError extends Error {
  constructor(public code: "employee_id_taken") {
    super(code);
  }
}

// Writes only the fields given. Gender, age and location are marked as
// provided by the organization; the learner sees them pre-filled in
// onboarding and can change them.
export async function saveLearnerDetails(userId: string, d: LearnerDetails, ex: Executor = pool): Promise<void> {
  const userCols: [keyof LearnerDetails, string][] = [
    ["employeeId", "employee_id"],
    ["department", "department"],
    ["jobTitle", "job_title"],
    ["phone", "phone"],
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of userCols) {
    if (d[k] === undefined) continue;
    vals.push(d[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (sets.length) {
    vals.push(userId);
    try {
      await ex.query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "23505") throw new DetailsError("employee_id_taken");
      throw err;
    }
  }
  const profCols: [keyof LearnerDetails, string][] = [
    ["country", "country"],
    ["city", "city"],
    ["jobRole", "job_role"],
    ["gender", "gender"],
    ["ageBand", "age_band"],
  ];
  const given = profCols.filter(([k]) => d[k] !== undefined);
  if (given.length) {
    const cols = given.map(([, c]) => c);
    const pv = given.map(([k]) => d[k]);
    await ex.query(
      `INSERT INTO participant_profiles (user_id, ${cols.join(", ")}, demographics_source)
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}, 'organization')
       ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
         demographics_source = CASE WHEN participant_profiles.onboarding_complete THEN participant_profiles.demographics_source ELSE 'organization' END,
         updated_at = now()`,
      [userId, ...pv],
    );
  }
}

// The employee fields for list views.
export const EMPLOYEE_SELECT = `u.employee_id, u.department, u.job_title, u.phone,
  (SELECT row_to_json(x) FROM (SELECT pp.country, pp.city, pp.job_role, pp.gender, pp.age_band FROM participant_profiles pp WHERE pp.user_id = u.id) x) AS profile_bits`;

export function employeeJson(r: Record<string, any>) {
  const p = r.profile_bits ?? {};
  return {
    employeeId: r.employee_id ?? null,
    department: r.department ?? null,
    jobTitle: r.job_title ?? null,
    phone: r.phone ?? null,
    country: p.country ?? null,
    city: p.city ?? null,
    jobRole: p.job_role ?? null,
    gender: p.gender ?? null,
    ageBand: p.age_band ?? null,
  };
}

const DETAIL_KEYS = Object.keys(learnerDetailsSchema.shape) as (keyof LearnerDetails)[];

// The detail fields of a parsed row that also holds other columns (bulk CSV).
export function pickLearnerDetails(row: Partial<LearnerDetails>): LearnerDetails {
  const out = {} as LearnerDetails;
  for (const k of DETAIL_KEYS) if (row[k] !== undefined) (out as Record<string, unknown>)[k] = row[k];
  return out;
}
