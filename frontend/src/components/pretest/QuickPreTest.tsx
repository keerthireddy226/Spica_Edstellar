import { useEffect, useState, type ReactNode } from "react";
import { SystemCheck } from "@/components/pretest/SystemCheck";
import { TestDemo } from "@/components/pretest/TestDemo";
import { ConsentDetails, PrivacyConsent } from "@/components/pretest/ConsentDetails";
import { getPreTestInfo, givePreTestConsent, type DeliveryMode, type PreTestInfo, type PreTestKind } from "@/api/proctoring";
import { holdTestConsent } from "@/lib/testConsent";
import { demoSeen, deviceNeedsFor } from "@/lib/systemCheck";
import { tr } from "@/i18n/tr";

// Before a practice or mock test (learners): as few screens as possible,
// every check still done.
// - The demo: one page, the first time only.
// - The full device check before every test, with the test's agreement under
//   it, so one screen does both.
// Runs before the session is created, so nothing here uses up a test.
export function QuickPreTest({
  kind,
  mode,
  minutes,
  onReady,
  onBack,
  extra,
}: {
  kind: PreTestKind;
  mode: DeliveryMode;
  minutes?: string | null;
  // agreed: the learner agreed here (else the first screen of the test asks).
  onReady: (agreed: boolean) => void;
  onBack: () => void;
  // Shown on the device check screen, above the agreement (a candidate's voice choice).
  extra?: ReactNode;
}) {
  const needs = deviceNeedsFor(kind);
  // Each test type is different: the first attempt at this one starts with its guide.
  const [stage, setStage] = useState<"demo" | "check">(() => (!demoSeen(kind) ? "demo" : "check"));
  // Back always goes one screen back: device check → guide → the list of sets.
  if (stage === "demo") return <TestDemo onePage kind={kind} needs={needs} minutes={minutes} onBack={onBack} onDone={() => setStage("check")} />;
  return <CheckAndAgree kind={kind} mode={mode} extra={extra} onBack={() => setStage("demo")} onDone={() => onReady(true)} />;
}

// The device check with the test's agreement under it: one screen, one button.
export function CheckAndAgree({
  kind,
  mode,
  onBack,
  onDone,
  extra,
}: {
  kind: PreTestKind;
  mode: DeliveryMode;
  onBack: () => void;
  onDone: () => void;
  extra?: ReactNode;
}) {
  const needs = deviceNeedsFor(kind);
  const [info, setInfo] = useState<PreTestInfo | null>(null);
  const [biometric, setBiometric] = useState(true);
  const [privacy, setPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getPreTestInfo(kind, mode)
      .then(setInfo)
      .catch(() => setError(tr("Could not load what this test collects. Try again.")));
  }, [kind, mode]);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      const r = await givePreTestConsent(kind, !!info?.biometric && biometric, mode);
      holdTestConsent(r.consentId);
      onDone();
    } catch {
      setError(tr("Could not save your choice. Try again."));
      setBusy(false);
    }
  }

  return (
    <SystemCheck
      needs={needs}
      onBack={onBack}
      busy={busy || !info || !privacy}
      doneLabel={tr("I agree, continue")}
      onPassed={() => agree()}
      extra={
        <>
        {extra && <div className="border-t border-rule pt-4">{extra}</div>}
        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <h2 className="font-display font-bold text-base text-ink">{tr("What this test collects")}</h2>
          {info && <ConsentDetails info={info} mode={mode} />}
          {info?.biometric && <BiometricChoice value={biometric} onChange={setBiometric} />}
          <PrivacyConsent agreed={privacy} onChange={setPrivacy} />
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        </>
      }
    />
  );
}

export function BiometricChoice({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5 text-sm text-ink">
      <legend className="sr-only">{tr("How we confirm it's you")}</legend>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name="identity-check" checked={value} onChange={() => onChange(true)} className="accent-[var(--color-navy)]" />
        {tr("Use face and voice matching")}
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="radio" name="identity-check" checked={!value} onChange={() => onChange(false)} className="accent-[var(--color-navy)]" />
        {tr("Check my identity manually instead")}
      </label>
    </fieldset>
  );
}
