import { useEffect, useState } from "react";
import { Award, CalendarClock, Moon, Users } from "lucide-react";
import { api } from "@/lib/api";
import { shortDate } from "@/api/staff";
import { EmptyNote, PageHeader, Panel, StatCard, paletteColor, useStaffPermissions } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
interface Insights {
  funnel: { invited: number; signed_in: number; onboarded: number; placed: number; practising: number; certified: number };
  cefr: { level: string; n: number }[];
  organizations: { id: string; name: string; learners: number; signedIn: number; active7: number; placed: number; certified: number; avgMinutes: number; typicalLevel: string | null }[];
  inactive: { id: string; name: string; email: string; orgName: string | null; batchName: string | null; lastActive: string | null }[];
  exams: { id: string; name: string; orgName: string | null; exam: string | null; date: string; goal: string | null; scoreTarget: string | null; level: string | null }[];
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// How learners are actually doing across the organizations this person looks
// after (plus individual learners): where they drop off, their levels, who to
// nudge, and who has an exam coming up.
export function StaffInsights() {
  const perms = useStaffPermissions();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Insights>("/admin/insights")
      .then(setData)
      .catch(() => setError(tr("Could not load insights.")));
  }, []);
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!data) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  const f = data.funnel;
  const steps: [string, number][] = [
    [tr("Invited or signed up"), f.invited],
    [tr("Signed in"), f.signed_in],
    [tr("Finished onboarding"), f.onboarded],
    [tr("Took the placement test"), f.placed],
    [tr("Practised this week"), f.practising],
    [tr("Certified"), f.certified],
  ];
  const maxCefr = Math.max(1, ...data.cefr.map((c) => c.n));

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Insights")}
        subtitle={perms.isSuper ? tr("How learners are doing across Spica.") : tr("How learners are doing in your organizations and among individual learners.")}
      />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="glass" palette="terracotta" index={0} icon={Users} value={`${pct(f.signed_in, f.invited)}%`} label={tr("Accepted their invite")} sub={`${f.signed_in} of ${f.invited}`} />
        <StatCard variant="glass" palette="terracotta" index={1} icon={Award} value={`${pct(f.placed, f.invited)}%`} label={tr("Took the placement test")} sub={`${f.placed} learners`} />
        <StatCard variant="glass" palette="terracotta" index={2} icon={Moon} value={data.inactive.length} label={tr("Licensed but inactive 14+ days")} />
        <StatCard variant="glass" palette="terracotta" index={3} icon={CalendarClock} value={data.exams.length} label={tr("Exams in the next 60 days")} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <Panel className="lg:col-span-2" title={tr("Learner journey")}>
          {steps.map(([label, n], i) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-48 text-sm text-ink">{label}</span>
              <div className="flex-1 h-6 rounded-input bg-rule overflow-hidden">
                <div className="h-full rounded-input flex items-center px-2 text-[11px] font-semibold text-white" style={{ width: `${Math.max(pct(n, f.invited), n ? 8 : 0)}%`, background: paletteColor("terracotta", i) }}>
                  {n ? n : ""}
                </div>
              </div>
              <span className="w-12 text-right text-xs text-muted">{pct(n, f.invited)}%</span>
            </div>
          ))}
          <p className="text-xs text-muted">{tr("The biggest drop between two steps is where to focus: reminders, onboarding help, or a nudge to take the placement test.")}</p>
        </Panel>
        <Panel title={tr("Current levels")}>
          {data.cefr.length === 0 ? (
            <EmptyNote>{tr("No placement results yet.")}</EmptyNote>
          ) : (
            <div className="flex items-end gap-2 h-40">
              {LEVELS.map((lv, i) => {
                const n = data.cefr.find((c) => c.level === lv)?.n ?? 0;
                return (
                  <div key={lv} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                    <span className="text-xs text-muted">{n || ""}</span>
                    <div className="w-full rounded-t" style={{ height: `${(n / maxCefr) * 100}%`, minHeight: n ? 4 : 0, background: paletteColor("moss", i) }} />
                    <span className="text-xs font-semibold text-ink">{lv}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={tr("Organizations compared")}>
        {data.organizations.length === 0 ? (
          <EmptyNote>{tr("No organization learners yet.")}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-rule">
                  <th className="py-2">{tr("Organization")}</th>
                  <th className="py-2">{tr("Learners")}</th>
                  <th className="py-2">{tr("Signed in")}</th>
                  <th className="py-2">{tr("Practised this week")}</th>
                  <th className="py-2">{tr("Placed")}</th>
                  <th className="py-2">{tr("Certified")}</th>
                  <th className="py-2">{tr("Avg minutes")}</th>
                  <th className="py-2">{tr("Typical level")}</th>
                </tr>
              </thead>
              <tbody>
                {data.organizations.map((o) => (
                  <tr key={o.id} className="border-b border-rule last:border-0">
                    <td className="py-2 text-ink font-medium">{o.name}</td>
                    <td className="py-2">{o.learners}</td>
                    {[o.signedIn, o.active7, o.placed, o.certified].map((v, i) => (
                      <td key={i} className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-rule overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct(v, o.learners)}%`, background: paletteColor("sand", i) }} />
                          </div>
                          <span className="text-xs text-muted">{pct(v, o.learners)}%</span>
                        </div>
                      </td>
                    ))}
                    <td className="py-2 text-muted">{o.avgMinutes}</td>
                    <td className="py-2 text-ink">{o.typicalLevel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <Panel title={tr("Licensed but not practising")}>
          {data.inactive.length === 0 ? (
            <EmptyNote>{tr("Everyone with a license practised in the last two weeks.")}</EmptyNote>
          ) : (
            data.inactive.slice(0, 15).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 text-sm border-t border-rule pt-2 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="text-ink truncate">{l.name}</p>
                  <p className="text-xs text-muted truncate">{[l.orgName ?? tr("Individual"), l.batchName].filter(Boolean).join(" · ")}</p>
                </div>
                <span className="text-xs text-muted shrink-0">{l.lastActive ? `Last ${shortDate(l.lastActive)}` : tr("Never practised")}</span>
              </div>
            ))
          )}
          {data.inactive.length > 15 && <p className="text-xs text-muted">{tr("and")}{" "}{data.inactive.length - 15} {tr("more")}</p>}
        </Panel>
        <Panel title={tr("Exams coming up")}>
          {data.exams.length === 0 ? (
            <EmptyNote>{tr("No learner has an exam date in the next 60 days.")}</EmptyNote>
          ) : (
            data.exams.map((e) => {
              const days = Math.ceil((new Date(e.date).getTime() - Date.now()) / 86400000);
              return (
                <div key={e.id} className="flex items-center justify-between gap-3 text-sm border-t border-rule pt-2 first:border-0 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-ink truncate">{e.name}</p>
                    <p className="text-xs text-muted truncate">
                      {[e.orgName ?? tr("Individual"), e.exam?.toUpperCase(), e.level ? `now ${e.level}` : null, e.goal ? `goal ${e.goal}` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${days <= 14 ? "text-error" : "text-muted"}`}>
                    {shortDate(e.date)} · {days} {tr("days")}</span>
                </div>
              );
            })
          )}
        </Panel>
      </div>
    </div>
  );
}
