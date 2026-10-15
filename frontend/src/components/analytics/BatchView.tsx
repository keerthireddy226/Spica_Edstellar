import { AlertTriangle } from "lucide-react";
import { ENGAGEMENT_CLASS, ENGAGEMENT_LABEL, timeAgo } from "@/api/notifications";
import type { BatchAnalytics } from "@/api/analytics";
import { formatShortDate } from "@/api/licenses";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { Card, Stat, StackedBar, WeeklyBars } from "@/components/analytics/Charts";

import { tr } from "@/i18n/tr";
const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILL_LABEL: Record<string, string> = { listening: tr("Listening"), speaking: tr("Speaking"), reading: tr("Reading"), writing: tr("Writing") };

function Compare({ value, org, unit }: { value: number; org: number; unit: string }) {
  const diff = value - org;
  return (
    <span className={`text-[11px] ${diff >= 0 ? "text-success" : "text-error"}`}>
      {diff === 0 ? tr("Same as") : `${diff > 0 ? "+" : ""}${diff}${unit} vs`} {tr("org average ({{org}} {{unit}})", { org: org, unit: unit })}{" "}</span>
  );
}

export function BatchView({ data }: { data: BatchAnalytics }) {
  const s = data.summary;
  const c = s.statusCounts;
  const maxCefr = Math.max(1, ...Object.values(data.cefr.current));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={tr("Learners")} value={s.learners} hint={data.batch.managers.length ? tr("Managed by {{join}}", { join: data.batch.managers.join(", ") }) : tr("No manager")} />
        <div className="bg-surface border border-rule rounded-card shadow-sm px-4 py-3.5">
          <p className="text-xs text-muted">{tr("On track")}</p>
          <p className="text-2xl font-display font-bold text-ink mt-0.5">{s.onTrackPercent}%</p>
          <Compare value={s.onTrackPercent} org={s.orgOnTrackPercent} unit="%" />
        </div>
        <div className="bg-surface border border-rule rounded-card shadow-sm px-4 py-3.5">
          <p className="text-xs text-muted">{tr("Practice / learner / week")}</p>
          <p className="text-2xl font-display font-bold text-ink mt-0.5">{tr("{{avgMinutesPerLearnerPerWeek}} min", { avgMinutesPerLearnerPerWeek: s.avgMinutesPerLearnerPerWeek })}</p>
          <Compare value={s.avgMinutesPerLearnerPerWeek} org={s.orgAvgMinutesPerLearnerPerWeek} unit=" min" />
        </div>
        <Stat
          label={tr("Days left")}
          value={data.batch.daysLeft ?? "—"}
          hint={data.batch.endsOn ? `Ends ${formatShortDate(data.batch.endsOn)}` : tr("Set a duration to track this")}
        />
        <Stat
          label={tr("Licensed learners")}
          value={`${s.licensedLearners} / ${s.learners}`}
          hint={s.endingWithin7Days ? tr("{{endingWithin7Days}} ending within 7 days", { endingWithin7Days: s.endingWithin7Days }) : tr("None ending this week")}
        />
        <Stat
          label={tr("Fixed licenses")}
          value={s.fixedLicenses === null ? tr("None") : `${s.fixedLicensesUsed} / ${s.fixedLicenses}`}
          hint={s.fixedLicenses === null ? tr("Uses Manager's pool") : `${Math.max(0, s.fixedLicenses - s.fixedLicensesUsed)} left`}
        />
      </div>

      <Card title={tr("Where learners are")} subtitle={tr("Status today")}>
        <StackedBar
          parts={[
            { label: tr("Goal achieved"), value: c.achieved, className: "bg-navy" },
            { label: tr("On track"), value: c.on_track, className: "bg-success" },
            { label: tr("Behind"), value: c.slow, className: "bg-warning" },
            { label: tr("Inactive"), value: c.inactive, className: "bg-error" },
            { label: tr("Not started"), value: c.not_started, className: "bg-muted" },
          ]}
        />
        {(s.needsAttention > 0 || s.remindedLearners > 0) && (
          <p className="text-xs text-muted">
            {tr("{{remindedLearners}} learner", { remindedLearners: s.remindedLearners })}{s.remindedLearners === 1 ? " has" : tr("s have")} {tr("been reminded")}{s.needsAttention ? tr(" · {{needsAttention}} still stuck after 2+ reminders", { needsAttention: s.needsAttention }) : ""}.
          </p>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card
          title={tr("Level distribution")}
          subtitle={
            data.cefr.start || data.cefr.target
              ? tr("Batch goal: {{v}} → {{v2}}", { v: data.cefr.start ?? "?", v2: data.cefr.target ?? "?" })
              : tr("Set a starting and goal level on the batch to track progress")
          }
        >
          <div className="flex flex-col gap-2">
            {[...CEFR, "Not placed"].map((level) => {
              const n = data.cefr.current[level] ?? 0;
              if (!n && level === "Not placed") return null;
              const isStart = level === data.cefr.start;
              const isTarget = level === data.cefr.target;
              return (
                <div key={level} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-ink">
                    {level === "Not placed" ? tr("Not placed") : level}
                    {isStart && <span className="ml-1 text-[10px] text-muted">{tr("start")}</span>}
                    {isTarget && <span className="ml-1 text-[10px] font-semibold text-navy">{tr("goal")}</span>}
                  </span>
                  <div className={`flex-1 h-2.5 rounded-full overflow-hidden ${isTarget ? "bg-navy/15" : "bg-rule"}`}>
                    <div className="h-full rounded-full bg-navy" style={{ width: `${(n / maxCefr) * 100}%` }} />
                  </div>
                  <span className="w-8 text-right text-muted tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title={tr("Weekly active learners")} subtitle={tr("Last 8 weeks")}>
          <WeeklyBars data={data.weeklyActive.map((w) => ({ week: w.week, value: w.activeLearners }))} valueLabel={tr("active learners")} />
        </Card>
      </div>

      <Card title={tr("Skills")} subtitle={tr("Average accuracy across the batch — the lowest is where to focus")}>
        {data.skills.length === 0 ? (
          <p className="text-sm text-muted">{tr("No practice graded yet.")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(() => {
              const weakest = data.skills.filter((x) => x.accuracy !== null).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]?.skill;
              return data.skills.map((sk) => (
                <div key={sk.skill} className={`rounded-input px-3 py-2.5 ${sk.skill === weakest ? "bg-warning/10 border border-warning/30" : "bg-paper-warm/60"}`}>
                  <p className="text-xs text-muted">
                    {SKILL_LABEL[sk.skill] ?? sk.skill}
                    {sk.skill === weakest && tr(" · weakest")}
                  </p>
                  <p className="text-xl font-display font-bold text-ink">{sk.accuracy === null ? "—" : `${sk.accuracy}%`}</p>
                  <p className="text-[11px] text-muted">{tr("{{avgMinutes}} min avg", { avgMinutes: sk.avgMinutes })}</p>
                </div>
              ));
            })()}
          </div>
        )}
      </Card>

      <Card title={tr("Learners")} subtitle={tr("Most at risk first — combines status, time left on their access, and distance from the goal")}>
        {data.learners.length === 0 ? (
          <p className="text-sm text-muted">{tr("No learners in this batch yet.")}</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-2 py-2">{tr("Learner")}</th>
                  <th className="px-2 py-2">{tr("Status")}</th>
                  <th className="px-2 py-2">{tr("Level")}</th>
                  <th className="px-2 py-2">{tr("Sessions")}</th>
                  <th className="px-2 py-2">{tr("Last active")}</th>
                  <th className="px-2 py-2">{tr("License")}</th>
                  <th className="px-2 py-2">{tr("Reminders")}</th>
                </tr>
              </thead>
              <tbody>
                {data.learners.map((l) => (
                  <tr key={l.id} className="border-b border-rule last:border-0">
                    <td className="px-2 py-2">
                      <p className="text-ink font-medium flex items-center gap-1.5">
                        {l.needsAttention && <AlertTriangle size={13} className="text-error" />}
                        {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email}
                      </p>
                      <p className="text-[11px] text-muted">{l.participantId ?? l.email}</p>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill whitespace-nowrap ${ENGAGEMENT_CLASS[l.status]}`}>
                        {ENGAGEMENT_LABEL[l.status]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap">{l.currentCefr ?? "—"}</td>
                    <td className="px-2 py-2 text-muted">{l.sessionsCompleted}</td>
                    <td className="px-2 py-2 text-muted whitespace-nowrap">{timeAgo(l.lastActiveAt)}</td>
                    <td className="px-2 py-2">
                      <LicenseStatusPill license={l.license} />
                    </td>
                    <td className="px-2 py-2 text-muted text-xs">{l.remindersSent || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
