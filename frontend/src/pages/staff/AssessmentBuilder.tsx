import { useEffect, useMemo, useRef, useState } from "react";
import { SHOW_AI_WRITTEN_TESTS } from "@/lib/focus";
import { Search, X, Plus, Trash2, Wand2, Sparkles, Save, Send, Archive, Pencil, CheckCircle2, Loader2, Rocket, AlertTriangle } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { Panel, StatusPill, EmptyNote } from "@/components/staff/StaffKit";
import {
  autofillForm,
  createBuiltForm,
  createTestOneClick,
  decideItem,
  formSeconds,
  getBuilderPlan,
  getBuilderTestTypes,
  getBuiltForm,
  getContentItem,
  getItemUsage,
  getLibrary,
  listForms,
  publishBuiltForm,
  retireBuiltForm,
  deleteBuiltForm,
  startGeneration,
  updateBuiltForm,
  type BuilderTestType,
  type BuildSummary,
  type BuiltForm,
  type ContentItem,
  type FormSeconds,
  type LibraryFilters,
  type LibraryItem,
  type LibrarySource,
  type PlanSection,
} from "@/api/content";
import { ChecksView, DOMAIN_LABEL, ItemView, LEVELS, aiErrorText } from "@/components/staff/contentShared";
import { tr } from "@/i18n/tr";

const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const DOMAINS = ["general", "banking", "bpo", "it", "insurance", "healthcare"];

const SOURCE_LABEL: Record<LibrarySource, () => string> = {
  module: () => tr("Practice Modules"),
  test_set: () => tr("Practice and mock sets"),
  placement: () => tr("Placement test"),
  ai: () => tr("AI-written, not in a set"),
  unplaced: () => tr("Other, not in a set"),
};
const SOURCES = Object.keys(SOURCE_LABEL) as LibrarySource[];
const FAMILY_LABEL: Record<string, string> = { versant: "Spica", languagecert: "LanguageCert" };
const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

const minutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;

function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
}

