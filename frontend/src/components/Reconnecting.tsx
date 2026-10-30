import { Loader2 } from "lucide-react";
import { tr } from "@/i18n/tr";

// Shown while Spica can't reach the server for a moment: it keeps trying on
// its own, so nobody is sent to another page or asked to sign in again.
export function Reconnecting() {
  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col items-center gap-2 text-center">
        <Loader2 size={26} className="animate-spin text-navy-deep" />
        <p className="font-display font-bold text-lg text-ink">{tr("Reconnecting…")}</p>
        <p className="text-sm text-muted">{tr("We can't reach Spica right now. This page will continue by itself once the connection is back. Your answers are saved.")}</p>
      </div>
    </div>
  );
}
