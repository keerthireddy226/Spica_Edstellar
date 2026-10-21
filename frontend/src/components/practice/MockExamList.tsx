import { useTranslation } from "react-i18next";
import { Timer, Lock, EyeOff, FileText, Clock, Award, CalendarClock, PlayCircle, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { HERO_GRADIENT } from "@/components/learner/LearnerHero";
import { formatShortDate } from "@/api/licenses";
import type { CatalogueFamily, CatalogueTestType, HistoryEntry, QuotaUsage } from "@/api/practiceTests";
import { familyHeading, testTypeColour, testTypeIcon, testTypeName } from "@/lib/testTypes";
import { tr } from "@/i18n/tr";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// What makes a mock different from practice, shown once above the list.
const RULES: [LucideIcon, () => string][] = [
  [Timer, () => tr("Timed like the real test")],
  [Lock, () => tr("Moves on with the timer: no Skip, no going back")],
  [EyeOff, () => tr("Questions you haven't seen")],
  [FileText, () => tr("Full report and level at the end")],
];

// The Mock Tests section: a dark exam-day banner with this month's mocks, the
// rules, and one row per exam with its last result and a direct Start button.
export function MockExamList({
  families,
  quota,
  history,
  openMock,
  onStart,
  phone = false,
}: {
  // On a phone mocks can't start: rows say so instead of Start/Resume.
  phone?: boolean;
  families: CatalogueFamily[];
  quota: QuotaUsage | null;
  history: HistoryEntry[];
  openMock: { sessionId: string; testTypeId: string | null } | null;
  onStart: (testTypeId: string) => void;
}) {
  const { t } = useTranslation();
  const mocks = history.filter((h) => h.deliveryMode === "mock");
  const left = quota && quota.mocksPerMonth !== null ? Math.max(0, quota.mocksPerMonth - quota.mocksUsed) : null;
  const best = mocks.reduce<string | null>((b, h) => (h.cefrLevel && (!b || LEVELS.indexOf(h.cefrLevel) > LEVELS.indexOf(b)) ? h.cefrLevel : b), null);
  const all = families.flatMap((f) => f.testTypes.map((tt) => ({ tt, family: f })));
  const inProgress = openMock?.testTypeId ? all.find((x) => x.tt.id === openMock.testTypeId)?.tt : undefined;

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-card text-white p-6 sm:p-8 shadow-sm" style={{ background: HERO_GRADIENT }}>
        <Timer size={220} strokeWidth={1} className="absolute -right-10 -bottom-14 text-white/[0.06] pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex-1 flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">{tr("Exam day practice")}</span>
            <h1 className="font-display font-bold text-3xl">{tr("Mock Tests")}</h1>
            <p className="text-sm text-white/80 max-w-xl leading-relaxed">
              {tr("Sit a full test under real conditions. You get your estimated level and a report with every answer you got wrong or skipped.")}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:w-[420px]">
            <Fact
              value={left === null ? "∞" : `${left}`}
              label={left === null ? tr("Mocks this month") : tr("Mocks left this month", { count: left })}
              note={quota?.mocksPerMonth != null ? tr("of {{n}}", { n: quota.mocksPerMonth }) : tr("no limit")}
            />
            <Fact value={`${mocks.length}`} label={tr("Mocks taken")} />
            <Fact value={best ?? "—"} label={tr("Best predicted level")} />
          </div>
        </div>
        {quota && quota.mocksPerMonth !== null && (
          <p className="relative mt-4 text-xs text-white/70 flex items-center gap-1.5">
            <CalendarClock size={13} /> {tr("New mocks on {{date}}", { date: formatShortDate(quota.resetsOn) })}
          </p>
        )}
      </section>

      <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {RULES.map(([Icon, label]) => (
          <li key={label()} className="flex items-center gap-2.5 bg-surface border border-rule rounded-card px-4 py-3 text-sm text-ink">
            <span className="h-8 w-8 rounded-full bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
              <Icon size={16} />
            </span>
            {label()}
          </li>
        ))}
      </ul>

      {inProgress && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-warning/10 border border-warning/30 rounded-card px-5 py-4">
          <Timer size={20} className="text-warning shrink-0" />
          <span className="flex-1 text-sm text-ink">{tr("You have a mock test in progress: {{name}}. Its clock keeps running.", { name: testTypeName(inProgress, t) })}</span>
          {phone ? (
            <span className="text-xs text-muted shrink-0">{tr("Resume on a computer")}</span>
          ) : (
            <Button onClick={() => onStart(inProgress.id)} className="shrink-0">
              {tr("Resume mock test")}
            </Button>
          )}
        </div>
      )}

      {families.map((family) => (
        <section key={family.id} className="flex flex-col gap-3">
          <h2 className="font-display font-bold text-lg text-ink">{familyHeading(family, true)}</h2>
          <div className="flex flex-col gap-3">
            {family.testTypes.map((tt) => (
              <MockRow
                key={tt.id}
                tt={tt}
                last={mocks.find((h) => h.testTypeId === tt.id) ?? null}
                taken={mocks.filter((h) => h.testTypeId === tt.id).length}
                blockedBy={
                  phone
                    ? tr("Computer only")
                    : openMock?.testTypeId && openMock.testTypeId !== tt.id
                      ? tr("Finish your other mock first")
                      : left === 0 && openMock?.testTypeId !== tt.id
                        ? tr("No mocks left this month")
                        : null
                }
                resume={openMock?.testTypeId === tt.id}
                onStart={() => onStart(tt.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Fact({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="rounded-card bg-white/10 border border-white/15 px-3 py-3 flex flex-col">
      <span className="font-display font-bold text-2xl leading-none">
        {value}
        {note && <span className="text-xs font-normal text-white/70 ml-1">{note}</span>}
      </span>
      <span className="text-[11px] text-white/75 mt-1.5 leading-tight">{label}</span>
    </div>
  );
}

function MockRow({
  tt,
  last,
  taken,
  blockedBy,
  resume,
  onStart,
}: {
  tt: CatalogueTestType;
  last: HistoryEntry | null;
  taken: number;
  blockedBy: string | null;
  resume: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const Icon = testTypeIcon(tt.id);
  const live = tt.status === "live" && tt.allowed && tt.inPlan !== false;
  return (
    <div className={`relative overflow-hidden bg-surface border border-rule rounded-card p-5 flex flex-col md:flex-row md:items-center gap-4 shadow-sm ${live ? "" : "opacity-55"}`}>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${testTypeColour(tt.id)}`} />
      <span className={`h-12 w-12 rounded-2xl flex items-center justify-center text-white shrink-0 ml-1 ${testTypeColour(tt.id)}`}>
        <Icon size={22} />
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <span className="font-display font-bold text-base text-ink">{testTypeName(tt, t)}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock size={12} /> {tr("{{m}} min", { m: tt.durationMinutes })}
          </span>
          <span>·</span>
          <span>
            {tr("Levels {{from}}-{{to}}", { from: tt.cefrMin, to: tt.cefrMax })}
          </span>
          <span>·</span>
          <span className="capitalize">{tt.skills.join(", ")}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm md:w-56 shrink-0">
        {last ? (
          <>
            <CheckCircle2 size={16} className="text-success shrink-0" />
            <span className="text-ink">
              {tr("Last: predicted {{level}}", { level: last.cefrLevel ?? "—" })}
              <span className="block text-xs text-muted">
                {formatShortDate(last.completedAt)} · {tr("{{n}} taken", { n: taken })}
              </span>
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-muted">
            <Award size={16} /> {tr("Not taken yet")}
          </span>
        )}
      </div>
      <div className="md:w-48 shrink-0 flex md:justify-end">
        {!live ? (
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {tt.status !== "live" ? tr("Coming soon") : tt.inPlan === false && tt.allowed ? tr("Not in your plan") : t("practiceTests.notEnabled")}
          </span>
        ) : blockedBy ? (
          <span className="text-xs text-muted">{blockedBy}</span>
        ) : (
          <Button onClick={onStart} className="flex items-center gap-1.5 w-full md:w-auto justify-center">
            <PlayCircle size={16} /> {resume ? tr("Resume mock test") : tr("Start mock test")}
          </Button>
        )}
      </div>
    </div>
  );
}