// Test types as <optgroup>s by exam family.
function TestTypeOptions({ testTypes }: { testTypes: BuilderTestType[] }) {
  const families = [...new Set(testTypes.map((t) => t.familyName))];
  return (
    <>
      {families.map((f) => (
        <optgroup key={f} label={f}>
          {testTypes
            .filter((t) => t.familyName === f)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {f} · {t.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

// One question's full view with where it's used.
function QuestionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [item, setItem] = useState<ContentItem | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getItemUsage>> | null>(null);
  useEffect(() => {
    setItem(null);
    getContentItem(id)
      .then((r) => setItem(r.item))
      .catch(() => {});
    getItemUsage(id)
      .then(setUsage)
      .catch(() => {});
  }, [id]);
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-surface w-full max-w-2xl h-full overflow-y-auto p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Question")}</h2>
          <button onClick={onClose} aria-label={tr("Close")} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        {!item ? (
          <p className="text-sm text-muted">{tr("Loading…")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              <span>{item.itemTypeId}</span>·<span>{item.level ?? "—"}</span>·<span>{item.topic}</span>·<span>{DOMAIN_LABEL[item.domain]?.() ?? item.domain}</span>
              {item.mockApproved && <StatusPill tone="success">{tr("Approved for mocks")}</StatusPill>}
              {item.status !== "approved" && <StatusPill tone="warning">{item.status}</StatusPill>}
            </div>
            <ItemView item={item} />
            {item.explanation && (item.explanation as { why?: string }).why && <p className="text-sm text-ink">{(item.explanation as { why?: string }).why}</p>}
            <div>
              <span className="text-[11px] uppercase tracking-wide text-muted">{tr("Automatic checks")}</span>
              <ChecksView checks={item.checks} />
            </div>
            {item.stats && item.stats.n > 0 && (
              <p className="text-xs text-muted">
                {tr("Answered {{n}} times, average score {{mean}}%.", { n: item.stats.n, mean: Math.round((item.stats.mean ?? 0) * 100) })}
              </p>
            )}
            {usage && (
              <div className="text-sm flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-muted">{tr("Where it's used")}</span>
                <span className="text-ink">{usage.place ?? SOURCE_LABEL[usage.source]()}</span>
                {usage.forms.map((f) => (
                  <span key={f.id} className="text-ink">
                    {f.code} · {f.name} <span className="text-muted">({f.purpose === "mock" ? tr("mock") : tr("practice")}, {f.status})</span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LibraryTable({ items, onOpen, action }: { items: LibraryItem[]; onOpen: (id: string) => void; action?: (i: LibraryItem) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-rule">
            <th className="py-2 pr-3 font-semibold">{tr("Question")}</th>
            <th className="py-2 pr-3 font-semibold">{tr("Type")}</th>
            <th className="py-2 pr-3 font-semibold">{tr("Level")}</th>
            <th className="py-2 pr-3 font-semibold">{tr("Where it's used")}</th>
            <th className="py-2 pr-3 font-semibold">{tr("Time")}</th>
            <th className="py-2 pr-3 font-semibold">{tr("Answered")}</th>
            {action && <th className="py-2" />}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-rule/60 align-top hover:bg-paper-warm/50">
              <td className="py-2 pr-3 cursor-pointer" onClick={() => onOpen(i.id)}>
                <div className="text-ink">{i.preview || "—"}</div>
                <div className="text-[11px] text-muted flex flex-wrap gap-1.5 mt-0.5">
                  <span>{FAMILY_LABEL[i.family]}</span>
                  {i.mockApproved && <span className="text-success">{tr("mock-approved")}</span>}
                  {i.status !== "approved" && <span className="text-warning">{i.status}</span>}
                  {i.formCount > 0 && <span>{tr("in {{n}} built tests", { n: i.formCount })}</span>}
                  {i.domain !== "general" && <span className="text-navy-deep">{DOMAIN_LABEL[i.domain]?.() ?? i.domain}</span>}
                </div>
              </td>
              <td className="py-2 pr-3 text-xs">{i.typeName}</td>
              <td className="py-2 pr-3 font-mono text-xs">{i.level ?? "—"}</td>
              <td className="py-2 pr-3 text-xs text-muted">{i.usedIn ?? SOURCE_LABEL[i.source]()}</td>
              <td className="py-2 pr-3 text-xs">{i.seconds !== null ? `${minutes(i.seconds)} min` : "—"}</td>
              <td className="py-2 pr-3 text-xs">
                {i.answered}
                {i.averageScore !== null && <span className="text-muted"> · {Math.round(i.averageScore * 100)}%</span>}
              </td>
              {action && <td className="py-2 text-right">{action(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Library: every question in the bank ----

export function LibraryPanel({ itemTypeNames }: { itemTypeNames: Record<string, string> }) {
  const [testTypes, setTestTypes] = useState<BuilderTestType[]>([]);
  const [f, setF] = useState<LibraryFilters>({ status: "approved" });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; items: LibraryItem[]; pageSize: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState<Record<string, string>>(itemTypeNames);
  const [more, setMore] = useState(false);

  useEffect(() => {
    getBuilderTestTypes()
      .then((r) => setTestTypes(r.testTypes))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setData(null);
    getLibrary({ ...f, q: q.trim() || undefined, page })
      .then((r) => {
        setData(r);
        setAllTypes((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((i) => [i.itemTypeId, i.typeName])) }));
      })
      .catch(() => setData({ total: 0, items: [], pageSize: 50 }));
  }, [f, q, page]);
  const set = (patch: Partial<LibraryFilters>) => {
    setPage(0);
    setF((x) => ({ ...x, ...patch }));
  };

  return (
    <Panel title={tr("All questions")}>
      <p className="text-xs text-muted">{tr("Every question in Spica. Click one to see it in full.")}</p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex items-center gap-1.5 border border-rule rounded-input px-2 bg-paper">
          <Search size={14} className="text-muted" />
          <input value={q} onChange={(e) => (setPage(0), setQ(e.target.value))} placeholder={tr("Search text or topic")} className="py-2 text-sm bg-transparent focus:outline-none w-48" />
        </label>
        <select value={f.testTypeId ?? ""} onChange={(e) => set({ testTypeId: e.target.value || undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="">{tr("Any test")}</option>
          <TestTypeOptions testTypes={testTypes.filter((t) => !f.family || t.familyId === f.family)} />
        </select>
        <select value={f.itemTypeId ?? ""} onChange={(e) => set({ itemTypeId: e.target.value || undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="">{tr("Any question type")}</option>
          {Object.entries(allTypes)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
        </select>
        <select
          value={f.levelMin && f.levelMin === f.levelMax ? f.levelMin : ""}
          onChange={(e) => set({ levelMin: e.target.value || undefined, levelMax: e.target.value || undefined })}
          className={`${inputClass} cursor-pointer`}
          aria-label={tr("Level")}
        >
          <option value="">{tr("Any level")}</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button onClick={() => setMore((m) => !m)} className="text-sm text-navy-deep hover:underline cursor-pointer py-2">
          {more ? tr("Fewer filters") : tr("More filters")}
        </button>
      </div>
      {more && (
      <div className="flex flex-wrap gap-2 items-end">
        <select value={f.skill ?? ""} onChange={(e) => set({ skill: e.target.value || undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="">{tr("Any skill")}</option>
          <option value="listening">{tr("Listening")}</option>
          <option value="speaking">{tr("Speaking")}</option>
          <option value="reading">{tr("Reading")}</option>
          <option value="writing">{tr("Writing")}</option>
        </select>
        <select value={f.domain ?? ""} onChange={(e) => set({ domain: e.target.value || undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="">{tr("Any field")}</option>
          {DOMAINS.map((d) => (
            <option key={d} value={d}>
              {DOMAIN_LABEL[d]?.() ?? d}
            </option>
          ))}
        </select>
        <select value={f.status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="approved">{tr("Approved")}</option>
          <option value="draft">{tr("Not in use (draft)")}</option>
          <option value="retired">{tr("Retired")}</option>
          <option value="">{tr("Any status")}</option>
        </select>
        <select value={f.mockApproved ?? ""} onChange={(e) => set({ mockApproved: (e.target.value || undefined) as "true" | "false" | undefined })} className={`${inputClass} cursor-pointer`}>
          <option value="">{tr("Mocks: any")}</option>
          <option value="true">{tr("Approved for mocks")}</option>
          <option value="false">{tr("Practice only")}</option>
        </select>
      </div>
      )}
      {more && (
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-muted self-center mr-1">{tr("Where from:")}</span>
        {SOURCES.map((s) => {
          const on = (f.sources ?? []).includes(s);
          return (
            <button
              key={s}
              onClick={() => set({ sources: on ? (f.sources ?? []).filter((x) => x !== s) : [...(f.sources ?? []), s] })}
              className={`text-xs px-2.5 py-1 rounded-pill border cursor-pointer ${on ? "bg-navy text-white border-navy" : "border-rule text-muted hover:text-ink"}`}
            >
              {SOURCE_LABEL[s]()}
            </button>
          );
        })}
      </div>
      )}
      {!data ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : data.items.length === 0 ? (
        <EmptyNote>{tr("No questions match these filters.")}</EmptyNote>
      ) : (
        <>
          <p className="text-xs text-muted">{tr("{{total}} questions", { total: data.total.toLocaleString() })}</p>
          <LibraryTable items={data.items} onOpen={setOpen} />
          <div className="flex items-center gap-3 justify-end text-sm">
            <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="!py-1.5">
              {tr("Previous")}
            </Button>
            <span className="text-muted text-xs">
              {tr("Page {{p}} of {{n}}", { p: page + 1, n: Math.max(1, Math.ceil(data.total / data.pageSize)) })}
            </span>
            <Button variant="secondary" disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)} className="!py-1.5">
              {tr("Next")}
            </Button>
          </div>
        </>
      )}
      {open && <QuestionDetail id={open} onClose={() => setOpen(null)} />}
    </Panel>
  );
}

// ---- Create test ----

interface Draft {
  id: string | null;
  testTypeId: string;
  purpose: "practice" | "mock";
  name: string;
  durationMinutes: number;
  levelMin: string;
  levelMax: string;
  domain: string;
  sources: LibrarySource[];
  sections: Record<string, string[]>;
}

// Picker: matching questions for one section, to add by hand.
function SectionPicker({
  section,
  draft,
  exclude,
  onAdd,
  onClose,
}: {
  section: PlanSection;
  draft: Draft;
  exclude: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ total: number; items: LibraryItem[]; pageSize: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    getLibrary({
      itemTypeId: section.itemTypeId,
      levelMin: draft.levelMin,
      levelMax: draft.levelMax,
      sources: draft.sources,
      status: "approved",
      q: q.trim() || undefined,
      exclude,
      page,
      pageSize: 20,
      preferDomain: draft.domain !== "general" ? draft.domain : undefined,
    })
      .then(setData)
      .catch(() => setData({ total: 0, items: [], pageSize: 20 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.itemTypeId, page, q, exclude.length]);
  return (
    <div className="border border-navy/30 rounded-input p-3 flex flex-col gap-2 bg-paper-warm/40">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink flex-1">{tr("Add {{type}} questions", { type: section.typeName })}</span>
        <input value={q} onChange={(e) => (setPage(0), setQ(e.target.value))} placeholder={tr("Search")} className={`${inputClass} !py-1 w-40`} />
        <button onClick={onClose} aria-label={tr("Close")} className="text-muted hover:text-ink cursor-pointer">
          <X size={16} />
        </button>
      </div>
      {!data ? (
        <p className="text-xs text-muted">{tr("Loading…")}</p>
      ) : data.items.length === 0 ? (
        <p className="text-xs text-muted">{tr("No more questions of this type match the level and sources.")}</p>
      ) : (
        <>
          <LibraryTable
            items={data.items}
            onOpen={setOpen}
            action={(i) => (
              <Button variant="secondary" onClick={() => onAdd(i.id)} className="!px-2 !py-1 text-xs">
                <Plus size={13} />
              </Button>
            )}
          />
          <div className="flex items-center gap-2 justify-end text-xs">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="text-navy-deep disabled:text-muted cursor-pointer">
              {tr("Previous")}
            </button>
            <span className="text-muted">{tr("{{total}} questions", { total: data.total })}</span>
            <button disabled={(page + 1) * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)} className="text-navy-deep disabled:text-muted cursor-pointer">
              {tr("Next")}
            </button>
          </div>
        </>
      )}
      {open && <QuestionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FormsList({ forms, testTypes, onEdit, onChanged }: { forms: BuiltForm[]; testTypes: BuilderTestType[]; onEdit: (id: string) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const retired = forms.filter((f) => f.status === "retired").length;
  const shown = showRetired ? forms : forms.filter((f) => f.status !== "retired");
  async function act(id: string, f: () => Promise<unknown>, done: string) {
    setBusy(id);
    setMsg(null);
    try {
      await f();
      setMsg(done);
      onChanged();
    } catch (err) {
      setMsg(publishError(err));
    } finally {
      setBusy(null);
    }
  }
  if (forms.length === 0) return null;
  return (
    <Panel
      title={tr("Built tests")}
      action={
        retired > 0 ? (
          <button onClick={() => setShowRetired((x) => !x)} className="text-xs text-navy-deep hover:underline cursor-pointer">
            {showRetired ? tr("Hide retired") : tr("Show retired ({{n}})", { n: retired })}
          </button>
        ) : undefined
      }
    >
      {msg && <p className="text-sm text-ink bg-paper-warm rounded-input px-3 py-2">{msg}</p>}
      {shown.length === 0 ? (
        <EmptyNote>
          {retired > 0 && !showRetired
            ? retired === 1
              ? tr("No tests in use. 1 retired test is hidden.")
              : tr("No tests in use. {{n}} retired tests are hidden.", { n: retired })
            : tr("No tests yet.")}
        </EmptyNote>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-rule">
              <th className="py-2 pr-3 font-semibold">{tr("Test")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("For")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Duration")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Questions")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Status")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} className="border-b border-rule/60">
                <td className="py-2 pr-3">
                  <div className="text-ink font-medium">
                    {f.code} · {f.name}
                  </div>
                  <div className="text-xs text-muted">
                    {f.familyName} · {f.testTypeName ?? testTypes.find((t) => t.id === f.testTypeId)?.name} · {f.createdBy ?? ""}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs">{f.purpose === "mock" ? tr("Mock") : tr("Practice")}</td>
                <td className="py-2 pr-3 text-xs">
                  {tr("{{m}} min", { m: f.durationMinutes })}
                  {f.shortForm && <span className="block text-warning">{tr("short form")}</span>}
                </td>
                <td className="py-2 pr-3 text-xs">{f.itemCount ?? ""}</td>
                <td className="py-2 pr-3">
                  <StatusPill tone={f.status === "published" ? "success" : f.status === "draft" ? "navy" : "muted"}>
                    {f.status === "published" ? tr("Published") : f.status === "draft" ? tr("Draft") : tr("Retired")}
                  </StatusPill>
                  {f.status === "draft" && f.buildStatus === "waiting_for_ai" && <span className="block text-[11px] text-navy-deep mt-1">{tr("AI writing questions…")}</span>}
                  {f.status === "draft" && f.buildStatus === "short" && <span className="block text-[11px] text-warning mt-1">{tr("Some parts are short")}</span>}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {f.status === "draft" && (
                    <>
                      <Button variant="secondary" onClick={() => onEdit(f.id)} disabled={busy === f.id} title={tr("Edit")} aria-label={tr("Edit")} className="!px-2 !py-1 text-xs mr-1">
                        <Pencil size={13} />
                      </Button>
                      <Button onClick={() => act(f.id, () => publishBuiltForm(f.id), tr("Published."))} disabled={busy === f.id} className="!px-2 !py-1 text-xs mr-1">
                        {tr("Publish")}
                      </Button>
                    </>
                  )}
                  {f.status !== "retired" && (
                    <Button
                      variant="secondary"
                      onClick={() => window.confirm(tr("Retire {{code}}? Learners won't get it any more.", { code: f.code })) && act(f.id, () => retireBuiltForm(f.id), tr("Retired."))}
                      disabled={busy === f.id}
                      title={tr("Retire")}
                      aria-label={tr("Retire")}
                      className="!px-2 !py-1 text-xs"
                    >
                      <Archive size={13} />
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    onClick={() => window.confirm(tr("Delete {{code}} for good? This can't be undone.", { code: f.code })) && act(f.id, () => deleteBuiltForm(f.id), tr("Deleted."))}
                    disabled={busy === f.id}
                    className="!px-2 !py-1 text-xs ml-1"
                    title={tr("Delete")}
                  >
                    <Trash2 size={13} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </Panel>
  );
}

function publishError(err: unknown): string {
  const code = errorCode(err);
  const body = err instanceof ApiError ? (err.body as { section?: string } | undefined) : undefined;
  const where = body?.section ? ` (${body.section})` : "";
  switch (code) {
    case "empty_section":
      return tr("Every section needs at least one question.") + where;
    case "wrong_type":
      return tr("A question doesn't fit its section.") + where;
    case "not_approved":
      return tr("A question isn't approved any more.") + where;
    case "not_mock_approved":
      return tr("A mock can only use questions approved for mocks.") + where;
    case "duplicate_item":
      return tr("The same question is in the test twice.");
    case "not_draft":
      return tr("Only drafts can be changed. Retire this test and build a new one.");
    case "form_in_use":
      return tr("Someone has already taken this test, so it can't be deleted. Retire it instead.");
    default:
      return tr("Could not save. Try again.");
  }
}

// What a one-click build did: questions per part, from the chosen field,
// what's missing and why, and what still needs a person.
function BuildSummaryView({
  summary,
  status,
  purpose,
  onApproveAll,
  busy,
}: {
  summary: BuildSummary;
  status: "ready" | "waiting_for_ai" | "short";
  purpose: "practice" | "mock";
  onApproveAll: () => void;
  busy: boolean;
}) {
  const total = summary.sections.reduce((n, s) => n + s.chosen, 0);
  const wanted = summary.sections.reduce((n, s) => n + s.wanted, 0);
  return (
    <Panel title={tr("What was built")}>
      <p className={`text-sm ${status === "ready" ? "text-success" : "text-warning"}`}>
        {summary.published
          ? tr("Complete and published: {{n}} questions.", { n: total })
          : status === "ready"
            ? tr("Complete: {{n}} questions. Check it below, then publish.", { n: total })
            : status === "waiting_for_ai"
              ? tr("Waiting for the AI's questions.")
              : tr("{{n}} of {{w}} questions. Some parts are short (see below).", { n: total, w: wanted })}
      </p>
      {summary.publishError && <p className="text-sm text-error">{publishError(new ApiError(summary.publishError, { error: summary.publishError }))}</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {summary.sections.map((s) => (
          <li key={s.sortOrder} className="flex flex-wrap gap-x-3">
            <span className={`font-medium ${s.missing ? "text-warning" : "text-ink"}`}>
              {s.sortOrder}. {s.label}: {s.chosen} / {s.wanted}
            </span>
            {summary.field && s.fromField !== null && (
              <span className="text-xs text-muted">
                {tr("{{n}} from {{field}}, {{g}} general", { n: s.fromField, field: DOMAIN_LABEL[summary.field]?.() ?? summary.field, g: s.chosen - s.fromField })}
              </span>
            )}
            {s.missing > 0 &&
              (s.aiPossible ? (
                <span className="text-xs text-muted">{tr("{{n}} missing; AI asked for {{a}}", { n: s.missing, a: s.aiRequested })}</span>
              ) : (
                <span className="text-xs text-warning">{tr("{{n}} missing; the AI can't write this question type yet, so add questions by hand or shorten the test.", { n: s.missing })}</span>
              ))}
          </li>
        ))}
      </ul>
      {summary.aiErrors.length > 0 && (
        <p className="text-xs text-error flex items-start gap-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {aiErrorText(summary.aiErrors[0])}
        </p>
      )}
      {purpose === "mock" && summary.needsMockApproval.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-paper-warm rounded-input px-3 py-2">
          <span className="text-sm text-ink flex-1">
            {tr("{{n}} AI-written questions passed their checks but need a person's approval before a mock can use them. Review them in the Review tab, or approve them here.", {
              n: summary.needsMockApproval.length,
            })}
          </span>
          <Button variant="secondary" onClick={onApproveAll} disabled={busy} className="!py-1.5 text-xs">
            {tr("Approve them for mocks and fill the gaps")}
          </Button>
        </div>
      )}
    </Panel>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BuilderPanel() {
  const [testTypes, setTestTypes] = useState<BuilderTestType[]>([]);
  const [forms, setForms] = useState<BuiltForm[]>([]);
  const [d, setD] = useState<Draft | null>(null);
  const [plan, setPlan] = useState<{ officialMinutes: number; plannedSeconds: number; scale: number; sections: PlanSection[] } | null>(null);
  const [details, setDetails] = useState<Record<string, LibraryItem>>({});
  const [seconds, setSeconds] = useState<FormSeconds | null>(null);
  const [missing, setMissing] = useState<{ sortOrder: number; itemTypeId: string; count: number }[]>([]);
  const [picker, setPicker] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [customDuration, setCustomDuration] = useState(false);
  const [publishNow, setPublishNow] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [built, setBuilt] = useState<{ summary: BuildSummary; status: "ready" | "waiting_for_ai" | "short" } | null>(null);
  // Where "Create the test" takes questions from.
  const [questionsFrom, setQuestionsFrom] = useState<"bank" | "ai">("bank");
  // Picking questions by hand (the section lists).
  const [manual, setManual] = useState(false);
  // Still on this page (set on every mount: React mounts twice in development).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function loadForms() {
    listForms()
      .then((r) => setForms(r.forms))
      .catch(() => {});
  }
  useEffect(() => {
    loadForms();
    getBuilderTestTypes()
      .then((r) => setTestTypes(r.testTypes))
      .catch(() => {});
  }, []);

  const tt = testTypes.find((t) => t.id === d?.testTypeId);
  function newDraft(testTypeId: string) {
    const t = testTypes.find((x) => x.id === testTypeId)!;
    setD({ id: null, testTypeId, purpose: "practice", name: "", durationMinutes: t.officialMinutes, levelMin: t.cefrMin, levelMax: t.cefrMax, domain: "general", sources: [], sections: {} });
    setCustomDuration(false);
    setMissing([]);
    setMsg(null);
    setBuilt(null);
    setManual(false);
  }

  // The plan follows the test type and duration.
  useEffect(() => {
    if (!d) return;
    getBuilderPlan(d.testTypeId, d.durationMinutes)
      .then(setPlan)
      .catch(() => setPlan(null));
  }, [d?.testTypeId, d?.durationMinutes]);

  // Details and time for the chosen questions.
  const chosenIds = useMemo(() => Object.values(d?.sections ?? {}).flat(), [d?.sections]);
  useEffect(() => {
    if (!d) return;
    const need = chosenIds.filter((id) => !details[id]);
    if (need.length) {
      getLibrary({ ids: need, status: "", pageSize: 500 })
        .then((r) => setDetails((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((i) => [i.id, i])) })))
        .catch(() => {});
    }
    formSeconds(d.testTypeId, d.sections)
      .then(setSeconds)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenIds.join(","), d?.testTypeId]);

  async function edit(id: string) {
    const r = await getBuiltForm(id);
    const f = r.form;
    setD({
      id: f.id,
      testTypeId: f.testTypeId,
      purpose: f.purpose,
      name: f.name,
      durationMinutes: f.durationMinutes,
      levelMin: f.levelMin ?? "A1",
      levelMax: f.levelMax ?? "C2",
      domain: f.domain,
      sources: [],
      sections: r.sections,
    });
    setCustomDuration(!DURATION_PRESETS.includes(f.durationMinutes));
    setMsg(null);
    setBuilt(f.buildSummary ? { summary: f.buildSummary, status: f.buildStatus ?? "ready" } : null);
  }

  // One click: pick, ask the AI for gaps, save; wait for the AI if needed.
  async function createNow() {
    if (!d) return;
    setBusy(true);
    setMsg(null);
    setBuilt(null);
    setProgress(tr("Picking questions and saving the test…"));
    try {
      const r = await createTestOneClick({
        testTypeId: d.testTypeId,
        purpose: d.purpose,
        durationMinutes: d.durationMinutes,
        levelMin: d.levelMin,
        levelMax: d.levelMax,
        domain: d.domain,
        sources: d.sources.length ? d.sources : undefined,
        name: d.name.trim() || undefined,
        publish: publishNow,
        questions: questionsFrom,
      });
      let summary = r.summary;
      let status = r.status;
      if (status === "waiting_for_ai") {
        const n = summary.sections.reduce((a, s) => a + s.aiRequested, 0);
        setProgress(
          tr("Writing {{n}} questions with AI and checking them. This takes a few minutes; you can leave and find the test under Built tests.", { n }),
        );
        for (let i = 0; i < 120 && mounted.current; i++) {
          await sleep(5000);
          const f = await getBuiltForm(r.id).catch(() => null);
          if (f && f.form.buildStatus !== "waiting_for_ai") {
            summary = f.form.buildSummary ?? summary;
            status = f.form.buildStatus ?? "ready";
            break;
          }
        }
      }
      if (!mounted.current) return;
      setProgress(null);
      loadForms();
      if (summary.published) {
        setD(null);
        setBuilt({ summary, status });
      } else {
        await edit(r.id);
        setBuilt({ summary, status });
      }
    } catch (err) {
      setMsg({ ok: false, text: publishError(err) });
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function approveAllAndFill() {
    if (!d || !built) return;
    setBusy(true);
    for (const id of built.summary.needsMockApproval) await decideItem(id, { decision: "approve_mock" }).catch(() => {});
    setBuilt({ ...built, summary: { ...built.summary, needsMockApproval: [] } });
    setBusy(false);
    await fill();
  }

  async function fill() {
    if (!d) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await autofillForm({
        testTypeId: d.testTypeId,
        purpose: d.purpose,
        durationMinutes: d.durationMinutes,
        levelMin: d.levelMin,
        levelMax: d.levelMax,
        domain: d.domain === "general" ? undefined : d.domain,
        sources: d.sources.length ? d.sources : undefined,
        keep: d.sections,
      });
      setD({ ...d, sections: r.sections });
      setMissing(r.missing);
    } catch {
      setMsg({ ok: false, text: tr("Could not fill the test. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function save(publish: boolean) {
    if (!d) return;
    setBusy(true);
    setMsg(null);
    try {
      const body = {
        testTypeId: d.testTypeId,
        purpose: d.purpose,
        name: d.name.trim() || `${tt?.name ?? ""} ${d.durationMinutes} min`,
        durationMinutes: d.durationMinutes,
        levelMin: d.levelMin,
        levelMax: d.levelMax,
        domain: d.domain,
        sections: d.sections,
      };
      let id = d.id;
      if (id) await updateBuiltForm(id, body);
      else id = (await createBuiltForm(body)).id;
      setD({ ...d, id });
      if (publish) {
        await publishBuiltForm(id);
        setMsg({ ok: true, text: d.purpose === "mock" ? tr("Published. Learners' mocks of this test can now use it.") : tr("Published. Learners see it with this test's practice sets.") });
        setD(null);
      } else {
        setMsg({ ok: true, text: tr("Draft saved.") });
      }
      loadForms();
    } catch (err) {
      setMsg({ ok: false, text: publishError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function approveForMocks(id: string) {
    await decideItem(id, { decision: "approve_mock" }).catch(() => {});
    setDetails((prev) => ({ ...prev, [id]: { ...prev[id], mockApproved: true } }));
  }

  async function writeMissing(m: { itemTypeId: string; count: number }) {
    if (!d) return;
    const mid = LEVELS[Math.round((LEVELS.indexOf(d.levelMin) + LEVELS.indexOf(d.levelMax)) / 2)];
    try {
      await startGeneration({ testTypeId: d.testTypeId, itemTypeId: m.itemTypeId, level: mid, domain: d.domain, count: Math.min(50, m.count) });
      setMsg({ ok: true, text: tr("Writing {{n}} questions with AI. Once they pass their checks (and, for mocks, a reviewer approves them), fill the test again.", { n: m.count }) });
    } catch (err) {
      setMsg({ ok: false, text: errorCode(err) === "not_generatable" ? tr("AI can't write this question type yet.") : tr("Could not start. Try again.") });
    }
  }

  const set = (patch: Partial<Draft>) => setD((x) => (x ? { ...x, ...patch } : x));
  // Question time in test minutes (the published test's questions fill its published time).
  const testMin = (secs: number) => Math.round((secs * (plan?.scale ?? 1)) / 60);
  const chosenMin = seconds ? testMin(seconds.total) : 0;
  const plannedMin = plan ? testMin(plan.plannedSeconds) : 0;
  const plannedCount = plan?.sections.reduce((n, x) => n + x.count, 0) ?? 0;
  const showSections = !!d && (!!d.id || manual);

  return (
    <div className="flex flex-col gap-4">
      <Panel title={tr("Create a test")}>
        <p className="text-xs text-muted">
          {tr("Choose the test and fill in the details. The duration starts at the real exam's time; change it for a shorter or longer test.")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {tr("Test")}
            <select value={d?.testTypeId ?? ""} onChange={(e) => e.target.value && newDraft(e.target.value)} className={`${inputClass} cursor-pointer`}>
              <option value="">{tr("Choose a test")}</option>
              <TestTypeOptions testTypes={testTypes} />
            </select>
          </label>
          {d && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {tr("For")}
                <select value={d.purpose} onChange={(e) => set({ purpose: e.target.value as Draft["purpose"] })} className={`${inputClass} cursor-pointer`}>
                  <option value="practice">{tr("Practice")}</option>
                  <option value="mock">{tr("Mock test")}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {tr("Duration")}
                <div className="flex gap-1">
                  <select
                    value={customDuration ? "custom" : String(d.durationMinutes)}
                    onChange={(e) => {
                      if (e.target.value === "custom") return setCustomDuration(true);
                      setCustomDuration(false);
                      set({ durationMinutes: Number(e.target.value) });
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {[...new Set([tt?.officialMinutes ?? 60, ...DURATION_PRESETS])]
                      .sort((a, b) => a - b)
                      .map((m) => (
                        <option key={m} value={m}>
                          {m === tt?.officialMinutes ? tr("{{m}} min (published)", { m }) : tr("{{m}} min", { m })}
                        </option>
                      ))}
                    <option value="custom">{tr("Other…")}</option>
                  </select>
                  {customDuration && (
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={d.durationMinutes}
                      onChange={(e) => set({ durationMinutes: Math.max(5, Math.min(300, Number(e.target.value) || 5)) })}
                      className={`${inputClass} w-20`}
                    />
                  )}
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {tr("Levels")}
                <div className="flex gap-1">
                  <select value={d.levelMin} onChange={(e) => set({ levelMin: e.target.value })} className={`${inputClass} cursor-pointer`}>
                    {LEVELS.filter((l) => !tt || (l >= tt.cefrMin && l <= tt.cefrMax)).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                  <select value={d.levelMax} onChange={(e) => set({ levelMax: e.target.value })} className={`${inputClass} cursor-pointer`}>
                    {LEVELS.filter((l) => !tt || (l >= tt.cefrMin && l <= tt.cefrMax)).map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                {tr("Field")}
                <select value={d.domain} onChange={(e) => set({ domain: e.target.value })} className={`${inputClass} cursor-pointer`}>
                  {DOMAINS.map((x) => (
                    <option key={x} value={x}>
                      {DOMAIN_LABEL[x]?.() ?? x}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-48">
                {tr("Name")}
                <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder={tr("e.g. Quick listening check")} className={inputClass} maxLength={120} />
              </label>
            </>
          )}
        </div>
        {d && (
          <>
            {plan && (
              <p className="text-sm text-ink bg-paper-warm rounded-input px-4 py-3">
                {tr("{{n}} questions, {{m}} min of the {{d}} min.", { n: plannedCount, m: plannedMin, d: d.durationMinutes })}{" "}
                {plannedMin > d.durationMinutes + 1 && (
                  <span className="text-warning">{tr("This exam can't be shorter than about {{m}} min (one question per part).", { m: plannedMin })}</span>
                )}
                {d.durationMinutes !== plan.officialMinutes && <span className="text-muted">{tr("The real exam takes {{m}} min.", { m: plan.officialMinutes })}</span>}
              </p>
            )}
            {!d.id && (
              <div className="flex flex-col gap-3 border border-navy/20 rounded-input px-4 py-3">
                {SHOW_AI_WRITTEN_TESTS && (
                <>
                <span className="text-sm font-semibold text-ink">{tr("Questions")}</span>
                <div className="grid sm:grid-cols-2 gap-2">
                  {(
                    [
                      ["bank", tr("From the question bank"), tr("Approved questions already in Spica, matched to the test's parts and levels. The AI writes only what's missing.")],
                      ["ai", tr("New questions written by AI"), tr("The AI writes fresh questions for every part it can write (LanguageCert types). Other parts use the bank. Takes a few minutes.")],
                    ] as const
                  ).map(([k, label, note]) => (
                    <label key={k} className={`flex gap-2 rounded-input border px-3 py-2 cursor-pointer ${questionsFrom === k ? "border-navy bg-navy/5" : "border-rule"}`}>
                      <input type="radio" name="questionsFrom" checked={questionsFrom === k} onChange={() => setQuestionsFrom(k)} className="mt-1" />
                      <span className="flex flex-col">
                        <span className="text-sm text-ink font-medium">{label}</span>
                        <span className="text-xs text-muted">{note}</span>
                      </span>
                    </label>
                  ))}
                </div>
                </>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
                    <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                    {tr("Publish when it's complete")}
                  </label>
                  <span className="flex-1" />
                  {!manual && (
                    <button onClick={() => setManual(true)} className="text-sm text-navy-deep hover:underline cursor-pointer">
                      {tr("Or pick the questions yourself")}
                    </button>
                  )}
                  <Button onClick={createNow} disabled={busy} className="flex items-center gap-1.5">
                    {progress ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />} {tr("Create the test")}
                  </Button>
                </div>
              </div>
            )}
            {showSections && plan && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className={Math.abs(chosenMin - d.durationMinutes) > Math.max(2, d.durationMinutes * 0.1) && chosenIds.length ? "text-warning font-semibold" : "text-ink"}>
                  {tr("Questions chosen: {{n}}, about {{m}} min", { n: chosenIds.length, m: chosenMin })}
                </span>
                <span className="flex-1" />
                <Button variant="secondary" onClick={fill} disabled={busy} className="flex items-center gap-1.5 !py-1.5">
                  <Wand2 size={14} /> {chosenIds.length ? tr("Fill the rest automatically") : tr("Fill automatically")}
                </Button>
                {chosenIds.length > 0 && (
                  <Button variant="secondary" onClick={() => set({ sections: {} })} disabled={busy} className="!py-1.5">
                    {tr("Clear")}
                  </Button>
                )}
              </div>
            )}
            {progress && (
              <p className="text-sm text-navy-deep flex items-center gap-2">
                <Loader2 size={15} className="animate-spin" /> {progress}
              </p>
            )}
            {d.durationMinutes !== plan?.officialMinutes && d.purpose === "mock" && (
              <p className="text-xs text-muted">{tr("A mock at another length shows the learner's CEFR level but no estimated exam score.")}</p>
            )}
          </>
        )}
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </Panel>

      {built && <BuildSummaryView summary={built.summary} status={built.status} purpose={d?.purpose ?? "practice"} onApproveAll={approveAllAndFill} busy={busy} />}

      {showSections &&
        plan?.sections.map((s) => {
          const list = d.sections[String(s.sortOrder)] ?? [];
          const miss = missing.find((m) => m.sortOrder === s.sortOrder);
          const secs = seconds?.bySection[String(s.sortOrder)] ?? 0;
          return (
            <Panel
              key={s.sortOrder}
              title={`${s.sortOrder}. ${s.label}`}
              action={
                <span className={`text-xs ${list.length < s.count ? "text-warning" : "text-muted"}`}>
                  {tr("{{have}} of {{need}} questions · {{m}} min", { have: list.length, need: s.count, m: testMin(secs) })}
                </span>
              }
            >
              <p className="text-xs text-muted">
                {s.typeName} · {tr("published test: {{n}} questions", { n: s.officialCount })}
              </p>
              {list.length > 0 && (
                <ul className="flex flex-col divide-y divide-rule/60">
                  {list.map((id, i) => {
                    const it = details[id];
                    return (
                      <li key={id} className="py-1.5 flex items-start gap-2 text-sm">
                        <span className="text-xs text-muted w-5 mt-0.5">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-ink truncate">{it?.preview ?? "…"}</div>
                          <div className="text-[11px] text-muted">
                            {it?.level ?? ""} · {it ? (it.usedIn ?? SOURCE_LABEL[it.source]()) : ""}
                            {it?.seconds ? ` · ${minutes(it.seconds)} min` : ""}
                          </div>
                        </div>
                        {d.purpose === "mock" && it && !it.mockApproved && (
                          <Button variant="secondary" onClick={() => approveForMocks(id)} className="!px-2 !py-1 text-xs" title={tr("A mock needs questions approved for mocks")}>
                            <CheckCircle2 size={13} className="inline mr-1" />
                            {tr("Approve for mocks")}
                          </Button>
                        )}
                        <button
                          onClick={() => set({ sections: { ...d.sections, [String(s.sortOrder)]: list.filter((x) => x !== id) } })}
                          aria-label={tr("Remove")}
                          className="text-muted hover:text-error cursor-pointer mt-0.5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setPicker(picker === s.sortOrder ? null : s.sortOrder)} className="!py-1.5 text-xs flex items-center gap-1">
                  <Plus size={13} /> {tr("Add questions")}
                </Button>
                {miss && (
                  <Button variant="secondary" onClick={() => writeMissing(miss)} className="!py-1.5 text-xs flex items-center gap-1">
                    <Sparkles size={13} /> {tr("Write the {{n}} missing with AI", { n: miss.count })}
                  </Button>
                )}
              </div>
              {miss && <p className="text-xs text-warning">{tr("Not enough matching questions: {{n}} missing.", { n: miss.count })}</p>}
              {picker === s.sortOrder && (
                <SectionPicker
                  section={s}
                  draft={d}
                  exclude={chosenIds}
                  onAdd={(id) => set({ sections: { ...d.sections, [String(s.sortOrder)]: [...list, id] } })}
                  onClose={() => setPicker(null)}
                />
              )}
            </Panel>
          );
        })}

      {d && (
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={() => setD(null)} disabled={busy}>
            {tr("Cancel")}
          </Button>
          {showSections && (
            <>
          <Button variant="secondary" onClick={() => save(false)} disabled={busy || chosenIds.length === 0} className="flex items-center gap-1.5">
            <Save size={14} /> {tr("Save draft")}
          </Button>
          <Button onClick={() => save(true)} disabled={busy || chosenIds.length === 0} className="flex items-center gap-1.5">
            <Send size={14} /> {tr("Publish")}
          </Button>
            </>
          )}
        </div>
      )}

      <FormsList forms={forms} testTypes={testTypes} onEdit={(id) => edit(id).catch(() => {})} onChanged={loadForms} />
    </div>
  );
}
