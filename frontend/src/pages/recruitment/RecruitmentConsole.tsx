import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, Check, ChevronRight, Coins, Copy, Download, FileSpreadsheet, Link2, Mail, Plus, Printer, RotateCw, Send, ShieldAlert, Trash2, Upload, UserCheck, UserPlus, Users, XCircle } from "lucide-react";
import { downloadText, parseCsv, toCsv } from "@/lib/csv";
import { readXlsx } from "@/lib/xlsx";
import { peopleFromRows, type SheetResult } from "@/lib/peopleSheet";
import { Badge, DetailModal } from "@/components/DetailModal";
import { Button } from "@/components/Button";
import { EmptyNote, FilterPills, PageHeader, Panel, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { dateTime, shortDate, timeOfDay } from "@/api/staff";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { ROUTES } from "@/constants/routes";
import { TEST_KIND_LABEL } from "@/components/recruitment/testKinds";
import { getProducts } from "@/api/access";
import {
  addRecruiter,
  cancelInvite,
  createJob,
  decideAssessment,
  getAssessment,
  getCandidateReport,
  shareAssessment,
  confirmAssessment,
  getCredits,
  getJob,
  getJobs,
  getRecruiters,
  getRecruitmentOverview,
  inviteCandidates,
  jobExportUrl,
  removeRecruiter,
  renewPublicLink,
  requestCredits,
  publicLinkUrl,
  setPublicLink,
  resendInvite,
  saveRecruitmentSettings,
  updateJob,
  type AssessmentReport,
  type InterviewQuestion,
  type AssessmentResult,
  type CandidateRow,
  type Cefr,
  type CreditEvent,
  type Decision,
  type Job,
  type JobInput,
  type Recruiter,
  type RecruitmentOverview,
  type TestKind,
} from "@/api/recruitment";
import { tr } from "@/i18n/tr";
import { useAdmissions } from "@/components/AppShell/useBranding";
import { FeedbackReportView } from "@/components/report/FeedbackReportView";
import { InterviewQuestionList } from "@/components/recruitment/InterviewQuestions";
import { trServer } from "@/i18n/serverText";

const CEFR: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const TEST_KINDS: TestKind[] = ["placement", "fourSkills", "speakingListening", "writing", "professional"];

const STATUS_TEXT: Record<string, () => string> = {
  invited: () => tr("Invited"),
  started: () => tr("In progress"),
  completed: () => tr("Completed"),
  expired: () => tr("Expired"),
  cancelled: () => tr("Cancelled"),
};
const STATUS_TONE = { invited: "muted", started: "navy", completed: "success", expired: "warning", cancelled: "muted" } as const;
const DECISION_TEXT: Record<Decision, () => string> = {
  shortlisted: () => tr("Shortlisted"),
  rejected: () => tr("Rejected"),
  hired: () => tr("Hired"),
  admitted: () => tr("Admitted"),
  waitlisted: () => tr("Waitlisted"),
  declined: () => tr("Declined"),
};
const DECISION_TONE: Record<Decision, "navy" | "error" | "success"> = {
  shortlisted: "navy",
  rejected: "error",
  hired: "success",
  admitted: "success",
  waitlisted: "navy",
  declined: "error",
};
// Admissions decisions match recruitment's for filters and counts.
const DECISION_GROUP: Record<Decision, "shortlisted" | "hired" | "rejected"> = {
  shortlisted: "shortlisted",
  hired: "hired",
  rejected: "rejected",
  waitlisted: "shortlisted",
  admitted: "hired",
  declined: "rejected",
};
const INTEGRITY_TEXT: Record<string, () => string> = {
  in_progress: () => tr("Being checked"),
  clear: () => tr("No issues"),
  flagged: () => tr("Needs review"),
  cleared: () => tr("Cleared"),
  violation: () => tr("Violation"),
};
const INTEGRITY_TONE = { in_progress: "muted", clear: "success", flagged: "warning", cleared: "success", violation: "error" } as const;

function personName(r: { first_name: string | null; last_name: string | null; email: string }): string {
  return [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email;
}

function initialsOf(r: { first_name: string | null; last_name: string | null; email: string }): string {
  return `${r.first_name?.[0] ?? ""}${r.last_name?.[0] ?? ""}`.toUpperCase() || r.email.slice(0, 2).toUpperCase();
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// The level, or the score for a fixed-length test.
function ResultBadge({ result, min }: { result: AssessmentResult | null; min?: Cefr | null }) {
  if (!result) return <span className="text-xs text-muted">—</span>;
  if (result.pending) return <span className="text-xs text-muted">{tr("Not scored")}</span>;
  const below = min && result.cefrLevel && CEFR.indexOf(result.cefrLevel) < CEFR.indexOf(min);
  return (
    <span className="flex items-center gap-1.5">
      {result.cefrLevel && <span className={`font-display font-bold ${below ? "text-error" : "text-ink"}`}>{result.cefrLevel}</span>}
      {result.overallPercent !== null && result.overallPercent !== undefined && <span className="text-xs text-muted">{result.overallPercent}%</span>}
    </span>
  );
}

function ResultDetails({ result }: { result: AssessmentResult }) {
  if (result.pending || (result.kind === "exam" && !result.partResults?.some((p) => p.gradedCount > 0) && !result.pendingCount)) {
    return <p className="text-sm text-muted">{tr("No answers could be scored. The candidate may have skipped the questions.")}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {result.skillLevels && Object.keys(result.skillLevels).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(result.skillLevels).map(([skill, level]) => (
            <div key={skill} className="bg-paper-warm rounded-input p-3">
              <p className="text-xs text-muted capitalize">{tr(skill.charAt(0).toUpperCase() + skill.slice(1))}</p>
              <p className="font-display font-bold text-lg text-ink">{level}</p>
              {result.skillPercents?.[skill] !== undefined && <p className="text-[11px] text-muted">{result.skillPercents[skill]}%</p>}
            </div>
          ))}
        </div>
      )}
      {(result.partResults ?? []).length > 0 && (
        <div className="flex flex-col gap-2">
          {(result.partResults ?? []).map((p) => {
            const pct = p.gradedCount ? Math.round((p.correctCount / p.gradedCount) * 100) : 0;
            return (
              <div key={p.label} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{p.label}</span>
                  <span className="text-xs font-mono text-muted">
                    {p.correctCount}/{p.gradedCount}
                  </span>
                </div>
                <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
                  <div className="h-full bg-navy" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {(result.pendingCount ?? 0) > 0 && <p className="text-xs text-muted">{tr("{{n}} answers still being scored.", { n: result.pendingCount })}</p>}
    </div>
  );
}

// The candidate's feedback report: question by question, writing corrections,
// speaking notes. Opened on demand (it can take a minute to build).
function CandidateFeedback({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel
      title={tr("Feedback report")}
      action={
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-semibold text-navy-deep underline cursor-pointer">
          {open ? tr("Hide") : tr("Show")}
        </button>
      }
    >
      {open ? <FeedbackReportView load={() => getCandidateReport(id)} /> : <p className="text-xs text-muted">{tr("Every answer reviewed: what was right or wrong and why, writing corrected, and notes on speaking.")}</p>}
    </Panel>
  );
}

// A read-only link for hiring managers, copied to the clipboard.
function ShareButton({ id }: { id: string }) {
  const [shared, setShared] = useState<{ url: string; until: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return shared ? (
    <span className="text-xs text-white bg-white/15 rounded-input px-3 py-2 self-center max-w-xs">
      {tr("Link copied. Anyone with it can open this report until {{date}}.", { date: shared.until })}
    </span>
  ) : (
    <Button
      variant="secondary"
      disabled={busy}
      title={failed ? tr("Could not create a link.") : undefined}
      onClick={async () => {
        setBusy(true);
        setFailed(false);
        const r = await shareAssessment(id).catch(() => null);
        setBusy(false);
        if (!r) {
          setFailed(true);
          return;
        }
        await navigator.clipboard?.writeText(r.url).catch(() => {});
        setShared(r);
      }}
    >
      {failed ? tr("Could not create a link.") : tr("Share with a hiring manager")}
    </Button>
  );
}

// The modal frame while something loads, or when it could not.
function ModalPlaceholder({ title, icon, error, onClose, onRetry }: { title: string; icon: typeof Briefcase; error: string | null; onClose: () => void; onRetry?: () => void }) {
  return (
    <DetailModal title={title} icon={icon} onClose={onClose}>
      {error ? (
        <div className="flex items-center justify-between gap-3 bg-error/10 border border-error/25 rounded-card px-4 py-3 text-sm text-error">
          <span>{error}</span>
          {onRetry && (
            <button onClick={onRetry} className="font-semibold underline cursor-pointer">
              {tr("Try again")}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-card bg-paper-warm border border-rule animate-pulse" />
          ))}
          <p className="sr-only">{tr("Loading…")}</p>
        </div>
      )}
    </DetailModal>
  );
}

// One candidate: result, integrity, decision.
export function CandidateReport({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const adm = useAdmissions();
  const [confirmLevel, setConfirmLevel] = useState<Cefr | "">("");
  const [confirmNote, setConfirmNote] = useState("");
  const [a, setA] = useState<AssessmentReport | null>(null);
  const [interview, setInterview] = useState<InterviewQuestion[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoadError(null);
    getAssessment(id)
      .then((r) => {
        setA(r.assessment);
        setInterview(r.interview ?? []);
        setNote(r.assessment.decision_note ?? "");
        setConfirmLevel(r.assessment.confirmed_level ?? r.assessment.result?.cefrLevel ?? "");
        setConfirmNote(r.assessment.confirm_note ?? "");
      })
      .catch(() => setLoadError(tr("Could not load this report.")));
  }, [id]);
  useEffect(load, [load]);
  if (!a) return <ModalPlaceholder title={loadError ? tr("Something went wrong") : tr("Loading…")} icon={UserCheck} error={loadError} onClose={onClose} onRetry={load} />;
  const integrityRoute = user?.role === "recruiter" ? ROUTES.RECRUITER_INTEGRITY : ROUTES.ORG_ADMIN_INTEGRITY;
  async function decide(d: Decision | null) {
    setBusy(true);
    await decideAssessment(id, d, note.trim() || undefined).catch(() => {});
    setBusy(false);
    load();
    onChanged();
  }
  return (
    <DetailModal
      title={personName(a)}
      subtitle={a.email}
      icon={UserCheck}
      onClose={onClose}
      badges={
        <>
          {a.job_title && (
            <Badge>
              <Briefcase size={11} className="inline mr-1 -mt-0.5" />
              {a.job_title}
            </Badge>
          )}
          <Badge tone={a.status === "completed" ? "good" : a.status === "expired" ? "warn" : "neutral"}>{STATUS_TEXT[a.status]()}</Badge>
          {a.decision && <Badge tone={a.decision === "rejected" ? "bad" : "good"}>{DECISION_TEXT[a.decision]()}</Badge>}
        </>
      }
      actions={
        a.status === "completed" ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => window.open(`/recruitment/report/${a.id}`, "_blank")}>
              <Printer size={15} className="inline mr-1.5" />
              {tr("Print or save as PDF")}
            </Button>
            <ShareButton id={a.id} />
          </div>
        ) : undefined
      }
      stats={[
        { label: tr("Level"), value: a.result?.cefrLevel ?? "—", hint: a.min_cefr ? tr("Minimum {{l}}", { l: a.min_cefr }) : undefined },
        { label: tr("Score"), value: a.result?.overallPercent !== undefined && a.result?.overallPercent !== null ? `${a.result.overallPercent}%` : "—" },
        { label: tr("Integrity"), value: a.integrity_status ? INTEGRITY_TEXT[a.integrity_status]() : "—", hint: a.risk_level ? tr("Risk {{s}}", { s: a.risk_score ?? 0 }) : undefined },
        { label: tr("Completed"), value: a.completed_at ? shortDate(a.completed_at) : "—", hint: a.completed_at ? timeOfDay(a.completed_at) : undefined },
      ]}
    >
      <div className="flex flex-col gap-5">
        <Panel title={tr("Result")}>
          {a.result ? <ResultDetails result={a.result} /> : <EmptyNote>{tr("No result yet.")}</EmptyNote>}
          <p className="text-xs text-muted">
            {[
              TEST_KIND_LABEL[a.test_kind](),
              a.exam_name,
              a.exam_test_id ? tr("Test ID {{c}}", { c: a.exam_test_id }) : null,
              a.test_code ? tr("Attempt ID {{c}}", { c: a.test_code }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </Panel>
        <Panel
          title={tr("Integrity")}
          action={
            a.session_id ? (
              <Link to={`${integrityRoute}?session=${a.session_id}`} className="text-sm font-semibold text-navy-deep underline">
                {tr("Open the review")}
              </Link>
            ) : undefined
          }
        >
          {!a.integrity_status ? (
            <EmptyNote>{tr("No proctoring record for this assessment.")}</EmptyNote>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap gap-1.5">
                <StatusPill tone={INTEGRITY_TONE[a.integrity_status]}>{INTEGRITY_TEXT[a.integrity_status]()}</StatusPill>
                {a.identity_status && (
                  <StatusPill tone={a.identity_status === "verified" ? "success" : a.identity_status === "rejected" ? "error" : "warning"}>
                    {a.identity_status === "verified" ? tr("ID verified") : a.identity_status === "rejected" ? tr("ID rejected") : tr("ID check waiting")}
                  </StatusPill>
                )}
              </div>
              {(a.integrity_reasons ?? []).length > 0 && (
                <p className="text-xs text-muted">{tr("{{n}} signals recorded. Open the review to see snapshots, recordings and the timeline.", { n: a.integrity_reasons!.length })}</p>
              )}
            </div>
          )}
        </Panel>
        {a.status === "completed" && <CandidateFeedback id={id} />}
        {interview.length > 0 && (
          <Panel title={tr("Questions for the interview")}>
            <p className="text-xs text-muted">{tr("To check in person the skills the test showed weakest, at the level the job needs.")}</p>
            <InterviewQuestionList questions={interview} />
          </Panel>
        )}
        {a.status === "completed" && adm && (
          <Panel title={tr("Confirm the result")}>
            <p className="text-xs text-muted">
              {tr("The level comes from an AI-scored test. Read the feedback report, then confirm the level or correct it before deciding.")}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <select value={confirmLevel} onChange={(e) => setConfirmLevel(e.target.value as Cefr | "")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm cursor-pointer">
                <option value="">{tr("Choose a level")}</option>
                {(["A1", "A2", "B1", "B2", "C1", "C2"] as Cefr[]).map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <input
                value={confirmNote}
                onChange={(e) => setConfirmNote(e.target.value)}
                placeholder={tr("Why, if you changed it (optional)")}
                className="flex-1 min-w-48 rounded-input border border-rule bg-surface px-3 py-2 text-sm"
              />
              <Button
                variant="secondary"
                disabled={busy || !confirmLevel}
                onClick={async () => {
                  setBusy(true);
                  await confirmAssessment(id, (confirmLevel || null) as Cefr | null, confirmNote.trim() || undefined).catch(() => {});
                  setBusy(false);
                  load();
                  onChanged();
                }}
              >
                {tr("Confirm level")}
              </Button>
            </div>
            {a.confirmed_level && a.confirmed_at && (
              <p className="text-xs text-success">
                {tr("Confirmed {{level}} by {{who}} on {{date}}.", { level: a.confirmed_level, who: a.confirmed_by_name || tr("a colleague"), date: dateTime(a.confirmed_at) })}
              </p>
            )}
          </Panel>
        )}
        {a.status === "completed" && (
          <Panel title={tr("Decision")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={tr("Note for your team (optional)")}
              className="rounded-input border border-rule bg-surface px-3 py-2 text-sm"
            />
            {adm && !a.confirmed_level && <p className="text-xs text-warning">{tr("Confirm the result first.")}</p>}
            <div className="flex flex-wrap gap-2">
              {(adm
                ? ([
                    ["admitted", tr("Admit")],
                    ["waitlisted", tr("Waitlist")],
                    ["declined", tr("Decline")],
                  ] as [Decision, string][])
                : ([
                    ["shortlisted", tr("Shortlist")],
                    ["hired", tr("Mark as hired")],
                    ["rejected", tr("Reject")],
                  ] as [Decision, string][])
              ).map(([d, label], i) => {
                const current = a.decision === d;
                return (
                  <Button
                    key={d}
                    variant={current || (!a.decision && i === 0) ? "primary" : "secondary"}
                    aria-pressed={current}
                    onClick={() => !current && decide(d)}
                    disabled={busy || (adm && !a.confirmed_level)}
                    className={current ? "ring-2 ring-navy/30 ring-offset-2 ring-offset-surface" : ""}
                  >
                    {current && <Check size={15} className="inline mr-1.5 -mt-0.5" />}
                    {label}
                  </Button>
                );
              })}
              {a.decision && (
                <button onClick={() => decide(null)} disabled={busy} className="text-sm text-muted underline cursor-pointer">
                  {tr("Clear decision")}
                </button>
              )}
            </div>
            {a.decided_at && (
              <p className="text-xs text-muted">{tr("Decided by {{who}} on {{date}}.", { who: a.decided_by_name || tr("a colleague"), date: dateTime(a.decided_at) })}</p>
            )}
          </Panel>
        )}
        <Panel title={tr("Timeline")}>
          <ul className="text-sm text-ink flex flex-col gap-1">
            <li>
              {a.source === "public_link"
                ? tr("Joined through the job's public link on {{date}}", { date: dateTime(a.invited_at) })
                : tr("Invited on {{date}} by {{who}}", { date: dateTime(a.invited_at), who: a.invited_by_name || tr("a colleague") })}
            </li>
            {a.started_at && <li>{tr("Started on {{date}}", { date: dateTime(a.started_at) })}</li>}
            {a.completed_at && (
              <li>
                {tr("Completed on {{date}}", { date: dateTime(a.completed_at) })}
                {a.started_at && <span className="text-muted"> · {tr("took {{m}} min", { m: Math.max(1, Math.round((new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 60000)) })}</span>}
              </li>
            )}
            {!a.completed_at && <li className="text-muted">{tr("Link valid until {{date}}", { date: dateTime(a.expires_at) })}</li>}
          </ul>
        </Panel>
      </div>
    </DetailModal>
  );
}

// "email, first name, last name" per line; commas, tabs or semicolons.
function parsePeople(text: string): { email: string; firstName?: string; lastName?: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.split(/[,;\t]/).map((x) => x.trim()))
    .filter((p) => p[0] && /\S+@\S+\.\S+/.test(p[0]))
    .map(([email, firstName, lastName]) => ({ email, firstName: firstName || undefined, lastName: lastName || undefined }));
}

function InvitePanel({ job, credits, onInvited }: { job: Job; credits: number; onInvited: () => void }) {
  // Credits per invitation: the test's assessment price (the placement test: 1).
  const [cost, setCost] = useState(1);
  useEffect(() => {
    getProducts()
      .then((r) => setCost(Math.max(1, r.products.find((p) => p.id === `assess_${job.test_kind}`)?.credits ?? 1)))
      .catch(() => setCost(1));
  }, [job.test_kind]);
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // People read from an uploaded spreadsheet, and what couldn't be used.
  const [sheet, setSheet] = useState<(SheetResult & { fileName: string }) | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const people = useMemo(() => {
    const list = [...parsePeople(bulk), ...(sheet?.people ?? [])];
    if (email.trim()) list.unshift({ email: email.trim(), firstName: first.trim() || undefined, lastName: last.trim() || undefined });
    // The same address twice (typed and in the file) is invited once.
    const seen = new Set<string>();
    return list.filter((p) => {
      const k = p.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [bulk, email, first, last, sheet]);
  async function readSheet(file: File) {
    setSheetError(null);
    try {
      const rows = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv(await file.text());
      const r = peopleFromRows(rows);
      if (!r.people.length) {
        setSheet(null);
        setSheetError(tr("No email addresses found in this file. Use the template: Email, First name, Last name."));
        return;
      }
      if (r.people.length > 200) {
        setSheet(null);
        setSheetError(tr("This file has {{n}} people. Upload at most 200 at a time.", { n: r.people.length }));
        return;
      }
      setSheet({ ...r, fileName: file.name });
    } catch {
      setSheet(null);
      setSheetError(tr("Could not read this file. Save it as .xlsx or .csv and try again."));
    }
  }
  async function send() {
    setBusy(true);
    setNote(null);
    try {
      const r = await inviteCandidates(job.id, people);
      setNote({
        ok: true,
        text: r.skipped
          ? tr("{{n}} invitations sent. {{s}} were already invited to this job.", { n: r.invited.length, s: r.skipped })
          : tr("{{n}} invitations sent.", { n: r.invited.length }),
      });
      setEmail("");
      setFirst("");
      setLast("");
      setBulk("");
      setSheet(null);
      onInvited();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; needed?: number; balance?: number }) : null;
      setNote({
        ok: false,
        text:
          body?.error === "not_enough_credits"
            ? tr("Not enough credits: {{needed}} needed, {{balance}} left.", { needed: body.needed ?? 0, balance: body.balance ?? 0 })
            : body?.error === "job_closed"
              ? tr("This job opening is closed. Reopen it to invite people.")
              : tr("Could not send the invitations. Check the email addresses."),
      });
    } finally {
      setBusy(false);
    }
  }
  if (job.status === "closed") return <EmptyNote>{tr("This job opening is closed. Reopen it to invite people.")}</EmptyNote>;
  const field = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  const label = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  const total = people.length * cost;
  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <PublicLinkPanel job={job} cost={cost} onChanged={onInvited} />
      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
        <p className="font-display font-bold text-ink">{tr("Invite one person")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={label}>{tr("Email")}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>{tr("First name")}</span>
            <input value={first} onChange={(e) => setFirst(e.target.value)} className={field} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={label}>{tr("Last name")}</span>
            <input value={last} onChange={(e) => setLast(e.target.value)} className={field} />
          </label>
        </div>
      </div>
      <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
        <p className="font-display font-bold text-ink">{tr("Invite many at once")}</p>
        <div className="flex flex-col gap-2 rounded-input border border-dashed border-rule-strong bg-paper-warm/60 p-4">
          <p className="text-sm font-semibold text-ink flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-navy-deep" /> {tr("Upload a spreadsheet")}
          </p>
          <p className="text-xs text-muted">{tr("Excel (.xlsx) or CSV, up to 200 people. Columns: Email, First name, Last name (or one Name column). Other columns are ignored.")}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-pill bg-navy text-lime cursor-pointer hover:bg-navy-soft">
              <Upload size={15} /> {tr("Choose a file")}
              <input
                type="file"
                accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readSheet(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => downloadText(toCsv([["Email", "First name", "Last name"], ["asha.rao@example.com", "Asha", "Rao"]]), "candidates-template.csv")}
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-pill border border-rule bg-surface text-ink hover:border-rule-strong cursor-pointer"
            >
              <Download size={15} /> {tr("Download a template")}
            </button>
          </div>
          {sheet && (
            <div className="text-sm text-ink flex items-start justify-between gap-3 bg-surface border border-rule rounded-input px-3 py-2">
              <span>
                {tr("{{file}}: {{n}} people ready.", { file: sheet.fileName, n: sheet.people.length })}
                {sheet.badRows.length > 0 && (
                  <span className="block text-xs text-warning">
                    {tr("Skipped rows without a valid email: {{rows}}", { rows: sheet.badRows.slice(0, 15).join(", ") + (sheet.badRows.length > 15 ? "…" : "") })}
                  </span>
                )}
                {sheet.duplicates > 0 && <span className="block text-xs text-muted">{tr("{{n}} repeated email addresses kept once.", { n: sheet.duplicates })}</span>}
              </span>
              <button type="button" onClick={() => setSheet(null)} className="text-muted hover:text-error cursor-pointer" aria-label={tr("Remove the file")}>
                <XCircle size={16} />
              </button>
            </div>
          )}
          {sheetError && <p className="text-sm text-error">{sheetError}</p>}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{tr("Or paste many, one per line: email, first name, last name")}</span>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder="name@example.com, Asha, Rao" className={`${field} font-mono`} />
        </label>
      </div>
      <div className="flex items-center gap-4 flex-wrap bg-paper-warm border border-rule rounded-card px-5 py-3">
        <div className="flex items-center gap-5">
          <div>
            <p className="font-display font-bold text-xl text-ink">{people.length}</p>
            <p className="text-[11px] text-muted">{tr("Ready")}</p>
          </div>
          <div>
            <p className={`font-display font-bold text-xl ${total > credits ? "text-error" : "text-ink"}`}>{total}</p>
            <p className="text-[11px] text-muted">{tr("Credits needed")}</p>
          </div>
          <div>
            <p className="font-display font-bold text-xl text-ink">{credits}</p>
            <p className="text-[11px] text-muted">{tr("Credits left")}</p>
          </div>
        </div>
        <div className="ml-auto">
          <Button onClick={send} disabled={busy || people.length === 0}>
            <Send size={15} className="inline mr-1.5" />
            {busy ? tr("Sending...") : tr("Send invitations")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted">
        {cost === 1
          ? tr("{{n}} people ready. Each invitation uses one credit ({{c}} left). Unused invitations are refunded when they expire or are cancelled.", { n: people.length, c: credits })
          : tr("{{n}} people ready. Each invitation to this test uses {{k}} credits: {{t}} in all ({{c}} left). Unused invitations are refunded when they expire or are cancelled.", {
              n: people.length,
              k: cost,
              t: people.length * cost,
              c: credits,
            })}
      </p>
      {note && (
        <p className={`text-sm rounded-input px-3.5 py-2.5 border ${note.ok ? "text-success bg-success/10 border-success/25" : "text-error bg-error/10 border-error/25"}`}>{note.text}</p>
      )}
    </div>
  );
}

// One link for job websites or a careers page: anyone with it confirms their
// email and takes the test; each person who starts uses the test's credits.
function PublicLinkPanel({ job, cost, onChanged }: { job: Job; cost: number; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(!!job.public_link_enabled);
  const [slug, setSlug] = useState(job.public_slug ?? null);
  const [max, setMax] = useState(job.public_link_max ? String(job.public_link_max) : "");
  const [closes, setCloses] = useState(job.public_link_closes_at ? job.public_link_closes_at.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const url = slug ? publicLinkUrl(slug) : "";
  async function save(on: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await setPublicLink(job.id, {
        enabled: on,
        max: max.trim() ? Math.max(1, Math.round(Number(max))) : null,
        // The link closes at the end of the chosen day.
        closesAt: closes ? new Date(`${closes}T23:59:59`).toISOString() : null,
      });
      setEnabled(r.enabled);
      setSlug(r.slug);
      setMsg({ ok: true, text: on ? tr("The link is on. Share it wherever you post this job.") : tr("The link is off. People who open it are told it's closed.") });
      onChanged();
    } catch {
      setMsg({ ok: false, text: tr("Could not save the link settings.") });
    } finally {
      setBusy(false);
    }
  }
  async function renew() {
    if (!window.confirm(tr("Make a new link? The current link stops working straight away."))) return;
    setBusy(true);
    try {
      const r = await renewPublicLink(job.id);
      setSlug(r.slug);
      setMsg({ ok: true, text: tr("New link made. The old one no longer works.") });
    } finally {
      setBusy(false);
    }
  }
  const field = "rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-display font-bold text-ink flex items-center gap-2">
          <Link2 size={17} className="text-navy-deep" /> {tr("Public link for job websites")}
        </p>
        <StatusPill tone={enabled ? "success" : "muted"}>{enabled ? tr("On") : tr("Off")}</StatusPill>
      </div>
      <p className="text-xs text-muted">
        {tr("Post one link on job websites or your careers page. Anyone with it confirms their email with a code and takes the test; they appear here like invited candidates. Each person who starts uses {{k}} credits.", { k: cost })}
      </p>
      {enabled && url && (
        <div className="flex items-center gap-2">
          <input readOnly value={url} onFocus={(e) => e.target.select()} className={`${field} flex-1 font-mono text-xs`} />
          <Button
            variant="secondary"
            className="!py-2 flex items-center gap-1.5"
            onClick={() => {
              void navigator.clipboard?.writeText(url);
              setMsg({ ok: true, text: tr("Link copied.") });
            }}
          >
            <Copy size={14} /> {tr("Copy")}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("At most this many people (optional)")}</span>
          <input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder={tr("No limit")} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Closes on (optional)")}</span>
          <input type="date" value={closes} onChange={(e) => setCloses(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {enabled ? (
          <>
            <Button onClick={() => save(true)} disabled={busy} className="!py-2">
              {tr("Save")}
            </Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy} className="!py-2">
              {tr("Turn off")}
            </Button>
            <button type="button" onClick={renew} disabled={busy} className="text-sm text-muted hover:text-ink underline cursor-pointer ml-auto">
              {tr("Make a new link")}
            </button>
          </>
        ) : (
          <Button onClick={() => save(true)} disabled={busy} className="!py-2 flex items-center gap-1.5">
            <Link2 size={14} /> {tr("Turn on the link")}
          </Button>
        )}
      </div>
      {(job.joined_by_link ?? 0) > 0 && (
        <p className="text-xs text-muted">{job.joined_by_link === 1 ? tr("1 person joined through the link.") : tr("{{n}} people joined through the link.", { n: job.joined_by_link })}</p>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
    </div>
  );
}

function JobForm({ initial, onSave, onCancel, locked }: { initial?: Job; onSave: (j: JobInput) => Promise<void>; onCancel: () => void; locked?: boolean }) {
  const adm = useAdmissions();
  const [f, setF] = useState<JobInput>({
    title: initial?.title ?? "",
    department: initial?.department ?? "",
    location: initial?.location ?? "",
    description: initial?.description ?? "",
    testKind: initial?.test_kind ?? "placement",
    minCefr: initial?.min_cefr ?? null,
    inviteValidDays: initial?.invite_valid_days ?? 7,
    showResultToCandidate: initial?.show_result_to_candidate ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm w-full text-ink focus:border-navy focus:outline-none disabled:opacity-60";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...f, department: f.department || null, location: f.location || null, description: f.description || null });
    } catch {
      setError(tr("Could not save the job opening."));
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <label className="flex flex-col gap-1 text-sm text-ink">
        {adm ? tr("Course and intake, e.g. MSc Data Science, September 2027") : tr("Job title")}
        <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={input} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Department")}
          <input value={f.department ?? ""} onChange={(e) => setF({ ...f, department: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Location")}
          <input value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Test")}
          <select value={f.testKind} disabled={locked} onChange={(e) => setF({ ...f, testKind: e.target.value as TestKind })} className={input}>
            {TEST_KINDS.map((k) => (
              <option key={k} value={k}>
                {TEST_KIND_LABEL[k]()}
              </option>
            ))}
          </select>
          {locked && <span className="text-xs text-muted">{tr("The test can't change after people were invited.")}</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Minimum level")}
          <select value={f.minCefr ?? ""} onChange={(e) => setF({ ...f, minCefr: (e.target.value || null) as Cefr | null })} className={input}>
            <option value="">{tr("None")}</option>
            {CEFR.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Invitation link valid for (days)")}
          <input type="number" min={1} max={60} value={f.inviteValidDays} onChange={(e) => setF({ ...f, inviteValidDays: Math.max(1, Math.min(60, Number(e.target.value) || 7)) })} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        {tr("Description (shown to candidates)")}
        <textarea value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} rows={3} className={input} />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={f.showResultToCandidate} onChange={(e) => setF({ ...f, showResultToCandidate: e.target.checked })} className="h-4 w-4 accent-navy" />
        {tr("Show candidates their level when they finish")}
      </label>
      {f.showResultToCandidate && <p className="text-xs text-muted -mt-1 ml-6">{tr("A test of all four skills also gives the candidate a certificate.")}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Button onClick={save} disabled={busy || f.title.trim().length < 2}>
          {busy ? tr("Saving...") : tr("Save")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {tr("Cancel")}
        </Button>
      </div>
    </div>
  );
}

type CandidateFilter = "all" | "to_decide" | "shortlisted" | "hired" | "rejected" | "pending";

function JobDetail({ jobId, credits, onClose, onChanged }: { jobId: string; credits: number; onClose: () => void; onChanged: () => void }) {
  const adm = useAdmissions();
  const [data, setData] = useState<{ job: Job; candidates: CandidateRow[] } | null>(null);
  const [tab, setTab] = useState("candidates");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [sort, setSort] = useState<"level" | "recent">("level");
  const [report, setReport] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoadError(null);
    getJob(jobId)
      .then(setData)
      .catch(() => setLoadError(tr("Something went wrong")));
  }, [jobId]);
  useEffect(load, [load]);
  if (!data) return <ModalPlaceholder title={loadError ? tr("Something went wrong") : tr("Loading…")} icon={Briefcase} error={loadError} onClose={onClose} onRetry={load} />;
  const { job, candidates } = data;
  const rank = (c: CandidateRow) => (c.result?.cefrLevel ? CEFR.indexOf(c.result.cefrLevel) * 1000 : 0) + (c.result?.overallPercent ?? -1);
  const shown = candidates
    .filter((c) =>
      filter === "all"
        ? true
        : filter === "to_decide"
          ? c.status === "completed" && !c.decision
          : filter === "pending"
            ? ["invited", "started", "expired"].includes(c.status)
            : !!c.decision && DECISION_GROUP[c.decision] === filter,
    )
    .sort((a, b) => (sort === "level" ? rank(b) - rank(a) : new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime()));
  const changed = () => {
    load();
    onChanged();
  };
  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setFlash({ ok: true, text: done });
    } catch {
      setFlash({ ok: false, text: tr("That didn't work. Try again.") });
    }
    changed();
  }
  return (
    <DetailModal
      title={job.title}
      subtitle={[job.department, job.location, TEST_KIND_LABEL[job.test_kind]()].filter(Boolean).join(" · ")}
      icon={Briefcase}
      onClose={onClose}
      badges={<Badge tone={job.status === "open" ? "good" : "neutral"}>{job.status === "open" ? tr("Open") : tr("Closed")}</Badge>}
      actions={
        <>
          <a href={jobExportUrl(job.id)} className="text-sm font-semibold underline flex items-center gap-1">
            <Download size={14} /> {tr("Export CSV")}
          </a>
          <Button
            variant="secondary"
            onClick={() =>
              (job.status === "closed" || window.confirm(tr("Close this job opening? Candidates can't be invited until you reopen it."))) &&
              act(() => updateJob(job.id, { status: job.status === "open" ? "closed" : "open" }), job.status === "open" ? tr("Job opening closed.") : tr("Job opening reopened."))
            }
          >
            {job.status === "open" ? tr("Close job") : tr("Reopen job")}
          </Button>
        </>
      }
      stats={[
        { label: tr("Invited"), value: job.invited },
        { label: tr("Completed"), value: job.completed },
        { label: adm ? tr("Waitlisted") : tr("Shortlisted"), value: job.shortlisted },
        { label: adm ? tr("Admitted") : tr("Hired"), value: job.hired },
      ]}
      tabs={[
        { key: "candidates", label: adm ? tr("Applicants") : tr("Candidates"), count: candidates.length },
        { key: "invite", label: tr("Invite") },
        { key: "details", label: tr("Details") },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {flash && (
        <div className={`text-sm rounded-input px-3.5 py-2.5 border mb-4 flex items-center justify-between gap-3 ${flash.ok ? "text-success bg-success/10 border-success/25" : "text-error bg-error/10 border-error/25"}`}>
          <span>{flash.text}</span>
          <button onClick={() => setFlash(null)} title={tr("Dismiss")} className="cursor-pointer opacity-70 hover:opacity-100">
            <XCircle size={15} />
          </button>
        </div>
      )}
      {tab === "candidates" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <FilterPills
              value={filter}
              onChange={setFilter}
              options={[
                ["all", tr("All")],
                ["to_decide", tr("To decide")],
                ["shortlisted", adm ? tr("Waitlisted") : tr("Shortlisted")],
                ["hired", adm ? tr("Admitted") : tr("Hired")],
                ["rejected", adm ? tr("Declined") : tr("Rejected")],
                ["pending", tr("Not finished")],
              ]}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as "level" | "recent")} className="rounded-input border border-rule bg-surface px-2 py-1.5 text-sm">
              <option value="level">{tr("Best result first")}</option>
              <option value="recent">{tr("Most recent first")}</option>
            </select>
          </div>
          {shown.length === 0 ? (
            <EmptyNote>{candidates.length ? tr("No candidates match this filter.") : tr("Nobody invited yet. Use the Invite tab.")}</EmptyNote>
          ) : (
            <div className="bg-surface border border-rule rounded-card shadow-sm divide-y divide-rule overflow-hidden">
              {shown.map((c) => (
                <div key={c.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-paper-warm/50 transition-colors">
                  <button onClick={() => setReport(c.id)} className="min-w-0 flex-1 text-left cursor-pointer flex items-center gap-3">
                    <span className="h-9 w-9 rounded-full bg-navy/10 text-navy-deep flex items-center justify-center text-xs font-bold shrink-0">{initialsOf(c)}</span>
                    <span className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{personName(c)}</p>
                    <p className="text-xs text-muted truncate">
                      {c.email} · {c.completed_at ? tr("finished {{d}}", { d: dateTime(c.completed_at) }) : c.source === "public_link" ? tr("joined through the link {{d}}", { d: dateTime(c.invited_at) }) : tr("invited {{d}}", { d: dateTime(c.invited_at) })}
                      {c.test_code ? ` · ${c.test_code}` : ""}
                    </p>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <ResultBadge result={c.result} min={job.min_cefr} />
                    {adm && c.status === "completed" && (
                      <StatusPill tone={c.confirmed_level ? "success" : "warning"}>
                        {c.confirmed_level ? tr("Confirmed {{level}}", { level: c.confirmed_level }) : tr("To review")}
                      </StatusPill>
                    )}
                    <StatusPill tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status]()}</StatusPill>
                    {c.integrity_status && c.status === "completed" && <StatusPill tone={INTEGRITY_TONE[c.integrity_status]}>{INTEGRITY_TEXT[c.integrity_status]()}</StatusPill>}
                    {c.decision && <StatusPill tone={DECISION_TONE[c.decision]}>{DECISION_TEXT[c.decision]()}</StatusPill>}
                    {c.status !== "completed" && (
                      <>
                        <button title={tr("Send the link again")} onClick={() => act(() => resendInvite(c.id), tr("A new link was emailed."))} className="h-8 w-8 rounded-input border border-rule flex items-center justify-center text-muted hover:text-ink cursor-pointer">
                          <RotateCw size={14} />
                        </button>
                        <button title={tr("Cancel the invitation")} onClick={() => act(() => cancelInvite(c.id), tr("Invitation cancelled."))} className="h-8 w-8 rounded-input border border-rule flex items-center justify-center text-muted hover:text-error cursor-pointer">
                          <XCircle size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === "invite" && <InvitePanel job={job} credits={credits} onInvited={changed} />}
      {tab === "details" && (
        <JobForm
          initial={job}
          locked={job.invited > 0}
          onCancel={() => setTab("candidates")}
          onSave={async (j) => {
            await updateJob(job.id, job.invited > 0 ? { ...j, testKind: undefined } : j);
            setTab("candidates");
            setFlash({ ok: true, text: tr("Job opening saved.") });
            changed();
          }}
        />
      )}
      {report && <CandidateReport id={report} onClose={() => setReport(null)} onChanged={changed} />}
    </DetailModal>
  );
}

function TeamPanel({ canManage }: { canManage: boolean }) {
  const { user } = useAuth();
  const adm = useAdmissions();
  const [rows, setRows] = useState<Recruiter[] | null>(null);
  const [f, setF] = useState({ email: "", firstName: "", lastName: "" });
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    getRecruiters()
      .then((r) => setRows(r.recruiters))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  async function add() {
    try {
      await addRecruiter(f);
      setNote({ ok: true, text: tr("{{email}} was invited as a recruiter.", { email: f.email }) });
      setF({ email: "", firstName: "", lastName: "" });
      load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof ApiError && err.message === "email_already_registered" ? tr("That email already has a Spica account.") : tr("Could not add the recruiter.") });
    }
  }
  const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  return (
    <div className="flex flex-col gap-4">
      {!canManage && <p className="text-xs text-muted">{tr("Only your Org Admin can add or remove recruiters.")}</p>}
      {canManage && (
        <Panel title={tr("Add a recruiter")}>
          <p className="text-sm text-muted">{tr("Recruiters see job openings, candidates and their integrity reviews. They don't see your employees.")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={tr("Email")} className={`${input} sm:col-span-2`} />
            <input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder={tr("First name")} className={input} />
            <input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder={tr("Last name")} className={input} />
          </div>
          {note && <p className={`text-sm ${note.ok ? "text-success" : "text-error"}`}>{note.text}</p>}
          <div>
            <Button onClick={add} disabled={!f.email || !f.firstName || !f.lastName}>
              <UserPlus size={15} className="inline mr-1.5" />
              {tr("Invite recruiter")}
            </Button>
          </div>
        </Panel>
      )}
      {rows === null ? (
        <div className="h-16 rounded-card bg-paper-warm border border-rule animate-pulse" aria-busy="true" />
      ) : rows.length === 0 ? (
        <EmptyNote>{tr("No recruiters yet.")}</EmptyNote>
      ) : (
        <Panel title={`${adm ? tr("Admissions team") : tr("Recruiters")} (${rows.length})`}>
        <div className="divide-y divide-rule -my-1">
          {rows.map((r) => (
            <div key={r.id} className="py-3 flex items-center gap-3">
              <span className="h-10 w-10 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">{initialsOf(r)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">
                  {personName(r)}
                  {user?.email && r.email.toLowerCase() === user.email.toLowerCase() && (
                    <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-pill bg-navy/10 text-navy-deep">{tr("You")}</span>
                  )}
                </p>
                <p className="text-xs text-muted truncate">
                  {r.email} · {r.last_login_at ? tr("last signed in {{d}}", { d: dateTime(r.last_login_at) }) : tr("hasn't signed in yet")} · {tr("{{n}} invited", { n: r.invited })}
                </p>
              </div>
              {canManage && (
                <button
                  title={tr("Remove")}
                  onClick={() => window.confirm(tr("Remove {{name}} as a recruiter?", { name: personName(r) })) && removeRecruiter(r.id).then(load)}
                  className="h-8 w-8 rounded-input border border-rule flex items-center justify-center text-muted hover:text-error cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        </Panel>
      )}
    </div>
  );
}

const REASON_TEXT: Record<CreditEvent["reason"], () => string> = {
  grant: () => tr("Added by Edstellar"),
  purchase: () => tr("Purchased"),
  invite: () => tr("Invitation"),
  refund: () => tr("Refund"),
  adjustment: () => tr("Adjustment"),
};

function CreditsPanel({ overview }: { overview: RecruitmentOverview }) {
  const [data, setData] = useState<{ balance: number; used: number; events: CreditEvent[] } | null>(null);
  const [qty, setQty] = useState(50);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    getCredits()
      .then(setData)
      .catch(() => setLoadFailed(true));
  }, []);
  async function request() {
    setBusy(true);
    const r = await requestCredits(qty, note.trim() || undefined).catch(() => null);
    setBusy(false);
    setMsg(
      r
        ? { ok: true, text: tr("Request sent to your Edstellar contact: {{n}} credits at {{p}} each.", { n: qty, p: money(r.unitPriceCents) }) }
        : { ok: false, text: tr("Could not send the request.") },
    );
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <Panel title={tr("Get more credits")}>
        <p className="text-sm text-muted">
          {tr("One credit costs {{p}}. A test takes 1 to 4 credits: Placement 1, Speaking & Listening and Writing 2, 4 Skills Essentials 3, Professional English 4. Credits don't expire.", { p: money(overview.unitPriceCents) })}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            {tr("Credits")}
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-28 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note (PO number, timing)")} className="flex-1 min-w-40 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
          <Button onClick={request} disabled={busy}>
            <Mail size={15} className="inline mr-1.5" />
            {tr("Request")}
          </Button>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </Panel>
      <Panel title={tr("History")}>
        {!data ? (
          loadFailed ? <EmptyNote>{tr("Something went wrong")}</EmptyNote> : <div className="h-24 rounded-input bg-paper-warm animate-pulse" aria-busy="true" />
        ) : data.events.length === 0 ? (
          <EmptyNote>{tr("No credits added yet.")}</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-rule max-h-[36rem] overflow-y-auto -mx-1 px-1">
            {data.events.map((e, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-ink">{REASON_TEXT[e.reason]()}</span>
                  {e.note && <span className="text-xs text-muted"> · {trServer(e.note)}</span>}
                  <span className="block text-xs text-muted">{dateTime(e.created_at)}</span>
                </span>
                <span className={`font-mono text-sm font-semibold px-2 py-0.5 rounded-pill ${e.delta > 0 ? "text-success bg-success/10" : "text-error bg-error/10"}`}>
                  {e.delta > 0 ? "+" : ""}
                  {e.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data && <p className="text-xs text-muted">{tr("{{n}} invitations sent in total.", { n: data.used })}</p>}
      </Panel>
    </div>
  );
}

function SettingsPanel({ overview, onSaved }: { overview: RecruitmentOverview; onSaved: () => void }) {
  const [days, setDays] = useState(overview.retentionDays);
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Panel title={tr("Candidate data")}>
        <p className="text-sm text-muted">{tr("Candidates' details, recordings and ID images are erased this many days after your decision (or after the test, if no decision was recorded). Results stay as anonymous numbers.")}</p>
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            {tr("Days")}
            <input type="number" min={30} max={1095} value={days} onChange={(e) => setDays(Number(e.target.value) || 30)} className="w-28 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
          </label>
          <Button
            onClick={() =>
              saveRecruitmentSettings(Math.max(30, Math.min(1095, days)))
                .then(() => {
                  setMsg(tr("Saved."));
                  onSaved();
                })
                .catch(() => setMsg(tr("Could not save.")))
            }
          >
            {tr("Save")}
          </Button>
        </div>
        {msg && <p className="text-sm text-success">{msg}</p>}
      </Panel>
      <Panel title={tr("Proctoring for candidates")}>
        <p className="text-sm text-muted">{tr("Candidates have their own proctoring settings, separate from your employees'. They start strict: ID check, camera, recording and voice checks.")}</p>
        <div>
          <Button variant="secondary" onClick={() => navigate(`${ROUTES.ORG_ADMIN_INTEGRITY}?tab=settings`)}>
            <ShieldAlert size={15} className="inline mr-1.5" />
            {tr("Open proctoring settings")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

type Tab = "jobs" | "team" | "credits" | "settings";

// Job openings, candidates and credits, for Org Admins and recruiters.
export function RecruitmentConsole() {
  const { user } = useAuth();
  const adm = useAdmissions();
  const isOrgAdmin = user?.role === "org_admin";
  const [overview, setOverview] = useState<RecruitmentOverview | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<Tab>(initialTab === "credits" || initialTab === "team" || initialTab === "settings" ? initialTab : "jobs");
  const [jobFilter, setJobFilter] = useState<"open" | "closed">("open");
  const [creating, setCreating] = useState(false);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getRecruitmentOverview()
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError && err.message === "product_not_enabled" ? tr("Recruitment isn't part of your organization's plan. Ask your Edstellar contact to add it.") : tr("Could not load recruitment.")));
    getJobs()
      .then((r) => setJobs(r.jobs))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="flex flex-col gap-5 w-full">
        <PageHeader title={adm ? tr("Admissions") : tr("Recruitment")} subtitle={tr("Assess candidates' English before you hire.")} />
        <div className="flex items-center justify-between gap-3 bg-paper-warm border border-rule rounded-card px-4 py-3 text-sm text-muted">
          <span>{error}</span>
          <button onClick={load} className="font-semibold text-navy-deep underline cursor-pointer shrink-0">
            {tr("Try again")}
          </button>
        </div>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="flex flex-col gap-5 w-full" aria-busy="true">
        <PageHeader title={adm ? tr("Admissions") : tr("Recruitment")} subtitle={tr("Assess candidates' English before you hire.")} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[88px] rounded-card bg-paper-warm border border-rule animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-card bg-paper-warm border border-rule animate-pulse" />
          ))}
        </div>
        <p className="sr-only">{tr("Loading…")}</p>
      </div>
    );
  }
  const tabs: [Tab, string][] = [
    ["jobs", adm ? tr("Intakes") : tr("Job openings")],
    ["team", adm ? tr("Admissions team") : tr("Recruiters")],
    ["credits", tr("Credits")],
  ];
  if (isOrgAdmin) tabs.push(["settings", tr("Settings")]);
  const visibleJobs = (jobs ?? []).filter((j) => j.status === jobFilter);

  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader
        title={adm ? tr("Admissions") : tr("Recruitment")}
        subtitle={
          adm
            ? tr("Invite applicants to a proctored English admission test, review each result and decide.")
            : tr("Invite candidates to a proctored English test and compare their results before you hire.")
        }
        actions={
          <Button
            disabled={creating && tab === "jobs"}
            onClick={() => {
              setTab("jobs");
              setCreating(true);
            }}
          >
            <Plus size={15} className="inline mr-1.5" />
            {adm ? tr("New intake") : tr("New job opening")}
          </Button>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={tr("Credits left")} value={overview.credits} sub={overview.credits <= 5 ? tr("Running low") : undefined} icon={Coins} index={0} />
        <StatCard label={adm ? tr("Waiting for applicants") : tr("Waiting for candidates")} value={overview.counts.open} icon={Mail} index={1} />
        <StatCard label={tr("Results to decide")} value={overview.counts.to_decide} icon={Users} index={2} />
        <StatCard label={adm ? tr("Admitted") : tr("Hired")} value={overview.counts.hired} icon={UserCheck} index={3} />
      </div>
      <div className="flex items-center gap-1 border-b border-rule overflow-x-auto">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors cursor-pointer ${
              tab === key ? "border-navy text-navy-deep" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <div className="flex flex-col gap-4">
          {creating && (
            <Panel title={adm ? tr("New intake") : tr("New job opening")}>
              <JobForm
                onCancel={() => setCreating(false)}
                onSave={async (j) => {
                  const r = await createJob(j);
                  setCreating(false);
                  load();
                  setOpenJob(r.id);
                }}
              />
            </Panel>
          )}
          <div className="self-start max-w-full">
            <FilterPills
              value={jobFilter}
              onChange={setJobFilter}
              options={[
                ["open", tr("Open"), (jobs ?? []).filter((j) => j.status === "open").length],
                ["closed", tr("Closed"), (jobs ?? []).filter((j) => j.status === "closed").length],
              ]}
            />
          </div>
          {jobs === null ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-40 rounded-card bg-paper-warm border border-rule animate-pulse" />
              ))}
            </div>
          ) : visibleJobs.length === 0 ? (
            <EmptyNote>
              {adm
                ? jobFilter === "open"
                  ? tr("No open intakes. Create one to start inviting applicants.")
                  : tr("No closed intakes.")
                : jobFilter === "open"
                  ? tr("No open job openings. Create one to start inviting candidates.")
                  : tr("No closed job openings.")}
            </EmptyNote>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleJobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setOpenJob(j.id)}
                  className="group text-left bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 hover:shadow-md hover:border-navy/40 hover:-translate-y-0.5 transition-all cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <span className="h-10 w-10 rounded-xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
                      <Briefcase size={18} strokeWidth={1.8} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-display font-bold text-ink truncate">{j.title}</p>
                      <p className="text-xs text-muted truncate">{[j.department, j.location].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    {TEST_KIND_LABEL[j.test_kind]()}
                    {j.min_cefr ? ` · ${tr("minimum {{l}}", { l: j.min_cefr })}` : ""}
                  </p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      [j.invited, tr("Invited")],
                      [j.completed, tr("Done")],
                      [j.shortlisted, adm ? tr("Waitlisted") : tr("Shortlist")],
                      [j.hired, adm ? tr("Admitted") : tr("Hired")],
                    ].map(([n, l]) => (
                      <div key={String(l)} className="bg-paper-warm rounded-input py-2">
                        <p className="font-display font-bold text-lg leading-tight text-ink">{n}</p>
                        <p className="text-[10px] text-muted truncate px-1">{l}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-rule text-xs text-muted">
                    <span className="truncate">{tr("Created {{date}}", { date: shortDate(j.created_at) })}</span>
                    <span className="flex items-center gap-0.5 font-semibold text-navy-deep shrink-0">
                      {tr("Open")} <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
          {overview.recent.length > 0 && (
            <Panel title={tr("Recently finished")}>
              <ul className="divide-y divide-rule -my-1">
                {overview.recent.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setReport(r.id)} className="w-full py-3 flex items-center justify-between gap-3 text-left cursor-pointer group">
                      <span className="h-9 w-9 rounded-full bg-navy/10 text-navy-deep flex items-center justify-center text-xs font-bold shrink-0">{initialsOf(r)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink truncate group-hover:underline">{personName(r)}</span>
                        <span className="block text-xs text-muted truncate">
                          {r.job_title} · {dateTime(r.completed_at)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <ResultBadge result={r.result} />
                        {r.decision ? <StatusPill tone={DECISION_TONE[r.decision]}>{DECISION_TEXT[r.decision]()}</StatusPill> : <StatusPill tone="warning">{tr("To decide")}</StatusPill>}
                        <ChevronRight size={15} className="text-muted hidden sm:block" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
      {tab === "team" && <TeamPanel canManage={isOrgAdmin} />}
      {tab === "credits" && <CreditsPanel overview={overview} />}
      {tab === "settings" && isOrgAdmin && <SettingsPanel overview={overview} onSaved={load} />}

      {openJob && <JobDetail jobId={openJob} credits={overview.credits} onClose={() => setOpenJob(null)} onChanged={load} />}
      {report && <CandidateReport id={report} onClose={() => setReport(null)} onChanged={load} />}
    </div>
  );
}
