import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { tr } from "@/i18n/tr";

export interface LegalInfo {
  termsVersion: string | null;
  termsUrl: string | null;
}

// Which Terms are current. Until the approved Terms are published the server
// returns no version, and no Terms box is shown.
export function useLegal(): LegalInfo | null {
  const [legal, setLegal] = useState<LegalInfo | null>(null);
  useEffect(() => {
    api<LegalInfo>("/auth/legal")
      .then(setLegal)
      .catch(() => setLegal({ termsVersion: null, termsUrl: null }));
  }, []);
  return legal;
}

// The Terms box (only when Terms are published).
export function TermsCheckbox({ legal, checked, onChange }: { legal: LegalInfo | null; checked: boolean; onChange: (v: boolean) => void }) {
  if (!legal?.termsVersion) return null;
  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {tr("I agree to the")}{" "}
        {legal.termsUrl ? (
          <a href={legal.termsUrl} target="_blank" rel="noreferrer" className="font-medium underline">
            {tr("Terms and Conditions")}
          </a>
        ) : (
          tr("Terms and Conditions")
        )}
        .
      </span>
    </label>
  );
}

// Marketing emails: optional and unticked by default.
export function MarketingCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{tr("Send me news, tips and offers from Spica by email (optional). I can stop these at any time.")}</span>
    </label>
  );
}
