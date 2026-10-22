import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, History, Pencil } from "lucide-react";
import { Button } from "@/components/Button";
import { AUDIT_VERBS } from "@/lib/auditVerbs";
import { countryName, sortedCountries } from "@/constants/demographics";
import { getMyActivity, getMySummary, getMyWork, saveMyWork, type WorkDetails } from "@/api/me";
import { ago } from "@/api/staff";
import { StatCard } from "@/components/staff/StaffKit";
import { LearnerCard } from "@/components/learner/LearnerHero";
import { BarChart3, Building2, Layers, Users } from "lucide-react";
import { CitySelect } from "@/components/CitySelect";

import { tr } from "@/i18n/tr";
import { trServer } from "@/i18n/serverText";
const ICONS = [Building2, Users, Layers, BarChart3];

// A row of numbers about what this person looks after.
export function RoleSummary() {
  const [data, setData] = useState<{ heading?: string; items: [string, number | string][] } | null>(null);
  useEffect(() => {
    getMySummary()
      .then(setData)
      .catch(() => {});
  }, []);
  if (!data || data.items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {data.heading && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{trServer(data.heading)}</p>}
      <div className={`grid grid-cols-2 ${data.items.length === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"} gap-4`}>
        {data.items.map(([label, value], i) => (
          <StatCard key={label} variant="tint" palette="terracotta" index={i} icon={ICONS[i % ICONS.length]} value={value} label={trServer(label)} />
        ))}
      </div>
    </div>
  );
}

const input = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

// Job title, department, phone and where they work; editable.
export function WorkDetailsCard({ showRegion }: { showRegion: boolean }) {
  const { i18n } = useTranslation();
  const [w, setW] = useState<WorkDetails | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = () =>
    getMyWork()
      .then((x) => {
        setW(x);
        setDraft(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v ?? ""])));
      })
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!w) return null;
  const f = (k: string) => ({ value: draft[k] ?? "", onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value })) });
  const rows: [string, string | null][] = [
    [tr("Job title"), w.jobTitle],
    [tr("Department"), w.department],
    [tr("Phone"), w.phone],
    ...(showRegion ? ([[tr("Region"), w.region]] as [string, string | null][]) : []),
    [tr("City"), w.city],
    [tr("Country"), w.country ? countryName(w.country, i18n.language) : null],
  ];

  return (
    <LearnerCard
      title={tr("Work details")}
      icon={Briefcase}
      color="#c9965c"
      action={
        !editing && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs font-semibold text-navy hover:underline cursor-pointer">
            <Pencil size={13} /> {tr("Edit")}</button>
        )
      }
    >
      {!editing ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {rows.map(([l, v]) => (
            <div key={l}>
              <p className="text-xs text-muted">{l}</p>
              <p className="text-sm text-ink">{v || "—"}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input {...f("jobTitle")} placeholder={tr("Job title")} className={input} />
            <input {...f("department")} placeholder={tr("Department")} className={input} />
            <input {...f("phone")} placeholder={tr("Phone")} className={input} />
            {showRegion && <input {...f("region")} placeholder={tr("Region or territory")} className={input} />}
            <select value={draft.country ?? ""} onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value, city: "" }))} className={`${input} cursor-pointer`}>
              <option value="">{tr("Country")}</option>
              {sortedCountries(i18n.language).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <CitySelect country={draft.country ?? ""} value={draft.city ?? ""} onChange={(city) => setDraft((d) => ({ ...d, city }))} className={input} placeholder={tr("City")} />
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await saveMyWork(draft);
                  setEditing(false);
                  setSaved(true);
                  load();
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? tr("Saving…") : tr("Save")}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {tr("Cancel")}</Button>
          </div>
        </div>
      )}
      {saved && !editing && <p className="text-xs text-success">{tr("Saved.")}</p>}
    </LearnerCard>
  );
}

const capitalize = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

// The changes this person made recently, from the audit log.
export function MyRecentActions() {
  const [rows, setRows] = useState<{ action: string; targetLabel: string | null; orgName: string | null; createdAt: string }[] | null>(null);
  useEffect(() => {
    getMyActivity()
      .then((r) => setRows(r.entries))
      .catch(() => setRows([]));
  }, []);
  if (!rows) return null;
  return (
    <LearnerCard title={tr("Your recent actions")} icon={History} color="#b97a62" action={<span className="text-xs text-muted">{tr("Last {{min}}", { min: Math.min(rows.length, 25) })}</span>}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{tr("Nothing yet — changes you make show up here.")}</p>
      ) : (
        <div className="flex flex-col">
          {rows.slice(0, 25).map((r, i) => (
            <div key={i} className="flex items-start gap-3 py-2.5 border-b border-rule last:border-b-0">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: ["#b5653f", "#c9965c", "#6e9660", "#a8613f"][i % 4] }} />
              <p className="flex-1 text-sm text-ink">
                {/* The action alone ("Assigned licenses to …"): "You" + verb doesn't agree in every language. */}
                {capitalize(AUDIT_VERBS[r.action] ?? r.action.replace(/[._]/g, " "))} <span className="font-semibold">{r.targetLabel ?? ""}</span>
                {r.orgName ? <span className="text-muted"> · {r.orgName}</span> : null}
              </p>
              <span className="text-xs text-muted shrink-0">{ago(r.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </LearnerCard>
  );
}
