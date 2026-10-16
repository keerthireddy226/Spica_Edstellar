import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Target, Users, CalendarDays, X, CheckCircle2, AlertTriangle, Clock, Download } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { formatShortDate } from "@/api/licenses";
import { getCatalogue, type CatalogueTestType } from "@/api/practiceTests";
import {
  createProgram,
  getBatches,
  getOrgSettings,
  getProgramDetail,
  listPrograms,
  updateProgram,
  type OrgBatch,
  type ProgramDomain,
  type ProgramMember,
  type ProgramSummary,
  type ProgramAlert,
  type ProgramViewer,
  getMemberReport,
  programExportPath,
} from "@/api/orgAdmin";
import { downloadCsv } from "@/api/analytics";
import { FeedbackReportView } from "@/components/report/FeedbackReportView";
import type { Program } from "@/api/practiceTests";
import { testTypeName } from "@/lib/testTypes";
import { tr } from "@/i18n/tr";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILLS = ["listening", "speaking", "reading", "writing"] as const;

const DOMAIN_LABEL: Record<ProgramDomain, () => string> = {
  general: () => tr("General"),
  banking: () => tr("Banking"),
  bpo: () => tr("BPO and customer support"),
  it: () => tr("IT"),
  insurance: () => tr("Insurance"),
  healthcare: () => tr("Healthcare"),
};

const STATUS_LABEL: Record<Program["status"], () => string> = {
  active: () => tr("Active"),
  completed: () => tr("Completed"),
  archived: () => tr("Archived"),
};

const ERROR_TEXT: Record<string, () => string> = {
  batch_has_program: () => tr("This batch already has an active program."),
  batch_not_active: () => tr("This batch has ended. Choose an active batch."),
  test_type_not_enabled: () => tr("This test isn't turned on for your organization. Turn it on in Settings."),
  unknown_test_type: () => tr("This test isn't available yet."),
  bad_dates: () => tr("The target date must be after the start date."),
};

function errorText(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
  return (code && ERROR_TEXT[code]?.()) || tr("Something went wrong. Try again.");
}

