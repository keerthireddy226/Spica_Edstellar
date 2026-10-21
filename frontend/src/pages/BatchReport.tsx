import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown, Download, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { ScoreReport } from "@/components/report/ScoreReport";
import {
  getBatchLearner,
  getBatchLearnerReport,
  getBatchReport,
  type BatchLearnerData,
  type BatchReport,
  type BatchReportLearner,
  type BatchReportPeriod,
  type GoalStatus,
  type ReportSkill,
} from "@/api/analytics";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";
import { CertifiedCell } from "@/components/CertifiedCell";

// The Batch report: what a batch did in a period, where its learners started
// and are now, who reached the goal and who needs attention. Org Admins and
// Managers open it from Analytics; Download PDF prints it on A4 pages.

const SKILLS: ReportSkill[] = ["speaking", "listening", "reading", "writing"];
const LEVELS = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"];
// Each level a stronger shade of the brand colour.
const LEVEL_FILL = [8, 18, 32, 50, 70, 88, 100];
const levelStyle = (level: string) => {
  const i = Math.max(0, LEVELS.indexOf(level));
  return {
    background: `color-mix(in srgb, var(--color-navy-deep) ${LEVEL_FILL[i]}%, var(--color-paper-warm))`,
    color: i >= 4 ? "#fff" : "var(--color-ink)",
  };
};
const SKILL_COLOUR: Record<ReportSkill, string> = {
  speaking: "var(--color-speaking)",
  listening: "var(--color-listening)",
  reading: "var(--color-reading)",
  writing: "var(--color-writing)",
};

// Dates in the app's language (set on <html lang> when it changes).
const locale = () => document.documentElement.lang || undefined;
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "—";
const shortDay = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(locale(), { day: "numeric", month: "short" });
const hours = (minutes: number) => (minutes >= 60 ? tr("{{h}} h", { h: Math.round(minutes / 60) }) : tr("{{m}} min", { m: minutes }));

function lastActive(l: BatchReportLearner): string {
  if (l.inactiveDays === null) return tr("Not started");
  if (l.inactiveDays === 0) return tr("Today");
  if (l.inactiveDays === 1) return tr("Yesterday");
  return tr("{{n}} days ago", { n: l.inactiveDays });
}

const GOAL_LABEL: Record<GoalStatus, () => string> = {
  reached: () => tr("Reached"),
  on_track: () => tr("On track"),
  at_risk: () => tr("At risk"),
  too_early: () => tr("Too early to tell"),
};
const GOAL_CLASS: Record<GoalStatus, string> = {
  reached: "text-success",
  on_track: "text-warning",
  at_risk: "text-error",
  too_early: "text-muted",
};

