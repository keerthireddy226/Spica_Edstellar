// A partner's payout details, in their Profile (owner, 20 Nov 2026): where
// Spica sends their earnings. Bank transfer, or PayPal for partners outside
// India. Spica pays only partners who have filled this in. Shown to partner
// types that earn money (Channel Partner, Affiliate, Referral Partner).
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/Button";
import { Notice } from "@/components/staff/StaffKit";
import { tr } from "@/i18n/tr";

interface Details {
  method: "bank" | "paypal";
  accountName: string | null;
  accountNumber: string | null;
  accountNumberMasked: string | null;
  bankName: string | null;
  bankCode: string | null;
  bankCountry: string | null;
  paypalEmail: string | null;
  pan: string | null;
  gstin: string | null;
}
type Form = { method: "bank" | "paypal"; accountName: string; accountNumber: string; bankName: string; bankCode: string; bankCountry: string; paypalEmail: string; pan: string; gstin: string };

const empty: Form = { method: "bank", accountName: "", accountNumber: "", bankName: "", bankCode: "", bankCountry: "India", paypalEmail: "", pan: "", gstin: "" };
const PROBLEM: Record<string, string> = {
  accountName: tr("Enter the name on the bank account."),
  accountNumber: tr("Enter the account number (letters and numbers only)."),
  bankCode: tr("Enter a valid IFSC code (India) or SWIFT code (other countries)."),
  paypalEmail: tr("Enter your PayPal email address."),
  pan: tr("Enter a valid PAN, for example ABCDE1234F."),
  gstin: tr("Enter a valid 15-character GST number."),
};

export function PayoutDetailsCard() {
  const [state, setState] = useState<{ needed: boolean; details: Details | null; moneyWaiting: boolean } | null>(null);
  const [f, setF] = useState<Form>(empty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = () =>
    api<{ needed: boolean; details: Details | null; moneyWaiting: boolean }>("/partner/payout-details")
      .then((r) => {
        setState(r);
        if (r.details) {
          const d = r.details;
          setF({ method: d.method, accountName: d.accountName ?? "", accountNumber: d.accountNumber ?? "", bankName: d.bankName ?? "", bankCode: d.bankCode ?? "", bankCountry: d.bankCountry ?? "India", paypalEmail: d.paypalEmail ?? "", pan: d.pan ?? "", gstin: d.gstin ?? "" });
        } else setEditing(true);
      })
      .catch(() => setState(null));
  useEffect(() => {
    load();
  }, []);
  if (!state?.needed) return null;
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api("/partner/payout-details", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      setEditing(false);
      setSaved(true);
      await load();
    } catch (e) {
      const body = (e as { body?: { fields?: { field: string }[] } }).body;
      const field = body?.fields?.[0]?.field;
      setErr((field && PROBLEM[field]) || tr("Could not save. Check the details and try again."));
    } finally {
      setBusy(false);
    }
  };
  const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
  const label = "text-xs font-semibold text-muted uppercase tracking-wide";
  const d = state.details;
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Wallet size={18} className="text-navy" />
        <h2 className="font-display font-bold text-lg">{tr("Payout details")}</h2>
      </div>
      <p className="text-sm text-muted">{tr("Where Spica sends the money you earn. Spica can only pay you once these are filled in. Only you and Spica's finance team can see them.")}</p>
      {!d && state.moneyWaiting && <Notice tone="error">{tr("Spica has money waiting for you. Add your details so Spica can pay you.")}</Notice>}
      {saved && <Notice tone="success">{tr("Saved. Spica will use these details for your next payment.")}</Notice>}

      {!editing && d ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">{tr("Paid by")}</dt>
            <dd>{d.method === "bank" ? tr("Bank transfer") : "PayPal"}</dd>
            {d.method === "bank" ? (
              <>
                <dt className="text-muted">{tr("Account name")}</dt>
                <dd>{d.accountName}</dd>
                <dt className="text-muted">{tr("Account number")}</dt>
                <dd className="font-mono">{d.accountNumberMasked}</dd>
                <dt className="text-muted">{tr("IFSC or SWIFT code")}</dt>
                <dd className="font-mono">{d.bankCode}</dd>
                {d.bankName && (
                  <>
                    <dt className="text-muted">{tr("Bank")}</dt>
                    <dd>{[d.bankName, d.bankCountry].filter(Boolean).join(", ")}</dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt className="text-muted">{tr("PayPal email")}</dt>
                <dd>{d.paypalEmail}</dd>
              </>
            )}
            {d.pan && (
              <>
                <dt className="text-muted">{tr("PAN")}</dt>
                <dd className="font-mono">{d.pan}</dd>
              </>
            )}
            {d.gstin && (
              <>
                <dt className="text-muted">{tr("GSTIN")}</dt>
                <dd className="font-mono">{d.gstin}</dd>
              </>
            )}
          </dl>
          <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
            {tr("Change payout details")}
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" className="accent-navy" checked={f.method === "bank"} onChange={() => setF({ ...f, method: "bank" })} />
              {tr("Bank transfer")}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" className="accent-navy" checked={f.method === "paypal"} onChange={() => setF({ ...f, method: "paypal" })} />
              {tr("PayPal (for partners outside India)")}
            </label>
          </div>
          {f.method === "bank" ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Name on the account")}</span>
                <input className={input} value={f.accountName} maxLength={120} onChange={set("accountName")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Account number")}</span>
                <input className={`${input} font-mono`} value={f.accountNumber} maxLength={40} onChange={set("accountNumber")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Bank country")}</span>
                <input className={input} value={f.bankCountry} maxLength={60} onChange={set("bankCountry")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{/^(india|in)$/i.test(f.bankCountry.trim()) || !f.bankCountry.trim() ? tr("IFSC code") : tr("SWIFT code")}</span>
                <input className={`${input} font-mono uppercase`} value={f.bankCode} maxLength={11} onChange={set("bankCode")} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={label}>{tr("Bank name (optional)")}</span>
                <input className={input} value={f.bankName} maxLength={120} onChange={set("bankName")} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1 sm:max-w-sm">
              <span className={label}>{tr("PayPal email")}</span>
              <input className={input} type="email" value={f.paypalEmail} onChange={set("paypalEmail")} />
            </label>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("PAN (India, optional)")}</span>
              <input className={`${input} font-mono uppercase`} value={f.pan} maxLength={10} onChange={set("pan")} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{tr("GST number (if registered, optional)")}</span>
              <input className={`${input} font-mono uppercase`} value={f.gstin} maxLength={15} onChange={set("gstin")} />
            </label>
          </div>
          {err && <Notice tone="error">{err}</Notice>}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={save}>
              {tr("Save payout details")}
            </Button>
            {d && (
              <Button variant="secondary" onClick={() => setEditing(false)}>
                {tr("Cancel")}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// On every partner page while money is waiting and no payout details are in
// (shown under the partnership bar).
export function PayoutReminder() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    api<{ needed: boolean; details: unknown; moneyWaiting: boolean }>("/partner/payout-details")
      .then((r) => setShow(r.needed && !r.details && r.moneyWaiting))
      .catch(() => setShow(false));
  }, []);
  if (!show) return null;
  return (
    <Notice tone="error">
      {tr("Spica has money waiting for you. Add your payout details in your Profile so Spica can pay you.")}{" "}
      <a href="/partner/profile" className="font-semibold underline">
        {tr("Add payout details")}
      </a>
    </Notice>
  );
}
