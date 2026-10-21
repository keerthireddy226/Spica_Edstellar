import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { ProgressRing } from "@/components/ProgressRing";
import { QuestionReview } from "@/components/report/FeedbackReportView";
import { SpeakingDetail, WritingDetail } from "@/components/report/ScoreReport";
import { getModuleReport, testsLine, type ModuleReport } from "@/api/practiceSession";
import { formatShortDate } from "@/api/licenses";
import { tr } from "@/i18n/tr";

// The report of one finished Practice Modules set: score, counts, and every
// question with the learner's answer and the right one.
export function ModuleReportPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [report, setReport] = useState<ModuleReport | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!sessionId) return;
    getModuleReport(sessionId)
      .then(setReport)
      .catch(() => setError(true));
  }, [sessionId]);

  const back = (
    <button onClick={() => navigate(-1)} className="self-start flex items-center gap-1.5 text-sm text-muted hover:text-ink cursor-pointer">
      <ArrowLeft size={16} /> {tr("Back")}
    </button>
  );
  if (error) {
    return (
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
        {back}
        <p className="text-sm text-error">{tr("This report couldn't be loaded.")}</p>
      </div>
    );
  }
  if (!report) return <p className="text-sm text-muted">{tr("Loading…")}</p>;

  const c = report.context;
  const pct = report.total ? Math.round((report.right / report.total) * 100) : 0;
  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col gap-5">
      {back}
      <div className="bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-4">
        <p className="text-xs uppercase tracking-wide text-muted">
          {[tr("Practice Modules"), c.skill ? t(`skills.${c.skill}`) : null, c.retry ? tr("Mistakes to retry") : c.typeName, c.unitName, c.setName].filter(Boolean).join(" · ")}
        </p>
        {c.tests?.length ? <p className="text-xs text-muted -mt-2">{tr("Used in these tests: {{tests}}", { tests: testsLine(c.tests) })}</p> : null}
        <div className="flex items-center gap-4">
          <ProgressRing percent={pct} size={72} strokeWidth={6} colorClass={pct >= 80 ? "text-success" : pct >= 50 ? "text-navy" : "text-warning"}>
            <span className="font-display font-bold text-lg text-ink">{pct}%</span>
          </ProgressRing>
          <div>
            <h1 className="font-display font-bold text-2xl text-ink">{tr("{{right}} of {{total}} right", { right: report.right, total: report.total })}</h1>
            <p className="text-sm text-muted">{tr("Finished on {{date}}", { date: formatShortDate(report.completedAt) })}</p>
            {report.pending > 0 && <p className="text-sm text-muted">{tr("{{n}} answers are still being scored.", { n: report.pending })}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-success/10 rounded-card py-2">
            <div className="font-display font-bold text-xl text-success">{report.right}</div>
            <div className="text-xs text-muted">{tr("Right")}</div>
          </div>
          <div className="bg-error/10 rounded-card py-2">
            <div className="font-display font-bold text-xl text-error">{report.wrong}</div>
            <div className="text-xs text-muted">{tr("Wrong")}</div>
          </div>
          <div className="bg-warning/10 rounded-card py-2">
            <div className="font-display font-bold text-xl text-warning">{report.skipped}</div>
            <div className="text-xs text-muted">{tr("Skipped")}</div>
          </div>
        </div>
      </div>
      {report.detail?.speaking && <SpeakingDetail s={report.detail.speaking} />}
      {report.detail?.writing && <WritingDetail w={report.detail.writing} />}
      {report.questions.length > 0 && <QuestionReview questions={report.questions} initialFilter="all" />}
    </div>
  );
}