function Chip({ status }: { status: GoalStatus }) {
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-pill border border-current whitespace-nowrap ${GOAL_CLASS[status]}`}>
      {GOAL_LABEL[status]()}
    </span>
  );
}

function Card({ title, aside, children, className = "" }: { title?: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`br-card bg-surface border border-rule rounded-card p-5 sm:p-6 flex flex-col gap-4 min-w-0 ${className}`}>
      {title && (
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-display font-semibold text-lg text-ink">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Stat({ value, label, note }: { value: string; label: string; note: React.ReactNode }) {
  return (
    <div className="border border-rule rounded-xl p-3.5 flex flex-col gap-0.5 min-w-0">
      <span className="ld-stat font-display font-bold text-[28px] leading-tight text-ink tabular-nums">{value}</span>
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}

// Start and now for one skill: how many learners at each level.
function LevelStack({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return <div className="h-[22px] rounded-md bg-paper-warm text-[11px] text-muted flex items-center px-2">{tr("No level yet")}</div>;
  return (
    <div className="flex h-[22px] rounded-md overflow-hidden text-[11px] font-semibold">
      {LEVELS.filter((l) => counts[l]).map((l) => {
        const share = counts[l] / total;
        return (
          <div key={l} style={{ ...levelStyle(l), width: `${share * 100}%` }} className="flex items-center justify-center min-w-0 overflow-hidden whitespace-nowrap" title={`${l}: ${counts[l]}`}>
            {share >= 0.12 ? `${l} · ${counts[l]}` : counts[l]}
          </div>
        );
      })}
    </div>
  );
}

// Latest Spica scores in bins of 5 on the 10-90 scale, with the goal's first score marked.
function ScoreSpread({ scores, goalMin, goalLevel }: { scores: number[]; goalMin: number | null; goalLevel: string | null }) {
  const bins = Array.from({ length: 16 }, (_, i) => 10 + i * 5);
  const counts = bins.map((b) => scores.filter((s) => s >= b && (b === 85 ? s <= 90 : s < b + 5)).length);
  const max = Math.max(1, ...counts);
  return (
    <div>
      <div className="relative pt-5">
        <div className="grid gap-[3px] items-end h-[140px]" style={{ gridTemplateColumns: `repeat(${bins.length}, minmax(0, 1fr))` }}>
          {counts.map((c, i) => (
            <div
              key={bins[i]}
              className="relative rounded-t"
              style={{
                height: c ? `${(c / max) * 100}%` : "2px",
                background: goalMin !== null && bins[i] >= goalMin ? "var(--color-navy)" : "color-mix(in srgb, var(--color-ink) 14%, transparent)",
              }}
            >
              {c > 0 && <b className="absolute -top-[18px] inset-x-0 text-center text-[11px] font-semibold tabular-nums text-ink">{c}</b>}
            </div>
          ))}
        </div>
        {goalMin !== null && (
          <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-ink" style={{ left: `calc(${((goalMin - 10) / 80) * 100}% - 1px)` }}>
            <span className="absolute -top-1 left-1.5 text-[11px] font-semibold whitespace-nowrap bg-surface px-1 text-ink">
              {tr("{{level}} from {{n}}", { level: goalLevel, n: goalMin })}
            </span>
          </div>
        )}
      </div>
      <div className="flex justify-between font-mono text-[10.5px] text-muted mt-1">
        {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// Under the spread: how many learners are at each level now, and the middle and range of scores.
function SpreadSummary({ learners, scores, goalMin, goalLevel }: { learners: BatchReportLearner[]; scores: number[]; goalMin: number | null; goalLevel: string | null }) {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  const counts = LEVELS.map((lv) => [lv, learners.filter((l) => l.current?.level === lv).length] as const).filter(([, n]) => n > 0);
  const atGoal = goalMin !== null ? scores.filter((s) => s >= goalMin).length : null;
  return (
    <div className="flex flex-col gap-3 border-t border-rule pt-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-paper-warm py-2">
          <b className="block font-display text-lg text-ink tabular-nums">{mid}</b>
          <span className="text-xs text-muted">{tr("Middle score")}</span>
        </div>
        <div className="rounded-lg bg-paper-warm py-2">
          <b className="block font-display text-lg text-ink tabular-nums">{`${sorted[0]}–${sorted[sorted.length - 1]}`}</b>
          <span className="text-xs text-muted">{tr("Lowest to highest")}</span>
        </div>
        <div className="rounded-lg bg-paper-warm py-2">
          <b className="block font-display text-lg text-ink tabular-nums">{atGoal !== null ? `${atGoal} / ${scores.length}` : "—"}</b>
          <span className="text-xs text-muted">{goalLevel ? tr("At {{level}} or above", { level: goalLevel }) : tr("No goal set")}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Overall level now")}</span>
        <div className="flex flex-wrap gap-2">
          {counts.map(([lv, n]) => (
            <span key={lv} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-pill px-2.5 py-1" style={levelStyle(lv)}>
              {lv} <span className="font-normal">·</span> {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// The batch's average skill scores now (filled) and at the start (outline).
function SkillRadar({ profile }: { profile: BatchReport["profile"] }) {
  const { t } = useTranslation();
  const C = 110;
  const R = 90;
  const r = (s: number) => (Math.max(10, Math.min(90, s)) - 10) / 80 * R;
  // Speaking up, listening right, reading down, writing left.
  const dir: Record<ReportSkill, [number, number]> = { speaking: [0, -1], listening: [1, 0], reading: [0, 1], writing: [-1, 0] };
  const pts = (pick: (s: ReportSkill) => number | null) =>
    SKILLS.map((s) => {
      const v = pick(s);
      const [dx, dy] = dir[s];
      return `${C + dx * r(v ?? 10)},${C + dy * r(v ?? 10)}`;
    }).join(" ");
  const ring = (score: number) => pts(() => score);
  const hasStart = SKILLS.some((s) => profile[s].start !== null);
  return (
    <svg viewBox="-62 -6 344 248" className="w-full max-w-[300px] h-auto" role="img" aria-label={tr("Skill profile")}>
      {[40, 55, 70, 90].map((s) => (
        <polygon key={s} points={ring(s)} fill="none" stroke="var(--color-rule-strong)" strokeDasharray={s === 55 ? "3 3" : undefined} />
      ))}
      <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="var(--color-rule)" />
      <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="var(--color-rule)" />
      {hasStart && <polygon points={pts((s) => profile[s].start)} fill="color-mix(in srgb, var(--color-ink) 8%, transparent)" stroke="var(--color-muted)" strokeWidth={1.5} />}
      <polygon points={pts((s) => profile[s].now)} fill="color-mix(in srgb, var(--color-navy) 28%, transparent)" stroke="var(--color-navy)" strokeWidth={2} />
      <text x={C + 4} y={C - r(55) - 4} fontSize={10} fill="var(--color-muted)">B2</text>
      {SKILLS.map((s) => {
        const [dx, dy] = dir[s];
        const v = profile[s].now;
        return (
          <text
            key={s}
            x={C + dx * (R + 8)}
            y={C + dy * (R + 14) + (dy === 0 ? 4 : 0)}
            textAnchor={dx === 0 ? "middle" : dx > 0 ? "start" : "end"}
            fontSize={12}
            fontWeight={600}
            fill="var(--color-ink)"
          >
            {t(`skills.${s}`)} {v ?? "—"}
          </text>
        );
      })}
    </svg>
  );
}

const MAX_NAMES = 8;
function AttentionList({ title, tone, items }: { title: string; tone: "error" | "warning"; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={`br-avoid border border-rule border-l-4 rounded-xl px-4 py-3 flex flex-col gap-1.5 ${tone === "error" ? "border-l-error" : "border-l-warning"}`}>
      <h3 className="font-display font-semibold text-[15px] text-ink flex justify-between gap-2">
        {title} <span className="font-mono text-sm text-muted">{items.length}</span>
      </h3>
      <ul className="list-disc pl-5 text-sm text-ink flex flex-col gap-0.5">
        {items.slice(0, MAX_NAMES).map((x) => (
          <li key={x}>{x}</li>
        ))}
        {items.length > MAX_NAMES && <li className="list-none -ml-5 text-muted">{tr("and {{n}} more", { n: items.length - MAX_NAMES })}</li>}
      </ul>
    </div>
  );
}

export function BatchReportView({ data, onOpenLearner }: { data: BatchReport; onOpenLearner: (userId: string) => void }) {
  const { t } = useTranslation();
  const s = data.summary;
  const g = data.goalCounts;
  const learners = [...data.learners].sort((a, b) => (b.current?.score ?? -1) - (a.current?.score ?? -1) || a.name.localeCompare(b.name));
  const withLevel = learners.filter((l) => l.current).length;
  const best = SKILLS.filter((k) => data.profile[k].now !== null).sort((a, b) => data.profile[b].now! - data.profile[a].now!);
  const gain = (k: ReportSkill) => (data.profile[k].now !== null && data.profile[k].start !== null ? data.profile[k].now! - data.profile[k].start! : null);
  const delta = (n: number | null) => (n === null ? "" : n > 0 ? tr("+{{n}} since the start", { n }) : n < 0 ? tr("{{n}} since the start", { n }) : tr("Same as at the start"));
  const a = data.attention;

  return (
    <div className="flex flex-col gap-4">
      {/* Who, which test, the goal and the period. */}
      <Card>
        <div className="flex flex-col gap-1.5">
          <span className="font-logo font-bold text-2xl text-navy leading-none">Spica</span>
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted mt-2">{tr("Batch report")}</span>
          <h1 className="font-display font-bold text-[28px] leading-tight text-ink">{data.batch.name}</h1>
          <p className="text-sm text-muted">
            {[data.batch.organization, data.batch.testName, data.goal ? (data.goal.date ? tr("Goal {{level}} by {{date}}", { level: data.goal.level, date: day(data.goal.date) }) : tr("Goal {{level}}", { level: data.goal.level })) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3 border-t border-rule pt-4 text-sm">
          <div>
            <dd className="font-semibold text-ink">{`${day(data.period.from)} – ${day(data.period.to)}`}</dd>
            <dt className="text-xs text-muted">{tr("Period")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink">{s.learners === 1 ? tr("1 learner") : tr("{{n}} learners", { n: s.learners })}</dd>
            <dt className="text-xs text-muted">{data.batch.batchCode ?? tr("In the batch")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink">{data.goal?.daysLeft != null ? tr("{{n}} days", { n: data.goal.daysLeft }) : "—"}</dd>
            <dt className="text-xs text-muted">{tr("Left to the goal date")}</dt>
          </div>
          <div>
            <dd className="font-semibold text-ink">{data.batch.managers.join(", ") || "—"}</dd>
            <dt className="text-xs text-muted">{data.batch.managers.length > 1 ? tr("Managers") : tr("Manager")}</dt>
          </div>
        </dl>
      </Card>

      <Card title={tr("Summary")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3">
          <Stat value={String(s.active)} label={tr("Active learners")} note={tr("of {{n}}, practised in the last {{days}} days", { n: s.learners, days: s.activeDays })} />
          <Stat value={hours(s.practiceMinutes)} label={tr("Practice time")} note={s.learners ? tr("{{t}} a learner on average", { t: hours(Math.round(s.practiceMinutes / s.learners)) }) : "—"} />
          <Stat value={`${s.practiceTests} · ${s.mockTests}`} label={tr("Practice tests · mock tests")} note={tr("Finished in this period")} />
          <Stat
            value={s.scoreNow !== null ? String(s.scoreNow) : "—"}
            label={tr("Average Spica score")}
            note={
              s.scoreStart !== null && s.scoreNow !== null ? (
                <>
                  {tr("Was {{n}} at the start", { n: s.scoreStart })}{" "}
                  {s.scoreNow !== s.scoreStart && <b className={s.scoreNow > s.scoreStart ? "text-success" : "text-error"}>{`${s.scoreNow > s.scoreStart ? "+" : ""}${s.scoreNow - s.scoreStart}`}</b>}
                </>
              ) : (
                tr("From each learner's latest test")
              )
            }
          />
        </div>
      </Card>

      {data.goal && g && (
        <Card
          title={data.goal.date ? tr("Goal: {{level}} by {{date}}", { level: data.goal.level, date: day(data.goal.date) }) : tr("Goal: {{level}}", { level: data.goal.level })}
          aside={<span className="text-sm text-muted">{tr("{{n}} of {{total}} certified by a final assessment", { n: s.certified, total: s.learners })}</span>}
        >
          <div className="flex h-[30px] rounded-lg overflow-hidden text-[12.5px] font-semibold text-white">
            {(
              [
                [g.reached, "var(--color-success)", tr("{{n}} reached", { n: g.reached })],
                [g.onTrack, "var(--color-warning)", tr("{{n}} on track", { n: g.onTrack })],
                [g.atRisk, "var(--color-error)", tr("{{n}} at risk", { n: g.atRisk })],
                [g.tooEarly, "color-mix(in srgb, var(--color-ink) 30%, transparent)", tr("{{n}} too early to tell", { n: g.tooEarly })],
              ] as const
            )
              .filter(([n]) => n > 0)
              .map(([n, bg, label]) => (
                <div key={bg} className="flex items-center px-2.5 min-w-0 overflow-hidden whitespace-nowrap" style={{ width: `${(n / Math.max(1, s.learners)) * 100}%`, background: bg }} title={label}>
                  {n / Math.max(1, s.learners) >= 0.14 ? label : n}
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink">
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-success" />{tr("Reached: latest Spica score {{n}} or more", { n: data.goal.minScore ?? "—" })}</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-warning" />{tr("On track: their mock tests point to the goal by the date")}</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-error" />{tr("At risk: not at their current pace")}</span>
            {g.tooEarly > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <i className="w-2.5 h-2.5 rounded-sm" style={{ background: "color-mix(in srgb, var(--color-ink) 30%, transparent)" }} />
                {tr("Too early to tell: fewer than 2 mock tests")}
              </span>
            )}
          </div>
        </Card>
      )}

      <Card title={tr("Levels at the start and now")}>
        <p className="text-[13.5px] text-muted -mt-2">{tr("Start: each learner's first level test. Now: their latest mock test, or level test if they haven't taken one.")}</p>
        <div className="grid grid-cols-[88px_44px_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center text-[13px]">
          {SKILLS.map((k, i) => (
            <div key={k} className="contents">
              {i > 0 && <div className="col-span-3 h-2" />}
              <div className="row-span-2 font-semibold text-ink flex items-center gap-2 self-stretch">
                <i className="w-1 self-stretch rounded" style={{ background: SKILL_COLOUR[k] }} />
                {t(`skills.${k}`)}
              </div>
              <span className="text-xs text-muted">{tr("Start")}</span>
              <LevelStack counts={data.levels.start[k]} />
              <span className="text-xs text-muted">{tr("Now")}</span>
              <LevelStack counts={data.levels.now[k]} />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink">
          {LEVELS.filter((l) => SKILLS.some((k) => data.levels.start[k][l] || data.levels.now[k][l])).map((l) => (
            <span key={l} className="inline-flex items-center gap-1.5">
              <i className="w-2.5 h-2.5 rounded-sm" style={{ background: levelStyle(l).background }} />
              {l}
            </span>
          ))}
          <span className="text-muted">{tr("Numbers are learners.")}</span>
        </div>
      </Card>

      <div className="br-page grid grid-cols-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] print:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
        <Card title={tr("Spread of Spica scores")}>
          <p className="text-[13.5px] text-muted -mt-2">{tr("Each learner's latest score on the 10–90 scale ({{n}} of {{total}} have one).", { n: data.scores.length, total: s.learners })}</p>
          <ScoreSpread scores={data.scores} goalMin={data.goal?.minScore ?? null} goalLevel={data.goal?.level ?? null} />
          <SpreadSummary learners={data.learners} scores={data.scores} goalMin={data.goal?.minScore ?? null} goalLevel={data.goal?.level ?? null} />
        </Card>
        <Card title={tr("Skill profile")}>
          <div className="flex flex-col items-center gap-2">
            <SkillRadar profile={data.profile} />
            <div className="flex gap-4 text-[13px] text-ink">
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-navy" />{tr("Now")}</span>
              <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-muted" />{tr("At the start")}</span>
            </div>
            {best.length >= 2 && (
              <div className="grid grid-cols-2 gap-2.5 w-full text-[13px]">
                {[
                  [tr("Strongest"), best[0]],
                  [tr("Weakest"), best[best.length - 1]],
                ].map(([label, k]) => (
                  <div key={label} className="border border-rule rounded-lg px-3 py-2">
                    <span className="text-muted">{label}</span>
                    <b className="block font-display text-[15px] text-ink">{`${t(`skills.${k}`)} · ${data.profile[k as ReportSkill].now}`}</b>
                    <span className="text-muted">{delta(gain(k as ReportSkill))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title={tr("Needs attention")}>
        {a.inactive.length + a.offPace.length + a.accessEnding.length + a.missedMock.length + a.quiet.length + a.noMock.length + a.dropped.length === 0 ? (
          <p className="text-sm text-muted">{tr("Nobody needs attention right now.")}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-3">
            <AttentionList
              title={tr("Not practising")}
              tone="error"
              items={a.inactive.map((x) => (x.days === null ? tr("{{name}}: hasn't started", { name: x.name }) : tr("{{name}}: last active {{n}} days ago", { name: x.name, n: x.days })))}
            />
            <AttentionList
              title={data.goal?.date ? tr("Won't reach {{level}} by {{date}} at this pace", { level: data.goal.level, date: shortDay(data.goal.date) }) : tr("Won't reach the goal at this pace")}
              tone="error"
              items={a.offPace.map((x) => (x.score !== null && x.needs ? tr("{{name}}: {{score}}, needs +{{n}}", { name: x.name, score: x.score, n: x.needs }) : x.name))}
            />
            <AttentionList
              title={tr("Access ends within {{n}} days", { n: a.accessEndingDays })}
              tone="warning"
              items={a.accessEnding.map((x) => tr("{{name}}: ends {{date}}", { name: x.name, date: shortDay(x.endsAt) }))}
            />
            <AttentionList
              title={tr("Missed a planned mock test")}
              tone="warning"
              items={a.missedMock.map((x) => (x.last ? tr("{{name}}: planned for {{date}}", { name: x.name, date: shortDay(x.last) }) : x.name))}
            />
            <AttentionList
              title={tr("Score dropped since the start")}
              tone="error"
              items={a.dropped.map((x) => tr("{{name}}: {{from}} → {{to}}", { name: x.name, from: x.from, to: x.to }))}
            />
            <AttentionList
              title={tr("Quiet for a week or more")}
              tone="warning"
              items={a.quiet.map((x) => tr("{{name}}: last active {{n}} days ago", { name: x.name, n: x.days }))}
            />
            <AttentionList
              title={tr("No mock test yet")}
              tone="warning"
              items={a.noMock.map((x) => (x.level ? tr("{{name}}: {{level}} from the level test only", { name: x.name, level: x.level }) : x.name))}
            />
          </div>
        )}
      </Card>

      <Card
        className="br-page br-flow"
        title={tr("Learners")}
        aside={
          <span className="text-[13px] text-muted print:hidden">
            {tr("Click a name to open the learner's report")}
          </span>
        }
      >
        <div className="overflow-x-auto print:overflow-visible border border-rule rounded-xl">
          <table className="w-full min-w-[720px] print:min-w-0 text-[13.5px] border-collapse">
            <thead>
              <tr className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap">
                <th className="px-3 py-2.5">{tr("Learner")}</th>
                <th className="px-3 py-2.5">{tr("Level")}</th>
                <th className="px-3 py-2.5">{tr("Spica score")}</th>
                <th className="px-3 py-2.5">{tr("Certified")}</th>
                <th className="px-3 py-2.5">{tr("Tests · mocks")}</th>
                <th className="px-3 py-2.5">{tr("Practice")}</th>
                {data.goal && <th className="px-3 py-2.5">{tr("Goal")}</th>}
                <th className="px-3 py-2.5">{tr("Last active")}</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr key={l.id} className="br-row border-t border-rule align-middle">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenLearner(l.id)}
                      className="font-semibold text-ink whitespace-nowrap underline decoration-rule-strong underline-offset-[3px] hover:decoration-navy cursor-pointer text-left"
                    >
                      {l.name}
                    </button>
                    {l.participantId && <span className="block text-xs text-muted font-mono">{l.participantId}</span>}
                  </td>
                  <td className="px-3 py-2.5 font-display font-semibold whitespace-nowrap text-ink">
                    {l.current?.level ? (
                      l.start?.level && l.start.level !== l.current.level ? (
                        <>
                          <span className="text-muted font-medium">{l.start.level} →</span> {l.current.level}
                        </>
                      ) : (
                        l.current.level
                      )
                    ) : (
                      <span className="text-muted font-medium">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.current?.score != null ? (
                      <div className="flex items-center gap-2">
                        <b className="tabular-nums min-w-[22px] text-ink">{l.current.score}</b>
                        <span className="w-[64px] h-1.5 rounded-pill bg-paper-warm overflow-hidden">
                          <i className="block h-full rounded-pill bg-navy" style={{ width: `${((l.current.score - 10) / 80) * 100}%` }} />
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <CertifiedCell c={l.certified} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-ink">{`${l.practiceTests} · ${l.mockTests}`}</td>
                  <td className="px-3 py-2.5 tabular-nums text-ink whitespace-nowrap">{l.minutes ? hours(l.minutes) : "—"}</td>
                  {data.goal && <td className="px-3 py-2.5">{l.goal ? <Chip status={l.goal} /> : "—"}</td>}
                  <td className="px-3 py-2.5 whitespace-nowrap text-ink">{lastActive(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {withLevel < learners.length && (
          <p className="text-[13px] text-muted">
            {learners.length - withLevel === 1
              ? tr("1 learner has no level yet: they haven't taken a level test or mock test.")
              : tr("{{n}} learners have no level yet: they haven't taken a level test or mock test.", { n: learners.length - withLevel })}
          </p>
        )}
      </Card>

      <div className="br-avoid text-[12.5px] text-muted flex flex-col gap-1.5 px-1">
        <p>{tr("Spica scores run from 10 to 90: Pre-A1 10–19, A1 20–29, A2 30–39, B1 40–54, B2 55–69, C1 70–79, C2 80–90. Practice time counts Practice Modules, practice tests and mock tests.")}</p>
        <p>{tr("Generated {{date}} by Spica for {{org}}.", { date: day(data.generatedAt), org: data.batch.organization })}</p>
      </div>
    </div>
  );
}

// Printed (Download PDF): A4, colours kept, the light palette whatever the
// screen theme, and a table frame whose empty header and footer rows repeat
// on every page as its top and bottom margins (the page itself has none, so
// browsers print no date or address lines).
const PRINT_CSS = `
.br-frame, .br-frame > thead, .br-frame > tbody, .br-frame > tfoot, .br-frame > * > tr, .br-frame > * > tr > td { display: block; }
.br-frame .br-gap { display: none; }
@media print {
  @page { size: A4; margin: 0; }
  html, body, #root { background: #fff !important; height: auto !important; overflow: visible !important; }
  .batch-report {
    --color-ink: #2e2419; --color-paper: #f3ebd8; --color-paper-warm: #efe4cc; --color-surface: #ffffff;
    --color-rule: rgba(46, 36, 25, 0.1); --color-rule-strong: rgba(46, 36, 25, 0.18); --color-muted: #7d6f5b;
    --color-navy: #c97c5c; --color-navy-deep: #a8613f; --color-success: #6e9660; --color-warning: #c9902f; --color-error: #c15c4a;
    --color-speaking: #d9713d; --color-listening: #6e9660; --color-reading: #d39a3c; --color-writing: #cf7f62;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; background: #fff; color: var(--color-ink); font-size: 12.5px;
    padding: 0 !important; max-width: none !important;
  }
  .br-frame { display: table; width: 100%; border-collapse: collapse; }
  .br-frame > thead { display: table-header-group; }
  .br-frame > tbody { display: table-row-group; }
  .br-frame > tfoot { display: table-footer-group; }
  .br-frame > * > tr { display: table-row; }
  .br-frame > * > tr > td { display: table-cell; padding: 0 12mm; }
  .br-frame .br-gap { display: table-cell; height: 10mm; padding: 0; }
  .batch-report .br-card { padding: 14px 16px; gap: 10px; border-radius: 12px; }
  .batch-report .br-card:not(.br-flow), .batch-report .br-avoid, .batch-report .br-row { break-inside: avoid; }
  /* The learner table runs over several pages: no card box to break open. */
  .batch-report .br-flow { border: 0; padding: 0; background: none; }
  .batch-report .br-page { break-before: page; }
  .batch-report table thead { display: table-header-group; }
  /* A learner's report open over the page prints on its own. */
  .batch-report[data-modal] > .br-frame, .batch-report[data-modal] > .br-toolbar { display: none !important; }
  .batch-report .br-modal { position: static !important; background: none !important; padding: 10mm 12mm !important; overflow: visible !important; display: block !important; }
  .batch-report .br-modal-panel { max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; background: none !important; }
}`;

export function BatchReportPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<BatchReportPeriod>("since_start");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<BatchReport | null>(null);
  const [error, setError] = useState(false);
  const back = user?.role === "manager" ? ROUTES.MANAGER_ANALYTICS : ROUTES.ORG_ADMIN_ANALYTICS;
  // Download PDF: the summarised report (this page), or the detailed one with a page per learner.
  const [menuOpen, setMenuOpen] = useState(false);
  const [printKind, setPrintKind] = useState<"summary" | "detailed" | null>(null);
  const [detailData, setDetailData] = useState<BatchReport | null>(null);
  const [preparing, setPreparing] = useState(false);
  // A learner's report, shown over the page.
  const [openLearner, setOpenLearner] = useState<string | null>(null);
  useEffect(() => setDetailData(null), [id, period, from, to]);
  useEffect(() => {
    if (!printKind || (printKind === "detailed" && !detailData)) return;
    // Let the learner pages render before the print window opens.
    const t = setTimeout(() => {
      window.print();
      setPrintKind(null);
    }, 300);
    return () => clearTimeout(t);
  }, [printKind, detailData]);
  async function download(kind: "summary" | "detailed") {
    setMenuOpen(false);
    if (kind === "detailed" && !detailData) {
      setPreparing(true);
      try {
        setDetailData(await getBatchReport(id, { period, from, to, detail: true }));
      } catch {
        setPreparing(false);
        return;
      }
      setPreparing(false);
    }
    setPrintKind(kind);
  }

  useEffect(() => {
    if (period === "custom" && !(from && to)) return;
    let live = true;
    setError(false);
    getBatchReport(id, { period, from, to })
      .then((r) => live && setData(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [id, period, from, to]);

  useEffect(() => {
    if (data) document.title = `${data.batch.name} · ${tr("Batch report")}`;
  }, [data]);

  return (
    <div className="batch-report min-h-screen bg-paper" data-modal={openLearner ? "" : undefined}>
      <style>{PRINT_CSS}</style>
      {openLearner && <LearnerModal batchId={id} userId={openLearner} onClose={() => setOpenLearner(null)} />}
      <div className="br-toolbar print:hidden sticky top-0 z-10 bg-paper/95 backdrop-blur border-b border-rule">
        <div className="max-w-[1000px] mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <button onClick={() => navigate(`${back}?tab=batches&batch=${id}`)} className="flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-navy cursor-pointer">
            <ArrowLeft size={16} /> {tr("Analytics")}
          </button>
          <div className="flex-1" />
          <label className="text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="br-period">
            {tr("Period")}
          </label>
          <select
            id="br-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as BatchReportPeriod)}
            className="rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer"
          >
            <option value="since_start">{tr("Since the batch started")}</option>
            <option value="last_30">{tr("Last 30 days")}</option>
            <option value="quarter">{tr("This quarter")}</option>
            <option value="custom">{tr("Choose dates")}</option>
          </select>
          {period === "custom" && (
            <>
              <input id="br-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr("From")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink" />
              <input id="br-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={tr("To")} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink" />
            </>
          )}
          <div className="relative">
            <Button onClick={() => setMenuOpen((o) => !o)} disabled={!data || preparing} aria-expanded={menuOpen} className="flex items-center gap-2 !px-4 !py-2 !text-sm">
              <Download size={15} /> {preparing ? tr("Preparing…") : tr("Download PDF")} <ChevronDown size={15} />
            </Button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-[320px] bg-surface border border-rule rounded-xl shadow-lg p-1.5 flex flex-col z-20">
                {(
                  [
                    ["summary", tr("Summarised report"), tr("The batch's overall results: summary, goal, levels, scores, who needs attention and the learner list.")],
                    ["detailed", tr("Detailed report"), tr("The summary, then a page for each learner: skill scores and levels, performance, strengths and areas to improve.")],
                  ] as const
                ).map(([kind, label, note]) => (
                  <button key={kind} onClick={() => download(kind)} className="text-left rounded-lg px-3 py-2.5 hover:bg-paper-warm cursor-pointer">
                    <span className="block text-sm font-semibold text-ink">{label}</span>
                    <span className="block text-xs text-muted">{note}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <table className="br-frame">
        <thead>
          <tr>
            <td className="br-gap" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="max-w-[1000px] mx-auto px-4 py-5 print:p-0">
                {error ? (
                  <p className="text-sm text-error">{tr("This report isn't available.")}</p>
                ) : data ? (
                  <>
                    <BatchReportView data={data} onOpenLearner={setOpenLearner} />
                    {/* The detailed PDF: a page for each learner after the summary. */}
                    {printKind === "detailed" && detailData && (
                      <div className="hidden print:block">
                        {[...detailData.learners]
                          .sort((a, b) => (b.current?.score ?? -1) - (a.current?.score ?? -1) || a.name.localeCompare(b.name))
                          .map((l) => (
                            <div key={l.id} className="br-page">
                              <LearnerDetail l={l} batch={detailData.batch} goal={detailData.goal} batchId={id} canOpenReports={false} />
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted">{tr("Loading…")}</p>
                )}
              </div>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="br-gap" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// A learner's score report opened from the Batch report.
export function BatchLearnerReportPage() {
  const { id = "", sessionId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Awaited<ReturnType<typeof getBatchLearnerReport>> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getBatchLearnerReport(id, sessionId)
      .then(setData)
      .catch(() => setError(true));
  }, [id, sessionId]);
  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[1000px] mx-auto px-4 py-5 flex flex-col gap-4">
        <button onClick={() => navigate(`/batch-report/${id}`)} className="print:hidden self-start flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-navy cursor-pointer">
          <ArrowLeft size={16} /> {tr("Batch report")}
        </button>
        {error ? (
          <p className="text-sm text-error">{tr("This report isn't available.")}</p>
        ) : data ? (
          <ScoreReport score={data.score} about={data.about} analysis={data.analysis} viewer="org" />
        ) : (
          <p className="text-sm text-muted">{tr("Loading…")}</p>
        )}
      </div>
    </div>
  );
}

const VS_GOAL: Record<"above" | "meets" | "below", { label: () => string; cls: string }> = {
  above: { label: () => tr("Above goal"), cls: "text-success" },
  meets: { label: () => tr("Meets goal"), cls: "text-success" },
  below: { label: () => tr("Below goal"), cls: "text-error" },
};

// A learner's mock test scores over time, with the goal's first score.
function ScoreTrend({ mocks, goalMin }: { mocks: BatchReportLearner["mocks"]; goalMin: number | null }) {
  const pts = mocks.filter((m) => m.score !== null) as { date: string; score: number; level: string | null }[];
  if (!pts.length) return <p className="text-sm text-muted">{tr("No mock test yet.")}</p>;
  const W = 320;
  const H = 110;
  // The scale fits the scores (and the goal), so small gains show.
  const vals = [...pts.map((p) => p.score), ...(goalMin !== null ? [goalMin] : [])];
  const lo = Math.max(10, Math.min(...vals) - 6);
  const hi = Math.min(90, Math.max(...vals) + 6);
  const y = (s: number) => H - 16 - ((s - lo) / Math.max(1, hi - lo)) * (H - 36);
  const x = (i: number) => (pts.length === 1 ? W / 2 : 28 + (i * (W - 56)) / (pts.length - 1));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[420px] print:max-w-[280px] h-auto" role="img" aria-label={tr("Mock test scores")}>
      {goalMin !== null && (
        <>
          <line x1={0} x2={W} y1={y(goalMin)} y2={y(goalMin)} stroke="var(--color-ink)" strokeDasharray="4 4" opacity={0.5} />
          <text x={W - 2} y={y(goalMin) - 4} textAnchor="end" fontSize={10} fill="var(--color-muted)">
            {goalMin}
          </text>
        </>
      )}
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke="var(--color-navy)" strokeWidth={2.5} />
      {pts.map((p, i) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.score)} r={4} fill="var(--color-navy)" />
          <text x={x(i)} y={y(p.score) - 9} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-ink)">
            {p.score}
          </text>
          <text x={x(i)} y={H - 1} textAnchor="middle" fontSize={10} fill="var(--color-muted)">
            {shortDay(p.date)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// One learner: each skill's level and Spica score, start and now, against the
// goal; performance; strengths and areas to improve. On its own page (a new
// tab from the Batch report) and once per learner in the detailed PDF.
export function LearnerDetail({
  l,
  batch,
  goal,
  batchId,
  canOpenReports,
  compact = false,
}: {
  l: BatchReportLearner;
  batch: BatchReport["batch"];
  goal: BatchReport["goal"];
  batchId: string;
  canOpenReports: boolean;
  // Tighter, for the popup.
  compact?: boolean;
}) {
  const { t } = useTranslation();
  // What needs attention for this learner.
  const endsInDays = l.accessEndsAt ? (Date.parse(l.accessEndsAt) - Date.now()) / 86_400_000 : null;
  const flags = [
    l.inactiveDays === null ? tr("Hasn't started yet.") : l.inactiveDays >= 14 ? tr("Not practising: last active {{n}} days ago.", { n: l.inactiveDays }) : l.inactiveDays >= 7 ? tr("Quiet: last active {{n}} days ago.", { n: l.inactiveDays }) : null,
    l.goal === "at_risk" && goal ? tr("Won't reach {{level}} by the goal date at this pace.", { level: goal.level }) : null,
    l.start?.score != null && l.current?.score != null && l.current.score - l.start.score <= -3 ? tr("Spica score dropped from {{from}} to {{to}}.", { from: l.start.score, to: l.current.score }) : null,
    l.inactiveDays !== null && l.mocks.length === 0 ? tr("No mock test yet, so progress can't be tracked.") : null,
    l.missedMocks > 0 ? tr("Missed a planned mock test.") : null,
    endsInDays !== null && endsInDays >= 0 && endsInDays <= 14 ? tr("Access ends {{date}}.", { date: day(l.accessEndsAt) }) : null,
  ].filter((x): x is string => !!x);
  const ins = l.insights;
  const change = l.current?.score != null && l.start?.score != null ? l.current.score - l.start.score : null;
  const skillName = (k: ReportSkill) => t(`skills.${k}`);
  const strengths = [
    ...(ins?.strongSkills ?? []).map((k) => {
      const s = ins!.skills.find((x) => x.skill === k)!;
      return s.change !== null && s.change > 0
        ? tr("{{skill}}: {{level}}, score {{score}} (+{{n}} since the start)", { skill: skillName(k), level: s.level, score: s.score, n: s.change })
        : tr("{{skill}}: {{level}}, score {{score}}", { skill: skillName(k), level: s.level, score: s.score });
    }),
    ...(ins?.strongTypes ?? []).map((x) => tr("{{type}} ({{skill}}): {{right}} of {{total}} right", { type: x.type, skill: skillName(x.skill), right: x.right, total: x.total })),
  ];
  const improve = [
    ...(ins?.weakSkills ?? []).map((w) => {
      const s = ins!.skills.find((x) => x.skill === w.skill)!;
      return w.gap && w.target
        ? tr("{{skill}}: {{level}}, score {{score}}, needs +{{n}} for {{goal}}", { skill: skillName(w.skill), level: s.level, score: s.score, n: w.gap, goal: w.target })
        : tr("{{skill}}: {{level}}, score {{score}}", { skill: skillName(w.skill), level: s.level, score: s.score });
    }),
    ...(ins?.focusTypes ?? []).map((x) => tr("{{type}} ({{skill}}): {{right}} of {{total}} right", { type: x.type, skill: skillName(x.skill), right: x.right, total: x.total })),
  ];
  return (
    <div className={`flex flex-col ${compact ? "ld-compact gap-3" : "gap-4"}`}>
      <Card>
        <div className="flex flex-wrap print:flex-nowrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="font-logo font-bold text-xl text-navy leading-none">Spica</span>
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted mt-2">{tr("Learner report")}</span>
            <h1 className="font-display font-bold text-[26px] leading-tight text-ink">{l.name}</h1>
            <p className="text-sm text-muted">
              {[l.participantId, batch.name, batch.testName, goal ? (goal.date ? tr("Goal {{level}} by {{date}}", { level: goal.level, date: day(goal.date) }) : tr("Goal {{level}}", { level: goal.level })) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-ink">
              {l.start?.level && l.current?.level ? (
                <span>
                  {tr("Start {{level}} · {{score}}", { level: l.start.level, score: l.start.score ?? "—" })} → <b>{tr("Now {{level}} · {{score}}", { level: l.current.level, score: l.current.score ?? "—" })}</b>
                  {change !== null && change !== 0 && <b className={change > 0 ? "text-success" : "text-error"}>{` (${change > 0 ? "+" : ""}${change})`}</b>}
                </span>
              ) : null}
              {l.goal && <Chip status={l.goal} />}
              {l.projected && <span className="text-muted">{tr("Trend reaches {{level}} by the goal date", { level: l.projected })}</span>}
            </div>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-paper-warm px-6 py-3 min-w-[130px] shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{tr("Spica score")}</span>
            <span className="ld-score font-display font-bold text-[44px] leading-none text-ink tabular-nums">{l.current?.score ?? "—"}</span>
            <span className="text-xs text-muted">{tr("out of 90")}</span>
            {l.current?.level && <span className="font-display font-bold text-navy-deep">{tr("CEFR {{level}}", { level: l.current.level })}</span>}
          </div>
        </div>
      </Card>

      <Card title={tr("Skills")} aside={<span className="text-[13px] text-muted">{l.levelSource === "mock" ? tr("From the latest mock test") : l.levelSource === "level_test" ? tr("From the latest level test") : ""}</span>}>
        {ins?.skills.length ? (
          <div className={`grid grid-cols-1 ${compact ? "grid-cols-2 sm:grid-cols-4 gap-2" : "sm:grid-cols-2 gap-3"} print:grid-cols-4 print:gap-2`}>
            {ins.skills.map((s) => (
              <div key={s.skill} className={`br-avoid border border-rule rounded-xl ${compact ? "p-2.5 gap-1.5" : "p-3.5 gap-2"} print:p-2.5 print:gap-1.5 flex flex-col min-w-0`} style={{ borderTop: `4px solid ${SKILL_COLOUR[s.skill]}` }}>
                <div className="flex flex-col items-start gap-1">
                  <span className="font-semibold text-ink">{skillName(s.skill)}</span>
                  {s.vsGoal && (
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-pill border border-current whitespace-nowrap ${VS_GOAL[s.vsGoal].cls}`}>{VS_GOAL[s.vsGoal].label()}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-3">
                  <span className="ld-level font-display font-bold text-[26px] leading-none text-ink">{s.level}</span>
                  <span className="text-sm text-muted">{tr("score {{n}}", { n: s.score })}</span>
                </div>
                <div className="relative h-2 rounded-pill bg-paper-warm">
                  <i className="absolute inset-y-0 left-0 rounded-pill" style={{ width: `${((s.score - 10) / 80) * 100}%`, background: SKILL_COLOUR[s.skill] }} />
                  {goal?.minScore != null && <i className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${((goal.minScore - 10) / 80) * 100}%` }} />}
                </div>
                <span className="text-xs text-muted">
                  {s.startLevel
                    ? s.change
                      ? tr("Start {{level}} · {{score}}, {{change}} since then", { level: s.startLevel, score: s.startScore ?? "—", change: `${s.change > 0 ? "+" : ""}${s.change}` })
                      : tr("Start {{level}} · {{score}}, no change", { level: s.startLevel, score: s.startScore ?? "—" })
                    : tr("No starting level")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{tr("No level yet: this learner hasn't taken a level test or mock test.")}</p>
        )}
      </Card>

      <Card title={tr("Performance")}>
        <div className="grid grid-cols-2 sm:grid-cols-4 print:grid-cols-4 gap-3">
          <Stat value={String(l.practiceTests)} label={tr("Practice tests")} note={tr("Finished in this period")} />
          <Stat value={String(l.mockTests)} label={tr("Mock tests")} note={tr("Finished in this period")} />
          <Stat value={l.minutes ? hours(l.minutes) : "—"} label={tr("Practice time")} note={tr("In this period")} />
          <Stat value={lastActive(l)} label={tr("Last active")} note={l.accessEndsAt ? tr("Access until {{date}}", { date: day(l.accessEndsAt) }) : "—"} />
        </div>
        <p className="text-sm text-ink">
          <span className="font-semibold">{tr("Final assessment")}:</span>{" "}
          {l.certified ? (
            <a href={`/certificate/${l.certified.code}`} target="_blank" rel="noopener" className="font-semibold text-success hover:underline">
              {l.certified.score !== null
                ? tr("Certified {{level}} · Spica score {{score}}", { level: l.certified.level ?? "—", score: l.certified.score })
                : tr("Certified {{level}}", { level: l.certified.level ?? "—" })}
            </a>
          ) : (
            <span className="text-muted">{tr("Not certified yet")}</span>
          )}
        </p>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-ink">{tr("Mock test scores")}</span>
          <div className={compact ? "max-w-[340px]" : ""}>
            <ScoreTrend mocks={l.mocks} goalMin={goal?.minScore ?? null} />
          </div>
        </div>
      </Card>

      <Card title={tr("Needs attention")}>
        {flags.length ? (
          <ul className="flex flex-col gap-1.5 text-sm text-ink">
            {flags.map((f) => (
              <li key={f} className="flex items-start gap-2">
                <i className="mt-1.5 h-2 w-2 rounded-full bg-error shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-success">{tr("Nothing needs attention: active, tested and on course.")}</p>
        )}
      </Card>

      <div className={`grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 ${compact ? "gap-3" : "gap-4"}`}>
        <Card title={tr("Strengths")}>
          {strengths.length ? (
            <ul className="list-disc pl-5 text-sm text-ink flex flex-col gap-1">
              {strengths.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{tr("Not enough results yet.")}</p>
          )}
        </Card>
        <Card title={tr("Areas to improve")}>
          {improve.length ? (
            <ul className="list-disc pl-5 text-sm text-ink flex flex-col gap-1">
              {improve.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{tr("Not enough results yet.")}</p>
          )}
        </Card>
      </div>

      {canOpenReports && l.reportSessionId && (
        <Link to={`/batch-report/${batchId}/reports/${l.reportSessionId}`} className="print:hidden self-start text-sm font-semibold text-navy-deep hover:underline">
          {tr("Open the full score report of the latest mock test")}
        </Link>
      )}
    </div>
  );
}

// The popup's learner report: smaller type and tighter boxes.
const COMPACT_CSS = `
.ld-compact .br-card { padding: 14px 16px; gap: 10px; border-radius: 14px; }
.ld-compact h1 { font-size: 21px; }
.ld-compact h2 { font-size: 15px; }
.ld-compact .ld-score { font-size: 34px; }
.ld-compact .ld-level { font-size: 20px; }
.ld-compact .ld-stat { font-size: 20px; }
.ld-compact .br-card .border.rounded-xl { padding: 10px 12px; }
.ld-compact .br-card > div > div { min-width: 0; }
`;

// A learner's report over the Batch report: Close, or Download PDF for this learner alone.
function LearnerModal({ batchId, userId, onClose }: { batchId: string; userId: string; onClose: () => void }) {
  const [data, setData] = useState<BatchLearnerData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(false);
    getBatchLearner(batchId, userId)
      .then((r) => live && setData(r))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [batchId, userId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="br-modal fixed inset-0 z-50 bg-ink/40 overflow-y-auto px-3 py-6" onClick={onClose} role="dialog" aria-modal="true" aria-label={data?.learner.name ?? tr("Learner report")}>
      <div className="br-modal-panel bg-paper rounded-card shadow-2xl w-full max-w-[760px] mx-auto p-3 sm:p-4" onClick={(e) => e.stopPropagation()}>
        <style>{COMPACT_CSS}</style>
        <div className="print:hidden flex items-center justify-end gap-2 mb-2">
          <Button variant="secondary" onClick={() => window.print()} disabled={!data} className="flex items-center gap-2 !px-3.5 !py-2 !text-sm">
            <Download size={15} /> {tr("Download PDF")}
          </Button>
          <button onClick={onClose} aria-label={tr("Close")} className="h-9 w-9 rounded-full flex items-center justify-center text-ink hover:bg-paper-warm cursor-pointer">
            <X size={18} />
          </button>
        </div>
        {error ? (
          <p className="text-sm text-error">{tr("This report isn't available.")}</p>
        ) : data ? (
          <LearnerDetail l={data.learner} batch={data.batch} goal={data.goal} batchId={batchId} canOpenReports={data.canOpenReports} compact />
        ) : (
          <p className="text-sm text-muted py-10 text-center">{tr("Loading…")}</p>
        )}
      </div>
    </div>
  );
}
