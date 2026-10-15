import { useTranslation } from "react-i18next";
import { countryName } from "@/constants/demographics";
import { formatAmount } from "@/api/payments";
import type { AnalyticsOverview } from "@/api/analytics";
import { BarList, Card, Stat, WeeklyBars } from "@/components/analytics/Charts";

import { tr } from "@/i18n/tr";
const ORG_TYPE_LABEL: Record<string, string> = { organization: tr("Organizations"), university: tr("Universities"), individual: tr("Individual learners") };

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function OverviewView({ data, showCompanies }: { data: AnalyticsOverview; showCompanies: boolean }) {
  const { t } = useTranslation();
  const tot = data.totals;
  const b = data.breakdowns;
  const activeRate = tot.learners ? Math.round((tot.activeLast7Days / tot.learners) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={tr("Learners")} value={tot.learners} hint={tr("{{newLast30Days}} joined in the last 30 days", { newLast30Days: tot.newLast30Days })} />
        <Stat label={tr("Active this week")} value={tot.activeLast7Days} hint={tr("{{activeRate}}% of learners", { activeRate: activeRate })} />
        <Stat label={tr("Active (28 days)")} value={tot.activeLast28Days} />
        <Stat label={tr("Sessions (30 days)")} value={tot.sessionsLast30Days} />
        <Stat label={tr("Avg practice / week")} value={`${tot.avgMinutesPerActiveLearnerPerWeek} min`} hint={tr("Per active learner, last 4 weeks")} />
        <Stat label={tr("Placement taken")} value={tot.placementTaken} hint={tr("{{dailyReminderAdoption}}% use daily reminders", { dailyReminderAdoption: tot.dailyReminderAdoption })} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title={tr("Weekly active learners")} subtitle={tr("Learners who completed at least one session, last 12 weeks")}>
          <WeeklyBars data={data.trend.map((w) => ({ week: w.week, value: w.activeLearners }))} valueLabel={tr("active learners")} />
        </Card>
        <Card title={tr("New learners per week")} subtitle={tr("Accounts created, last 12 weeks")}>
          <WeeklyBars data={data.trend.map((w) => ({ week: w.week, value: w.signups }))} valueLabel={tr("new learners")} />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        <Card title={tr("Learning level (CEFR)")} subtitle={tr("Latest placement result")}>
          <BarList data={b.cefr} label={(k) => k} emptyText={tr("No placements yet.")} />
        </Card>
        <Card title={tr("Location")} subtitle={tr("Country")}>
          <BarList data={b.country} label={(k) => countryName(k, "en")} emptyText={tr("No locations captured yet.")} />
        </Card>
        {!showCompanies && (
          <Card title={tr("Department")} subtitle={tr("From employee details · top 15")}>
            <BarList data={b.department ?? []} label={(k) => (k === "unknown" ? tr("Not recorded") : k)} emptyText={tr("No departments recorded yet.")} />
          </Card>
        )}
        <Card title={tr("Job role")}>
          <BarList data={b.jobRole} label={(k) => t(`demographics.jobRole.${k}`, { defaultValue: k })} emptyText={tr("No job roles captured yet.")} />
        </Card>
        <Card title={tr("Age")} subtitle={tr("Groups under {{minGroupSize}} are hidden", { minGroupSize: data.minGroupSize })}>
          <BarList data={b.ageBand} label={(k) => t(`demographics.ageBand.${k}`, { defaultValue: k })} emptyText={tr("No age data shared yet.")} />
        </Card>
        <Card title={tr("Gender")} subtitle={tr("Groups under {{minGroupSize}} are hidden", { minGroupSize: data.minGroupSize })}>
          <BarList data={b.gender} label={(k) => t(`demographics.gender.${k}`, { defaultValue: k })} emptyText={tr("No gender data shared yet.")} />
        </Card>
        <Card title={tr("Language selected")} subtitle={tr("App language each learner uses")}>
          <BarList data={b.language} label={languageName} emptyText={tr("Not recorded yet.")} />
        </Card>
        {showCompanies && (
          <>
            <Card title={tr("Account type")}>
              <BarList data={b.orgType} label={(k) => ORG_TYPE_LABEL[k] ?? k} />
            </Card>
            <Card title={tr("Learners by organization")} subtitle={tr("Top 15")}>
              <BarList data={b.companies} label={(k) => k} />
            </Card>
          </>
        )}
        <Card title={tr("Reminders")} subtitle={tr("Manager, automatic and daily reminders, last 30 days")}>
          <div className="flex items-baseline gap-6">
            <div>
              <p className="text-2xl font-display font-bold text-ink">{data.reminders.sentLast30Days}</p>
              <p className="text-xs text-muted">{tr("sent")}</p>
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-ink">{data.reminders.returnRate === null ? "—" : `${data.reminders.returnRate}%`}</p>
              <p className="text-xs text-muted">{tr("practised within 7 days")}</p>
            </div>
          </div>
        </Card>
      </div>

      {data.licenses && (
        <Card title={tr("Licenses & revenue")} subtitle={tr("Paid purchases only count toward revenue")}>
          {data.licenses.length === 0 ? (
            <p className="text-sm text-muted">{tr("No licenses yet.")}</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {data.licenses.map((l) => (
                <div key={l.currency} className="contents">
                  <Stat label={tr("Licenses ({{currency}})", { currency: l.currency })} value={l.purchased} hint={tr("{{paid}} paid · {{v}} credited/comp", { paid: l.paid, v: l.purchased - l.paid })} />
                  <Stat label={tr("Assigned")} value={l.assigned} hint={l.purchased ? tr("{{round}}% utilization", { round: Math.round((l.assigned / l.purchased) * 100) }) : undefined} />
                  <Stat label={tr("Revenue (all time)")} value={formatAmount(l.revenueMinor, l.currency)} />
                  <Stat label={tr("Revenue (30 days)")} value={formatAmount(l.revenue30Minor, l.currency)} />
                  <Stat label={tr("Avg per paid license")} value={l.paid ? formatAmount(Math.round(l.revenueMinor / l.paid), l.currency) : "—"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
