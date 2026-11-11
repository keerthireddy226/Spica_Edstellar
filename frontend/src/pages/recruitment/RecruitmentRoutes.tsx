import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { useBranding } from "@/components/AppShell/useBranding";
import { ROUTES } from "@/constants/routes";
import { OrgAdminDashboard } from "@/pages/orgAdmin/OrgAdminDashboard";
import { TEST_KIND_LABEL } from "@/components/recruitment/testKinds";
import { getAssessment, getSharedAssessment, type AssessmentReport, type InterviewQuestion } from "@/api/recruitment";
import { InterviewQuestionList } from "@/components/recruitment/InterviewQuestions";
import { tr } from "@/i18n/tr";
import { ScoreReport } from "@/components/report/ScoreReport";
import type { ScoreReport as ScoreReportData } from "@/api/practiceTests";
import { StrengthsSummary, rankSkills } from "@/components/report/StrengthsSummary";
import { isIncomplete, partTone, resultMarks } from "@/components/recruitment/resultMarks";
import { AnswerTotals, IncompleteNote } from "@/pages/recruitment/RecruitmentConsole";

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

// Every decision, recruitment and admissions alike.
const DECISION_TEXT: Record<NonNullable<AssessmentReport["decision"]>, () => string> = {
  shortlisted: () => tr("Shortlisted"),
  rejected: () => tr("Rejected"),
  hired: () => tr("Hired"),
  admitted: () => tr("Admitted"),
  waitlisted: () => tr("Waitlisted"),
  declined: () => tr("Declined"),
};

// The light palette, whatever the app's theme: the report is a white document.
const LIGHT = {
  "--color-navy": "#c97c5c", "--color-navy-deep": "#a8613f", "--color-ink": "#2e2419", "--color-paper": "#f3ebd8", "--color-paper-warm": "#efe4cc",
  "--color-surface": "#ffffff", "--color-rule": "rgba(46,36,25,0.08)", "--color-rule-strong": "rgba(46,36,25,0.16)", "--color-muted": "#8a7c68",
  "--color-success": "#6e9660", "--color-warning": "#e0aa52", "--color-error": "#c15c4a",
  "--color-listening": "#6e9660", "--color-speaking": "#d9713d", "--color-reading": "#e0aa52", "--color-writing": "#d98f72",
} as CSSProperties;
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3 break-inside-avoid">
      {title && <h2 className="font-display font-bold text-lg text-ink">{title}</h2>}
      {children}
    </section>
  );
}

