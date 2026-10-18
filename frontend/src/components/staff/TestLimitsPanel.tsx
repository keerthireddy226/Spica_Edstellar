import { useEffect, useState } from "react";
import { SHOW_UNIVERSITIES } from "@/lib/focus";
import { Button } from "@/components/Button";
import { Panel } from "@/components/staff/StaffKit";
import { getPlanQuotas, savePlanQuota, type PlanQuota } from "@/api/admin";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/i18n/tr";

const SEGMENT_LABEL: Record<PlanQuota["segment"], () => string> = {
  individual: () => tr("Individuals"),
  company: () => tr("Companies"),
  university: () => tr("Universities"),
};

const TIER_LABEL: Record<string, () => string> = {
  free: () => tr("Free"),
  plus: () => tr("Plus"),
  starter: () => tr("Starter"),
  business: () => tr("Business"),
  enterprise: () => tr("Enterprise"),
  campus: () => tr("Campus"),
};

// "" in the box = unlimited.
const toBox = (n: number | null) => (n === null ? "" : String(n));
const fromBox = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.round(Number(s))));

const inputClass = "w-24 rounded-input border border-rule bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-navy focus:outline-none";

// How many practice tests and mock exams each plan allows a learner per
// month. Super Admins change them; changes apply from the next test started.
export function TestLimitsPanel() {
  const canEdit = useAuth().user?.role === "super_admin";
  const [rows, setRows] = useState<PlanQuota[] | null>(null);
  const [draft, setDraft] = useState<Record<string, { practice: string; mocks: string; report: PlanQuota["reportLevel"] }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    getPlanQuotas()
      .then((r) => {
        setRows(r.quotas);
        setDraft(Object.fromEntries(r.quotas.map((q) => [`${q.segment}/${q.tier}`, { practice: toBox(q.practicePerMonth), mocks: toBox(q.mocksPerMonth), report: q.reportLevel }])));
      })
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function save(q: PlanQuota) {
    const key = `${q.segment}/${q.tier}`;
    const d = draft[key];
    setSaving(key);
    setMessage(null);
    try {
      await savePlanQuota({ segment: q.segment, tier: q.tier, practicePerMonth: fromBox(d.practice), mocksPerMonth: fromBox(d.mocks), reportLevel: d.report });
      setMessage(tr("Saved. New limits apply to the next test a learner starts."));
      load();
    } catch {
      setMessage(tr("Could not save. Try again."));
    } finally {
      setSaving(null);
    }
  }

  if (!rows) return null;
  return (
    <Panel title={tr("Monthly test limits")}>
      <p className="text-xs text-muted">
        {tr("Practice tests and mock exams each learner can start per month of access (a license month, e.g. 16 Oct to 16 Nov; the calendar month for learners without a license). Empty means unlimited. Candidates take their one assessment and have no limits.")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-rule">
              <th className="py-2 pr-3 font-semibold">{tr("Plan")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Practice tests")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Mock exams")}</th>
              <th className="py-2 pr-3 font-semibold">{tr("Feedback report")}</th>
              {canEdit && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.filter((q) => SHOW_UNIVERSITIES || (q.segment !== "university" && q.tier !== "campus")).map((q) => {
              const key = `${q.segment}/${q.tier}`;
              const d = draft[key];
              const changed = d && (d.practice !== toBox(q.practicePerMonth) || d.mocks !== toBox(q.mocksPerMonth) || d.report !== q.reportLevel);
              const set = (patch: Partial<typeof d>) => setDraft((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
              return (
                <tr key={key} className="border-b border-rule/60">
                  <td className="py-2 pr-3 text-ink">
                    {SEGMENT_LABEL[q.segment]()} · {TIER_LABEL[q.tier]?.() ?? q.tier}
                  </td>
                  <td className="py-2 pr-3">
                    {canEdit ? (
                      <input type="number" min={0} value={d.practice} placeholder={tr("Unlimited")} onChange={(e) => set({ practice: e.target.value })} className={inputClass} />
                    ) : (
                      (q.practicePerMonth ?? tr("Unlimited"))
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {canEdit ? (
                      <input type="number" min={0} value={d.mocks} placeholder={tr("Unlimited")} onChange={(e) => set({ mocks: e.target.value })} className={inputClass} />
                    ) : (
                      (q.mocksPerMonth ?? tr("Unlimited"))
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {canEdit ? (
                      <select value={d.report} onChange={(e) => set({ report: e.target.value as PlanQuota["reportLevel"] })} className={`${inputClass} w-28 cursor-pointer`}>
                        <option value="summary">{tr("Summary")}</option>
                        <option value="full">{tr("Full")}</option>
                      </select>
                    ) : q.reportLevel === "full" ? (
                      tr("Full")
                    ) : (
                      tr("Summary")
                    )}
                  </td>
                  {canEdit && (
                    <td className="py-2 text-right">
                      <Button variant="secondary" disabled={!changed || saving === key} onClick={() => save(q)} className="!px-3 !py-1.5 text-xs">
                        {tr("Save")}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && <p className="text-xs text-muted">{message}</p>}
    </Panel>
  );
}
