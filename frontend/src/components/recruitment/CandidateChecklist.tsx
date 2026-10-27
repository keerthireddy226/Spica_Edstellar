import type { ReactNode } from "react";
import { Camera, Clock, Headphones, IdCard, Lock, MonitorUp, Volume2 } from "lucide-react";
import type { CandidateProctoring, TestKind } from "@/api/recruitment";
import { TEST_KIND_LABEL, TEST_MINUTES } from "@/components/recruitment/testKinds";
import { tr } from "@/i18n/tr";

// What a candidate reads before starting: how long it takes, what to have
// ready, the checks before the test (only those the organization uses) and
// the few rules during it. Shared by the invite link and the public link.
export function CandidateChecklist({
  testKind,
  proctoring,
  expiresAt,
  admissions,
}: {
  testKind: TestKind;
  proctoring: CandidateProctoring;
  expiresAt?: string;
  admissions?: boolean;
}) {
  const p = proctoring;
  const needs: [boolean, ReactNode, string][] = [
    [true, <MonitorUp key="pc" size={16} />, p.screen ? tr("A laptop or desktop computer with Chrome or Edge (not a phone or tablet). You'll share your entire screen.") : tr("A laptop or desktop computer with Chrome or Edge (not a phone or tablet)")],
    [p.camera, <Camera key="c" size={16} />, tr("A webcam: you're visible during the test")],
    [p.microphone, <Headphones key="m" size={16} />, tr("A microphone. Headphones with a microphone are best.")],
    [p.camera || p.microphone, <Volume2 key="q" size={16} />, tr("A quiet room where you're alone, with good light on your face")],
    [p.idDocument, <IdCard key="i" size={16} />, tr("A photo ID: passport, national ID card, driving licence, PAN card or company ID card. For an Aadhaar card, use a masked Aadhaar (only the last 4 digits showing).")],
    [p.secureBrowser, <Lock key="l" size={16} />, admissions ? tr("Safe Exam Browser, as the admissions office instructed") : tr("Safe Exam Browser, as your recruiter instructed")],
  ];
  const checks = [
    tr("A device check: internet, speakers, microphone"),
    p.idDocument && tr("A photo of your ID, then a selfie"),
    p.roomScan && tr("A room scan: slowly turn your camera around the room"),
    p.voiceSample && tr("A short voice sample: read a passage aloud"),
    p.screen && tr("Screen sharing: choose \"Entire screen\""),
  ].filter((x): x is string => !!x);

  return (
    <>
      <div className="bg-paper-warm rounded-input p-4 flex flex-col gap-1.5 text-sm text-ink">
        <p className="font-semibold">{TEST_KIND_LABEL[testKind]()}</p>
        <p className="flex items-start gap-1.5 text-muted">
          <Clock size={14} className="mt-0.5 shrink-0" />
          {tr("The test takes {{m}} minutes. Allow about 10 minutes more for the checks before it, and do it in one sitting.", { m: TEST_MINUTES[testKind] })}
        </p>
        {expiresAt && <p className="text-xs text-muted">{tr("The link works until {{date}}.", { date: new Date(expiresAt).toLocaleDateString() })}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("You'll need")}</p>
        {needs
          .filter(([on]) => on)
          .map(([, icon, text]) => (
            <p key={text} className="flex items-start gap-2 text-sm text-ink">
              <span className="text-navy-deep mt-0.5 shrink-0">{icon}</span> {text}
            </p>
          ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Before the test")}</p>
        <ol className="list-decimal pl-5 text-sm text-ink flex flex-col gap-1">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("During the test")}</p>
        <ul className="list-disc pl-5 text-sm text-ink flex flex-col gap-1">
          <li>{tr("It moves on with the timer: no skipping and no going back.")}</li>
          {testKind !== "writing" && <li>{tr("Spoken answers: press the microphone, speak, then press it again to stop.")}</li>}
          <li>{tr("Stay on this tab. Copy and paste are turned off.")}</li>
        </ul>
      </div>
    </>
  );
}
