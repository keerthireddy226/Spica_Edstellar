import { useState } from "react";
import { Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/i18n/tr";

// Marketing emails on or off at any time. Service emails (invites, results,
// receipts, password resets) are always sent.
export function MarketingEmails() {
  const { user, refresh } = useAuth();
  const [on, setOn] = useState(!!user?.marketingConsent);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  async function change(next: boolean) {
    setOn(next);
    setState("busy");
    try {
      await api("/auth/me/marketing", { method: "PATCH", body: JSON.stringify({ consent: next }) });
      setState("saved");
      void refresh();
    } catch {
      setOn(!next);
      setState("error");
    }
  }
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
        <Mail size={18} className="text-navy-deep" /> {tr("Marketing emails")}
      </h2>
      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
        <input type="checkbox" checked={on} disabled={state === "busy"} onChange={(e) => void change(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{tr("Send me news, tips and offers from Spica by email.")}</span>
      </label>
      <p className="text-xs text-muted">{tr("Emails about your tests, results, payments and account are always sent.")}</p>
      {state === "saved" && <p className="text-sm text-success">{tr("Saved.")}</p>}
      {state === "error" && <p className="text-sm text-error">{tr("Couldn't save it. Try again.")}</p>}
    </div>
  );
}
