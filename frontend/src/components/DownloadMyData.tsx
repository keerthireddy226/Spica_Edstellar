import { Download } from "lucide-react";
import { tr } from "@/i18n/tr";

// A learner downloading a copy of their own data (one JSON file).
export function DownloadMyData() {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink">{tr("Download my data")}</h2>
      <p className="text-sm text-muted">
        {tr("A copy of everything Spica keeps about you: your account, agreements, tests, each answer and its score, certificates and appeals. Recordings and photos are listed, not included.")}
      </p>
      <a
        href="/api/auth/me/export"
        download
        className="self-start inline-flex items-center gap-1.5 rounded-pill border border-rule px-4 py-2 text-sm font-semibold text-ink hover:border-navy"
      >
        <Download size={15} /> {tr("Download (JSON file)")}
      </a>
    </div>
  );
}
