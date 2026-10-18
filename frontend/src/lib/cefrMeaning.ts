import { tr } from "@/i18n/tr";

// What each CEFR level means for a learner, in plain words.
export const CEFR_MEANING: Record<string, () => string> = {
  A1: () => tr("Beginner: you understand and use everyday phrases and simple sentences."),
  A2: () => tr("Elementary: you handle simple, routine conversations about familiar things."),
  B1: () => tr("Intermediate: you deal with most everyday and work situations and describe experiences."),
  B2: () => tr("Upper intermediate: you speak fluently with native speakers and handle complex work topics."),
  C1: () => tr("Advanced: you use English flexibly and precisely for work and study."),
  C2: () => tr("Proficient: you understand virtually everything and express yourself with ease."),
};

const ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

// How many levels from one to the other (0 when reached or past).
export function levelsToGo(from: string, to: string): number {
  const a = ORDER.indexOf(from);
  const b = ORDER.indexOf(to);
  return a < 0 || b < 0 ? 0 : Math.max(0, b - a);
}
