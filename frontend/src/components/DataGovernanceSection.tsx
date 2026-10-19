import { useEffect, useState } from "react";
import { Download, FileCheck2 } from "lucide-react";
import { Button } from "@/components/Button";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { planErrorMessage } from "@/api/plans";
import { governanceApi, type DataGovernance } from "@/api/developers";
import { downloadCsv } from "@/api/analytics";

import { tr } from "@/i18n/tr";
const MONTHS = [3, 6, 12, 24, 36];

// Data processing agreement, retention rules and full data export.
export function DataGovernanceSection() {
  const allowed = useHasFeature("data_governance");
  const [data, setData] = useState<DataGovernance | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => governanceApi.get().then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!data) return null;
  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none cursor-pointer";
  const dpaCurrent = data.dpa.acceptedVersion === data.dpa.currentVersion;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      load();
    } catch (err) {
      setMsg({ ok: false, text: planErrorMessage(err) ?? tr("That didn't work. Please try again.") });
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 grid md:grid-cols-[260px_1fr] gap-5">
      <div>
        <h2 className="font-display font-bold text-base text-ink">{tr("Data")}</h2>
        <p className="text-sm text-muted mt-1">{tr("The data processing agreement, how long personal data is kept, and a full export of everything your organization has in Spica.")}</p>
      </div>
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <FileCheck2 size={18} className={dpaCurrent ? "text-success mt-0.5" : "text-warning mt-0.5"} />
          <div className="flex-1">
            <p className="text-sm text-ink">
              {tr("Data processing agreement {{currentVersion}}", { currentVersion: data.dpa.currentVersion })}
              {data.dpa.url && (
                <>
                  {" · "}
                  <a href={data.dpa.url} target="_blank" rel="noreferrer" className="text-navy font-semibold hover:underline">
                    {tr("Read it")}</a>
                </>
              )}
            </p>
            <p className="text-xs text-muted">
              {dpaCurrent
                ? data.dpa.acceptedBy
                  ? tr("Accepted by {{name}} on {{date}}.", { name: data.dpa.acceptedBy, date: new Date(data.dpa.acceptedAt!).toLocaleDateString() })
                  : tr("Accepted by your organization on {{date}}.", { date: new Date(data.dpa.acceptedAt!).toLocaleDateString() })
                : data.dpa.acceptedVersion
                  ? tr("You accepted version {{acceptedVersion}}; a newer version needs accepting.", { acceptedVersion: data.dpa.acceptedVersion })
                  : tr("Not accepted yet.")}
            </p>
          </div>
          {!dpaCurrent && (
            <Button variant="secondary" onClick={() => run(governanceApi.acceptDpa, tr("Agreement accepted."))} className="!px-3.5 !py-2">
              {tr("Accept on behalf of my organization")}</Button>
          )}
        </div>

        <div className="border-t border-rule pt-4 flex flex-col gap-3">
          <PlanLockNote feature="data_governance" compact />
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {tr("Delete voice recordings and face images after")}<select
                disabled={allowed === false}
                value={data.retention.recordingsMonths ?? ""}
                onChange={(e) =>
                  run(() => governanceApi.setRetention({ ...data.retention, recordingsMonths: e.target.value ? Number(e.target.value) : null }), tr("Retention saved."))
                }
                className={inputClass}
              >
                <option value="">{tr("Keep while the account exists")}</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {tr("{{m}} months", { m: m })}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              {tr("Erase learners deactivated for")}<select
                disabled={allowed === false}
                value={data.retention.inactiveLearnerMonths ?? ""}
                onChange={(e) =>
                  run(() => governanceApi.setRetention({ ...data.retention, inactiveLearnerMonths: e.target.value ? Number(e.target.value) : null }), tr("Retention saved."))
                }
                className={inputClass}
              >
                <option value="">{tr("Never automatically")}</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {tr("{{m}} months", { m: m })}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted">{tr("Erasing keeps anonymous practice statistics and license records, and removes everything that identifies the person.")}</p>

          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="secondary"
              disabled={allowed === false || data.exports.some((e) => e.status === "queued")}
              onClick={() => run(governanceApi.requestExport, tr("Export started — you'll get a notification when it's ready."))}
              className="!px-3.5 !py-2"
            >
              {tr("Export all data")}</Button>
            {data.exports
              .filter((e) => e.status === "ready")
              .slice(0, 1)
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => downloadCsv(`/org-admin/data-exports/${e.id}/download`, "spica-export.json")}
                  className="flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline cursor-pointer"
                >
                  <Download size={14} /> {tr("Download export of {{toLocaleDateString}}", { toLocaleDateString: new Date(e.completedAt!).toLocaleDateString() })} ({Math.max(1, Math.round((e.sizeBytes ?? 0) / 1024))} {tr("KB)")}</button>
              ))}
            {data.exports[0]?.status === "queued" && <span className="text-xs text-muted">{tr("Preparing export…")}</span>}
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
