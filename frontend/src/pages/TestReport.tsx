import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getReport } from "@/api/practiceTests";
import { FeedbackReportView } from "@/components/report/FeedbackReportView";
import { useMyLicense } from "@/components/licenses/LicenseGate";
import { tr } from "@/i18n/tr";

// A learner's feedback report for one finished practice test or mock.
export function TestReport() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const license = useMyLicense();
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <button onClick={() => navigate(-1)} className="self-start flex items-center gap-1.5 text-sm text-muted hover:text-ink cursor-pointer print:hidden">
        <ArrowLeft size={16} /> {tr("Back")}
      </button>
      <h1 className="font-display font-bold text-2xl text-ink print:hidden">{tr("Your feedback report")}</h1>
      <FeedbackReportView key={sessionId} load={() => getReport(sessionId!)} upgradeLink={!!license?.individual} sessionId={sessionId} />
    </div>
  );
}