const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-muted";

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} aria-label={tr("Close")} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function CreateProgramModal({
  batches,
  testTypes,
  onClose,
  onCreated,
}: {
  batches: OrgBatch[];
  testTypes: CatalogueTestType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [testTypeId, setTestTypeId] = useState(testTypes[0]?.id ?? "");
  const [domain, setDomain] = useState<ProgramDomain>("general");
  const [targetLevel, setTargetLevel] = useState("B2");
  const [skillTargets, setSkillTargets] = useState<Record<string, string>>({});
  const [startsOn, setStartsOn] = useState(today());
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testType = testTypes.find((x) => x.id === testTypeId);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const targetSkills = Object.fromEntries(Object.entries(skillTargets).filter(([s, v]) => v && testType?.skills.includes(s as (typeof SKILLS)[number])));
      await createProgram({ name: name.trim(), batchId, testTypeId, domain, targetLevel, targetSkills, startsOn, targetDate });
      onCreated();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const ready = name.trim() && batchId && testTypeId && targetDate && targetDate > startsOn;
  return (
    <ModalShell title={tr("New program")} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label={tr("Name")} wide>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Support team to B2")} className={inputClass} maxLength={120} />
        </Field>
        <Field label={tr("Batch")} hint={tr("Everyone in the batch follows the program, including people who join later.")}>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {tr("Learners: {{count}}", { count: b.learnerCount })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Test")}>
          <select value={testTypeId} onChange={(e) => setTestTypeId(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {testTypes.map((x) => (
              <option key={x.id} value={x.id}>
                {testTypeName(x, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Target level")}>
          <select value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Field")} hint={tr("Questions about this field come with a later update; for now every program uses general questions.")}>
          <select value={domain} onChange={(e) => setDomain(e.target.value as ProgramDomain)} className={`${inputClass} cursor-pointer`}>
            {(Object.keys(DOMAIN_LABEL) as ProgramDomain[]).map((d) => (
              <option key={d} value={d}>
                {DOMAIN_LABEL[d]()}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Starts on")}>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={inputClass} />
        </Field>
        <Field label={tr("Target date")} hint={tr("The final mock exam is planned 3 days before it.")}>
          <input type="date" value={targetDate} min={startsOn} onChange={(e) => setTargetDate(e.target.value)} className={inputClass} />
        </Field>
        {testType && testType.skills.length > 1 && (
          <Field label={tr("Skill targets (optional)")} hint={tr("A different level for a skill, e.g. speaking B2 when the overall target is B1.")} wide>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {testType.skills.map((s) => (
                <label key={s} className="flex flex-col gap-1 text-xs text-muted">
                  {t(`skills.${s}`)}
                  <select
                    value={skillTargets[s] ?? ""}
                    onChange={(e) => setSkillTargets((p) => ({ ...p, [s]: e.target.value }))}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">{tr("Same as overall")}</option>
                    {LEVELS.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
      <p className="text-sm text-muted mt-5">
        {tr("Spica plans each member's practice tests and mock exams from their latest level and the time left, within your plan's monthly limits. Plans update after every mock exam.")}
      </p>
      {error && <p className="text-sm text-error mt-3">{error}</p>}
      <div className="flex justify-end gap-3 mt-5">
        <Button variant="secondary" onClick={onClose}>
          {tr("Cancel")}
        </Button>
        <Button onClick={submit} disabled={!ready || busy}>
          {busy ? tr("Creating…") : tr("Create program")}
        </Button>
      </div>
    </ModalShell>
  );
}

const STATUS: Record<ProgramMember["status"], { label: () => string; cls: string }> = {
  at_target: { label: () => tr("At target"), cls: "bg-success/15 text-success" },
  on_track: { label: () => tr("On track"), cls: "bg-navy/10 text-navy-deep" },
  at_risk: { label: () => tr("At risk"), cls: "bg-error/15 text-error" },
  too_early: { label: () => tr("Too early to tell"), cls: "bg-paper-warm text-muted" },
};

const ALERT_LABEL: Record<ProgramAlert["kind"], () => string> = {
  at_risk: () => tr("At risk"),
  inactive: () => tr("Inactive for 14 days"),
  missed_mock: () => tr("Missed a mock exam"),
};

// A member's finished test report, as the learner sees it, with the test's integrity status.
function MemberReportModal({ programId, sessionId, viewer, onClose }: { programId: string; sessionId: string; viewer: ProgramViewer; onClose: () => void }) {
  const [integrity, setIntegrity] = useState<{ status: string | null; risk: string | null } | null>(null);
  return (
    <ModalShell title={tr("Mock exam report")} onClose={onClose}>
      {integrity?.status && (
        <p className="text-sm text-muted mb-3">
          {tr("Test integrity: {{status}}", { status: integrity.status })}
          {integrity.risk ? ` · ${tr("risk {{risk}}", { risk: integrity.risk })}` : ""}
        </p>
      )}
      <FeedbackReportView
        load={() =>
          getMemberReport(programId, sessionId, viewer).then((r) => {
            setIntegrity(r.integrity ?? null);
            return r;
          })
        }
      />
    </ModalShell>
  );
}

function MemberRowView({ m, p, onOpenReport }: { m: ProgramMember; p: Program; onOpenReport: (sessionId: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const st = STATUS[m.status];
  return (
    <>
      <tr className="border-b border-rule/60 cursor-pointer hover:bg-paper-warm/60" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3">
          <div className="text-ink font-medium">{m.name}</div>
          <div className="text-xs text-muted">{m.email}</div>
        </td>
        <td className="py-2 pr-3">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill ${st.cls}`} title={m.statusReason}>
            {st.label()}
          </span>
        </td>
        <td className="py-2 pr-3 font-mono">
          {m.latestLevel ?? "—"}
          {m.levelSource === "placement" && <span className="text-[10px] text-muted font-sans ml-1">{tr("placement")}</span>}
        </td>
        <td className="py-2 pr-3 text-xs font-mono">{m.mocks.length ? m.mocks.map((x) => x.cefrLevel ?? "?").join(" → ") : "—"}</td>
        <td className="py-2 pr-3 text-xs">{m.projected ?? "—"}</td>
        <td className={`py-2 pr-3 ${m.missed ? "text-error font-semibold" : ""}`}>
          {m.done} / {m.missed}
        </td>
        <td className={`py-2 text-xs ${m.inactiveDays !== null && m.inactiveDays >= 14 ? "text-error" : "text-muted"}`}>
          {m.lastActivity ? formatShortDate(m.lastActivity) : tr("Never")}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-rule/60 bg-paper-warm/40">
          <td colSpan={7} className="px-3 py-3">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap gap-2">
                {(["listening", "speaking", "reading", "writing"] as const)
                  .filter((s) => m.skillLevels?.[s])
                  .map((s) => (
                    <span key={s} className="bg-surface rounded-input px-2.5 py-1 text-xs">
                      {t(`skills.${s}`)} <b>{m.skillLevels[s]}</b>
                      {p.targetSkills[s] ? <span className="text-muted"> / {p.targetSkills[s]}</span> : null}
                    </span>
                  ))}
              </div>
              <p className="text-xs text-muted">{m.statusReason}</p>
              {m.next && (
                <p className="text-xs text-muted">
                  {tr("Next:")} {m.next.kind === "mock" ? tr("Mock exam") : tr("Practice test")} · {formatShortDate(m.next.dueOn)}
                </p>
              )}
              {m.mocks.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {[...m.mocks].reverse().map((x) => (
                    <li key={x.sessionId} className="flex items-center gap-3 text-xs">
                      <span className="w-24">{formatShortDate(x.date)}</span>
                      <span className="font-mono w-10">{x.cefrLevel ?? "—"}</span>
                      <span className="w-12">{x.percent !== null ? `${x.percent}%` : ""}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenReport(x.sessionId);
                        }}
                        className="font-semibold text-navy-deep hover:underline cursor-pointer"
                      >
                        {tr("Open the report")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">{tr("No mock exams yet.")}</p>
              )}
              {m.integrity?.status && (
                <p className="text-xs text-muted">
                  {tr("Latest mock's integrity: {{status}}", { status: m.integrity.status })}
                  {m.integrity.risk ? ` (${m.integrity.risk})` : ""}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ProgramDetailModal({
  id,
  testTypes,
  viewer,
  onClose,
  onChanged,
}: {
  id: string;
  testTypes: CatalogueTestType[];
  viewer: ProgramViewer;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ program: Program; members: ProgramMember[]; alerts: ProgramAlert[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ProgramMember["status"]>("all");
  const canEdit = viewer === "org-admin";

  function load() {
    getProgramDetail(id, viewer)
      .then((d) => {
        setData(d);
        setTargetDate(d.program.targetDate);
        setTargetLevel(d.program.targetLevel);
      })
      .catch(() => setError(tr("Could not load the program.")));
  }
  useEffect(load, [id]);

  async function save(change: Parameters<typeof updateProgram>[1]) {
    setBusy(true);
    setError(null);
    try {
      await updateProgram(id, change);
      load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const p = data?.program;
  const tt = testTypes.find((x) => x.id === p?.testTypeId);
  const counts = (s: ProgramMember["status"]) => data?.members.filter((m) => m.status === s).length ?? 0;
  const shown = (data?.members ?? []).filter((m) => filter === "all" || m.status === filter);
  return (
    <ModalShell title={p?.name ?? tr("Program")} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-muted">{error ?? tr("Loading…")}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted flex-1">
              {tt ? testTypeName(tt, t) : p!.testTypeId} · {tr("Target {{level}}", { level: p!.targetLevel })} · {formatShortDate(p!.startsOn)} – {formatShortDate(p!.targetDate)} ·{" "}
              {STATUS_LABEL[p!.status]()}
            </p>
            <Button
              variant="secondary"
              onClick={() => downloadCsv(programExportPath(id, viewer), "program.csv").catch(() => setError(tr("Export failed.")))}
              className="flex items-center gap-2 !px-3 !py-1.5 text-sm"
            >
              <Download size={14} /> {tr("Export CSV")}
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["at_risk", "on_track", "at_target", "too_early"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter((f) => (f === s ? "all" : s))}
                className={`rounded-input px-3 py-2 text-left cursor-pointer border ${filter === s ? "border-navy" : "border-transparent"} ${STATUS[s].cls}`}
              >
                <div className="text-xl font-display font-bold">{counts(s)}</div>
                <div className="text-xs">{STATUS[s].label()}</div>
              </button>
            ))}
          </div>

          {canEdit && p!.status === "active" && (
            <div className="flex flex-wrap items-end gap-3 bg-paper-warm rounded-input p-4">
              <Field label={tr("Target level")}>
                <select value={targetLevel} onChange={(e) => setTargetLevel(e.target.value)} className={`${inputClass} cursor-pointer`}>
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label={tr("Target date")}>
                <input type="date" value={targetDate} min={p!.startsOn} onChange={(e) => setTargetDate(e.target.value)} className={inputClass} />
              </Field>
              <Button
                variant="secondary"
                disabled={busy || (targetDate === p!.targetDate && targetLevel === p!.targetLevel)}
                onClick={() => save({ targetDate, targetLevel })}
              >
                {tr("Save and replan")}
              </Button>
              <span className="flex-1" />
              <Button variant="secondary" disabled={busy} onClick={() => save({ status: "completed" })}>
                {tr("Mark completed")}
              </Button>
            </div>
          )}
          {canEdit && p!.status !== "archived" && p!.status !== "active" && (
            <div className="flex gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => save({ status: "active" })}>
                {tr("Reopen")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => save({ status: "archived" }).then(onClose)}>
                {tr("Archive")}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-error">{error}</p>}

          {data.alerts.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Alerts in the last 30 days")}</span>
              <ul className="text-sm flex flex-col gap-0.5">
                {data.alerts.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-xs text-muted w-20 shrink-0">{formatShortDate(a.createdAt)}</span>
                    <span className="text-ink">
                      {a.name}: {ALERT_LABEL[a.kind]()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-rule">
                  <th className="py-2 pr-3 font-semibold">{tr("Learner")}</th>
                  <th className="py-2 pr-3 font-semibold">{tr("Status")}</th>
                  <th className="py-2 pr-3 font-semibold">{tr("Latest level")}</th>
                  <th className="py-2 pr-3 font-semibold">{tr("Mocks")}</th>
                  <th className="py-2 pr-3 font-semibold">{tr("Projected")}</th>
                  <th className="py-2 pr-3 font-semibold">{tr("Done / missed")}</th>
                  <th className="py-2 font-semibold">{tr("Last activity")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <MemberRowView key={m.userId} m={m} p={p!} onOpenReport={setReport} />
                ))}
              </tbody>
            </table>
            {data.members.length === 0 && <p className="text-sm text-muted py-4">{tr("This batch has no learners yet.")}</p>}
          </div>
          <p className="text-xs text-muted">
            {tr("Projected: the level the trend across a learner's mock exams reaches by the target date (from 2 mocks). Latest level comes from the latest mock, or the placement test before the first.")}
          </p>
        </div>
      )}
      {report && <MemberReportModal programId={id} sessionId={report} viewer={viewer} onClose={() => setReport(null)} />}
    </ModalShell>
  );
}

// Org Admins manage programs; a batch's Managers see them read only.
export function OrgAdminPrograms({ viewer = "org-admin" }: { viewer?: ProgramViewer }) {
  const { t } = useTranslation();
  const [programs, setPrograms] = useState<ProgramSummary[] | null>(null);
  const [batches, setBatches] = useState<OrgBatch[]>([]);
  const [testTypes, setTestTypes] = useState<CatalogueTestType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  function load() {
    listPrograms(viewer)
      .then((r) => setPrograms(r.programs))
      .catch(() => setError(tr("Could not load programs.")));
  }
  useEffect(() => {
    load();
    if (viewer === "org-admin") {
      getBatches()
        .then((r) => setBatches(r.batches))
        .catch(() => {});
    }
    // Live tests the organization has turned on.
    Promise.all([getCatalogue(), viewer === "org-admin" ? getOrgSettings().catch(() => null) : Promise.resolve(null)])
      .then(([c, settings]) => {
        const allowed = settings?.allowedTestProducts ?? null;
        setTestTypes(c.families.flatMap((f) => f.testTypes).filter((x) => x.status === "live" && (!allowed || allowed.includes(x.id))));
      })
      .catch(() => {});
  }, []);

  const busyBatches = new Set((programs ?? []).filter((p) => p.status === "active").map((p) => p.batchId));
  const freeBatches = batches.filter((b) => b.status === "active" && !busyBatches.has(b.id));

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Programs")}</h1>
          <p className="text-sm text-muted mt-1">
            {tr("Set an exam goal for a batch. Spica plans each member's practice tests and mock exams to reach it.")}
          </p>
        </div>
        {viewer === "org-admin" && (
          <Button onClick={() => setCreating(true)} disabled={freeBatches.length === 0 || testTypes.length === 0} className="flex items-center gap-2">
            <Plus size={16} /> {tr("New program")}
          </Button>
        )}
      </div>
      {programs && freeBatches.length === 0 && batches.length > 0 && (
        <p className="text-xs text-muted -mt-2">{tr("Every active batch already has a program.")}</p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}

      {programs === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : programs.length === 0 ? (
        <div className="bg-surface border border-rule rounded-card p-8 text-center flex flex-col items-center gap-2">
          <Target size={28} className="text-navy-deep" />
          <p className="font-semibold text-ink">{tr("No programs yet")}</p>
          <p className="text-sm text-muted max-w-md">
            {tr("A program sets a target level and date for a batch, for example LanguageCert 4 Skills B2 by 15 December.")}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {programs.map((p) => {
            const tt = testTypes.find((x) => x.id === p.testTypeId);
            return (
              <button
                key={p.id}
                onClick={() => setViewing(p.id)}
                className="text-left bg-surface border border-rule rounded-card p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display font-bold text-base text-ink">{p.name}</span>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill shrink-0 ${
                      p.status === "active" ? "bg-success/15 text-success" : "bg-paper-warm text-muted"
                    }`}
                  >
                    {STATUS_LABEL[p.status]()}
                  </span>
                </div>
                <span className="text-sm text-muted">
                  {tt ? testTypeName(tt, t) : p.testTypeId} · {tr("Target {{level}}", { level: p.targetLevel })}
                  {Object.entries(p.targetSkills).map(([s, l]) => ` · ${t(`skills.${s}`)} ${l}`)}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <Users size={13} /> {p.batchName} · {tr("Learners: {{count}}", { count: p.members })}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays size={13} /> {tr("By {{date}}", { date: formatShortDate(p.targetDate) })}
                  </span>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle2 size={13} /> {tr("{{n}} done", { n: p.items.done })}
                  </span>
                  <span className={`flex items-center gap-1 ${p.items.missed ? "text-error" : "text-muted"}`}>
                    <AlertTriangle size={13} /> {tr("{{n}} missed", { n: p.items.missed })}
                  </span>
                  <span className="flex items-center gap-1 text-muted">
                    <Clock size={13} /> {tr("{{n}} planned", { n: p.items.due })}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {creating && (
        <CreateProgramModal
          batches={freeBatches}
          testTypes={testTypes}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {viewing && <ProgramDetailModal id={viewing} testTypes={testTypes} viewer={viewer} onClose={() => setViewing(null)} onChanged={load} />}
    </div>
  );
}
