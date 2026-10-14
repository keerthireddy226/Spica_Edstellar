import type { AgeBand, Gender, JobRole } from "@/api/onboarding";
import type { CefrLevel } from "@/api/orgAdmin";

// What an Org Admin or Manager records about a batch, beyond its name.
export type ExamFocus =
  | "general"
  | "versant_four_skills"
  | "versant_speaking_listening"
  | "versant_writing"
  | "versant_professional"
  | "versant_placement"
  | "ielts"
  | "toefl"
  | "pte"
  | "cambridge";

export const EXAM_FOCUS_LABEL: Record<ExamFocus, string> = {
  general: "General English",
  versant_four_skills: "Versant 4 Skills Essential",
  versant_speaking_listening: "Versant Speaking & Listening",
  versant_writing: "Versant Writing",
  versant_professional: "Versant Professional English",
  versant_placement: "Versant English Placement Test",
  ielts: "IELTS",
  toefl: "TOEFL",
  pte: "PTE Academic",
  cambridge: "Cambridge English",
};

export interface BatchDetails {
  name: string;
  description: string | null;
  department: string | null;
  location: string | null;
  examFocus: ExamFocus | null;
  startDate: string | null;
  durationMonths: number | null;
  startCefr: CefrLevel | null;
  targetCefr: CefrLevel | null;
  targetCutScore: number | null;
  weeklyMinutesGoal: number | null;
  capacity: number | null;
  defaultLicenseMonths: number | null;
  autoReminders: boolean;
}

// Where a batch's learners' licenses stand.
export interface BatchLicenseStats {
  fixedUsed: number;
  fromPool: number;
  fromOrg: number;
  learners: number;
  licensed: number;
  endingSoon: number;
  unlicensed: number;
}

// What the organization records about a learner who works there.
export interface LearnerDetails {
  employeeId: string | null;
  department: string | null;
  jobTitle: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  jobRole: JobRole | null;
  gender: Gender | null;
  ageBand: AgeBand | null;
}

export const EMPTY_LEARNER_DETAILS: LearnerDetails = {
  employeeId: null,
  department: null,
  jobTitle: null,
  phone: null,
  country: null,
  city: null,
  jobRole: null,
  gender: null,
  ageBand: null,
};

// Only the fields that were filled in, so an invite doesn't send empty ones.
export function filledDetails(d: LearnerDetails): Partial<LearnerDetails> | undefined {
  const out: Partial<LearnerDetails> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null && v !== "") (out as Record<string, unknown>)[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function detailsErrorMessage(code: string | undefined): string | null {
  if (code === "employee_id_taken") return "Another learner in your organization already has this employee ID.";
  if (code === "batch_full") return "This batch is full. Raise its capacity or choose another batch.";
  if (code === "not_enough_licenses") return "You don't have enough licenses for that many months.";
  return null;
}
