import { Award, ClipboardList, RotateCcw, Sparkles, Timer } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import type { NextStep } from "@/api/dashboard";
import type { SkillTag } from "@/api/testSession";
import { tr } from "@/i18n/tr";

// How a recommended next step reads: icon, title, why, button and where it goes.
export function stepView(step: NextStep, skillName: (s: SkillTag) => string, modulesOn: boolean): { icon: typeof Timer; title: string; why: string; cta: string; href: string } | null {
  switch (step.kind) {
    case "final":
      return {
        icon: Award,
        title: step.chooseTest ? tr("Choose the test for your final assessment") : tr("Take your final assessment"),
        why: step.chooseTest
          ? tr("Your plan includes a final assessment with a certificate. Pick its test so your practice aims at it.")
          : tr("It's open, and your mock tests show you're ready. One strictly proctored test gives your certificate."),
        cta: step.chooseTest ? tr("Choose your test") : tr("Go to Assessment"),
        href: ROUTES.MY_TESTS,
      };
    case "mock":
      return {
        icon: Timer,
        title: tr("Take a mock test"),
        why: tr("{{n}} days to your exam. A full timed mock now shows where you stand.", { n: step.daysLeft }),
        cta: tr("Go to mock tests"),
        href: ROUTES.MOCK_EXAMS,
      };
    case "practice_test":
      return {
        icon: ClipboardList,
        title: tr("Take a practice test"),
        why: step.daysSince === null ? tr("You've done several sets. A practice test checks your progress.") : tr("Your last practice test was {{n}} days ago. Check your progress.", { n: step.daysSince }),
        cta: tr("Go to practice tests"),
        href: ROUTES.PRACTICE_TESTS,
      };
    case "retry": {
      if (!modulesOn) return null;
      const skill = skillName(step.skill).toLowerCase();
      const n = Math.min(5, step.count);
      return {
        icon: RotateCcw,
        title: tr("Retry your {{skill}} mistakes", { skill }),
        why:
          (step.types?.length
            ? tr("{{n}} {{skill}} questions you got wrong earlier are waiting, from {{types}}.", { n: step.count, skill, types: step.types.join(", ") })
            : tr("{{n}} {{skill}} questions you got wrong earlier are waiting.", { n: step.count, skill })) +
          " " +
          tr("You'll do {{n}} of them again in Practice Modules ({{skillName}}).", { n, skillName: skillName(step.skill) }),
        cta: tr("Retry {{n}} {{skill}} questions", { n, skill }),
        href: `${ROUTES.MODULES}?skill=${step.skill}&retry=1`,
      };
    }
    case "set":
      if (!modulesOn) return null;
      return {
        icon: Sparkles,
        title: tr("{{type}} · {{level}} · {{set}}", { type: step.typeName, level: step.unitName.split(" ")[0], set: step.setName }),
        why: step.retake
          ? tr("{{skill}} is your weakest skill. You've done every {{level}} set of {{type}}; retake your weakest to pass the level.", { skill: skillName(step.skill), level: step.level, type: step.typeName })
          : tr("{{skill}} is your weakest skill. Next on your {{level}} path: {{type}}.", { skill: skillName(step.skill), level: step.level, type: step.typeName }),
        cta: tr("Start this set"),
        href: `${ROUTES.MODULES}?skill=${step.skill}&set=${step.setId}`,
      };
  }
}
