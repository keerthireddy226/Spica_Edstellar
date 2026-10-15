import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/components/AppShell/useBranding";
import { ROUTES } from "@/constants/routes";
import { OrgAdminDashboard } from "@/pages/orgAdmin/OrgAdminDashboard";
import { TEST_KIND_LABEL } from "@/components/recruitment/testKinds";
import { getAssessment, type AssessmentReport } from "@/api/recruitment";
import { tr } from "@/i18n/tr";

// An organization that only bought recruitment lands on recruitment.
export function OrgAdminHome() {
  const branding = useBranding();
  if (!branding) return null;
  if (!branding.products.includes("skills")) return <Navigate to={ROUTES.ORG_ADMIN_RECRUITMENT} replace />;
  return <OrgAdminDashboard />;
}

// Notification links: each reader's own recruitment page.
export function RecruitmentRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  return <Navigate to={user.role === "recruiter" ? ROUTES.RECRUITER_JOBS : ROUTES.ORG_ADMIN_RECRUITMENT} replace />;
}

const INTEGRITY_TEXT: Record<string, () => string> = {
  in_progress: () => tr("Being checked"),
  clear: () => tr("No issues"),
  flagged: () => tr("Needs review"),
  cleared: () => tr("Cleared after review"),
  violation: () => tr("Violation confirmed"),
};

// A clean one-page report to print or save as PDF for the hiring manager.
export function CandidateReportPrint() {
  const { id = "" } = useParams();
  const [a, setA] = useState<AssessmentReport | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getAssessment(id)
      .then((r) => setA(r.assessment))
      .catch(() => setError(true));
  }, [id]);
  if (error) return <p className="p-8 text-sm text-error">{tr("This report isn't available.")}</p>;
  if (!a) return null;
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email;
  const r = a.result;
  return (
    <div className="min-h-screen bg-white text-black px-6 sm:px-10 py-8 max-w-3xl mx-auto print:p-0">
      <div className="flex items-start justify-between gap-4 border-b border-black/20 pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-black/60">{tr("English assessment report")}</p>
          <h1 className="text-2xl font-bold mt-1">{name}</h1>
          <p className="text-sm text-black/70">{a.email}</p>
        </div>
        <Button onClick={() => window.print()} className="print:hidden">
          <Printer size={15} className="inline mr-1.5" />
          {tr("Print or save as PDF")}
        </Button>
      </div>
      <table className="w-full text-sm mt-4">
        <tbody>
          {[
            [tr("Job opening"), [a.job_title, a.department, a.location].filter(Boolean).join(" · ")],
            [tr("Test"), [TEST_KIND_LABEL[a.test_kind](), a.exam_name].filter(Boolean).join(" · ")],
            [tr("Test ID"), a.test_code ?? "—"],
            [tr("Completed"), a.completed_at ? new Date(a.completed_at).toLocaleString() : "—"],
            [tr("Minimum level for the job"), a.min_cefr ?? tr("None")],
          ].map(([k, v]) => (
            <tr key={k} className="border-b border-black/10">
              <td className="py-1.5 pr-4 text-black/60 w-48">{k}</td>
              <td className="py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="text-lg font-bold mt-6">{tr("Result")}</h2>
      {!r ? (
        <p className="text-sm text-black/60">{tr("No result yet.")}</p>
      ) : r.pending || (!r.cefrLevel && (r.overallPercent === null || r.overallPercent === undefined)) ? (
        <p className="text-sm text-black/60">{tr("No answers could be scored. The candidate may have skipped the questions.")}</p>
      ) : (
        <div className="mt-2">
          <p className="text-4xl font-bold">
            {r.cefrLevel ?? (r.overallPercent !== null && r.overallPercent !== undefined ? `${r.overallPercent}%` : "—")}
            {r.cefrLevel && r.overallPercent !== null && r.overallPercent !== undefined && <span className="text-base font-normal text-black/60 ml-3">{r.overallPercent}%</span>}
          </p>
          {r.meetsMinimum !== null && r.meetsMinimum !== undefined && (
            <p className="text-sm mt-1">{r.meetsMinimum ? tr("Meets the minimum level for this job.") : tr("Below the minimum level for this job.")}</p>
          )}
          {r.skillLevels && (
            <table className="w-full text-sm mt-3">
              <tbody>
                {Object.entries(r.skillLevels).map(([skill, level]) => (
                  <tr key={skill} className="border-b border-black/10">
                    <td className="py-1.5 pr-4 capitalize w-48">{tr(skill.charAt(0).toUpperCase() + skill.slice(1))}</td>
                    <td className="py-1.5 font-semibold">{level}</td>
                    <td className="py-1.5 text-black/60">{r.skillPercents?.[skill] !== undefined ? `${r.skillPercents[skill]}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {r.partResults && (
            <table className="w-full text-sm mt-3">
              <tbody>
                {r.partResults.map((p) => (
                  <tr key={p.label} className="border-b border-black/10">
                    <td className="py-1.5 pr-4 w-48">{p.label}</td>
                    <td className="py-1.5">
                      {p.correctCount}/{p.gradedCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <h2 className="text-lg font-bold mt-6">{tr("Test integrity")}</h2>
      <p className="text-sm mt-1">
        {a.integrity_status ? INTEGRITY_TEXT[a.integrity_status]() : tr("Not proctored")}
        {a.identity_status ? ` · ${a.identity_status === "verified" ? tr("ID verified") : a.identity_status === "rejected" ? tr("ID rejected") : tr("ID check waiting")}` : ""}
      </p>
      {a.decision && (
        <>
          <h2 className="text-lg font-bold mt-6">{tr("Decision")}</h2>
          <p className="text-sm mt-1">{a.decision === "hired" ? tr("Hired") : a.decision === "rejected" ? tr("Rejected") : tr("Shortlisted")}</p>
          {a.decision_note && <p className="text-sm text-black/70">{a.decision_note}</p>}
        </>
      )}
      <p className="text-xs text-black/50 mt-10">{tr("Generated by Spica on {{date}}. Contains personal data: share only with people involved in this hiring decision.", { date: new Date().toLocaleDateString() })}</p>
    </div>
  );
}
