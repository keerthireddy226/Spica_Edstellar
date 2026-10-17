import { useEffect, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { PageHeader, Panel, FilterPills, StatusPill, EmptyNote } from "@/components/staff/StaffKit";
import {
  decideItem,
  getContentItem,
  getContentOverview,
  getGenerationJobs,
  getReviewQueue,
  recheckItem,
  startGeneration,
  type ContentItem,
  type ContentOverview,
  type GenerationJob,
  type QueueState,
} from "@/api/content";
import { tr } from "@/i18n/tr";
import { ChecksView, DOMAIN_LABEL, ItemView, LEVELS, aiErrorText } from "@/components/staff/contentShared";
import { BuilderPanel, LibraryPanel } from "@/pages/staff/AssessmentBuilder";

const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

function apiErrorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
}

// ---- Generate ----

function GeneratePanel({ overview, onStarted }: { overview: ContentOverview; onStarted: () => void }) {
  const [testTypeId, setTestTypeId] = useState(overview.testTypes[0]?.id ?? "");
  const tt = overview.testTypes.find((x) => x.id === testTypeId);
  const [itemTypeId, setItemTypeId] = useState(tt?.itemTypes[0] ?? "");
  const levels = LEVELS.filter((l) => !tt || (l >= tt.cefrMin && l <= tt.cefrMax));
  const [level, setLevel] = useState("B1");
  const [domain, setDomain] = useState("general");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (tt && !tt.itemTypes.includes(itemTypeId)) setItemTypeId(tt.itemTypes[0]);
    if (tt && !levels.includes(level)) setLevel(levels[levels.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testTypeId]);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      await startGeneration({ testTypeId, itemTypeId, level, domain, count });
      setMessage(tr("Started. Questions appear below as they're written and checked."));
      onStarted();
    } catch (err) {
      setMessage(apiErrorCode(err) === "level_out_of_range" ? tr("This level isn't part of this test.") : tr("Could not start. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={tr("Write new questions with AI")}>
      <p className="text-xs text-muted">
        {tr("Pick the test, the question type, the level and how many. Questions that pass the automatic checks go into the bank for practice; mock exams use them after you approve them in Review. Only LanguageCert-style types can be written so far.")}
        {!overview.ttsEnabled && ` ${tr("Text-to-speech isn't set up, so listening questions get recordings later.")}`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("Test")}
          <select value={testTypeId} onChange={(e) => setTestTypeId(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {(["LanguageCert", "Versant"] as const).map((fam) => {
              const list = overview.testTypes.filter((t) => familyOf(t.id) === fam);
              return list.length ? (
                <optgroup key={fam} label={fam}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {fam} · {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("Question type")}
          <select value={itemTypeId} onChange={(e) => setItemTypeId(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {(tt?.itemTypes ?? []).map((x) => (
              <option key={x} value={x}>
                {overview.itemTypeNames[x] ?? x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("Level")}
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {levels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("Field")}
          <select value={domain} onChange={(e) => setDomain(e.target.value)} className={`${inputClass} cursor-pointer`}>
            {overview.domains.map((d) => (
              <option key={d} value={d}>
                {DOMAIN_LABEL[d]?.() ?? d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("How many")}
          <input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className={`${inputClass} w-20`} />
        </label>
        <Button onClick={start} disabled={busy || !itemTypeId} className="flex items-center gap-2">
          <Sparkles size={15} /> {tr("Write questions")}
        </Button>
      </div>
      {message && <p className="text-xs text-muted">{message}</p>}
    </Panel>
  );
}

// The exam family of a test type (LanguageCert test types start with "lc").
function familyOf(testTypeId: string): "LanguageCert" | "Versant" {
  return testTypeId.startsWith("lc") ? "LanguageCert" : "Versant";
}

function JobsPanel({ jobs, names, testTypes }: { jobs: GenerationJob[]; names: Record<string, string>; testTypes: ContentOverview["testTypes"] }) {
  if (jobs.length === 0) return null;
  return (
    <Panel title={tr("Recent AI requests")}>
      <ul className="flex flex-col divide-y divide-rule/60">
        {jobs.map((j) => (
          <li key={j.id} className="py-2 flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink">
                {tr("{{n}} × {{type}}, {{level}}", { n: j.requested, type: names[j.itemTypeId] ?? j.itemTypeId, level: j.level })}
                <span className="text-muted">
                  {" "}
                  · {testTypes.find((t) => t.id === j.testTypeId)?.name ?? j.testTypeId}
                  {j.domain !== "general" && ` · ${DOMAIN_LABEL[j.domain]?.() ?? j.domain}`}
                </span>
              </div>
              <div className="text-xs text-muted">
                {new Date(j.createdAt).toLocaleString()} · {j.createdBy ?? ""}
              </div>
              {j.status === "failed" && j.error && <div className="text-xs text-error">{aiErrorText(j.error)}</div>}
              {j.status === "done" && (
                <div className="text-xs text-muted">
                  {tr("{{p}} ready to use, {{r}} waiting for review", { p: j.passed, r: j.failed })}
                </div>
              )}
            </div>
            <StatusPill tone={j.status === "done" ? "success" : j.status === "failed" ? "error" : "navy"}>
              {j.status === "done" ? tr("Done") : j.status === "failed" ? tr("Failed") : j.status === "running" ? tr("Writing…") : tr("Queued")}
            </StatusPill>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---- Review ----

function ReviewDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const [item, setItem] = useState<ContentItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [contentJson, setContentJson] = useState("");
  const [keyJson, setKeyJson] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    getContentItem(id)
      .then((r) => {
        setItem(r.item);
        setContentJson(JSON.stringify(r.item.content, null, 2));
        setKeyJson(JSON.stringify(r.item.answerSet ?? {}, null, 2));
      })
      .catch(() => setError(tr("Could not load the question.")));
  }
  useEffect(() => {
    setEditing(false);
    setNote("");
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function decide(decision: "approve" | "approve_mock" | "remove_mock" | "reject") {
    setBusy(true);
    setError(null);
    try {
      let edits = {};
      if (editing) {
        try {
          edits = { content: JSON.parse(contentJson), answerSet: JSON.parse(keyJson) };
        } catch {
          setError(tr("The edited question isn't valid JSON."));
          setBusy(false);
          return;
        }
      }
      await decideItem(id, { decision, note: note.trim() || undefined, ...edits });
      onDone();
    } catch (err) {
      const problems = err instanceof ApiError ? (err.body as { problems?: string[] } | undefined)?.problems : undefined;
      setError(problems?.length ? problems.join("; ") : tr("Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    setError(null);
    try {
      await recheckItem(id);
      load();
    } catch {
      setError(tr("Checks could not run. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!item) return <p className="text-sm text-muted">{error ?? tr("Loading…")}</p>;
  const expl = item.explanation as { why?: string; evidence?: string; questions?: { why?: string; evidence?: string }[] } | null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>{item.level}</span>·<span>{item.topic}</span>·<span>{DOMAIN_LABEL[item.domain]?.() ?? item.domain}</span>
        {item.placedIn && <>· {tr("In set {{code}}", { code: item.placedIn })}</>}
        {item.mockApproved && <StatusPill tone="success">{tr("Approved for mocks")}</StatusPill>}
        {item.status === "approved" && !item.mockApproved && <StatusPill tone="navy">{tr("Practice only")}</StatusPill>}
        {item.status === "draft" && <StatusPill tone="warning">{tr("Not in use")}</StatusPill>}
      </div>
      {item.reviewReason && <p className="text-sm text-warning">{item.reviewReason}</p>}
      {editing ? (
        <div className="grid md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {tr("Question (JSON)")}
            <textarea value={contentJson} onChange={(e) => setContentJson(e.target.value)} rows={16} className={`${inputClass} font-mono text-xs`} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {tr("Answer key (JSON)")}
            <textarea value={keyJson} onChange={(e) => setKeyJson(e.target.value)} rows={6} className={`${inputClass} font-mono text-xs`} />
          </label>
        </div>
      ) : (
        <ItemView item={item} />
      )}
      {expl && (
        <div className="text-xs text-muted flex flex-col gap-1">
          <span className="uppercase tracking-wide">{tr("Explanation")}</span>
          {expl.why && <p className="text-ink">{expl.why}</p>}
          {expl.questions?.map((q, i) => (
            <p key={i} className="text-ink">
              {i + 1}. {q.why} {q.evidence && <span className="text-muted">“{q.evidence}”</span>}
            </p>
          ))}
          {expl.evidence && <p>“{expl.evidence}”</p>}
        </div>
      )}
      <div>
        <span className="text-[11px] uppercase tracking-wide text-muted">{tr("Automatic checks")}</span>
        <ChecksView checks={item.checks} />
      </div>
      {item.stats && item.stats.n > 0 && (
        <p className="text-xs text-muted">
          {tr("Answered {{n}} times, average score {{mean}}%, shown {{views}} times in mocks.", {
            n: item.stats.n,
            mean: Math.round((item.stats.mean ?? 0) * 100),
            views: item.stats.views,
          })}
        </p>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("Note for the record (optional)")} className={inputClass} maxLength={1000} />
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => decide("approve_mock")}>
          {tr("Approve for practice and mocks")}
        </Button>
        {!(item.status === "approved" && !editing) && (
          <Button variant="secondary" disabled={busy} onClick={() => decide("approve")}>
            {tr("Approve for practice")}
          </Button>
        )}
        {item.mockApproved && (
          <Button variant="secondary" disabled={busy} onClick={() => decide("remove_mock")}>
            {tr("Remove from mocks")}
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => decide("reject")}>
          {tr("Reject")}
        </Button>
        <span className="flex-1" />
        <Button variant="secondary" disabled={busy} onClick={() => setEditing((e) => !e)}>
          {editing ? tr("Cancel edits") : tr("Edit")}
        </Button>
        {item.pipeline === "gen-v1" && (
          <Button variant="secondary" disabled={busy || editing} onClick={recheck} className="flex items-center gap-1.5">
            <RefreshCw size={14} /> {tr("Run checks again")}
          </Button>
        )}
      </div>
    </div>
  );
}

function ReviewPanel({ overview, refresh }: { overview: ContentOverview; refresh: () => void }) {
  const [state, setState] = useState<QueueState>("needs_review");
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  function load() {
    getReviewQueue(state)
      .then((r) => {
        setItems(r.items);
        setSelected((s) => (s && r.items.some((i) => i.id === s) ? s : (r.items[0]?.id ?? null)));
      })
      .catch(() => setItems([]));
  }
  useEffect(load, [state]);

  return (
    <Panel title={tr("Review")}>
      <FilterPills<QueueState>
        value={state}
        onChange={setState}
        options={[
          ["needs_review", tr("Needs review"), overview.queue.needs_review],
          ["for_mock", tr("Waiting for mock approval"), overview.queue.for_mock],
          ["approved_before_review", tr("Approved before review")],
          ["rejected", tr("Rejected")],
        ]}
      />
      {items === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : items.length === 0 ? (
        <EmptyNote>{tr("Nothing here.")}</EmptyNote>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <ul className="flex flex-col gap-1 max-h-[70vh] overflow-y-auto">
            {items.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => setSelected(i.id)}
                  className={`w-full text-left rounded-input px-3 py-2 cursor-pointer ${selected === i.id ? "bg-navy/10" : "hover:bg-paper-warm"}`}
                >
                  <div className="text-sm text-ink">
                    {overview.itemTypeNames[i.itemTypeId] ?? i.itemTypeId} · {i.level}
                  </div>
                  <div className="text-xs text-muted truncate">{i.topic ?? ""}</div>
                  {i.reviewReason && <div className="text-xs text-warning truncate">{i.reviewReason}</div>}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0">
            {selected && (
              <ReviewDetail
                id={selected}
                onDone={() => {
                  load();
                  refresh();
                }}
              />
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

// Question bank: create tests, see every question, write new ones with AI and
// review them (ASSESSMENT_ENGINE.md sections 6 and 21).
type Tab = "create" | "library" | "generate" | "review";

const TAB_NOTE: Record<Tab, () => string> = {
  create: () => tr("Make a practice test or a mock exam for learners."),
  library: () => tr("Browse and search every question."),
  generate: () => tr("Ask the AI to write more questions."),
  review: () => tr("Check AI-written questions before learners get them."),
};

export function QuestionBank() {
  const [overview, setOverview] = useState<ContentOverview | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [tab, setTab] = useState<Tab>("create");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    getContentOverview()
      .then(setOverview)
      .catch((err) => setError(apiErrorCode(err) === "permission_required" ? tr("You need the Content review permission.") : tr("Could not load the question bank.")));
    getGenerationJobs()
      .then((r) => setJobs(r.jobs))
      .catch(() => {});
  }
  useEffect(refresh, []);
  // While a request runs, its counts update every few seconds.
  const running = jobs.some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [running]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader
        title={tr("Question bank")}
        subtitle={tr("Create tests and manage the questions in them.")}
      />
      <div className="flex flex-col gap-1.5">
        <FilterPills<Tab>
          value={tab}
          onChange={setTab}
          options={[
            ["create", tr("Create a test")],
            ["library", tr("All questions")],
            ["generate", tr("Write with AI")],
            ["review", tr("Review"), overview.queue.needs_review + overview.queue.for_mock],
          ]}
        />
        <p className="text-xs text-muted">{TAB_NOTE[tab]()}</p>
      </div>
      {tab === "generate" && (
        <>
          <GeneratePanel overview={overview} onStarted={refresh} />
          <JobsPanel jobs={jobs} names={overview.itemTypeNames} testTypes={overview.testTypes} />
        </>
      )}
      {tab === "review" && <ReviewPanel overview={overview} refresh={refresh} />}
      {tab === "library" && <LibraryPanel itemTypeNames={overview.itemTypeNames} />}
      {tab === "create" && <BuilderPanel />}
    </div>
  );
}
