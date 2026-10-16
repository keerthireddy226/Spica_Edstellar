import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Camera, CheckCircle2, Mic, ShieldCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { MONITORED } from "@/components/proctoring/ProctoringGate";
import { getPreTestInfo, givePreTestConsent, type DeliveryMode, type PreTestInfo, type PreTestKind } from "@/api/proctoring";
import { holdTestConsent } from "@/lib/testConsent";
import { tr } from "@/i18n/tr";

function Item({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-ink">
      <span className="text-navy-deep shrink-0 mt-0.5">{icon}</span>
      {text}
    </li>
  );
}

// Before every test, right before the first face photo: what this test
// collects, who sees it, how long it's kept. Agreeing is recorded and linked
// to the test's session, so the proctoring steps don't ask again.
export function TestConsent({
  kind,
  mode,
  onAgreed,
  onBack,
}: {
  kind: PreTestKind;
  mode?: DeliveryMode;
  onAgreed: () => void;
  onBack?: () => void;
}) {
  const [info, setInfo] = useState<PreTestInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPreTestInfo(kind, mode)
      .then(setInfo)
      .catch(() => setError(tr("Could not load what this test collects. Try again.")));
  }, [kind, mode]);

  async function accept(biometric: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await givePreTestConsent(kind, biometric, mode);
      holdTestConsent(r.consentId);
      onAgreed();
    } catch {
      setError(tr("Could not save your choice. Try again."));
      setBusy(false);
    }
  }

  const p = info?.policy;
  const module = kind === "module";
  const monitored = p ? MONITORED.filter((m) => p[m.key]) : [];

  return (
    <div className="max-w-2xl mx-auto bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-5">
      {onBack && (
        <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm text-muted hover:text-ink cursor-pointer">
          <ArrowLeft size={16} /> {tr("Back")}
        </button>
      )}
      <div className="flex items-start gap-3">
        <span className="h-12 w-12 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
          <ShieldCheck size={24} />
        </span>
        <div>
          <h1 className="font-display font-bold text-xl text-ink">
            {module ? tr("Before you start: what this practice session collects") : tr("Before you start: what this test collects")}
          </h1>
          <p className="text-sm text-muted mt-1">
            {module ? tr("Read this and agree to continue. You're asked before every session.") : tr("Read this and agree to continue. You're asked before every test.")}
          </p>
        </div>
      </div>

      {!info && !error && <p className="text-sm text-muted">{tr("Loading...")}</p>}

      {info && (
        <>
          <ul className="flex flex-col gap-2.5">
            {info.faceCheck && (
              <Item
                icon={<Camera size={16} />}
                text={tr("Face photos: one before you start and more at random moments (every 30 to 90 seconds), compared with your enrolled face to confirm it's you.")}
              />
            )}
            <Item icon={<Mic size={16} />} text={tr("Spoken answers are recorded for scoring, and checked for background noise that could affect your score.")} />
            {monitored.map((m) => (
              <Item key={m.key} icon={<CheckCircle2 size={16} className="text-success" />} text={m.label()} />
            ))}
          </ul>

          <div className="bg-paper-warm rounded-input p-3 text-xs text-muted leading-relaxed flex flex-col gap-1.5">
            <p>
              {module
                ? tr("How we use them: only to confirm it's you and to score your spoken answers.")
                : tr("How we use them: only to confirm it's you, to check the test was taken fairly, and to score your spoken answers.")}
            </p>
            <p>
              {module
                ? tr("When: during the session, and when your answers are scored.")
                : tr("When: during the test, when your answers are scored, and afterwards if a reviewer checks the test.")}
            </p>
            {info.proctored && monitored.length > 0 && (
              <p>{tr("Test snapshots, recordings and ID images are deleted after {{days}} days.", { days: info.retentionDays })}</p>
            )}
            <p>
              {info.recordingsMonths
                ? tr("Face photos and recorded answers are deleted after {{n}} months.", { n: info.recordingsMonths })
                : tr("Face photos and recorded answers are deleted when your account is deleted.")}
            </p>
            {p?.region === "us" && info.biometric && (
              <p>{tr("Face and voice data are biometric identifiers. By choosing face and voice matching you give written consent to their collection for this test, under the retention period above.")}</p>
            )}
            {info.biometric && (
              <p>{tr("You can choose a manual identity check instead of face and voice matching. A reviewer then confirms who you are; it doesn't affect your score.")}</p>
            )}
          </div>
        </>
      )}

      {error && <p className="text-sm text-error">{error}</p>}

      {info && (
        <div className="flex flex-col gap-2">
          {info.biometric ? (
            <>
              <Button onClick={() => accept(true)} disabled={busy}>
                {tr("I agree, including face and voice matching")}
              </Button>
              <Button variant="secondary" onClick={() => accept(false)} disabled={busy}>
                {tr("I agree, but check my identity manually")}
              </Button>
            </>
          ) : (
            <Button onClick={() => accept(false)} disabled={busy}>
              {module ? tr("I agree, start practising") : tr("I agree, start the test")}
            </Button>
          )}
          {onBack && (
            <Button variant="secondary" onClick={onBack} disabled={busy}>
              {tr("Not now")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
