import { useState } from "react";
import { UserCog } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { handOverOrgAdmin } from "@/api/orgAdmin";
import { ROUTES } from "@/constants/routes";

import { tr } from "@/i18n/tr";
// An organization has exactly one Org Admin. Handing over replaces this
// account with the successor's, and signs this account out.
export function HandoverCard() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", jobTitle: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await handOverOrgAdmin({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
      });
      window.location.href = ROUTES.ORG_ADMIN_LOGIN;
    } catch (err) {
      setError(err instanceof ApiError && err.message === "email_already_registered" ? tr("That email already has a Spica account.") : tr("Couldn't hand over. Please try again."));
      setBusy(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  const ready = form.firstName.trim() && form.lastName.trim() && /\S+@\S+\.\S+/.test(form.email) && confirmed;

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
          <UserCog size={20} />
        </span>
        <div>
          <h2 className="font-display font-bold text-lg text-ink">{tr("Hand over the Org Admin role")}</h2>
          <p className="text-sm text-muted">
            {tr("Leaving, or someone else taking over? Your organization can have only one Org Admin, so this account is deactivated and the new person gets an invite.")}</p>
        </div>
      </div>
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)} className="self-start">
          {tr("Hand over…")}</Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder={tr("First name")} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} />
            <input placeholder={tr("Last name")} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} />
            <input placeholder={tr("Work email")} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            <input placeholder={tr("Job title (optional)")} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} />
          </div>
          <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy" />
            {tr("I understand I'll be signed out and lose access to this organization's console.")}</label>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex gap-3">
            <Button onClick={submit} disabled={!ready || busy}>
              {busy ? tr("Handing over…") : tr("Hand over and sign out")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
