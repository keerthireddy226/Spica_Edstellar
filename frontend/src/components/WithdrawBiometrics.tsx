import { useState } from "react";
import { ScanFace } from "lucide-react";
import { Button } from "@/components/Button";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";

// A learner withdrawing face and voice consent: the enrolled face photo and
// voice samples are deleted. A later test that needs them asks again.
export function WithdrawBiometrics() {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "nothing" | "error">("idle");
  async function withdraw() {
    setState("busy");
    try {
      const r = await api<{ face: boolean; voice: boolean }>("/auth/me/biometrics/withdraw", { method: "POST" });
      setState(r.face || r.voice ? "done" : "nothing");
      setConfirming(false);
    } catch {
      setState("error");
    }
  }
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
        <ScanFace size={18} className="text-navy-deep" /> {tr("Face and voice matching")}
      </h2>
      <p className="text-sm text-muted">
        {tr("You can withdraw your agreement at any time. Your enrolled face photo and voice samples are deleted. If a later test needs a face or voice check, you'll be asked again, or you can choose a manual identity check.")}
      </p>
      {state === "done" && <p className="text-sm text-success">{tr("Withdrawn. Your face photo and voice samples are deleted.")}</p>}
      {state === "nothing" && <p className="text-sm text-muted">{tr("There was no face photo or voice sample to delete.")}</p>}
      {state === "error" && <p className="text-sm text-error">{tr("Couldn't withdraw it. Try again.")}</p>}
      {!confirming ? (
        <Button variant="secondary" className="self-start" onClick={() => setConfirming(true)} disabled={state === "busy"}>
          {tr("Withdraw face and voice consent")}
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={withdraw} disabled={state === "busy"}>
            {tr("Yes, delete my face photo and voice samples")}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={state === "busy"}>
            {tr("Cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
