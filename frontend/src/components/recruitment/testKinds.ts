import type { TestKind } from "@/api/recruitment";
import { tr } from "@/i18n/tr";

export const TEST_KIND_LABEL: Record<TestKind, () => string> = {
  placement: () => tr("English placement test (adaptive)"),
  fourSkills: () => tr("Four skills test"),
  speakingListening: () => tr("Speaking and listening test"),
  writing: () => tr("Writing test"),
  professional: () => tr("Professional English test"),
};

export const TEST_MINUTES: Record<TestKind, string> = { placement: "30–45", fourSkills: "50", speakingListening: "20", writing: "35", professional: "60" };
