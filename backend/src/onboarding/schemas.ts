import { z } from "zod";

export const JOB_ROLES = [
  "student",
  "it_engineering",
  "customer_support",
  "sales_marketing",
  "healthcare",
  "education",
  "finance",
  "operations",
  "management",
  "other",
] as const;

const demographicsShape = {
  country: z.string().length(2).toUpperCase(),
  city: z.string().trim().min(1).max(100),
  jobRole: z.enum(JOB_ROLES),
  gender: z.enum(["female", "male", "non_binary", "prefer_not"]).nullable().optional(),
  ageBand: z.enum(["under_18", "18_24", "25_34", "35_44", "45_54", "55_plus"]).nullable().optional(),
  // Separate, affirmative consent for the two sensitive (optional) fields —
  // required only when either one is actually provided.
  demographicsConsent: z.boolean().optional(),
};

export const demographicsSchema = z.object(demographicsShape).refine(
  (d) => (!d.gender && !d.ageBand) || d.demographicsConsent === true,
  { message: "demographics_consent_required", path: ["demographicsConsent"] },
);

// Mirrors participant_profiles + users.first_name/last_name. One combined submission, not save-per-step.
export const onboardingSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  examPreference: z.enum(["versant", "ielts", "toefl", "pte", "cambridge", "other"]),
  goalLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2", "unsure"]),
  scoreTarget: z.string().optional(),
  examReason: z.enum(["university", "job", "immigration", "promotion", "personal"]),
  hasAppliedForExam: z.boolean(),
  examDate: z.iso.date().optional().nullable(),
  targetPrepDays: z.number().int().positive(),
  pastAttemptsStatus: z.enum(["first", "once", "multiple"]),
  prevScore: z.string().optional(),
  prevDate: z.string().optional(),
  dailyMinutesPreference: z.number().int().positive(),
  accessDuration: z.enum(["1month", "3months", "6months", "untilexam"]),
  ...demographicsShape,
  // Must be affirmatively true, not just present — a checkbox left unchecked
  // fails validation rather than silently defaulting to consent given (C3).
  consentGiven: z.literal(true),
}).refine((d) => (!d.gender && !d.ageBand) || d.demographicsConsent === true, {
  message: "demographics_consent_required",
  path: ["demographicsConsent"],
});
