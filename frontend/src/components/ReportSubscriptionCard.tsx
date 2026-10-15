import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { getReportSubscription, previewReport, setReportSubscription, type ReportFrequency } from "@/api/reports";

import { tr } from "@/i18n/tr";
// Org Admins and Managers choose a weekly or monthly progress email.
export function ReportSubscriptionCard() {
  const allowed = useHasFeature("scheduled_reports");
  const [frequency, setFrequency] = useState<ReportFrequency | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getReportSubscription()
      .then((s) => setFrequency(s.frequency))
      .catch(() => setFrequency("off"));
  }, []);

  if (frequency === null) return null;

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 print:hidden">
      <div className="flex items-center gap-2">
        <Mail size={18} className="text-navy" />
        <h2 className="font-display font-bold text-base text-ink">{tr("Email me a progress report")}</h2>
      </div>
      {allowed === false ? (
        <PlanLockNote feature="scheduled_reports" compact />
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {(["weekly", "monthly", "off"] as ReportFrequency[]).map((f) => (
              <button
                key={f}
                onClick={async () => {
                  setFrequency((await setReportSubscription(f)).frequency);
                  setSaved(true);
                  setTimeout(() => setSaved(false), 2000);
                }}
                className={`px-3.5 py-1.5 rounded-pill text-sm font-semibold border transition-colors cursor-pointer ${
                  frequency === f ? "bg-navy text-lime border-navy" : "border-rule text-ink hover:bg-paper-warm"
                }`}
              >
                {f === "weekly" ? tr("Every Monday") : f === "monthly" ? tr("On the 1st of each month") : tr("Off")}
              </button>
            ))}
            {saved && <span className="text-xs text-success">{tr("Saved")}</span>}
          </div>
          <p className="text-xs text-muted">{tr("Activity, practice time, who needs attention and access ending soon. Sent at 08:00 in your organization's time zone.")}</p>
          <Button
            variant="secondary"
            onClick={async () => setPreview((await previewReport(frequency === "monthly" ? "monthly" : "weekly"))?.text ?? "")}
            className="self-start !px-3.5 !py-2"
          >
            {tr("Preview")}</Button>
          {preview !== null && <pre className="text-xs text-ink bg-paper-warm rounded-input p-3 whitespace-pre-wrap font-sans">{preview}</pre>}
        </>
      )}
    </div>
  );
}
