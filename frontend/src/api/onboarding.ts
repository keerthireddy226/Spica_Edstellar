import { api } from "@/lib/api";

export type ExamPreference = "versant" | "ielts" | "toefl" | "pte" | "cambridge" | "other";
export type GoalLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "unsure";
export type ExamReason = "university" | "job" | "immigration" | "promotion" | "personal";
export type AttemptsStatus = "first" | "once" | "multiple";
export type AccessDuration = "1month" | "3months" | "6months" | "untilexam";
export type JobRole =
  | "student"
  | "it_engineering"
  | "customer_support"
  | "sales_marketing"
  | "healthcare"
  | "education"
  | "finance"
  | "operations"
  | "management"
  | "other";
export type Gender = "female" | "male" | "non_binary" | "prefer_not";
export type AgeBand = "under_18" | "18_24" | "25_34" | "35_44" | "45_54" | "55_plus";

export interface Demographics {
  country: string;
  city: string;
  jobRole: JobRole;
  gender: Gender | null;
  ageBand: AgeBand | null;
  demographicsConsent: boolean;
}

export interface OnboardingAnswers {
  firstName: string;
  lastName: string;
  examPreference: ExamPreference;
  goalLevel: GoalLevel;
  scoreTarget: string;
  examReason: ExamReason;
  hasAppliedForExam: boolean;
  examDate: string | null;
  targetPrepDays: number;
  pastAttemptsStatus: AttemptsStatus;
  prevScore: string;
  prevDate: string;
  dailyMinutesPreference: number;
  accessDuration: AccessDuration;
  consentGiven: boolean;
}

export type OnboardingSubmission = OnboardingAnswers & Demographics;

export type PreferredVoice = "male" | "female";

// Widened to the fields Profile actually displays (exam goal, score target, exam date).
export interface OnboardingProfile {
  onboarding_complete: boolean;
  preferred_voice: PreferredVoice | null;
  exam_preference: ExamPreference | null;
  goal_level: GoalLevel | null;
  score_target: string | null;
  exam_date: string | null;
  daily_minutes_preference: number | null;
  spoken_prompts_enabled: boolean;
  country: string | null;
  city: string | null;
  job_role: JobRole | null;
  gender: Gender | null;
  age_band: AgeBand | null;
}

export function getOnboardingProfile(): Promise<OnboardingProfile | null> {
  return api("/onboarding/profile");
}

// Real, persisted preference, unlike Profile's other two "coming soon" toggles — not yet wired into session playback behavior.
export function updateSpokenPromptsPreference(spokenPromptsEnabled: boolean): Promise<void> {
  return api("/onboarding/preferences", { method: "PATCH", body: JSON.stringify({ spokenPromptsEnabled }) });
}

export function submitOnboarding(answers: OnboardingSubmission): Promise<void> {
  return api("/onboarding/complete", { method: "POST", body: JSON.stringify(answers) });
}

export function updateVoicePreference(preferredVoice: PreferredVoice): Promise<void> {
  return api("/onboarding/voice-preference", { method: "PATCH", body: JSON.stringify({ preferredVoice }) });
}

export function updateDemographics(d: Demographics): Promise<void> {
  return api("/onboarding/demographics", { method: "PATCH", body: JSON.stringify(d) });
}
