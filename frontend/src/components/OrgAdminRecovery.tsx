import { useState } from "react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { replaceOrgAdmin, resendOrgAdminLink } from "@/api/admin";

// Edstellar-side recovery for an organization's one Org Admin: a fresh
// set-password link, or replacing the person entirely.
export function OrgAdminRecovery({ tenantId, hasOrgAdmin, onReplaced }: { tenantId: string; hasOrgAdmin: boolean; onReplaced: () => void }) {
  const [mode, setMode] = useState<"idle" | "replace">("idle");
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", jobTitle: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function resend() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await resendOrgAdminLink(tenantId);
      setMessage({ ok: true, text: `A new set-password link was sent to ${r.email}.` });
    } catch {
      setMessage({ ok: false, text: "Couldn't send the link." });
    } finally {
      setBusy(false);
    }
  }

  async function replace() {
    setBusy(true);
    setMessage(null);
    try {
      await replaceOrgAdmin(tenantId, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      setMessage({ ok: true, text: `${form.firstName.trim()} is now the Org Admin — their invite is on its way.` });
      setMode("idle");
      onReplaced();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError && err.message === "email_already_registered" ? "That email already has a Spica account." : "Couldn't replace the Org Admin." });
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  const ready = form.firstName.trim() && form.lastName.trim() && /\S+@\S+\.\S+/.test(form.email);

  return (
    <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-rule">
      {mode === "idle" ? (
        <div className="flex gap-2 flex-wrap">
          {hasOrgAdmin && (
            <Button variant="secondary" onClick={resend} disabled={busy} className="!px-3.5 !py-2">
              Send set-password link
            </Button>
          )}
          <Button variant="secondary" onClick={() => setMode("replace")} disabled={busy} className="!px-3.5 !py-2">
            {hasOrgAdmin ? "Replace Org Admin" : "Assign Org Admin"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {hasOrgAdmin ? "The current Org Admin is deactivated and signed out; " : ""}the new person gets an invite to set their password.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} />
            <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} />
            <input placeholder="Work email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
            <input placeholder="Job title (optional)" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} />
          </div>
          <div className="flex gap-2">
            <Button onClick={replace} disabled={!ready || busy}>
              {busy ? "Saving…" : hasOrgAdmin ? "Replace" : "Assign"}
            </Button>
            <Button variant="secondary" onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>}
    </div>
  );
}
