import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ScoreReport } from "@/components/report/ScoreReport";
import type { ScoreReport as ScoreReportData } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// Public: a full Spica score report with made-up data, for the website's Demo
// page. No login needed.
export function SampleReport() {
  const [data, setData] = useState<{ score: ScoreReportData; analysis: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/certificates/sample-report")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="app-surface min-h-screen px-3 py-6 sm:px-8 sm:py-10 flex flex-col items-center gap-4 print:p-0 print:bg-white">
      <div className="print:hidden w-full max-w-5xl flex flex-col gap-2">
        <span className="font-logo font-bold text-2xl text-navy">Spica</span>
        <h1 className="font-display font-bold text-xl text-ink">{tr("Sample score report")}</h1>
        <p className="text-sm text-muted">
          {tr("This is what a Spica score report looks like, with made-up details. Real reports show the test taker's own results.")}{" "}
          <Link to="/certificate/SAMPLE" className="font-semibold text-navy underline">
            {tr("See the sample certificate")}
          </Link>
        </p>
      </div>
      <div className="w-full max-w-5xl">
        {failed ? (
          <p className="text-sm text-error">{tr("The sample report couldn't be loaded. Try again later.")}</p>
        ) : !data ? (
          <div className="h-96 rounded-card bg-surface border border-rule animate-pulse" aria-busy="true" />
        ) : (
          <ScoreReport score={data.score} about={{ deliveryMode: "certified", testTypeName: "English 4 Skills Essentials", familyName: null, setName: null, testCode: "SAMPLE", completedAt: data.score.completedAt }} analysis={data.analysis} />
        )}
      </div>
    </div>
  );
}
