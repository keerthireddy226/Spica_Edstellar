import { useState, type ReactNode } from "react";
import { PrivacyNoticeModal } from "@/pages/PrivacyNoticeDoc";
import { Camera, FileText, Keyboard, Mic, MonitorUp, PenLine, Eye } from "lucide-react";
import type { DeliveryMode, PreTestInfo, ProctoringSetup } from "@/api/proctoring";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/i18n/tr";

type Policy = NonNullable<ProctoringSetup["policy"]>;

// What a test collects, grouped by where it comes from (answers, camera,
// microphone, screen, typing, a live proctor); only the parts this test uses.
export function collectedGroups(p: Policy | null, opts: { faceCheck?: boolean; deviceCheck?: boolean } = {}): { icon: ReactNode; label: string; parts: string[] }[] {
  const on = (k: keyof Policy) => !!p?.[k];
  const groups = [
    {
      icon: <PenLine size={16} />,
      label: tr("Answers"),
      parts: [tr("your spoken and written answers are saved and scored by AI"), opts.deviceCheck ? tr("your device check is saved with the test") : ""],
    },
    {
      icon: <Camera size={16} />,
      label: tr("Camera"),
      parts: [
        on("idVerification") ? tr("a photo of your ID and your face") : "",
        on("faceMatch") || opts.faceCheck ? tr("your face is compared with your photo during the test") : "",
        on("webcamMonitoring") ? tr("photos check you're alone, with no phone") : "",
        on("videoRecording") ? tr("recorded during the test") : "",
        on("roomScan") ? tr("a short room video before you start") : "",
      ],
    },
    {
      icon: <Mic size={16} />,
      label: tr("Microphone"),
      parts: [on("voiceMatch") ? tr("your voice is compared with a short sample") : "", on("audioMonitoring") ? tr("talking between answers is noted") : ""],
    },
    {
      icon: <MonitorUp size={16} />,
      label: tr("Screen"),
      parts: [
        on("screenRecording") ? tr("screenshots when you leave the test, and every few minutes") : "",
        on("requireFullscreen") ? tr("full screen") : "",
        on("lockdown") ? tr("copy and paste are off; leaving the tab is noted") : "",
        on("multiMonitorCheck") ? tr("second screens are detected") : "",
      ],
    },
    { icon: <Keyboard size={16} />, label: tr("Typing"), parts: [on("typingPattern") ? tr("typing rhythm only, never the text") : ""] },
    { icon: <Eye size={16} />, label: tr("Proctor"), parts: [on("liveMonitoring") ? tr("may watch live and message you") : ""] },
  ];
  return groups.map((g) => ({ ...g, parts: g.parts.filter(Boolean) })).filter((g) => g.parts.length > 0);
}

export function CollectedList({ groups }: { groups: ReturnType<typeof collectedGroups> }) {
  return (
    <ul className="flex flex-col gap-2">
      {groups.map((g) => (
        <li key={g.label} className="flex items-start gap-2.5 text-sm text-ink">
          <span className="text-navy-deep shrink-0 mt-0.5">{g.icon}</span>
          <span>
            <b>{g.label}:</b> {g.parts.join("; ")}.
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ConsentDetails({ info, module = false, mode }: { info: PreTestInfo; module?: boolean; mode?: DeliveryMode }) {
  // Proctored: reviewers may check the test.
  const checked = info.proctored;
  const p = info.policy;
  return (
    <>
      <CollectedList groups={collectedGroups(p, { faceCheck: info.faceCheck, deviceCheck: !module })} />
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
          {checked && <> {tr("Nothing fails you automatically: anything unusual is checked by a person.")}</>}
        </p>
        {(mode === "certified" || mode === "sample") && info.audience !== "employer" && <p>{tr("You can appeal a final-assessment result, and a person reviews it.")}</p>}
        {info.proctored && p && <p>{tr("Test snapshots, recordings and ID images are deleted after {{days}} days.", { days: info.retentionDays })}</p>}
        <p>
          {info.recordingsMonths
            ? tr("Your answers and recordings are deleted after {{n}} months.", { n: info.recordingsMonths })
            : tr("Your answers and recordings are deleted when your account is deleted.")}
        </p>
        {p?.region === "us" && info.biometric && (
          <p>{tr("Face and voice data are biometric identifiers. By choosing face and voice matching you give written consent to their collection for this test, under the retention period above.")}</p>
        )}
      </div>
    </>
  );
}

// The Privacy Notice, required before a test: the box can only be ticked
// after the notice has been opened.
export function PrivacyConsent({ agreed, onChange }: { agreed: boolean; onChange: (v: boolean) => void }) {
  const [opened, setOpened] = useState(false);
  // The notice for this person's kind of account (candidate, organization, individual).
  const { user } = useAuth();
  const audience = user?.privacyAudience ?? "free";
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-card border-2 border-navy/40 bg-navy/5 p-4 flex flex-col gap-3">
      <p className="flex items-center gap-2 font-display font-bold text-base text-ink">
        <FileText size={18} className="text-navy-deep" /> {tr("Privacy Notice")}
      </p>
      <p className="text-sm text-ink">{tr("Please read how Spica uses your data before you continue.")}</p>
      {/* Opens over the test screen, so nobody leaves their place to read it. */}
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          setShow(true);
        }}
        className="self-start inline-flex items-center gap-2 rounded-input bg-navy text-white font-semibold text-sm px-4 py-2 hover:opacity-90 cursor-pointer"
      >
        <FileText size={16} /> {tr("Open the Privacy Notice")}
      </button>
      {show && <PrivacyNoticeModal audience={audience} onClose={() => setShow(false)} />}
      <label className={`flex items-start gap-2 text-sm ${opened ? "text-ink cursor-pointer" : "text-muted"}`}>
        <input type="checkbox" disabled={!opened} checked={agreed} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {tr("I have read the Privacy Notice and agree.")}
          {!opened && <span className="block text-xs">{tr("Open the Privacy Notice first.")}</span>}
        </span>
      </label>
    </div>
  );
}
