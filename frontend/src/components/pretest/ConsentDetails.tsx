import type { ReactNode } from "react";
import { Camera, CheckCircle2, Ear, Gauge, Mic, ShieldCheck } from "lucide-react";
import { MONITORED } from "@/components/proctoring/ProctoringGate";
import type { DeliveryMode, PreTestInfo } from "@/api/proctoring";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

function Item({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink">
      <span className="text-navy-deep shrink-0 mt-0.5">{icon}</span>
      {text}
    </li>
  );
}

// What a test collects, who sees it and how long it's kept: the text of the
// agreement before a test (its own screen, or under the device check).
export function ConsentDetails({ info, module = false, mode }: { info: PreTestInfo; module?: boolean; mode?: DeliveryMode }) {
  const p = info.policy;
  // Proctored: reviewers may check the test.
  const checked = info.proctored;
  const monitored = p ? MONITORED.filter((m) => p[m.key]) : [];
  return (
    <>
      <ul className="flex flex-col gap-2.5">
        {info.faceCheck && (
          <Item
            icon={<Camera size={16} />}
            text={tr("Face photos: one before you start and more at random moments (every 30 to 90 seconds), compared with your enrolled face to confirm it's you.")}
          />
        )}
        <Item
          icon={<Mic size={16} />}
          text={tr("Your spoken and written answers are saved and scored by AI (Google Gemini). Spoken answers are also checked for background noise that could affect your score.")}
        />
        {!module && <Item icon={<Gauge size={16} />} text={tr("Your device check (internet speed, microphone and room noise) is saved with the test.")} />}
      </ul>

      {/* The anti-cheating checks that run in the background while you answer. */}
      <div className="flex flex-col gap-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck size={16} className="text-navy-deep" /> {tr("Anti-cheating checks that run in the background")}
        </p>
        <ul className="flex flex-col gap-2.5">
          {!p?.lockdown && <Item icon={<CheckCircle2 size={16} className="text-success" />} text={tr("Copy and paste are turned off.")} />}
          {!module && !p?.audioMonitoring && (
            <Item icon={<Ear size={16} />} text={tr("In tests with speaking, the microphone listens between answers for other voices. This stays on your device and isn't recorded.")} />
          )}
          {monitored.map((m) => (
            <Item key={m.key} icon={<CheckCircle2 size={16} className="text-success" />} text={m.label()} />
          ))}
        </ul>
      </div>

      {/* Only the lines that apply to this test: a practice test that isn't proctored
          has no reviewers, and only the final assessment can be appealed. */}
      <div className="bg-paper-warm rounded-input p-3 text-xs text-muted leading-relaxed flex flex-col gap-1.5">
        <p>
          {checked
            ? tr("How we use them: only to confirm it's you, to check the test was taken fairly, and to score your answers. Never sold.")
            : info.faceCheck
              ? tr("How we use them: only to confirm it's you and to score your answers. Never sold.")
              : tr("How we use them: only to score your answers. Never sold.")}
        </p>
        <p>
          {info.audience === "employer"
            ? tr("Who sees it: the employer you applied to, and reviewers who check anything flagged.")
            : info.audience === "organization"
              ? checked
                ? tr("Who sees it: you, your organization's admins and managers (your results), and reviewers who check anything flagged.")
                : tr("Who sees it: you, and your organization's admins and managers (your results).")
              : checked
                ? tr("Who sees it: you, and Spica reviewers if your test is checked.")
                : tr("Who sees it: only you.")}
        </p>
        {checked && <p>{tr("Nothing fails you automatically: anything unusual is checked by a person.")}</p>}
        {(mode === "certified" || mode === "sample") && info.audience !== "employer" && <p>{tr("You can appeal a final-assessment result, and a person reviews it.")}</p>}
        {info.proctored && monitored.length > 0 && (
          <p>{tr("Test snapshots, recordings and ID images are deleted after {{days}} days.", { days: info.retentionDays })}</p>
        )}
        <p>
          {info.faceCheck
            ? info.recordingsMonths
              ? tr("Face photos and recorded answers are deleted after {{n}} months.", { n: info.recordingsMonths })
              : tr("Face photos and recorded answers are deleted when your account is deleted.")
            : info.recordingsMonths
              ? tr("Your answers and recordings are deleted after {{n}} months.", { n: info.recordingsMonths })
              : tr("Your answers and recordings are deleted when your account is deleted.")}
        </p>
        {p?.region === "us" && info.biometric && (
          <p>{tr("Face and voice data are biometric identifiers. By choosing face and voice matching you give written consent to their collection for this test, under the retention period above.")}</p>
        )}
        {info.biometric && (
          <p>{tr("You can choose a manual identity check instead of face and voice matching. A reviewer then confirms who you are; it doesn't affect your score.")}</p>
        )}
        {/* The rest (providers, storage, your rights in each country) is in the Privacy Notice. */}
        <p>
          {tr("Full details, including how to download or delete your data:")}{" "}
          <Link to={ROUTES.PRIVACY} target="_blank" className="underline text-ink">
            {tr("Privacy Notice")}
          </Link>
        </p>
      </div>
    </>
  );
}
