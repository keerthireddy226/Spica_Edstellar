import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Briefcase, Coins, Download, Mail, Plus, Printer, RotateCw, Send, ShieldAlert, Trash2, UserCheck, UserPlus, Users, XCircle } from "lucide-react";
import { Badge, DetailModal } from "@/components/DetailModal";
import { Button } from "@/components/Button";
import { EmptyNote, FilterPills, PageHeader, Panel, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { shortDate } from "@/api/staff";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { ROUTES } from "@/constants/routes";
import { TEST_KIND_LABEL } from "@/components/recruitment/testKinds";
import {
  addRecruiter,
  cancelInvite,
  createJob,
  decideAssessment,
  getAssessment,
  getCredits,
  getJob,
  getJobs,
  getRecruiters,
  getRecruitmentOverview,
  inviteCandidates,
  jobExportUrl,
  removeRecruiter,
  requestCredits,
  resendInvite,
  saveRecruitmentSettings,
  updateJob,
  type AssessmentReport,
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
const DECISION_TEXT: Record<Decision, () => string> = { shortlisted: () => tr("Shortlisted"), rejected: () => tr("Rejected"), hired: () => tr("Hired") };
const DECISION_TONE = { shortlisted: "navy", rejected: "error", hired: "success" } as const;
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

// One candidate: result, integrity, decision.
export function CandidateReport({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [a, setA] = useState<AssessmentReport | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    getAssessment(id)
      .then((r) => {
        setA(r.assessment);
        setNote(r.assessment.decision_note ?? "");
      })
      .catch(() => {});
  }, [id]);
  useEffect(load, [load]);
  if (!a) return null;
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
      subtitle={[a.email, a.job_title].join(" · ")}
      icon={UserCheck}
      onClose={onClose}
      badges={
        <>
          <Badge tone={a.status === "completed" ? "good" : a.status === "expired" ? "warn" : "neutral"}>{STATUS_TEXT[a.status]()}</Badge>
          {a.decision && <Badge tone={a.decision === "rejected" ? "bad" : "good"}>{DECISION_TEXT[a.decision]()}</Badge>}
        </>
      }
      actions={
        a.status === "completed" ? (
          <Button variant="secondary" onClick={() => window.open(`/recruitment/report/${a.id}`, "_blank")}>
            <Printer size={15} className="inline mr-1.5" />
            {tr("Print or save as PDF")}
          </Button>
        ) : undefined
      }
      stats={[
        { label: tr("Level"), value: a.result?.cefrLevel ?? "—", hint: a.min_cefr ? tr("Minimum {{l}}", { l: a.min_cefr }) : undefined },
        { label: tr("Score"), value: a.result?.overallPercent !== undefined && a.result?.overallPercent !== null ? `${a.result.overallPercent}%` : "—" },
        { label: tr("Integrity"), value: a.integrity_status ? INTEGRITY_TEXT[a.integrity_status]() : "—", hint: a.risk_level ? tr("Risk {{s}}", { s: a.risk_score ?? 0 }) : undefined },
        { label: tr("Completed"), value: a.completed_at ? shortDate(a.completed_at) : "—" },
      ]}
    >
      <div className="flex flex-col gap-5">
        <Panel title={tr("Result")}>
          {a.result ? <ResultDetails result={a.result} /> : <EmptyNote>{tr("No result yet.")}</EmptyNote>}
          <p className="text-xs text-muted">
            {[TEST_KIND_LABEL[a.test_kind](), a.exam_name, a.test_code ? tr("Test ID {{c}}", { c: a.test_code }) : null].filter(Boolean).join(" · ")}
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
        {a.status === "completed" && (
          <Panel title={tr("Decision")}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={tr("Note for your team (optional)")}
              className="rounded-input border border-rule bg-surface px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => decide("shortlisted")} disabled={busy}>
                {tr("Shortlist")}
              </Button>
              <Button variant="secondary" onClick={() => decide("hired")} disabled={busy}>
                {tr("Mark as hired")}
              </Button>
              <Button variant="secondary" onClick={() => decide("rejected")} disabled={busy}>
                {tr("Reject")}
              </Button>
              {a.decision && (
                <button onClick={() => decide(null)} disabled={busy} className="text-sm text-muted underline cursor-pointer">
                  {tr("Clear decision")}
                </button>
              )}
            </div>
            {a.decided_at && (
              <p className="text-xs text-muted">{tr("Decided by {{who}} on {{date}}.", { who: a.decided_by_name || tr("a colleague"), date: shortDate(a.decided_at) })}</p>
            )}
          </Panel>
        )}
        <Panel title={tr("Timeline")}>
          <ul className="text-sm text-ink flex flex-col gap-1">
            <li>{tr("Invited on {{date}} by {{who}}", { date: shortDate(a.invited_at), who: a.invited_by_name || tr("a colleague") })}</li>
            {a.started_at && <li>{tr("Started on {{date}}", { date: shortDate(a.started_at) })}</li>}
            {a.completed_at && <li>{tr("Completed on {{date}}", { date: shortDate(a.completed_at) })}</li>}
            {!a.completed_at && <li className="text-muted">{tr("Link valid until {{date}}", { date: shortDate(a.expires_at) })}</li>}
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
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const people = useMemo(() => {
    const list = parsePeople(bulk);
    if (email.trim()) list.unshift({ email: email.trim(), firstName: first.trim() || undefined, lastName: last.trim() || undefined });
    return list;
  }, [bulk, email, first, last]);
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
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr("Email")} type="email" className="rounded-input border border-rule bg-surface px-3 py-2 text-sm sm:col-span-3" />
        <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder={tr("First name")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
        <input value={last} onChange={(e) => setLast(e.target.value)} placeholder={tr("Last name")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        {tr("Or paste many, one per line: email, first name, last name")}
        <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm font-mono" />
      </label>
      <p className="text-xs text-muted">
        {tr("{{n}} people ready. Each invitation uses one credit ({{c}} left). Unused invitations are refunded when they expire or are cancelled.", { n: people.length, c: credits })}
      </p>
      {note && <p className={`text-sm ${note.ok ? "text-success" : "text-error"}`}>{note.text}</p>}
      <div>
        <Button onClick={send} disabled={busy || people.length === 0}>
          <Send size={15} className="inline mr-1.5" />
          {busy ? tr("Sending...") : tr("Send invitations")}
        </Button>
      </div>
    </div>
  );
}

function JobForm({ initial, onSave, onCancel, locked }: { initial?: Job; onSave: (j: JobInput) => Promise<void>; onCancel: () => void; locked?: boolean }) {
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
  const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm w-full";
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
        {tr("Job title")}
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
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2">
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
  const [data, setData] = useState<{ job: Job; candidates: CandidateRow[] } | null>(null);
  const [tab, setTab] = useState("candidates");
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [sort, setSort] = useState<"level" | "recent">("level");
  const [report, setReport] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    getJob(jobId)
      .then(setData)
      .catch(() => {});
  }, [jobId]);
  useEffect(load, [load]);
  if (!data) return null;
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
            : c.decision === filter,
    )
    .sort((a, b) => (sort === "level" ? rank(b) - rank(a) : new Date(b.invited_at).getTime() - new Date(a.invited_at).getTime()));
  const changed = () => {
    load();
    onChanged();
  };
  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      setFlash(done);
    } catch {
      setFlash(tr("That didn't work. Try again."));
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
          <Button variant="secondary" onClick={() => act(() => updateJob(job.id, { status: job.status === "open" ? "closed" : "open" }), job.status === "open" ? tr("Job opening closed.") : tr("Job opening reopened."))}>
            {job.status === "open" ? tr("Close job") : tr("Reopen job")}
          </Button>
        </>
      }
      stats={[
        { label: tr("Invited"), value: job.invited },
        { label: tr("Completed"), value: job.completed },
        { label: tr("Shortlisted"), value: job.shortlisted },
        { label: tr("Hired"), value: job.hired },
      ]}
      tabs={[
        { key: "candidates", label: tr("Candidates"), count: candidates.length },
        { key: "invite", label: tr("Invite") },
        { key: "details", label: tr("Details") },
      ]}
      tab={tab}
      onTab={setTab}
    >
      {flash && <p className="text-sm text-success mb-3">{flash}</p>}
      {tab === "candidates" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <FilterPills
              value={filter}
              onChange={setFilter}
              options={[
                ["all", tr("All")],
                ["to_decide", tr("To decide")],
                ["shortlisted", tr("Shortlisted")],
                ["hired", tr("Hired")],
                ["rejected", tr("Rejected")],
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
            <div className="bg-surface border border-rule rounded-card divide-y divide-rule">
              {shown.map((c) => (
                <div key={c.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <button onClick={() => setReport(c.id)} className="min-w-0 flex-1 text-left cursor-pointer">
                    <p className="text-sm font-semibold text-ink truncate">{personName(c)}</p>
                    <p className="text-xs text-muted truncate">
                      {c.email} · {c.completed_at ? tr("finished {{d}}", { d: shortDate(c.completed_at) }) : tr("invited {{d}}", { d: shortDate(c.invited_at) })}
                      {c.test_code ? ` · ${c.test_code}` : ""}
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <ResultBadge result={c.result} min={job.min_cefr} />
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
            setFlash(tr("Job opening saved."));
            changed();
          }}
        />
      )}
      {report && <CandidateReport id={report} onClose={() => setReport(null)} onChanged={changed} />}
    </DetailModal>
  );
}

function TeamPanel({ canManage }: { canManage: boolean }) {
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
  const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm";
  return (
    <div className="flex flex-col gap-4">
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
      {rows === null ? null : rows.length === 0 ? (
        <EmptyNote>{tr("No recruiters yet.")}</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card divide-y divide-rule">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">{personName(r)}</p>
                <p className="text-xs text-muted truncate">
                  {r.email} · {r.last_login_at ? tr("last signed in {{d}}", { d: shortDate(r.last_login_at) }) : tr("hasn't signed in yet")} · {tr("{{n}} invited", { n: r.invited })}
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
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    getCredits()
      .then(setData)
      .catch(() => {});
  }, []);
  async function request() {
    const r = await requestCredits(qty, note.trim() || undefined).catch(() => null);
    setMsg(r ? tr("Request sent to your Edstellar contact: {{n}} credits at {{p}} each.", { n: qty, p: money(r.unitPriceCents) }) : tr("Could not send the request."));
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Panel title={tr("Get more credits")}>
        <p className="text-sm text-muted">
          {tr("One credit = one candidate assessment, currently {{p}}. Credits don't expire.", { p: money(overview.unitPriceCents) })}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            {tr("Credits")}
            <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-28 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note (PO number, timing)")} className="flex-1 min-w-40 rounded-input border border-rule bg-surface px-3 py-2 text-sm" />
          <Button onClick={request}>
            <Mail size={15} className="inline mr-1.5" />
            {tr("Request")}
          </Button>
        </div>
        {msg && <p className="text-sm text-success">{msg}</p>}
      </Panel>
      <Panel title={tr("History")}>
        {!data ? null : data.events.length === 0 ? (
          <EmptyNote>{tr("No credits added yet.")}</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {data.events.map((e, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-ink">{REASON_TEXT[e.reason]()}</span>
                  {e.note && <span className="text-xs text-muted"> · {trServer(e.note)}</span>}
                  <span className="block text-xs text-muted">{shortDate(e.created_at)}</span>
                </span>
                <span className={`font-mono text-sm ${e.delta > 0 ? "text-success" : "text-error"}`}>
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
        <PageHeader title={tr("Recruitment")} subtitle={tr("Assess candidates' English before you hire.")} />
        <EmptyNote>{error}</EmptyNote>
      </div>
    );
  }
  if (!overview) return null;
  const tabs: [Tab, string][] = [
    ["jobs", tr("Job openings")],
    ["team", tr("Recruiters")],
    ["credits", tr("Credits")],
  ];
  if (isOrgAdmin) tabs.push(["settings", tr("Settings")]);
  const visibleJobs = (jobs ?? []).filter((j) => j.status === jobFilter);

  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader
        title={tr("Recruitment")}
        subtitle={tr("Invite candidates to a proctored English test and compare their results before you hire.")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} className="inline mr-1.5" />
            {tr("New job opening")}
          </Button>
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={tr("Credits left")} value={overview.credits} sub={overview.credits <= 5 ? tr("Running low") : undefined} icon={Coins} index={0} />
        <StatCard label={tr("Waiting for candidates")} value={overview.counts.open} icon={Mail} index={1} />
        <StatCard label={tr("Results to decide")} value={overview.counts.to_decide} icon={Users} index={2} />
        <StatCard label={tr("Hired")} value={overview.counts.hired} icon={UserCheck} index={3} />
      </div>
      <FilterPills value={tab} onChange={setTab} options={tabs} />

      {tab === "jobs" && (
        <div className="flex flex-col gap-4">
          {creating && (
            <Panel title={tr("New job opening")}>
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
          <FilterPills
            value={jobFilter}
            onChange={setJobFilter}
            options={[
              ["open", tr("Open"), (jobs ?? []).filter((j) => j.status === "open").length],
              ["closed", tr("Closed"), (jobs ?? []).filter((j) => j.status === "closed").length],
            ]}
          />
          {jobs === null ? null : visibleJobs.length === 0 ? (
            <EmptyNote>{jobFilter === "open" ? tr("No open job openings. Create one to start inviting candidates.") : tr("No closed job openings.")}</EmptyNote>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleJobs.map((j) => (
                <button key={j.id} onClick={() => setOpenJob(j.id)} className="text-left bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-ink truncate">{j.title}</p>
                    {(j.department || j.location) && <p className="text-xs text-muted truncate">{[j.department, j.location].filter(Boolean).join(" · ")}</p>}
                  </div>
                  <p className="text-xs text-muted">
                    {TEST_KIND_LABEL[j.test_kind]()}
                    {j.min_cefr ? ` · ${tr("minimum {{l}}", { l: j.min_cefr })}` : ""}
                  </p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      [j.invited, tr("Invited")],
                      [j.completed, tr("Done")],
                      [j.shortlisted, tr("Shortlist")],
                      [j.hired, tr("Hired")],
                    ].map(([n, l]) => (
                      <div key={String(l)} className="bg-paper-warm rounded-input py-1.5">
                        <p className="font-display font-bold text-ink">{n}</p>
                        <p className="text-[10px] text-muted">{l}</p>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
          {overview.recent.length > 0 && (
            <Panel title={tr("Recently finished")}>
              <ul className="divide-y divide-rule">
                {overview.recent.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => setReport(r.id)} className="w-full py-2 flex items-center justify-between gap-3 text-left cursor-pointer">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink truncate">{personName(r)}</span>
                        <span className="block text-xs text-muted truncate">
                          {r.job_title} · {shortDate(r.completed_at)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <ResultBadge result={r.result} />
                        {r.decision && <StatusPill tone={DECISION_TONE[r.decision]}>{DECISION_TEXT[r.decision]()}</StatusPill>}
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
