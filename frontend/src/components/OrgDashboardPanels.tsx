import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, KeyRound, Layers, ShieldAlert, UserMinus, UserX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { ENGAGEMENT_CLASS, ENGAGEMENT_LABEL, getLearnerEngagement, timeAgo, type EngagementOverview, type EngagementStatus, type LearnerEngagement } from "@/api/notifications";
import { getAnalyticsOverview, type AnalyticsOverview } from "@/api/analytics";
import { getPendingReviewCount } from "@/api/proctoring";
import { getOrgLicenseRequests } from "@/api/licenses";
import { getBatches, type OrgBatch } from "@/api/orgAdmin";
import { BarList, StackedBar, WeeklyBars } from "@/components/analytics/Charts";

import { tr } from "@/i18n/tr";
import { getOrgAppeals, type OrgAppeal } from "@/api/quality";

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
const linkCls = "inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline";
// Who to follow up with first.
const FOLLOW_UP_ORDER: EngagementStatus[] = ["inactive", "not_started", "slow"];

function Panel({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Skeleton({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} rounded-input bg-paper-warm border border-rule animate-pulse`} />;
}

function name(l: LearnerEngagement): string {
  return [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email;
}

// Things waiting for the Org Admin: requests to decide, tests to review, and
// learners to follow up with.
function NeedsAttention({ learners }: { learners: LearnerEngagement[] | null }) {
  const [requests, setRequests] = useState<number | null>(null);
  const [reviews, setReviews] = useState<number | null>(null);
  useEffect(() => {
    getOrgLicenseRequests()
      .then((r) => setRequests(r.pending))
      .catch(() => setRequests(0));
    getPendingReviewCount()
      .then((r) => setReviews(r.flagged))
      .catch(() => setReviews(0));
  }, []);

  const count = (s: EngagementStatus) => (learners ? learners.filter((l) => l.status === s).length : null);
  const tiles: [string, number | null, LucideIcon, string, string][] = [
    [tr("License requests to decide"), requests, KeyRound, "text-warning", ROUTES.ORG_ADMIN_LICENSES],
    [tr("Tests to review"), reviews, ShieldAlert, "text-error", ROUTES.ORG_ADMIN_INTEGRITY],
    [tr("Stopped practising"), count("inactive"), UserMinus, "text-error", `${ROUTES.ORG_ADMIN_LEARNERS}?view=follow-up`],
    [tr("Haven't started"), count("not_started"), UserX, "text-warning", `${ROUTES.ORG_ADMIN_LEARNERS}?view=follow-up`],
  ];
  return (
    <Panel title={tr("Needs your attention")}>
      <div className="grid grid-cols-2 auto-rows-fr gap-3 flex-1">
        {tiles.map(([label, n, Icon, tone, to]) =>
          n === null ? (
            <Skeleton key={label} h="h-[72px]" />
          ) : (
            <Link
              key={label}
              to={to}
              className="bg-paper-warm/60 border border-rule rounded-input px-4 py-3 flex items-start justify-between gap-2 hover:border-rule-strong hover:bg-paper-warm transition-colors"
            >
              <span className="min-w-0 h-full flex flex-col justify-between gap-2">
                <span className={`block font-display font-bold text-3xl tabular-nums ${n ? tone : "text-ink"}`}>{n}</span>
                <span className="block text-sm text-muted">{label}</span>
              </span>
              <Icon size={16} className={`shrink-0 mt-1 opacity-80 ${n ? tone : "text-muted"}`} />
            </Link>
          ),
        )}
      </div>
    </Panel>
  );
}

// How learners are doing against their goals, and who to contact first.
function LearnerProgress({ learners }: { learners: LearnerEngagement[] | null }) {
  const followUp = (learners ?? [])
    .filter((l) => FOLLOW_UP_ORDER.includes(l.status))
    .sort((a, b) => FOLLOW_UP_ORDER.indexOf(a.status) - FOLLOW_UP_ORDER.indexOf(b.status) || Number(b.needsAttention) - Number(a.needsAttention))
    .slice(0, 4);
  const parts: { s: EngagementStatus; className: string }[] = [
    { s: "achieved", className: "bg-navy" },
    { s: "on_track", className: "bg-success" },
    { s: "slow", className: "bg-warning" },
    { s: "inactive", className: "bg-error" },
    { s: "not_started", className: "bg-muted/50" },
  ];
  return (
    <Panel
      title={tr("Learner progress")}
      subtitle={tr("Against each learner's level goal")}
      action={
        <Link to={`${ROUTES.ORG_ADMIN_LEARNERS}?view=follow-up`} className={linkCls}>
          {tr("Follow up with learners")} <ArrowRight size={13} />
        </Link>
      }
    >
      {learners === null ? (
        <Skeleton />
      ) : learners.length === 0 ? (
        <p className="text-sm text-muted">{tr("No learners yet.")}</p>
      ) : (
        <>
          <StackedBar parts={parts.map((p) => ({ label: ENGAGEMENT_LABEL[p.s], value: learners.filter((l) => l.status === p.s).length, className: p.className }))} />
          {followUp.length === 0 ? (
            <p className="text-sm text-muted">{tr("Everyone is practising. Nobody needs a follow-up right now.")}</p>
          ) : (
            <ul className="divide-y divide-rule border-t border-rule -mb-1">
              {followUp.map((l) => (
                <li key={l.id} className="py-2.5 flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink truncate">{name(l)}</span>
                    <span className="block text-[11px] text-muted truncate">
                      {[l.batchName, tr("Last active {{when}}", { when: timeAgo(l.lastActiveAt) })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill shrink-0 ${ENGAGEMENT_CLASS[l.status]}`}>{ENGAGEMENT_LABEL[l.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

function WeeklyActivity({ data }: { data: AnalyticsOverview | null }) {
  const t = data?.totals;
  return (
    <Panel
      title={tr("Weekly active learners")}
      subtitle={tr("Learners who completed at least one session, last 12 weeks")}
      action={
        <Link to={ROUTES.ORG_ADMIN_ANALYTICS} className={linkCls}>
          {tr("Analytics")} <ArrowRight size={13} />
        </Link>
      }
    >
      {!data || !t ? (
        <Skeleton h="h-44" />
      ) : (
        <>
          <WeeklyBars data={data.trend.map((w) => ({ week: w.week, value: w.activeLearners }))} valueLabel={tr("active learners")} />
          <div className="grid grid-cols-3 gap-3 border-t border-rule pt-3">
            {(
              [
                [tr("Active this week"), `${t.activeLast7Days}/${t.learners}`],
                [tr("Sessions (30 days)"), t.sessionsLast30Days],
                [tr("Avg practice / week"), tr("{{n}} min", { n: t.avgMinutesPerActiveLearnerPerWeek })],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="text-center">
                <p className="font-display font-bold text-lg text-ink tabular-nums">{value}</p>
                <p className="text-[11px] text-muted leading-snug">{label}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

// Learners' current level (from their practice, else their placement test).
function Levels({ learners }: { learners: LearnerEngagement[] | null }) {
  const notYet = (learners ?? []).filter((l) => !l.currentCefr).length;
  return (
    <Panel title={tr("Learners by level")} subtitle={tr("Each learner's current level")}>
      {learners === null ? (
        <Skeleton />
      ) : (
        <>
          <BarList
            data={notYet === learners.length ? [] : CEFR.map((c) => ({ key: c, count: learners.filter((l) => l.currentCefr === c).length }))}
            label={(k) => k}
            emptyText={tr("No levels yet. Levels appear after the placement test.")}
          />
          {notYet > 0 && <p className="text-[11px] text-muted">{notYet === 1 ? tr("1 learner has no level yet.") : tr("{{n}} learners have no level yet.", { n: notYet })}</p>}
        </>
      )}
    </Panel>
  );
}

// Active batches with how many of their learners are on track.
function Batches({ learners }: { learners: LearnerEngagement[] | null }) {
  const [batches, setBatches] = useState<OrgBatch[] | null>(null);
  useEffect(() => {
    getBatches()
      .then((r) => setBatches(r.batches.filter((b) => b.status === "active")))
      .catch(() => setBatches([]));
  }, []);
  return (
    <Panel
      title={tr("Active batches")}
      action={
        <Link to={ROUTES.ORG_ADMIN_BATCHES} className={linkCls}>
          {tr("All batches")} <ArrowRight size={13} />
        </Link>
      }
    >
      {batches === null || learners === null ? (
        <Skeleton />
      ) : batches.length === 0 ? (
        <p className="text-sm text-muted">{tr("No active batches.")}</p>
      ) : (
        <ul className="divide-y divide-rule -my-1">
          {batches.map((b) => {
            const own = learners.filter((l) => l.batchId === b.id);
            const good = own.filter((l) => l.status === "on_track" || l.status === "achieved").length;
            const pct = own.length ? Math.round((good / own.length) * 100) : 0;
            return (
              <li key={b.id}>
                <Link to={`${ROUTES.ORG_ADMIN_ANALYTICS}?tab=batches&batch=${b.id}`} className="py-3 flex items-center gap-3 group">
                  <span className="h-9 w-9 rounded-xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
                    <Layers size={17} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink truncate group-hover:underline">{b.name}</span>
                    <span className="block text-[11px] text-muted truncate">
                      {[b.batchCode, own.length === 1 ? tr("1 learner") : tr("{{n}} learners", { n: own.length })].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="w-32 shrink-0">
                    <span className="flex justify-between text-[11px] text-muted mb-1">
                      <span>{tr("On track")}</span>
                      <span className="font-semibold text-ink tabular-nums">
                        {good}/{own.length}
                      </span>
                    </span>
                    <span className="block h-1.5 rounded-pill bg-rule overflow-hidden">
                      <span className="block h-full rounded-pill bg-success" style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// Everything on the Org Admin dashboard between the license card and the
// activity feed.
// Score reviews your people asked for, and their outcomes. The Spica review
// team (Edstellar) decides; the organization sees them here.
function ScoreReviews() {
  const [rows, setRows] = useState<OrgAppeal[] | null>(null);
  useEffect(() => {
    getOrgAppeals()
      .then((r) => setRows(r.appeals))
      .catch(() => setRows([]));
  }, []);
  if (!rows || rows.length === 0) return null;
  const STATUS: Record<string, string> = {
    pending: tr("Waiting for a reviewer"),
    in_review: tr("In review"),
    upheld: tr("Score stands"),
    changed: tr("Re-marked"),
    new_attempt: tr("Free retake"),
    noted: tr("Concern noted"),
  };
  return (
    <Panel title={tr("Score review requests")} subtitle={tr("Decided by the Spica review team. Shown here so you can follow them.")}>
      <ul className="flex flex-col divide-y divide-rule text-sm">
        {rows.slice(0, 8).map((r) => (
          <li key={r.id} className="py-2 flex flex-col gap-0.5">
            <span className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold text-ink">
                {r.learner} {r.testCode && <span className="text-xs text-muted font-normal">{r.testCode}</span>}
              </span>
              <span className="text-xs font-semibold text-navy-deep">{STATUS[r.status] ?? r.status}</span>
            </span>
            <span className="text-xs text-muted line-clamp-2">{r.note ?? r.reason}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function OrgDashboardPanels() {
  const [engagement, setEngagement] = useState<EngagementOverview | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  useEffect(() => {
    getLearnerEngagement()
      .then(setEngagement)
      .catch(() => setEngagement({ learners: [], batches: [], cooldownHours: 0 }));
    getAnalyticsOverview()
      .then(setAnalytics)
      .catch(() => {});
  }, []);
  const learners = engagement?.learners ?? null;

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6">
        <NeedsAttention learners={learners} />
        <LearnerProgress learners={learners} />
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          <WeeklyActivity data={analytics} />
        </div>
        <Levels learners={learners} />
      </div>
      <Batches learners={learners} />
      <ScoreReviews />
    </>
  );
}
