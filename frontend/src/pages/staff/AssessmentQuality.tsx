import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import {
  decideAppeal,
  claimAppeal,
  getFeedbackSummary,
  type AppealOutcome,
  type FeedbackSummary,
  getAppeals,
  getFairness,
  getPoolReport,
  getQualitySettings,
  getTechnical,
  saveQualitySettings,
  type Appeal,
  type FairnessStudy,
  type PoolReport,
  type QualitySettings,
  type TechnicalReport,
} from "@/api/quality";
import { tr } from "@/i18n/tr";
import { useAuth } from "@/hooks/useAuth";
import { bankLabel } from "@/lib/questionBank";
import { EmptyNote, FilterPills, Notice, PageHeader, Panel as KitPanel, Tabs } from "@/components/staff/StaffKit";

// Assessment quality (Spica staff): appeals, pass marks and other settings,
// the question pool, the speaking fairness study and the technical report.

type Tab = "appeals" | "feedback" | "settings" | "pool" | "fairness" | "technical";
const TESTS = [
  ["fourSkills", "English 4 Skills Essentials"],
  ["speakingListening", "English Speaking & Listening"],
  ["writing", "English Writing"],
  ["professional", "Professional English"],
  ["placement", "English Placement"],
] as const;

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const input = "rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";
const td = "px-3 py-2 border-t border-rule";

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <KitPanel title={title} note={note} className="break-inside-avoid">
      {children}
    </KitPanel>
  );
}

const LOAD_FAILED = () => tr("Could not load this. Try again.");
function Loading() {
  return <div className="h-40 rounded-card bg-surface border border-rule animate-pulse" aria-busy="true" />;
}
function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice tone="error">
      {LOAD_FAILED()}{" "}
      <button onClick={onRetry} className="font-semibold underline cursor-pointer">
        {tr("Try again")}
      </button>
    </Notice>
  );
}

