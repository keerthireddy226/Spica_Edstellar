import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { PrivacyConsent } from "@/components/pretest/ConsentDetails";
import { tr } from "@/i18n/tr";

// Shown instead of the app until the current Privacy Notice is agreed: for
// people invited by an organization (who never saw the sign-up form) and for
// everyone after the notice changes.
export function PrivacyAgreement() {
  const { refresh, logout } = useAuth();
  const [privacy, setPrivacy] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/me/privacy", { method: "POST", body: JSON.stringify({ acceptPrivacy: true, adultConfirmed: true }) });
      await refresh();
    } catch {
      setError(tr("Could not save your choice. Try again."));
      setBusy(false);
    }
  }

  return (
    <div className="app-surface min-h-screen px-4 py-10 flex items-start justify-center">
      <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <span className="h-12 w-12 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
            <ShieldCheck size={24} />
          </span>
          <div>
            <h1 className="font-display font-bold text-xl text-ink">{tr("Our Privacy Notice")}</h1>
            <p className="text-sm text-muted mt-1">{tr("Please read and agree to our Privacy Notice to continue using Spica.")}</p>
          </div>
        </div>
        <PrivacyConsent agreed={privacy} onChange={setPrivacy} />
        <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          {tr("I am 18 or older.")}
        </label>
        {error && <p className="text-sm text-error">{error}</p>}
        <Button onClick={agree} disabled={busy || !privacy || !adult}>
          {tr("Continue")}
        </Button>
        <button onClick={() => void logout()} className="self-center text-sm text-muted hover:text-ink cursor-pointer">
          {tr("Log out")}
        </button>
      </div>
    </div>
  );
}
