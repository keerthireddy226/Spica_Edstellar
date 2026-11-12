import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ScoreReport } from "@/components/report/ScoreReport";
import type { ReportAbout, ScoreReport as ScoreReportData } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// Public: the full score report behind a valid result certificate, opened from
// the certificate's check page. The learner can turn this off; their example
// answers are never shown here.
export function CertificateReport() {
  const { code = "" } = useParams();
  const [data, setData] = useState<{ score: ScoreReportData; about: ReportAbout | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/certificates/verify/${encodeURIComponent(code)}/report`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [code]);
  return (
    <div className="app-surface min-h-screen px-3 py-6 sm:px-8 sm:py-10 flex flex-col items-center gap-4 print:p-0 print:bg-white">
      <div className="print:hidden w-full max-w-5xl flex flex-col gap-2">
        <span className="font-logo font-bold text-2xl text-navy">Spica</span>
        <h1 className="font-display font-bold text-xl text-ink">{tr("Score report")}</h1>
        <p className="text-sm text-muted">
          {tr("The full result behind certificate {{code}}, shared by its holder.", { code: code.toUpperCase() })}{" "}
          <Link to={`/certificate/${encodeURIComponent(code)}`} className="font-semibold text-navy underline">
            {tr("Back to the certificate")}
          </Link>
        </p>
      </div>
      <div className="w-full max-w-5xl">
        {failed ? (
          <p className="text-sm text-error">{tr("This report isn't available. The certificate may not be valid, or its holder has not shared the report.")}</p>
        ) : !data ? (
          <div className="h-96 rounded-card bg-surface border border-rule animate-pulse" aria-busy="true" />
        ) : (
          <ScoreReport score={data.score} about={data.about} analysis="" viewer="org" />
        )}
      </div>
    </div>
  );
}
