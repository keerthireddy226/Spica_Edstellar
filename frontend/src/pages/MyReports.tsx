import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, ChevronRight, Layers, ClipboardCheck, Timer, Award, Gauge, BadgeCheck } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { formatShortDate } from "@/api/licenses";
import { getCatalogue, getHistory, type CatalogueTestType, type HistoryEntry } from "@/api/practiceTests";
import { ROUTES } from "@/constants/routes";
import { testTypeName } from "@/lib/testTypes";
import { tr } from "@/i18n/tr";
import { getModuleHistory, type ModuleHistoryEntry } from "@/api/practiceSession";
import { useModulesEnabled } from "@/components/AppShell/useBranding";
import { EmptyState, PageError, SectionLoading } from "@/components/learner/PageStates";
import { useTestOnly } from "@/components/learner/useTestOnly";

// Every row's kind label has the same width, so the test names line up.
const KIND_LABEL = "text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill shrink-0 sm:w-36 text-center truncate";

const linkBtn = "inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-semibold";

// Every practice test, mock test and Practice Modules set the learner
// finished, each opening its report.
export function MyReports() {
  const { t } = useTranslation();
  const testOnly = useTestOnly();
  const navigate = useNavigate();
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [types, setTypes] = useState<CatalogueTestType[]>([]);
  const modulesOn = useModulesEnabled();
  const [modules, setModules] = useState<ModuleHistoryEntry[] | null>(null);
  // ?show=mock or ?show=practice (the links on Mock Tests and Practice Tests) opens on that tab.
  const [searchParams] = useSearchParams();
  const show = searchParams.get("show");
  const [filter, setFilter] = useState<"all" | "mock" | "practice" | "modules" | "real" | "sample" | "level">(show === "mock" || show === "practice" ? show : "all");
  // A list that failed to load says so (with a retry) instead of looking empty.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setFailed(false);
    getHistory()
      .then((r) => setRows(r.sessions))
      .catch(() => {
        setRows([]);
        setFailed(true);
      });
    getModuleHistory()
      .then((r) => setModules(r.sessions))
      .catch(() => {
        setModules([]);
        setFailed(true);
      });
    getCatalogue()
      .then((r) => setTypes(r.families.flatMap((f) => f.testTypes)))
      .catch(() => {});
  }, [attempt]);
  // Real tests, samples and level tests (the tabs someone who bought only a test sees).
  const matches = (r: HistoryEntry) =>
    filter === "all" ||
    (filter === "real" ? r.deliveryMode === "certified" && !r.levelTest : filter === "level" ? !!r.levelTest : r.deliveryMode === filter);
  const tests = filter === "modules" ? [] : (rows ?? []).filter(matches);
  const sets = modulesOn && (filter === "all" || filter === "modules") ? (modules ?? []) : [];
  // Tests and sets in one list, newest first.
  const shown: ({ kind: "test"; at: string; h: HistoryEntry } | { kind: "set"; at: string; m: ModuleHistoryEntry })[] = [
    ...tests.map((h) => ({ kind: "test" as const, at: h.completedAt, h })),
    ...sets.map((m) => ({ kind: "set" as const, at: m.completedAt, m })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const loading = rows === null || (modulesOn && modules === null);
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("Your results")}
        title={tr("My reports")}
        subtitle={
          testOnly
            ? tr("Your test and its free sample: the score report of each, once it's ready.")
            : tr("Every practice test, mock test and Practice Modules set you finished, with what you got wrong or skipped and the right answers.")
        }
        icon={FileText}
        stats={
          rows && testOnly
            ? // Bought only a test: the counts of what they have.
              [
                { label: tr("Tests finished"), value: rows.length, icon: FileText },
                { label: tr("Real tests"), value: rows.filter((r) => r.deliveryMode === "certified" && !r.levelTest).length, icon: Award },
                ...(rows.some((r) => r.levelTest) ? [{ label: tr("Level tests"), value: rows.filter((r) => r.levelTest).length, icon: Gauge }] : []),
                { label: tr("Free samples"), value: rows.filter((r) => r.deliveryMode === "sample").length, icon: ClipboardCheck },
                { label: tr("Certificates"), value: rows.filter((r) => r.certificateCode).length, icon: BadgeCheck },
              ].slice(0, 4)
            : rows
            ? [
                { label: tr("Tests finished"), value: rows.length, icon: FileText },
                { label: tr("Mock tests"), value: rows.filter((r) => r.deliveryMode === "mock").length, icon: Timer },
                { label: tr("Practice tests"), value: rows.filter((r) => r.deliveryMode === "practice").length, icon: ClipboardCheck },
                ...(modulesOn ? [{ label: tr("Module sets"), value: modules?.length ?? 0, icon: Layers }] : []),
              ]
            : undefined
        }
      />
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        {(testOnly
          ? ([
              ["all", tr("All")],
              ["real", tr("Real tests")],
              ["sample", tr("Free samples")],
              ...((rows ?? []).some((r) => r.levelTest) ? ([["level", tr("Level tests")]] as const) : []),
            ] as const)
          : ([
              ["all", tr("All")],
              ["mock", tr("Mock tests")],
              ["practice", tr("Practice tests")],
              ...(modulesOn ? ([["modules", tr("Practice Modules")]] as const) : []),
            ] as const)
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-sm px-3.5 py-1.5 rounded-pill border whitespace-nowrap cursor-pointer transition-colors ${filter === k ? "bg-navy text-white border-navy" : "bg-surface border-rule text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <SectionLoading />
      ) : failed && shown.length === 0 ? (
        <PageError
          message={tr("Your reports couldn't be loaded.")}
          onRetry={() => {
            setRows(null);
            setModules(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={filter === "modules" ? Layers : FileText}
          title={filter === "modules" ? tr("No finished sets yet") : tr("No reports yet")}
          body={
            filter === "modules"
              ? tr("Your report for each Practice Modules set appears here.")
              : testOnly
                ? tr("Your score report appears here after your test, and after its free sample.")
                : tr("Your reports appear here after each practice test or mock test.")
          }
        >
          {filter === "modules" ? (
            <Link to={ROUTES.MODULES} className={`${linkBtn} bg-navy text-white`}>
              <Layers size={15} /> {tr("Go to Practice Modules")}
            </Link>
          ) : testOnly ? (
            <Link to={ROUTES.MY_TESTS} className={`${linkBtn} bg-navy text-white`}>
              <Award size={15} /> {tr("Go to Assessment")}
            </Link>
          ) : (
            <>
              <Link to={ROUTES.PRACTICE_TESTS} className={`${linkBtn} bg-navy text-white`}>
                <ClipboardCheck size={15} /> {tr("Go to practice tests")}
              </Link>
              <Link to={ROUTES.MOCK_EXAMS} className={`${linkBtn} border border-rule-strong text-ink hover:bg-paper-warm`}>
                <Timer size={15} /> {tr("Go to mock tests")}
              </Link>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm divide-y divide-rule overflow-hidden">
          {shown.map((row) => {
            if (row.kind === "set") {
              const m = row.m;
              const pct = m.total ? Math.round((m.right / m.total) * 100) : 0;
              return (
                <button
                  key={m.sessionId}
                  onClick={() => navigate(ROUTES.MODULE_REPORT.replace(":sessionId", m.sessionId))}
                  className="w-full px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 text-left hover:bg-paper-warm/60 cursor-pointer"
                >
                  <span className={`${KIND_LABEL} bg-warning/15 text-ink`}>{tr("Module")}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-ink truncate">
                      {[m.retry ? tr("Mistakes to retry") : (m.typeName ?? tr("Quick practice")), m.unitName?.split(" ")[0], m.setName].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-xs text-muted">
                      {formatShortDate(m.completedAt)}
                      {m.skill ? ` · ${t(`skills.${m.skill}`)}` : ""}
                    </span>
                  </span>
                  <span className="text-sm text-ink shrink-0">
                    {tr("{{right}}/{{total}} right", { right: m.right, total: m.total })}
                    <span className="text-muted"> · {pct}%</span>
                  </span>
                  <ChevronRight size={18} className="text-muted shrink-0 hidden sm:block" />
                </button>
              );
            }
            const h = row.h;
            const tt = types.find((x) => x.id === h.testTypeId);
            return (
              <div key={h.sessionId} className="relative flex items-center hover:bg-paper-warm/60">
              <button
                onClick={() => navigate(ROUTES.TEST_REPORT.replace(":sessionId", h.sessionId))}
                className="flex-1 min-w-0 px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 text-left cursor-pointer"
              >
                <span className={`${KIND_LABEL} ${h.deliveryMode === "practice" ? "bg-accent/15 text-accent" : "bg-navy/10 text-navy-deep"}`}>
                  {h.deliveryMode === "certified" ? (h.levelTest ? tr("Level test") : tr("Final assessment")) : h.deliveryMode === "sample" ? tr("Sample test") : h.deliveryMode === "mock" ? tr("Mock test") : tr("Practice")}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{tt ? testTypeName(tt, t) : (h.examName ?? "")}</span>
                  <span className="block text-xs text-muted">
                    {formatShortDate(h.completedAt)}
                    {h.examName && h.deliveryMode === "practice" ? ` · ${h.examName}` : ""}
                  </span>
                </span>
                {/* A final assessment shows no level before its certificate (being scored, under review or void). */}
                {h.finalStatus ? (
                  <span className={`text-sm shrink-0 text-right ${h.finalStatus === "void" ? "text-error" : "text-warning"}`}>
                    {h.finalStatus === "void" ? tr("Not valid") : h.finalStatus === "under_review" ? tr("Under review") : tr("Being scored")}
                  </span>
                ) : (
                <span className="text-sm text-ink shrink-0 text-right">
                  {h.certifiedLevel ?? h.cefrLevel ?? "—"}
                  {h.spicaScore != null ? (
                    <span className="text-muted"> · {tr("Spica score {{score}}", { score: h.spicaScore })}</span>
                  ) : h.percent !== null ? (
                    <span className="text-muted"> · {h.percent}%</span>
                  ) : null}
                </span>
                )}
                {!h.certificateCode && <ChevronRight size={18} className="text-muted shrink-0 hidden sm:block" />}
              </button>
              {h.certificateCode && (
                <Link
                  to={`/certificate/${h.certificateCode}`}
                  className="shrink-0 mr-4 inline-flex items-center gap-1 text-xs font-semibold text-success border border-success/40 bg-success/5 rounded-pill px-2.5 py-1 hover:bg-success/10"
                >
                  <Award size={13} /> {tr("Certificate")}
                </Link>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
