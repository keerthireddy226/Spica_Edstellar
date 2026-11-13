import { useEffect, useState } from "react";
import { getCheckoutTerms, type CheckoutAgreementsValue, type CheckoutTerms } from "@/api/payments";
import { tr } from "@/i18n/tr";

// What an individual buyer agrees to before paying (consent register N02–N04):
// the Refund and Cancellation Policy once the Terms are published; for a
// monthly subscription, that it renews; and in the EU, EEA and UK, that access
// starts now and the 14-day right to cancel ends. The server checks them too.
export function useCheckoutTerms(): CheckoutTerms | null {
  const [t, setT] = useState<CheckoutTerms | null>(null);
  useEffect(() => {
    getCheckoutTerms()
      .then(setT)
      .catch(() => setT({ refundPolicyUrl: null, withdrawalWaiver: false }));
  }, []);
  return t;
}

export function agreementsReady(t: CheckoutTerms | null, v: CheckoutAgreementsValue, renewal = false): boolean {
  if (!t) return false;
  return (!t.refundPolicyUrl || !!v.refundPolicy) && (!t.withdrawalWaiver || !!v.withdrawalWaiver) && (!renewal || !!v.renewal);
}

export function CheckoutAgreements({ terms, value, onChange, renewal = false }: { terms: CheckoutTerms | null; value: CheckoutAgreementsValue; onChange: (v: CheckoutAgreementsValue) => void; renewal?: boolean }) {
  if (!terms || (!terms.refundPolicyUrl && !terms.withdrawalWaiver && !renewal)) return null;
  const box = (key: keyof CheckoutAgreementsValue, label: React.ReactNode) => (
    <label className="flex items-start gap-2 text-xs text-ink cursor-pointer">
      <input type="checkbox" checked={!!value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="flex flex-col gap-2">
      {renewal && box("renewal", tr("I agree that Full access renews every month and my card is charged each month until I cancel. I can cancel any time in Plans."))}
      {terms.refundPolicyUrl &&
        box(
          "refundPolicy",
          <>
            {tr("I agree to the")}{" "}
            <a href={terms.refundPolicyUrl} target="_blank" rel="noreferrer" className="underline font-semibold">
              {tr("Refund and Cancellation Policy")}
            </a>
          </>,
        )}
      {terms.withdrawalWaiver && box("withdrawalWaiver", tr("Start my access now. I understand that I lose my 14-day right to cancel once access starts."))}
    </div>
  );
}