// The candidate's report to print or save as PDF for the hiring manager, laid
// out like the learner's score report. Also opened by a hiring manager from a
// shared link (`token`), without logging in.
export function CandidateReportPrint() {
  const { id = "", token = "" } = useParams();
  const [a, setA] = useState<AssessmentReport | null>(null);
  const [interview, setInterview] = useState<InterviewQuestion[]>([]);
  const [sharedUntil, setSharedUntil] = useState<string | null>(null);
  const [score, setScore] = useState<ScoreReportData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    (token ? getSharedAssessment(token) : getAssessment(id))
      .then((r) => {
        setA(r.assessment);
        setInterview(r.interview ?? []);
        setScore(r.score ?? null);
        if ("sharedUntil" in r) setSharedUntil(r.sharedUntil as string);
      })
      .catch(() => setError(true));
  }, [id, token]);
  if (error) return <p className="p-8 text-sm text-error">{token ? tr("This link has expired or isn't valid. Ask the recruiter for a new one.") : tr("This report isn't available.")}</p>;
  if (!a) return <p className="p-8 text-sm text-black/60 bg-white min-h-screen">{tr("Loading…")}</p>;
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || a.email;
  const r = a.result;
  const scored = r && !r.pending && !!(r.cefrLevel || (r.overallPercent !== null && r.overallPercent !== undefined));
  const { skills, parts } = r ? resultMarks(r, a.test_kind) : { skills: [], parts: [] };
  const { best, worst } = rankSkills(skills);
  const completed = a.completed_at ? new Date(a.completed_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
  // With a score report: the learner's report as it is (every skill's graph,
  // the profile, speaking and writing), then the hiring details on their own page.
  const full = !!score?.overall;
  return (
    <div className="cr-print min-h-screen bg-white text-ink" style={LIGHT}>
      <style>{`.cr-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { ${full ? "" : "@page { size: A4; margin: 10mm 0; }"} html, body, *:has(.cr-print) { background: #fff !important; } .cr-print { font-size: 13px; } .cr-print section { box-shadow: none; padding: 12px 14px; } .cr-extra { padding: 4mm 12mm 0; } }`}</style>
      <div className={`${full ? "max-w-4xl" : "max-w-3xl"} mx-auto px-4 sm:px-8 py-8 print:p-0 print:max-w-none flex flex-col gap-4`}>
        {isIncomplete(a.answers) && <IncompleteNote answers={a.answers!} />}
        {full ? (
          <ScoreReport score={score!} about={null} analysis="" viewer="org" hiring={[TEST_KIND_LABEL[a.test_kind](), a.exam_name].filter(Boolean).join(" · ")} />
        ) : (
        <>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="font-logo font-bold text-2xl text-navy">Spica</span>
              <h1 className="font-display font-bold text-2xl text-ink mt-1">{tr("English assessment report")}</h1>
              <p className="text-sm text-muted">{[TEST_KIND_LABEL[a.test_kind](), a.exam_name].filter(Boolean).join(" · ")}</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                // "Save as PDF" names the file after the page title.
                const before = document.title;
                document.title = ["Spica assessment report", name, a.test_code, completed].filter(Boolean).join(" - ");
                window.print();
                document.title = before;
              }}
              className="print:hidden flex items-center gap-2"
            >
              <Printer size={15} /> {tr("Print or save as PDF")}
            </Button>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 border-t border-rule pt-4 text-sm">
            {[
              [name, a.email],
              [[a.job_title, a.location].filter(Boolean).join(" · ") || "—", tr("Job opening")],
              [completed, tr("Completed")],
              [a.test_code ?? "—", tr("Attempt ID")],
            ].map(([v, k]) => (
              <div key={k} className="min-w-0">
                <dd className="font-semibold text-ink break-words">{v}</dd>
                <dt className="text-xs text-muted break-words">{k}</dt>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          {!r ? (
            <p className="text-sm text-muted">{tr("No result yet.")}</p>
          ) : !scored ? (
            <p className="text-sm text-muted">{tr("No answers could be scored. The candidate may have skipped the questions.")}</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-[180px_1fr] print:grid-cols-[160px_1fr] gap-5 items-center">
                <div className="flex flex-col items-center gap-1 rounded-card bg-paper-warm p-4">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{tr("Level")}</span>
                  <span className="font-display font-bold text-5xl text-ink leading-none">{r.cefrLevel ?? "—"}</span>
                  {r.overallPercent !== null && r.overallPercent !== undefined && <span className="text-sm text-muted">{tr("{{n}}% overall", { n: r.overallPercent })}</span>}
                  {r.meetsMinimum !== null && r.meetsMinimum !== undefined && (
                    <span className={`mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-pill text-center ${r.meetsMinimum ? "bg-success/15 text-success" : "bg-error/10 text-error"}`}>
                      {r.meetsMinimum ? tr("Meets the minimum level for this job.") : tr("Below the minimum level for this job.")}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2 min-w-0">
                  <div className="grid grid-cols-6 h-8 rounded-lg overflow-hidden">
                    {LEVELS.map((l, i) => (
                      <div key={l} className={`flex items-center justify-center text-[11px] font-semibold ${l === r.cefrLevel ? "bg-navy text-white" : i % 2 ? "bg-paper-warm text-muted" : "bg-paper text-muted"}`}>
                        {l}
                      </div>
                    ))}
                  </div>
                  {a.min_cefr && <p className="text-xs text-muted">{tr("Minimum level for the job")}: {a.min_cefr}</p>}
                  {a.certificate_code && (
                    <p className="text-xs text-muted">
                      {tr("Certificate")}: <a href={`/certificate/${a.certificate_code}`} className="underline">{a.certificate_code}</a>
                    </p>
                  )}
                </div>
              </div>
              <StrengthsSummary skills={skills} parts={parts} unit="percent" />
            </>
          )}
        </Card>

        {scored && skills.length > 0 && (
          <Card title={skills.length === 4 ? tr("The four skills") : tr("Skills")}>
            <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3">
              {skills.map((s) => (
                <div
                  key={s.skill}
                  className={`rounded-xl p-3 flex flex-col gap-1.5 ${s.skill === best?.skill ? "bg-success/10 ring-2 ring-success/50" : s.skill === worst?.skill ? "bg-warning/10 ring-1 ring-warning/60" : "bg-paper"}`}
                >
                  <span className="text-xs text-muted">{s.name}</span>
                  <span className={`font-display font-bold text-2xl leading-none ${s.attempted ? "text-ink" : "text-muted"}`}>{s.attempted ? s.level : "0%"}</span>
                  <div className="h-1.5 rounded-pill bg-white/80 overflow-hidden">
                    <div className="h-full rounded-pill" style={{ width: `${s.value}%`, background: `var(--color-${s.skill})` }} />
                  </div>
                  <span className="text-[11px] text-muted">{s.attempted ? `${s.value}%` : tr("Not attempted")}</span>
                  {s.skill === best?.skill && <span className="text-[10px] font-semibold uppercase tracking-wide text-success">{tr("Strongest")}</span>}
                  {s.skill === worst?.skill && <span className="text-[10px] font-semibold uppercase tracking-wide text-ink">{tr("Needs most work")}</span>}
                </div>
              ))}
            </div>
          </Card>
        )}

        </>
        )}

        <div className={`flex flex-col gap-4 ${full ? "cr-extra" : ""}`}>
        {full && (
          <Card title={tr("Hiring details")}>
            <dl className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 text-sm">
              {[
                [[a.job_title, a.location].filter(Boolean).join(" · ") || "—", tr("Job opening")],
                [a.min_cefr ?? tr("None"), tr("Minimum level for the job")],
                [r?.cefrLevel ? `${r.cefrLevel}${r.overallPercent !== null && r.overallPercent !== undefined ? ` · ${r.overallPercent}%` : ""}` : "—", tr("Level")],
                [a.test_code ?? "—", tr("Attempt ID")],
              ].map(([v, k]) => (
                <div key={k} className="min-w-0">
                  <dd className="font-semibold text-ink break-words">{v}</dd>
                  <dt className="text-xs text-muted break-words">{k}</dt>
                </div>
              ))}
            </dl>
            {r && <AnswerTotals result={r} answers={a.answers} />}
            {r?.meetsMinimum !== null && r?.meetsMinimum !== undefined && (
              <span className={`self-start text-xs font-semibold px-2.5 py-0.5 rounded-pill ${r.meetsMinimum ? "bg-success/15 text-success" : "bg-error/10 text-error"}`}>
                {r.meetsMinimum ? tr("Meets the minimum level for this job.") : tr("Below the minimum level for this job.")}
              </span>
            )}
            {a.certificate_code && (
              <p className="text-xs text-muted">
                {tr("Certificate")}: <a href={`/certificate/${a.certificate_code}`} className="underline">{a.certificate_code}</a>
              </p>
            )}
            {a.decision && (
              <p className="text-sm border-t border-rule pt-3">
                <b>{tr("Decision")}:</b> {DECISION_TEXT[a.decision]()}
                {a.decision_note && <span className="text-muted"> · {a.decision_note}</span>}
              </p>
            )}
          </Card>
        )}
        {scored && parts.length > 0 && (
          <Card title={tr("Question types")}>
            <div className="flex flex-col gap-2">
              {parts.map((p) => (
                <div key={p.label} className="flex flex-col gap-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink">{p.label}</span>
                    <span className="text-xs font-mono text-muted">
                      {p.right}/{p.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
                    <div className={`h-full ${partTone(p.right, p.total)}`} style={{ width: `${p.total ? Math.round((p.right / p.total) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title={tr("Test integrity")}>
          <p className="text-sm">
            {a.integrity_status ? INTEGRITY_TEXT[a.integrity_status]() : tr("Not proctored")}
            {a.identity_status ? ` · ${a.identity_status === "verified" ? tr("ID verified") : a.identity_status === "rejected" ? tr("ID rejected") : tr("ID check waiting")}` : ""}
          </p>
          <p className="text-xs text-muted border-l-2 border-rule-strong pl-3">
            {tr("The test is one input, not the only factor: weigh it with the interview, experience and references. A level is an estimate with some margin, so treat results close to the minimum with care.")}
          </p>
        </Card>

        {interview.length > 0 && (
          <Card title={tr("Questions for the interview")}>
            <p className="text-xs text-muted">{tr("To check in person the skills the test showed weakest, at the level the job needs.")}</p>
            <InterviewQuestionList questions={interview} print />
          </Card>
        )}

        {a.decision && !full && (
          <Card title={tr("Decision")}>
            <p className="text-sm">{DECISION_TEXT[a.decision]()}</p>
            {a.decision_note && <p className="text-sm text-muted">{a.decision_note}</p>}
          </Card>
        )}

        <p className="text-xs text-muted">
          {tr("Generated by Spica on {{date}}. Contains personal data: share only with people involved in this hiring decision.", { date: new Date().toLocaleDateString() })}
          {sharedUntil ? ` ${tr("Shared link valid until {{date}}.", { date: sharedUntil })}` : ""}
        </p>
        </div>
      </div>
    </div>
  );
}
