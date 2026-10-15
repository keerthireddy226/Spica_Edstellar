import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Building2, CalendarClock, ChevronRight, CreditCard, KeyRound, ServerCog, Users, UserPlus, ShieldCheck } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { TIER_LABELS } from "@/api/plans";
import { AUDIT_VERBS } from "@/lib/auditVerbs";
import { getPortfolio, money, ago, type Portfolio } from "@/api/staff";
import { EmptyNote, PageHeader, Panel, StatCard, StatusPill, WeeklyBars, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
const BAND_TONE = { healthy: "success", watch: "warning", at_risk: "error" } as const;
const BAND_LABEL = { healthy: tr("Healthy"), watch: tr("Watch"), at_risk: tr("At risk") } as const;

function pct(n: number | null) {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

// One dashboard for Edstellar staff. A Super Admin sees the whole platform
// plus every Admin's portfolio and system health; an Admin sees the
// organizations they own and the individual learners.
export function StaffDashboard() {
  const perms = useStaffPermissions();
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPortfolio()
      .then(setData)
      .catch(() => setError(tr("Could not load the dashboard.")));
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-muted">{tr("Loading…")}</p>;

  const sup = perms.isSuper;
  const r = {
    orgs: sup ? ROUTES.SUPER_ORGANIZATIONS : ROUTES.ADMIN_CONSOLE_ORGANIZATIONS,
    learners: sup ? ROUTES.ADMIN_LEARNERS : ROUTES.ADMIN_CONSOLE_USERS,
    billing: sup ? ROUTES.SUPER_BILLING : ROUTES.ADMIN_CONSOLE_BILLING,
    audit: sup ? ROUTES.SUPER_AUDIT : ROUTES.ADMIN_CONSOLE_AUDIT,
    reviews: sup ? ROUTES.ADMIN_REVIEW : ROUTES.ADMIN_CONSOLE_REVIEWS,
  };
  const revenue = data.revenue[0];
  const owed = data.outstanding[0];
  const attentionLink: Record<string, string> = {
    at_risk: r.orgs,
    invite: r.orgs,
    no_admin: r.orgs,
    pilot: r.orgs,
    overdue: r.billing,
    review: r.reviews,
    jobs: ROUTES.SUPER_SYSTEM,
    admin_invite: ROUTES.ADMIN_ADMINS,
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={sup ? tr("Platform overview") : tr("Your portfolio")}
        subtitle={
          sup
            ? tr("Every organization, learner and Admin on Spica — and what needs attention.")
            : tr("The organizations you look after, individual learners, and what needs your attention.")
        }
        actions={
          sup ? (
            <>
              <Link to={ROUTES.SUPER_ORGANIZATIONS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                <Building2 size={15} /> {tr("Onboard an organization")}</Link>
              <Link to={ROUTES.ADMIN_ADMINS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                <ShieldCheck size={15} /> {tr("Manage Admins")}</Link>
              <Link to={ROUTES.ADMIN_LEARNERS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                <UserPlus size={15} /> {tr("Invite an individual learner")}</Link>
            </>
          ) : (
            <>
              {perms.manageOrganizations && (
                <Link to={ROUTES.ADMIN_CONSOLE_ORGANIZATIONS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                  <Building2 size={15} /> {tr("Onboard an organization")}</Link>
              )}
              {perms.manageAdmins && (
                <Link to={ROUTES.ADMIN_CONSOLE_ADMINS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                  <ShieldCheck size={15} /> {tr("Onboard an Admin")}</Link>
              )}
              {perms.inviteLearners && (
                <Link to={ROUTES.ADMIN_CONSOLE_USERS} className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
                  <UserPlus size={15} /> {tr("Invite an individual learner")}</Link>
              )}
            </>
          )
        }
      />

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          index={0}
          icon={Building2}
          value={data.organizations.active}
          label={tr("Active organization{{v}}", { v: data.organizations.active === 1 ? "" : "s" })}
          sub={tr("{{companies}} companies · {{universities}} universities{{v}}", { companies: data.organizations.companies, universities: data.organizations.universities, v: data.organizations.pilots ? ` · ${data.organizations.pilots} on pilot` : "" })}
        />
        <StatCard
          index={1}
          icon={Users}
          value={data.learners.total + data.individuals.total}
          label={tr("Learners")}
          sub={tr("{{v}} practised this week · {{v2}} new", { v: data.learners.active7 + data.individuals.active7, v2: data.learners.new7 + data.individuals.new7 })}
        />
        <StatCard
          index={2}
          icon={KeyRound}
          value={`${data.licenses.assigned} / ${data.licenses.bought}`}
          label={tr("Licenses assigned / bought")}
          sub={`${pct(data.licenses.utilization)} used${data.licenses.expiringUnused ? tr(" · {{expiringUnused}} expire unused soon", { expiringUnused: data.licenses.expiringUnused }) : ""}`}
        />
        <StatCard
          index={3}
          icon={CreditCard}
          value={revenue ? money(revenue.thisMonth, revenue.currency) : "—"}
          label={tr("Paid this month")}
          sub={
            revenue
              ? tr("Last month {{money}}{{v}}", { money: money(revenue.lastMonth, revenue.currency), v: owed ? ` · ${money(owed.total, owed.currency)} unpaid` : "" })
              : owed
                ? `${money(owed.total, owed.currency)} unpaid`
                : tr("No payments yet")
          }
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Panel
          className="lg:col-span-2"
          title={tr("Needs attention")}
          action={<span className="text-xs text-muted">{data.attention.length} {tr("item")}{data.attention.length === 1 ? "" : "s"}</span>}
        >
          {data.attention.length === 0 ? (
            <EmptyNote>{tr("Nothing needs attention right now.")}</EmptyNote>
          ) : (
            <div className="flex flex-col divide-y divide-rule">
              {data.attention.slice(0, 10).map((a, i) => (
                <Link key={i} to={attentionLink[a.kind] ?? r.orgs} className="flex items-start gap-3 py-2.5 hover:bg-paper-warm -mx-2 px-2 rounded-input transition-colors">
                  <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${a.kind === "at_risk" || a.kind === "overdue" || a.kind === "jobs" ? "text-error" : "text-warning"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">{a.title}</p>
                    {a.detail && <p className="text-xs text-muted truncate">{a.detail}</p>}
                  </div>
                  <ChevronRight size={15} className="text-muted mt-0.5" />
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={tr("Renewals")} action={<CalendarClock size={16} className="text-muted" />}>
          {data.renewals.length === 0 ? (
            <EmptyNote>{tr("No contracts end in the next 60 days.")}</EmptyNote>
          ) : (
            data.renewals.map((c) => {
              const days = Math.ceil((new Date(c.contractEnd).getTime() - Date.now()) / 86400000);
              return (
                <Link key={c.id} to={r.orgs} className="flex items-center justify-between gap-3 text-sm hover:underline">
                  <span className="min-w-0">
                    <span className="text-ink font-medium truncate block">{c.name}</span>
                    {sup && c.ownerName && <span className="text-xs text-muted">{c.ownerName}</span>}
                  </span>
                  <StatusPill tone={days <= 14 ? "error" : days <= 30 ? "warning" : "muted"}>{days <= 0 ? tr("Ends today") : `${days} days`}</StatusPill>
                </Link>
              );
            })
          )}
          {owed && (
            <Link to={r.billing} className="mt-1 rounded-input bg-paper-warm px-3 py-2.5 text-sm hover:bg-rule/40 transition-colors">
              <span className="font-semibold text-ink">{owed.count} {tr("unpaid invoice")}{owed.count === 1 ? "" : "s"}</span>
              <span className="text-muted"> · {money(owed.total, owed.currency)}</span>
              {owed.overdue > 0 && <span className="text-error font-semibold"> · {owed.overdue} {tr("overdue")}</span>}
            </Link>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Panel className="lg:col-span-2" title={tr("Last 8 weeks")}>
          <WeeklyBars data={data.trend} />
        </Panel>
        <Panel title={tr("Account health")} action={<Link to={r.orgs} className="text-xs font-semibold text-navy hover:underline">{tr("All")}</Link>}>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-rule">
            {(["healthy", "watch", "atRisk"] as const).map((k) => {
              const total = data.organizations.healthy + data.organizations.watch + data.organizations.atRisk || 1;
              const color = k === "healthy" ? "bg-success" : k === "watch" ? "bg-warning" : "bg-error";
              return <div key={k} className={color} style={{ width: `${(data.organizations[k] / total) * 100}%` }} />;
            })}
          </div>
          <p className="text-xs text-muted">
            {data.organizations.healthy} {tr("healthy ·")}{" "}{data.organizations.watch} {tr("to watch ·")}{" "}{data.organizations.atRisk} {tr("at risk")}</p>
          <div className="flex flex-col gap-2 mt-1">
            {data.health.slice(0, 5).map((h) => (
              <div key={h.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-ink truncate">{h.name}</p>
                  <p className="text-[11px] text-muted truncate">
                    {h.active7}/{h.learners} {tr("practised this week")}{h.flags[0] ? ` · ${h.flags[0]}` : ""}
                  </p>
                </div>
                <StatusPill tone={BAND_TONE[h.band]}>
                  {h.score} · {BAND_LABEL[h.band]}
                </StatusPill>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
        <Panel title={tr("Plans")}>
          {data.organizations.byTier.map((t) => (
            <div key={t.tier} className="flex items-center gap-3">
              <span className="w-24 text-sm text-ink">{TIER_LABELS[t.tier]}</span>
              <div className="flex-1 h-2 rounded-full bg-rule overflow-hidden">
                <div className="h-full bg-navy rounded-full" style={{ width: `${data.organizations.active ? (t.count / data.organizations.active) * 100 : 0}%` }} />
              </div>
              <span className="text-sm text-muted w-6 text-right">{t.count}</span>
            </div>
          ))}
          <p className="text-xs text-muted">
            {data.organizations.pilots} {tr("on pilot")}{data.organizations.deactivated ? tr(" · {{deactivated}} deactivated", { deactivated: data.organizations.deactivated }) : ""}
          </p>
        </Panel>

        <Panel title={tr("Individual learners")} action={<Link to={r.learners} className="text-xs font-semibold text-navy hover:underline">{tr("Open")}</Link>}>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                [tr("Total"), data.individuals.total],
                [tr("Paid"), data.individuals.paid],
                [tr("Practised this week"), data.individuals.active7],
                [tr("New this week"), data.individuals.new7],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="rounded-input bg-paper-warm px-3 py-2">
                <p className="font-display font-bold text-xl text-ink">{v}</p>
                <p className="text-[11px] text-muted">{l}</p>
              </div>
            ))}
          </div>
          {revenue && <p className="text-xs text-muted">{tr("This year:")}{" "}{money(revenue.thisYear, revenue.currency)} {tr("paid across organizations and individuals.")}</p>}
        </Panel>

        <Panel title={tr("Recent activity")} action={<Link to={r.audit} className="text-xs font-semibold text-navy hover:underline">{tr("Audit log")}</Link>}>
          {data.recent.length === 0 ? (
            <EmptyNote>{tr("Nothing recorded yet.")}</EmptyNote>
          ) : (
            data.recent.slice(0, 8).map((e, i) => (
              <div key={i} className="text-sm">
                <p className="text-ink">
                  <span className="font-medium">{e.actorLabel ?? tr("System")}</span> {AUDIT_VERBS[e.action] ?? e.action.replace(/[._]/g, " ")}{" "}
                  {e.targetLabel ?? ""}
                </p>
                <p className="text-[11px] text-muted">
                  {e.orgName ? `${e.orgName} · ` : ""}
                  {ago(e.createdAt)}
                </p>
              </div>
            ))
          )}
        </Panel>
      </div>

      {sup && data.admins && (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          <Panel className="lg:col-span-2" title={tr("Admins' portfolios")} action={<Link to={ROUTES.ADMIN_ADMINS} className="text-xs font-semibold text-navy hover:underline">{tr("Manage")}</Link>}>
            {data.admins.length === 0 ? (
              <EmptyNote>{tr("No Admins yet.")}</EmptyNote>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-rule">
                      <th className="py-2">{tr("Admin")}</th>
                      <th className="py-2">{tr("Organizations")}</th>
                      <th className="py-2">{tr("Learners")}</th>
                      <th className="py-2">{tr("At risk")}</th>
                      <th className="py-2">{tr("Last signed in")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.admins.map((a) => (
                      <tr key={a.id} className={`border-b border-rule last:border-0 ${a.active ? "" : "opacity-50"}`}>
                        <td className="py-2">
                          <p className="text-ink font-medium">{a.name}</p>
                          <p className="text-xs text-muted">{a.department ?? a.email}</p>
                        </td>
                        <td className="py-2 text-ink">{a.organizations}</td>
                        <td className="py-2 text-ink">{a.learners}</td>
                        <td className="py-2">{a.atRisk ? <StatusPill tone="error">{a.atRisk}</StatusPill> : <span className="text-muted">0</span>}</td>
                        <td className="py-2 text-muted">{ago(a.lastLoginAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={tr("System")} action={<Link to={ROUTES.SUPER_SYSTEM} className="text-xs font-semibold text-navy hover:underline">{tr("Open")}</Link>}>
            <div className="flex items-center gap-3">
              <ServerCog size={20} className={data.system?.failedJobs ? "text-error" : "text-success"} />
              <div>
                <p className="text-sm text-ink font-medium">{data.system?.failedJobs ? tr("{{failedJobs}} failed job{{v}}", { failedJobs: data.system.failedJobs, v: data.system.failedJobs === 1 ? "" : "s" }) : tr("All background jobs healthy")}</p>
                <p className="text-xs text-muted">{data.system?.readyJobs ?? 0} {tr("waiting to run")}</p>
              </div>
            </div>
            <p className="text-xs text-muted">
              {data.pendingReviews} {tr("placement")}{data.pendingReviews === 1 ? "" : "s"} {tr("waiting for identity review ·")}{" "}
              <Link to={r.reviews} className="text-navy font-semibold hover:underline">
                {tr("Review")}</Link>
            </p>
          </Panel>
        </div>
      )}
    </div>
  );
}
