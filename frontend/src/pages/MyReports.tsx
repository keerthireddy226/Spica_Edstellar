import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, ChevronRight, Layers } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { formatShortDate } from "@/api/licenses";
import { getCatalogue, getHistory, type CatalogueTestType, type HistoryEntry } from "@/api/practiceTests";
import { ROUTES } from "@/constants/routes";
import { testTypeName } from "@/lib/testTypes";
import { tr } from "@/i18n/tr";
import { getModuleHistory, type ModuleHistoryEntry } from "@/api/practiceSession";
import { useModulesEnabled } from "@/components/AppShell/useBranding";

// Every practice test, mock exam and Practice Modules set the learner
// finished, each opening its report.
export function MyReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [types, setTypes] = useState<CatalogueTestType[]>([]);
  const modulesOn = useModulesEnabled();
  const [modules, setModules] = useState<ModuleHistoryEntry[] | null>(null);
  const [filter, setFilter] = useState<"all" | "mock" | "practice" | "modules">("all");
  useEffect(() => {
    getHistory()
      .then((r) => setRows(r.sessions))
      .catch(() => setRows([]));
    getModuleHistory()
      .then((r) => setModules(r.sessions))
      .catch(() => setModules([]));
    getCatalogue()
      .then((r) => setTypes(r.families.flatMap((f) => f.testTypes)))
      .catch(() => {});
  }, []);
  const tests = filter === "modules" ? [] : (rows ?? []).filter((r) => filter === "all" || r.deliveryMode === filter);
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
        subtitle={tr("Every practice test, mock exam and Practice Modules set you finished, with what you got wrong or skipped and the right answers.")}
        icon={FileText}
        stats={
          rows
            ? [
                { label: tr("Tests finished"), value: rows.length, icon: FileText },
                { label: tr("Mock exams"), value: rows.filter((r) => r.deliveryMode === "mock").length, icon: FileText },
                { label: tr("Practice tests"), value: rows.filter((r) => r.deliveryMode === "practice").length, icon: FileText },
                ...(modulesOn ? [{ label: tr("Module sets"), value: modules?.length ?? 0, icon: Layers }] : []),
              ]
            : undefined
        }
      />
      <div className="flex gap-2">
        {(
          [
            ["all", tr("All")],
            ["mock", tr("Mock exams")],
            ["practice", tr("Practice tests")],
            ...(modulesOn ? ([["modules", tr("Practice Modules")]] as const) : []),
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`text-sm px-3 py-1.5 rounded-pill border cursor-pointer ${filter === k ? "bg-navy text-white border-navy" : "border-rule text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">
          {filter === "modules"
            ? tr("No finished sets yet. Your report for each Practice Modules set appears here.")
            : tr("No finished tests yet. Your reports appear here after each practice test or mock exam.")}
        </p>
      ) : (
        <div className="bg-surface border border-rule rounded-card divide-y divide-rule">
          {shown.map((row) => {
            if (row.kind === "set") {
              const m = row.m;
              const pct = m.total ? Math.round((m.right / m.total) * 100) : 0;
              return (
                <button
                  key={m.sessionId}
                  onClick={() => navigate(ROUTES.MODULE_REPORT.replace(":sessionId", m.sessionId))}
                  className="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-paper-warm/60 cursor-pointer"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill shrink-0 bg-warning/15 text-ink">{tr("Module")}</span>
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
                  <ChevronRight size={18} className="text-muted shrink-0" />
                </button>
              );
            }
            const h = row.h;
            const tt = types.find((x) => x.id === h.testTypeId);
            return (
              <button
                key={h.sessionId}
                onClick={() => navigate(ROUTES.TEST_REPORT.replace(":sessionId", h.sessionId))}
                className="w-full px-4 py-3 flex items-center gap-4 text-left hover:bg-paper-warm/60 cursor-pointer"
              >
                <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-pill shrink-0 ${h.deliveryMode === "mock" ? "bg-navy/10 text-navy-deep" : "bg-accent/15 text-accent"}`}>
                  {h.deliveryMode === "mock" ? tr("Mock exam") : tr("Practice")}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{tt ? testTypeName(tt, t) : (h.examName ?? "")}</span>
                  <span className="block text-xs text-muted">
                    {formatShortDate(h.completedAt)}
                    {h.examName && h.deliveryMode === "practice" ? ` · ${h.examName}` : ""}
                  </span>
                </span>
                <span className="text-sm text-ink shrink-0">
                  {h.cefrLevel ?? "—"}
                  {h.percent !== null ? <span className="text-muted"> · {h.percent}%</span> : null}
                </span>
                <ChevronRight size={18} className="text-muted shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
