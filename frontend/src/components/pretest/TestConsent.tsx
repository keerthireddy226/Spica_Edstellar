import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { ConsentDetails } from "@/components/pretest/ConsentDetails";
import { getPreTestInfo, givePreTestConsent, type DeliveryMode, type PreTestInfo, type PreTestKind } from "@/api/proctoring";
import { holdTestConsent } from "@/lib/testConsent";
import { tr } from "@/i18n/tr";

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

  const module = kind === "module";

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
          <ConsentDetails info={info} module={module} mode={mode} />
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
