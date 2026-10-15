import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { getLearnerIntegritySummary } from "@/api/proctoring";
import { reasonText } from "@/components/proctoring/integrityText";
import { tr } from "@/i18n/tr";

type Summary = Awaited<ReturnType<typeof getLearnerIntegritySummary>>;

// On the result screen: what was recorded during the test, so an honest
// learner knows what a reviewer will see. Shows nothing when nothing was
// recorded, or when a candidate's job opening hides results.
export function IntegrityResultNote({ sessionId }: { sessionId: string | null }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    getLearnerIntegritySummary(sessionId)
      .then(setSummary)
      .catch(() => {});
  }, [sessionId]);
  if (!summary?.show) return null;
  const flagged = summary.status === "flagged";
  if (summary.reasons.length === 0 && !flagged) return null;

  return (
    <div className="w-full text-left bg-warning/10 border border-warning/30 rounded-card p-4 flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <ShieldAlert size={16} className="text-warning" />
        {tr("Recorded during this test")}
      </p>
      {summary.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-ink flex flex-col gap-0.5">
          {summary.reasons.map((r) => (
            <li key={r.code}>{reasonText(r.code, r.count)}</li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        {flagged
          ? tr("A reviewer will look at this test. Nothing is decided automatically, and your result may be held until the review is done.")
          : tr("These were recorded, but the test doesn't need a review.")}
      </p>
    </div>
  );
}