function Appeals() {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [rows, setRows] = useState<Appeal[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setFailed(false);
    getAppeals(status)
      .then((r) => setRows(r.appeals))
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  const { user } = useAuth();
  async function take(a: Appeal) {
    setBusy(a.id);
    setError(null);
    try {
      await claimAppeal(a.id, user?.role === "super_admin" && !!a.assignedTo && a.assignedTo !== user.id);
      load();
    } catch {
      setError(tr("Someone else has already taken this review."));
    } finally {
      setBusy(null);
    }
  }
  async function decide(a: Appeal, outcome: AppealOutcome) {
    const note = (notes[a.id] ?? "").trim();
    if (!note) return;
    setBusy(a.id);
    setError(null);
    try {
      await decideAppeal(a.id, outcome, note);
      load();
    } catch {
      setError(tr("Could not save the decision. Try again."));
    } finally {
      setBusy(null);
    }
  }
  const LABEL: Record<Appeal["status"], string> = { open: tr("Open"), upheld: tr("Result stands"), changed: tr("Re-marked"), new_attempt: tr("Free retake"), noted: tr("Concern noted") };
  const TEST: Record<string, string> = { practice: tr("Practice test"), mock: tr("Mock test"), placement: tr("Placement test"), certified: tr("Final assessment"), sample: tr("Sample test") };
  return (
    <Panel
      title={tr("Score reviews")}
      note={tr("One shared queue for every Edstellar reviewer. Take a request so nobody else reviews it, check the answers, recordings and proctoring record, then decide. Requests waiting more than 2 days (or 5 once taken) are sent to the Super Admin.")}
    >
      <FilterPills
        value={status}
        onChange={setStatus}
        options={[
          ["open", tr("Open")],
          ["all", tr("All")],
        ]}
      />
      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      {failed ? (
        <Failed onRetry={load} />
      ) : rows === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : rows.length === 0 ? (
        <EmptyNote>{status === "open" ? tr("No open requests. New ones appear here when someone asks for a review of a score.") : tr("No requests.")}</EmptyNote>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <div key={a.id} className="border border-rule rounded-xl p-4 flex flex-col gap-2 bg-paper/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">
                  {a.learner} <span className="text-xs text-muted font-normal">{[a.email, a.org].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-pill border border-rule text-muted">
                    {TEST[a.testKind] ?? a.testKind} · {a.kind === "review" ? tr("Score review") : tr("Concern")}
                  </span>
                  {a.escalated && a.status === "open" && <span className="text-xs font-semibold px-2 py-0.5 rounded-pill border border-error/50 text-error">{tr("Waiting too long")}</span>}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-pill border border-current text-navy-deep">{LABEL[a.status]}</span>
                </span>
              </div>
              {a.status === "open" && (
                <p className="text-xs text-muted">
                  {a.assignedTo ? tr("Taken by {{name}}", { name: a.assignedTo === user?.id ? tr("you") : (a.reviewer ?? tr("a reviewer")) }) : tr("Not taken yet")}
                </p>
              )}
              <p className="text-sm text-muted">
                {[a.testName, a.testCode, tr("taken {{date}}", { date: day(a.completedAt) }), a.spicaScore != null ? tr("Spica score {{n}}", { n: a.spicaScore }) : null, a.level, a.integrity ? tr("proctoring: {{s}}", { s: a.integrity }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-sm text-ink bg-paper-warm rounded-lg px-3 py-2">{a.reason}</p>
              {a.status === "open" && a.assignedTo !== user?.id ? (
                <div>
                  <Button variant="secondary" disabled={busy === a.id || (!!a.assignedTo && user?.role !== "super_admin")} onClick={() => take(a)} className="!py-1.5 !text-sm">
                    {a.assignedTo ? tr("Take over this review") : tr("Take this review")}
                  </Button>
                </div>
              ) : a.status === "open" ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    placeholder={tr("Your decision, as the learner will read it")}
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                    className={input}
                  />
                  <div className="flex flex-wrap gap-2">
                    {a.kind === "concern" && (
                      <Button variant="secondary" disabled={!notes[a.id]?.trim() || busy === a.id} onClick={() => decide(a, "noted")} className="!py-1.5 !text-sm">
                        {tr("Concern noted")}
                      </Button>
                    )}
                    <Button variant="secondary" disabled={!notes[a.id]?.trim() || busy === a.id} onClick={() => decide(a, "upheld")} className="!py-1.5 !text-sm">
                      {tr("Result stands")}
                    </Button>
                    {a.testKind === "certified" && (
                      <>
                        <Button variant="secondary" disabled={!notes[a.id]?.trim() || busy === a.id} onClick={() => decide(a, "changed")} className="!py-1.5 !text-sm">
                          {tr("Re-marked: issue a new certificate")}
                        </Button>
                        <Button variant="secondary" disabled={!notes[a.id]?.trim() || busy === a.id} onClick={() => decide(a, "new_attempt")} className="!py-1.5 !text-sm">
                          {tr("Give a free retake")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                a.decisionNote && <p className="text-xs text-muted">{tr("Decision: {{note}}", { note: a.decisionNote })}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// What learners said after their tests: averages, the recommend score, what
// went wrong, and the comments worth reading.
function FeedbackTab() {
  const [days, setDays] = useState<"30" | "90" | "365">("30");
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    getFeedbackSummary(Number(days))
      .then(setData)
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  const ISSUE: Record<string, string> = { audio: tr("Audio"), camera_mic: tr("Camera or microphone"), slow: tr("Slow or freezing"), screen: tr("Screen sharing"), other: tr("Other") };
  const TEST: Record<string, string> = { practice: tr("Practice test"), mock: tr("Mock test"), placement: tr("Placement test"), certified: tr("Final assessment"), sample: tr("Sample test") };
  return (
    <Panel title={tr("Test feedback")} note={tr("The short form learners can fill in after every test. Recommend score: % who answered 9–10 minus % who answered 0–6.")}>
      <FilterPills
        value={days}
        onChange={setDays}
        options={[
          ["30", tr("30 days")],
          ["90", tr("90 days")],
          ["365", tr("1 year")],
        ]}
      />
      {failed ? (
        <Failed onRetry={load} />
      ) : data === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : data.answered === 0 ? (
        <EmptyNote>{tr("No feedback yet.")}</EmptyNote>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              [tr("Answers"), String(data.answered)],
              [tr("Average rating"), data.rating != null ? `${data.rating} / 5` : "—"],
              [tr("Recommend score"), data.nps != null ? String(data.nps) : "—"],
              [tr("Didn't run smoothly"), data.notSmoothPercent != null ? `${data.notSmoothPercent}%` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="border border-rule rounded-xl p-3">
                <p className="text-xs text-muted">{k}</p>
                <p className="font-display font-bold text-xl text-ink">{v}</p>
              </div>
            ))}
          </div>
          {data.issues.length > 0 && (
            <p className="text-sm text-ink">
              <b>{tr("What went wrong")}:</b> {data.issues.map((i) => `${ISSUE[i.issue] ?? i.issue} (${i.n})`).join(" · ")}
            </p>
          )}
          <p className="text-sm text-ink">
            <b>{tr("By test")}:</b> {data.byTest.map((b) => `${TEST[b.test] ?? b.test}: ${b.rating ?? "—"} / 5 (${b.answered})`).join(" · ")}
          </p>
          <div className="flex flex-col gap-2">
            {data.comments.map((c, i) => (
              <div key={i} className="border border-rule rounded-xl p-3 text-sm">
                <p className="text-xs text-muted">
                  {[c.learner, c.org, TEST[c.test] ?? c.test, c.test_code, day(c.created_at), c.rating ? `${c.rating}/5` : null, c.smooth === false ? tr("didn't run smoothly") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {c.issues?.length > 0 && <p className="text-xs text-error">{c.issues.map((x) => ISSUE[x] ?? x).join(", ")}</p>}
                {c.suggestion && <p className="text-ink mt-1">{c.suggestion}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function Settings() {
  const [s, setS] = useState<QualitySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setFailed(false);
    getQualitySettings()
      .then(setS)
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) return <Failed onRetry={load} />;
  if (!s) return <Loading />;
  const fields: [keyof QualitySettings, string, string][] = [
    ["levelPassOverall", tr("Level test pass mark, overall (%)"), tr("The share of questions right a level test needs overall.")],
    ["levelSkillMin", tr("Level test minimum per skill (%)"), tr("Each skill needs at least this share right.")],
    ["levelRetakeDays", tr("Days before a new level test"), tr("After a level test that wasn't passed, at the same level.")],
    ["exposureCap", tr("Real tests per question"), tr("A question used in this many real tests is kept out of new ones while others are available.")],
    ["appealDays", tr("Days to appeal"), tr("How long after a real test a learner can appeal its result.")],
  ];
  return (
    <Panel title={tr("Pass marks and settings")} note={tr("Changes apply to tests started from now on.")}>
      <div className="grid sm:grid-cols-2 gap-3">
        {fields.map(([k, label, note]) => (
          <label key={k} className="flex flex-col gap-1 text-sm text-ink">
            {label}
            <input
              type="number"
              min={0}
              value={s[k]}
              onChange={(e) => {
                setSaved(false);
                setS({ ...s, [k]: Number(e.target.value) });
              }}
              className={`${input} w-32`}
            />
            <span className="text-xs text-muted">{note}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              setS(await saveQualitySettings(s));
              setSaved(true);
            } catch {
              setError(tr("Could not save. Check the numbers and try again."));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? tr("Saving…") : tr("Save")}
        </Button>
        {saved && <span className="text-sm text-success">{tr("Saved.")}</span>}
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </Panel>
  );
}

function Pool() {
  const [p, setP] = useState<PoolReport | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    getPoolReport()
      .then(setP)
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) return <Failed onRetry={load} />;
  if (!p) return <Loading />;
  return (
    <>
      <Panel title={tr("Tests: questions per part")} note={tr("Approved questions, those cleared for mock and real tests, and how often real tests used them (limit {{n}}).", { n: p.exposureCap })}>
        <div className="overflow-x-auto border border-rule rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-paper-warm/60">
                {[tr("Test"), tr("Bank"), tr("Part"), tr("Approved"), tr("For mock and real tests"), tr("At the limit"), tr("Average use"), tr("Most used")].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.tests.map((r) => (
                <tr key={`${r.test}-${r.bank}-${r.part}`}>
                  <td className={td}>{TESTS.find(([id]) => id === r.test)?.[1] ?? r.test}</td>
                  <td className={`${td} whitespace-nowrap`}>{bankLabel(r.bank)}</td>
                  <td className={td}>{r.part}</td>
                  <td className={`${td} tabular-nums`}>{r.approved}</td>
                  <td className={`${td} tabular-nums`}>{r.forMocks}</td>
                  <td className={`${td} tabular-nums ${r.overCap ? "text-error font-semibold" : ""}`}>{r.overCap}</td>
                  <td className={`${td} tabular-nums`}>{r.meanExposure}</td>
                  <td className={`${td} tabular-nums`}>{r.maxExposure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title={tr("Level tests: questions per level")} note={tr("Each level test takes a set number of each question type; \"Fresh tests left\" is how many more level tests the unused questions cover.")}>
        <div className="overflow-x-auto border border-rule rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-paper-warm/60">
                {[tr("Question type"), tr("Level"), tr("Approved"), tr("At the limit"), tr("Per test"), tr("Fresh tests left")].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.levelTests.map((r) => (
                <tr key={`${r.type}-${r.level}`}>
                  <td className={td}>{r.type}</td>
                  <td className={td}>{r.level}</td>
                  <td className={`${td} tabular-nums`}>{r.approved}</td>
                  <td className={`${td} tabular-nums`}>{r.overCap}</td>
                  <td className={`${td} tabular-nums`}>{r.perTest}</td>
                  <td className={`${td} tabular-nums ${r.testsLeft !== null && r.testsLeft < 5 ? "text-error font-semibold" : ""}`}>{r.testsLeft ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Fairness() {
  const [days, setDays] = useState(180);
  const [f, setF] = useState<FairnessStudy | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setF(null);
    setFailed(false);
    getFairness(days)
      .then(setF)
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [days]);
  return (
    <Panel
      title={tr("Speaking fairness study")}
      note={tr("Spoken answers' scores by the speaker's first language (or country when not given). A group with at least {{n}} people whose average differs from everyone's by {{g}} points or more is flagged for a closer look: it may mean the scoring favours some accents.", { n: f?.minLearners ?? 20, g: f?.gap ?? 8 })}
    >
      <label className="flex items-center gap-2 text-sm text-ink">
        {tr("Period")}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={input}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {tr("Last {{n}} days", { n: d })}
            </option>
          ))}
        </select>
      </label>
      {failed ? (
        <Failed onRetry={load} />
      ) : !f ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : (
        <>
          <p className="text-sm text-ink">{tr("{{n}} spoken answers, average score {{m}}.", { n: f.answers, m: f.overall ?? "—" })}</p>
          <div className="overflow-x-auto border border-rule rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-paper-warm/60">
                  {[tr("Group"), tr("People"), tr("Answers"), tr("Average score"), tr("Difference"), tr("Clarity"), tr("Fluency"), ""].map((h, i) => (
                    <th key={i} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.groups.map((g) => (
                  <tr key={g.group}>
                    <td className={td}>{g.group}</td>
                    <td className={`${td} tabular-nums`}>{g.learners}</td>
                    <td className={`${td} tabular-nums`}>{g.answers}</td>
                    <td className={`${td} tabular-nums`}>{g.mean ?? "—"}</td>
                    <td className={`${td} tabular-nums ${g.flagged ? "text-error font-semibold" : ""}`}>{g.diff === null ? "—" : `${g.diff > 0 ? "+" : ""}${g.diff}`}</td>
                    <td className={`${td} tabular-nums`}>{g.clarity ?? "—"}</td>
                    <td className={`${td} tabular-nums`}>{g.fluency ?? "—"}</td>
                    <td className={td}>{g.flagged ? <span className="text-xs font-semibold text-error">{tr("Check")}</span> : g.tooFew ? <span className="text-xs text-muted">{tr("Too few people")}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function Technical() {
  const { t } = useTranslation();
  const [test, setTest] = useState<string>(TESTS[0][0]);
  const [r, setR] = useState<TechnicalReport | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setR(null);
    setFailed(false);
    getTechnical(test)
      .then(setR)
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [test]);
  const FLAG: Record<string, string> = { too_hard: tr("Too hard"), too_easy: tr("Too easy"), low_discrimination: tr("Doesn't separate strong from weak") };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <select value={test} onChange={(e) => setTest(e.target.value)} aria-label={tr("Test")} className={`${input} cursor-pointer`}>
          {TESTS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => window.print()} className="flex items-center gap-2 !py-2">
          <Printer size={15} /> {tr("Print / PDF")}
        </Button>
      </div>
      {failed ? (
        <Failed onRetry={load} />
      ) : !r ? (
        <Loading />
      ) : (
        <>
          <Panel title={tr("Technical report: {{test}}", { test: TESTS.find(([id]) => id === test)?.[1] ?? test })} note={tr("Generated {{date}} from finished mock tests and real tests.", { date: day(r.generatedAt) })}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                [tr("Mock tests"), r.sessions.mock],
                [tr("Real tests"), r.sessions.certified],
                [tr("Reliability (alpha)"), r.alpha ?? "—"],
                [tr("Questions flagged"), `${r.flaggedItems} / ${r.itemsAnalysed}`],
              ].map(([l, v]) => (
                <div key={String(l)} className="bg-paper-warm/60 border border-rule rounded-xl p-3">
                  <b className="block font-display text-xl text-ink tabular-nums">{v}</b>
                  <span className="text-xs text-muted">{l}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">
              {tr("Reliability is Cronbach's alpha over the four skill scores of {{n}} tests: 0.7 or more is acceptable, 0.8 or more good.", { n: r.alphaSessions })}
            </p>
          </Panel>
          <Panel title={tr("Skills")}>
            <div className="overflow-x-auto border border-rule rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-paper-warm/60">
                    {[tr("Skill"), tr("Tests"), tr("Average % right"), tr("Spread (SD)")].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(r.skills).map(([k, v]) => (
                    <tr key={k}>
                      <td className={td}>{t(`skills.${k}`)}</td>
                      <td className={`${td} tabular-nums`}>{v.n}</td>
                      <td className={`${td} tabular-nums`}>{v.mean ?? "—"}</td>
                      <td className={`${td} tabular-nums`}>{v.sd ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-4 text-sm text-ink">
              <span>
                <b>{tr("Levels reached")}:</b>{" "}
                {Object.entries(r.levels)
                  .sort()
                  .map(([l, n]) => `${l} ${n}`)
                  .join(" · ") || "—"}
              </span>
              <span>
                <b>{tr("Proctoring (real tests)")}:</b>{" "}
                {Object.entries(r.integrity)
                  .map(([l, n]) => `${l} ${n}`)
                  .join(" · ") || "—"}
              </span>
              <span>
                <b>{tr("Appeals")}:</b>{" "}
                {Object.entries(r.appeals)
                  .map(([l, n]) => `${l} ${n}`)
                  .join(" · ") || "—"}
              </span>
            </div>
          </Panel>
          <Panel
            title={tr("Questions")}
            note={tr("Questions with at least {{n}} answers: difficulty is the share answered right; discrimination is how well getting it right goes with a high overall score (below 0.1 is weak).", { n: r.minAnswers })}
          >
            {r.items.length === 0 ? (
              <p className="text-sm text-muted">{tr("Not enough answers yet.")}</p>
            ) : (
              <div className="overflow-x-auto border border-rule rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-paper-warm/60">
                      {[tr("Question type"), tr("Level"), tr("Answers"), tr("% right"), tr("Discrimination"), tr("Note")].map((h) => (
                        <th key={h} className={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.items.map((i) => (
                      <tr key={i.itemId}>
                        <td className={td}>{i.type}</td>
                        <td className={td}>{i.level ?? "—"}</td>
                        <td className={`${td} tabular-nums`}>{i.answers}</td>
                        <td className={`${td} tabular-nums`}>{i.difficulty ?? "—"}</td>
                        <td className={`${td} tabular-nums`}>{i.discrimination ?? "—"}</td>
                        <td className={`${td} ${i.flag ? "text-error font-semibold" : "text-muted"}`}>{i.flag ? FLAG[i.flag] : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

export function AssessmentQuality() {
  const [tab, setTab] = useState<Tab>("appeals");
  const TABS: [Tab, string][] = [
    ["appeals", tr("Score reviews")],
    ["feedback", tr("Test feedback")],
    ["settings", tr("Pass marks")],
    ["pool", tr("Question pool")],
    ["fairness", tr("Fairness study")],
    ["technical", tr("Technical report")],
  ];
  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="print:hidden">
        <PageHeader
          title={tr("Assessment quality")}
          subtitle={tr("Keeping real tests fair, secure and reliable: appeals, pass marks, question exposure, a fairness check on speaking scores, and the technical report.")}
        />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} options={TABS.map(([key, label]) => ({ key, label }))} className="print:hidden" />
      {tab === "appeals" && <Appeals />}
      {tab === "feedback" && <FeedbackTab />}
      {tab === "settings" && <Settings />}
      {tab === "pool" && <Pool />}
      {tab === "fairness" && <Fairness />}
      {tab === "technical" && <Technical />}
    </div>
  );
}
