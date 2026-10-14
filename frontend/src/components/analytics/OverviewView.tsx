import { useTranslation } from "react-i18next";
import { countryName } from "@/constants/demographics";
import { formatAmount } from "@/api/payments";
import type { AnalyticsOverview } from "@/api/analytics";
import { BarList, Card, Stat, WeeklyBars } from "@/components/analytics/Charts";

const ORG_TYPE_LABEL: Record<string, string> = { organization: "Organizations", university: "Universities", individual: "Individual learners" };

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
        <Stat label="Learners" value={tot.learners} hint={`${tot.newLast30Days} joined in the last 30 days`} />
        <Stat label="Active this week" value={tot.activeLast7Days} hint={`${activeRate}% of learners`} />
        <Stat label="Active (28 days)" value={tot.activeLast28Days} />
        <Stat label="Sessions (30 days)" value={tot.sessionsLast30Days} />
        <Stat label="Avg practice / week" value={`${tot.avgMinutesPerActiveLearnerPerWeek} min`} hint="Per active learner, last 4 weeks" />
        <Stat label="Placement taken" value={tot.placementTaken} hint={`${tot.dailyReminderAdoption}% use daily reminders`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Weekly active learners" subtitle="Learners who completed at least one session, last 12 weeks">
          <WeeklyBars data={data.trend.map((w) => ({ week: w.week, value: w.activeLearners }))} valueLabel="active learners" />
        </Card>
        <Card title="New learners per week" subtitle="Accounts created, last 12 weeks">
          <WeeklyBars data={data.trend.map((w) => ({ week: w.week, value: w.signups }))} valueLabel="new learners" />
        </Card>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
        <Card title="Learning level (CEFR)" subtitle="Latest placement result">
          <BarList data={b.cefr} label={(k) => k} emptyText="No placements yet." />
        </Card>
        <Card title="Location" subtitle="Country">
          <BarList data={b.country} label={(k) => countryName(k, "en")} emptyText="No locations captured yet." />
        </Card>
        {!showCompanies && (
          <Card title="Department" subtitle="From employee details · top 15">
            <BarList data={b.department ?? []} label={(k) => (k === "unknown" ? "Not recorded" : k)} emptyText="No departments recorded yet." />
          </Card>
        )}
        <Card title="Job role">
          <BarList data={b.jobRole} label={(k) => t(`demographics.jobRole.${k}`, { defaultValue: k })} emptyText="No job roles captured yet." />
        </Card>
        <Card title="Age" subtitle={`Groups under ${data.minGroupSize} are hidden`}>
          <BarList data={b.ageBand} label={(k) => t(`demographics.ageBand.${k}`, { defaultValue: k })} emptyText="No age data shared yet." />
        </Card>
        <Card title="Gender" subtitle={`Groups under ${data.minGroupSize} are hidden`}>
          <BarList data={b.gender} label={(k) => t(`demographics.gender.${k}`, { defaultValue: k })} emptyText="No gender data shared yet." />
        </Card>
        <Card title="Language selected" subtitle="App language each learner uses">
          <BarList data={b.language} label={languageName} emptyText="Not recorded yet." />
        </Card>
        {showCompanies && (
          <>
            <Card title="Account type">
              <BarList data={b.orgType} label={(k) => ORG_TYPE_LABEL[k] ?? k} />
            </Card>
            <Card title="Learners by organization" subtitle="Top 15">
              <BarList data={b.companies} label={(k) => k} />
            </Card>
          </>
        )}
        <Card title="Reminders" subtitle="Manager, automatic and daily reminders, last 30 days">
          <div className="flex items-baseline gap-6">
            <div>
              <p className="text-2xl font-display font-bold text-ink">{data.reminders.sentLast30Days}</p>
              <p className="text-xs text-muted">sent</p>
            </div>
            <div>
              <p className="text-2xl font-display font-bold text-ink">{data.reminders.returnRate === null ? "—" : `${data.reminders.returnRate}%`}</p>
              <p className="text-xs text-muted">practised within 7 days</p>
            </div>
          </div>
        </Card>
      </div>

      {data.licenses && (
        <Card title="Licenses & revenue" subtitle="Paid purchases only count toward revenue">
          {data.licenses.length === 0 ? (
            <p className="text-sm text-muted">No licenses yet.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {data.licenses.map((l) => (
                <div key={l.currency} className="contents">
                  <Stat label={`Licenses (${l.currency})`} value={l.purchased} hint={`${l.paid} paid · ${l.purchased - l.paid} credited/comp`} />
                  <Stat label="Assigned" value={l.assigned} hint={l.purchased ? `${Math.round((l.assigned / l.purchased) * 100)}% utilization` : undefined} />
                  <Stat label="Revenue (all time)" value={formatAmount(l.revenueMinor, l.currency)} />
                  <Stat label="Revenue (30 days)" value={formatAmount(l.revenue30Minor, l.currency)} />
                  <Stat label="Avg per paid license" value={l.paid ? formatAmount(Math.round(l.revenueMinor / l.paid), l.currency) : "—"} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
