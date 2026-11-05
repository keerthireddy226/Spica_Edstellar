import type { AssessmentResult, TestKind } from "@/api/recruitment";
import type { PartMark, SkillMark } from "@/components/report/StrengthsSummary";
import { tr } from "@/i18n/tr";

// The skills each kind of test covers: one with nothing answered shows as 0%.
const KIND_SKILLS: Partial<Record<TestKind, string[]>> = {
  fourSkills: ["reading", "writing", "speaking", "listening"],
  professional: ["reading", "writing", "speaking", "listening"],
  speakingListening: ["speaking", "listening"],
};

export const skillName = (skill: string) => tr(skill.charAt(0).toUpperCase() + skill.slice(1));

// A candidate's skills (scored ones first, then the ones not attempted) and question types.
export function resultMarks(result: AssessmentResult, kind: TestKind): { skills: SkillMark[]; parts: PartMark[] } {
  const levels = result.skillLevels ?? {};
  const scored: SkillMark[] = Object.entries(levels).map(([skill, level]) => ({ skill, name: skillName(skill), level, value: result.skillPercents?.[skill] ?? 0, attempted: true }));
  const missing: SkillMark[] = (KIND_SKILLS[kind] ?? [])
    .filter((k) => !(k in levels))
    .map((skill) => ({ skill, name: skillName(skill), level: null, value: 0, attempted: false }));
  const parts = (result.partResults ?? []).map((p) => ({ label: p.label, right: p.correctCount, total: p.gradedCount }));
  return { skills: [...scored, ...missing], parts };
}

// A question type's bar colour: green when it went well, amber in between, red when weak.
export function partTone(right: number, total: number): string {
  const share = right / Math.max(1, total);
  return share >= 0.75 ? "bg-success" : share >= 0.5 ? "bg-warning" : "bg-error";
}
