import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ScoreReport } from "@/components/report/ScoreReport";
import type { ScoreReport as ScoreReportData } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// The tests with a sample report; ?test= picks one.
const SAMPLE_TESTS: { id: string; name: string }[] = [
  { id: "fourSkills", name: "English 4 Skills Essentials" },
  { id: "speakingListening", name: "English Speaking & Listening" },
  { id: "writing", name: "English Writing" },
  { id: "professional", name: "Professional English" },
  { id: "placement", name: "English Placement" },
  { id: "level", name: "Level Tests" },
];

interface SampleData {
  score: ScoreReportData;
  analysis: string;
  test: { id: string; name: string; levelTest: string | null; levelPassed: boolean | null };
}

// Public: a full Spica score report with made-up data, one for each test, for
// the website's Demo page. No login needed.
export function SampleReport() {
  const [params, setParams] = useSearchParams();
  const testId = SAMPLE_TESTS.some((t) => t.id === params.get("test")) ? params.get("test")! : "fourSkills";
  const [data, setData] = useState<SampleData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setData(null);
    setFailed(false);
    fetch(`/api/certificates/sample-report?test=${testId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [testId]);
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
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={tr("Choose a test")}>
          {SAMPLE_TESTS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === testId}
              onClick={() => setParams({ test: t.id }, { replace: true })}
              className={`text-xs font-semibold px-3 py-1.5 rounded-pill border cursor-pointer ${t.id === testId ? "bg-navy text-white border-navy" : "bg-surface text-ink border-rule hover:border-navy"}`}
            >
              {tr(t.name)}
            </button>
          ))}
        </div>
      </div>
      <div className="w-full max-w-5xl">
        {failed ? (
          <p className="text-sm text-error">{tr("The sample report couldn't be loaded. Try again later.")}</p>
        ) : !data ? (
          <div className="h-96 rounded-card bg-surface border border-rule animate-pulse" aria-busy="true" />
        ) : (
          <ScoreReport
            score={data.score}
            about={{
              deliveryMode: "certified",
              testTypeName: data.test.name,
              familyName: null,
              setName: null,
              testCode: "SAMPLE",
              completedAt: data.score.completedAt,
              levelTest: data.test.levelTest,
              levelPassed: data.test.levelPassed,
            }}
            analysis={data.analysis}
          />
        )}
      </div>
    </div>
  );
}
