import { useEffect, useState } from "react";
import { ShieldCheck, Copy, Download } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { mfaApi, type MfaStatus } from "@/api/admin";
import { downloadText } from "@/lib/csv";

import { tr } from "@/i18n/tr";
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink">
        {tr("Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone.")}{" "}<span className="font-semibold">{tr("They won't be shown again.")}</span>
      </p>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-paper-warm rounded-input p-3">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))} className="!px-3.5 !py-2 flex items-center gap-1.5">
          <Copy size={14} /> {tr("Copy")}</Button>
        <Button variant="secondary" onClick={() => downloadText(codes.join("\n"), "spica-recovery-codes.txt", "text/plain")} className="!px-3.5 !py-2 flex items-center gap-1.5">
          <Download size={14} /> {tr("Download")}</Button>
        <Button onClick={onDone} className="!px-3.5 !py-2">
          {tr("I've saved them")}</Button>
      </div>
    </div>
  );
}

// Two-step sign-in with an authenticator app: set up, recovery codes, turn off.
export function MfaCard({ onEnabled }: { onEnabled?: () => void }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "regenerate">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => mfaApi.status().then(setStatus).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const m = err instanceof ApiError ? err.message : "";
      setError(
        m === "invalid_code"
          ? tr("That code didn't work. Use the newest code from your app.")
          : m === "invalid_credentials"
            ? tr("Wrong password.")
            : m === "required_by_organization"
              ? tr("Your organization requires two-step sign-in, so it can't be turned off.")
              : tr("Something went wrong. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2.5 font-display font-bold text-ink">
          <span className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm ${status.enabled ? "bg-success" : "bg-navy"}`}>
            <ShieldCheck size={18} />
          </span>
          {tr("Two-step sign-in")}{status.enabled && <span className="text-xs font-semibold px-2.5 py-0.5 rounded-pill bg-success/15 text-success">{tr("On")}</span>}
        </h2>
        <div>
          <p className="text-sm text-muted">
            {status.enabled
              ? tr("On since {{toLocaleDateString}}. {{recoveryCodesLeft}} recovery code{{v}} left.", { toLocaleDateString: new Date(status.enabledAt!).toLocaleDateString(), recoveryCodesLeft: status.recoveryCodesLeft, v: status.recoveryCodesLeft === 1 ? "" : "s" })
              : tr("Ask for a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) when you sign in.")}
            {status.requiredByOrganization && tr(" Your organization requires it.")}
          </p>
        </div>
      </div>

      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            load();
            onEnabled?.();
          }}
        />
      ) : !status.enabled ? (
        !setup ? (
          <Button onClick={() => run(async () => setSetup(await mfaApi.setup()))} disabled={busy} className="self-start">
            {tr("Set up")}</Button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-5">
            <img src={setup.qrDataUrl} alt={tr("QR code for your authenticator app")} className="h-44 w-44 rounded-input border border-rule bg-white p-1" />
            <div className="flex flex-col gap-3 flex-1">
              <ol className="text-sm text-ink list-decimal pl-4 flex flex-col gap-1">
                <li>{tr("Scan the QR code with your authenticator app.")}</li>
                <li>
                  {tr("Can't scan? Enter this key:")}{" "}<span className="font-mono text-xs break-all bg-paper-warm px-1.5 py-0.5 rounded">{setup.secret}</span>
                </li>
                <li>{tr("Type the 6-digit code it shows.")}</li>
              </ol>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" className={`${inputClass} w-32`} />
                <Button
                  disabled={busy || code.trim().length !== 6}
                  onClick={() =>
                    run(async () => {
                      const r = await mfaApi.enable(code.trim());
                      setCodes(r.recoveryCodes);
                      setSetup(null);
                      setCode("");
                    })
                  }
                >
                  {tr("Turn on")}</Button>
              </div>
            </div>
          </div>
        )
      ) : mode === "idle" ? (
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => setMode("regenerate")} className="!px-3.5 !py-2">
            {tr("New recovery codes")}</Button>
          {!status.requiredByOrganization && (
            <Button variant="secondary" onClick={() => setMode("disable")} className="!px-3.5 !py-2">
              {tr("Turn off")}</Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {mode === "disable" && <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr("Your password")} className={inputClass} />}
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr("Code from your app")} className={inputClass} />
          <div className="flex gap-2">
            <Button
              disabled={busy || code.trim().length < 6 || (mode === "disable" && !password)}
              onClick={() =>
                run(async () => {
                  if (mode === "disable") {
                    await mfaApi.disable(password, code.trim());
                    await load();
                  } else {
                    setCodes((await mfaApi.newRecoveryCodes(code.trim())).recoveryCodes);
                  }
                  setMode("idle");
                  setCode("");
                  setPassword("");
                })
              }
            >
              {mode === "disable" ? tr("Turn off two-step sign-in") : tr("Get new codes")}
            </Button>
            <Button variant="secondary" onClick={() => setMode("idle")}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
