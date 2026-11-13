import { Gavel, Scale } from "lucide-react";
import type { PreTestInfo, TestDeclarationsValue } from "@/api/proctoring";
import { tr } from "@/i18n/tr";

export const NO_DECLARATIONS: TestDeclarationsValue = { testRules: false, automatedNotice: false };

// Whether every declaration this test needs has been ticked.
export function declarationsDone(info: PreTestInfo | null | undefined, v: TestDeclarationsValue): boolean {
  if (!info) return false;
  return (!info.testRules || v.testRules) && (!info.automatedNotice || v.automatedNotice);
}

// Before a real test: the test rules declaration (consent register N01) and,
// for candidates, the notice that scoring is automatic (N06).
export function TestDeclarations({ info, value, onChange }: { info: PreTestInfo; value: TestDeclarationsValue; onChange: (v: TestDeclarationsValue) => void }) {
  if (!info.testRules && !info.automatedNotice) return null;
  const employer = info.employer || tr("The employer who invited you");
  return (
    <div className="flex flex-col gap-3">
      {info.automatedNotice && (
        <div className="rounded-card border border-rule bg-paper-warm/50 p-4 flex flex-col gap-2">
          <p className="flex items-center gap-2 font-display font-bold text-base text-ink">
            <Scale size={18} className="text-navy-deep" /> {tr("How your result is used")}
          </p>
          <p className="text-sm text-ink">
            {tr("Your answers are scored automatically. {{employer}} receives your result and makes the hiring decision; a person reviews anything unusual. You can ask {{employer}} for a person to review your result.", { employer })}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={value.automatedNotice} onChange={(e) => onChange({ ...value, automatedNotice: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0" />
            {tr("I understand how my result is scored and used.")}
          </label>
        </div>
      )}
      {info.testRules && (
        <div className="rounded-card border border-rule bg-paper-warm/50 p-4 flex flex-col gap-2">
          <p className="flex items-center gap-2 font-display font-bold text-base text-ink">
            <Gavel size={18} className="text-navy-deep" /> {tr("Test rules")}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={value.testRules} onChange={(e) => onChange({ ...value, testRules: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0" />
            {tr("I will take this test alone, without notes, other devices, translation or AI tools, or anyone's help, and I will not copy or share the questions. I understand that my result can be withdrawn if I break these rules.")}
          </label>
        </div>
      )}
    </div>
  );
}
