import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import {
  decideAppeal,
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

// Assessment quality (Spica staff): appeals, pass marks and other settings,
// the question pool, the speaking fairness study and the technical report.

type Tab = "appeals" | "settings" | "pool" | "fairness" | "technical";
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
    <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3 break-inside-avoid">
      <div>
        <h2 className="font-display font-semibold text-lg text-ink">{title}</h2>
        {note && <p className="text-sm text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Appeals() {
  const [status, setStatus] = useState<"open" | "all">("open");
  const [rows, setRows] = useState<Appeal[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = () => getAppeals(status).then((r) => setRows(r.appeals));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  async function decide(a: Appeal, outcome: "upheld" | "changed" | "new_attempt") {
    const note = (notes[a.id] ?? "").trim();
    if (!note) return;
    await decideAppeal(a.id, outcome, note);
    load();
  }
  const LABEL: Record<Appeal["status"], string> = { open: tr("Open"), upheld: tr("Result stands"), changed: tr("Re-marked"), new_attempt: tr("Free retake") };
  return (
    <Panel title={tr("Appeals")} note={tr("A learner can appeal a real test's result once. Read the reason, check the answers and the proctoring record, then decide.")}>
      <div className="flex gap-2">
        {(["open", "all"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-pill text-sm font-semibold border cursor-pointer ${status === s ? "bg-navy text-white border-navy" : "border-rule text-ink"}`}>
            {s === "open" ? tr("Open") : tr("All")}
          </button>
        ))}
      </div>
      {rows === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{tr("No appeals.")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((a) => (
            <div key={a.id} className="border border-rule rounded-xl p-4 flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-ink">
                  {a.learner} <span className="text-xs text-muted font-normal">{[a.email, a.org].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-pill border border-current text-navy-deep">{LABEL[a.status]}</span>
              </div>
              <p className="text-sm text-muted">
                {[a.testName, a.testCode, tr("taken {{date}}", { date: day(a.completedAt) }), a.spicaScore != null ? tr("Spica score {{n}}", { n: a.spicaScore }) : null, a.level, a.integrity ? tr("proctoring: {{s}}", { s: a.integrity }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-sm text-ink bg-paper-warm rounded-lg px-3 py-2">{a.reason}</p>
              {a.status === "open" ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    placeholder={tr("Your decision, as the learner will read it")}
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                    className={input}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={!notes[a.id]?.trim()} onClick={() => decide(a, "upheld")} className="!py-1.5 !text-sm">
                      {tr("Result stands")}
                    </Button>
                    <Button variant="secondary" disabled={!notes[a.id]?.trim()} onClick={() => decide(a, "changed")} className="!py-1.5 !text-sm">
                      {tr("Re-marked: issue a new certificate")}
                    </Button>
                    <Button variant="secondary" disabled={!notes[a.id]?.trim()} onClick={() => decide(a, "new_attempt")} className="!py-1.5 !text-sm">
                      {tr("Give a free retake")}
                    </Button>
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

function Settings() {
  const [s, setS] = useState<QualitySettings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    getQualitySettings().then(setS);
  }, []);
  if (!s) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
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
            <input type="number" value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className={`${input} w-32`} />
            <span className="text-xs text-muted">{note}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={async () => {
            setS(await saveQualitySettings(s));
            setSaved(true);
          }}
        >
          {tr("Save")}
        </Button>
        {saved && <span className="text-sm text-success">{tr("Saved.")}</span>}
      </div>
    </Panel>
  );
}

function Pool() {
  const [p, setP] = useState<PoolReport | null>(null);
  useEffect(() => {
    getPoolReport().then(setP);
  }, []);
  if (!p) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  return (
    <>
      <Panel title={tr("Tests: questions per part")} note={tr("Approved questions, those cleared for mock and real tests, and how often real tests used them (limit {{n}}).", { n: p.exposureCap })}>
        <div className="overflow-x-auto border border-rule rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-paper-warm/60">
                {[tr("Test"), tr("Part"), tr("Approved"), tr("For mock and real tests"), tr("At the limit"), tr("Average use"), tr("Most used")].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.tests.map((r) => (
                <tr key={`${r.test}-${r.part}`}>
                  <td className={td}>{TESTS.find(([id]) => id === r.test)?.[1] ?? r.test}</td>
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
  useEffect(() => {
    setF(null);
    getFairness(days).then(setF);
  }, [days]);
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
      {!f ? (
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
  useEffect(() => {
    setR(null);
    getTechnical(test).then(setR);
  }, [test]);
  const FLAG: Record<string, string> = { too_hard: tr("Too hard"), too_easy: tr("Too easy"), low_discrimination: tr("Doesn't separate strong from weak") };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <select value={test} onChange={(e) => setTest(e.target.value)} className={input}>
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
      {!r ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
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
                <div key={String(l)} className="border border-rule rounded-xl p-3">
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
    ["appeals", tr("Appeals")],
    ["settings", tr("Pass marks")],
    ["pool", tr("Question pool")],
    ["fairness", tr("Fairness study")],
    ["technical", tr("Technical report")],
  ];
  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="print:hidden">
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Assessment quality")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Keeping real tests fair, secure and reliable: appeals, pass marks, question exposure, a fairness check on speaking scores, and the technical report.")}</p>
      </div>
      <div className="flex gap-1 border-b border-rule print:hidden flex-wrap">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 cursor-pointer ${tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "appeals" && <Appeals />}
      {tab === "settings" && <Settings />}
      {tab === "pool" && <Pool />}
      {tab === "fairness" && <Fairness />}
      {tab === "technical" && <Technical />}
    </div>
  );
}
