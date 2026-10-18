// What the product shows for now (2026-10-18): Versant only. LanguageCert,
// other exams (IELTS, TOEFL, PTE, Cambridge), universities and immigration are
// hidden, not deleted: data and code stay, and flipping these brings them back.
// LanguageCert itself is hidden in the database (exam_families.active).

// Exams a learner can name as their goal.
export const SHOWN_EXAM_PREFERENCES = ["versant"] as const;
// Reasons for taking the exam that aren't offered.
export const HIDDEN_EXAM_REASONS = ["university", "immigration"];
// Universities (Campus and Admissions) as an organization type.
export const SHOW_UNIVERSITIES = false;
// The test builder's "New questions written by AI": the AI only writes
// LanguageCert-style question types so far.
export const SHOW_AI_WRITTEN_TESTS = false;
