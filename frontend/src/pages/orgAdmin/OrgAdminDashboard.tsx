import { useEffect, useState } from "react";
import { Layers, ShieldCheck, Users, CalendarCheck, Pencil, Check, X, UserPlus, CheckCircle2, Award, ArrowRight, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OrgLoadError, OrgLoading, OrgNotice, OrgStatTile } from "@/components/OrgAdminUi";
import { getOrgOverview, updateOrganizationName, type OrgAdminOverview } from "@/api/orgAdmin";
import { getOrgLicenseSummary, formatShortDate, type PoolSummary } from "@/api/licenses";
import { Link } from "react-router-dom";
import { ROUTES } from "@/constants/routes";
import { KeyRound } from "lucide-react";
import type { ActivityKind } from "@/api/admin";

import { tr } from "@/i18n/tr";
const SESSION_TYPE_LABEL: Record<string, string> = {
  practice: tr("Practice"),
  mocktest: tr("Mock Test"),
  practice_test: tr("Practice test"),
  final: tr("Final assessment"),
  level_test: tr("Level test"),
  sample: tr("Free sample"),
  placement: tr("Placement"),
  coach: tr("Coach Mode"),
};

const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  signup: UserPlus,
  admin_created: UserPlus,
  session_completed: CheckCircle2,
  placement: Award,
};

function activitySentence(item: OrgAdminOverview["activityFeed"][number]): string {
  const who = item.who.trim() || tr("Someone");
  switch (item.kind) {
    case "signup":
      return item.detail === "manager" ? tr("{{who}} — Manager onboarded", { who: who }) : tr("{{who}} — Learner onboarded", { who: who });
    case "session_completed":
      return tr("{{who}} completed a {{v}} session", { who: who, v: SESSION_TYPE_LABEL[item.detail ?? ""] ?? item.detail });
    // A placement (level) test's review status — not a certificate, which
    // only the final assessment gives.
    case "placement":
      return item.detail === "fraud_confirmed"
        ? tr("{{who}}'s placement test: violation confirmed", { who })
        : item.detail === "pending_review"
          ? tr("{{who}}'s placement test is waiting for review", { who })
          : tr("{{who}} took the placement test", { who });
    default:
      return who;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return tr("{{max}}m ago", { max: Math.max(mins, 0) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return tr("{{hours}}h ago", { hours: hours });
  const days = Math.round(hours / 24);
  return tr("{{days}}d ago", { days: days });
}

function RecentActivity({ data }: { data: OrgAdminOverview["activityFeed"] }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <h2 className="font-display font-bold text-ink flex items-center gap-2">
          <Activity size={17} className="text-navy" /> {tr("Recent activity")}
        </h2>
        <Link to={ROUTES.ORG_ADMIN_AUDIT} className="text-xs font-semibold text-navy hover:underline flex items-center gap-1">
          {tr("Audit log")} <ArrowRight size={13} />
        </Link>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted px-5 pb-5">{tr("Nothing has happened yet.")}</p>
      ) : (
        <ul className="divide-y divide-rule border-t border-rule">
          {data.map((item, i) => {
            const Icon = ACTIVITY_ICON[item.kind] ?? CheckCircle2;
            return (
              <li key={i} className="flex items-center gap-3 text-sm px-5 py-2.5">
                <span className="h-8 w-8 rounded-full bg-navy/10 text-navy flex items-center justify-center shrink-0">
                  <Icon size={15} strokeWidth={1.8} />
                </span>
                <span className="text-ink flex-1 min-w-0">{activitySentence(item)}</span>
                <span className="text-muted text-xs shrink-0 tabular-nums" title={new Date(item.occurredAt).toLocaleString()}>
                  {timeAgo(item.occurredAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OrgNameEditor({ overview, onRenamed }: { overview: OrgAdminOverview; onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(overview.organizationName ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateOrganizationName(name.trim());
      onRenamed(name.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setName(overview.organizationName ?? "");
          setEditing(true);
        }}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors cursor-pointer"
      >
        <Pencil size={13} /> {tr("Rename organization")}</button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-input border border-rule bg-paper px-3 py-1.5 text-sm text-ink focus:border-navy focus:outline-none"
      />
      <button onClick={handleSave} disabled={saving} className="text-success hover:text-success/80 cursor-pointer disabled:opacity-50">
        <Check size={18} />
      </button>
      <button onClick={() => setEditing(false)} className="text-muted hover:text-ink cursor-pointer">
        <X size={18} />
      </button>
    </div>
  );
}

export function OrgAdminDashboard() {
  const [overview, setOverview] = useState<OrgAdminOverview | null>(null);
  const [licenses, setLicenses] = useState<PoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    getOrgOverview()
      .then(setOverview)
      .catch(() => setError(tr("Could not load your organization.")));
    getOrgLicenseSummary()
      .then(setLicenses)
      .catch(() => {});
  }
  useEffect(load, []);

  if (error) return <OrgLoadError text={error} onRetry={load} />;
  if (!overview) return <OrgLoading />;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{overview.organizationName ?? tr("Your organization")}</h1>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <OrgNameEditor overview={overview} onRenamed={(name) => setOverview({ ...overview, organizationName: name })} />
          {overview.onboardedBy && (
            <span className="text-sm text-muted">
              <span aria-hidden className="mr-3">·</span>
              {tr("Onboarded by {{name}} ({{email}})", { name: overview.onboardedBy.name, email: overview.onboardedBy.email })}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <OrgStatTile label={tr("Batches")} value={overview.totalBatches} icon={Layers} index={0} to={ROUTES.ORG_ADMIN_BATCHES} />
        <OrgStatTile label={tr("Managers")} value={overview.totalManagers} icon={ShieldCheck} index={1} to={ROUTES.ORG_ADMIN_MANAGERS} />
        <OrgStatTile label={tr("Learners")} value={overview.totalLearners} icon={Users} index={2} to={ROUTES.ORG_ADMIN_LEARNERS} />
        <OrgStatTile label={tr("Certified")} value={overview.certifiedLearners ?? 0} icon={Award} index={3} to={ROUTES.ORG_ADMIN_CERTIFICATES} />
        <OrgStatTile label={tr("Sessions completed today")} value={overview.sessionsCompletedToday} icon={CalendarCheck} index={4} to={ROUTES.ORG_ADMIN_ANALYTICS} />
      </div>

      {overview.totalBatches === 0 && (
        <OrgNotice>
          {tr("No batches yet — create one from the Batches page, then invite learners into it.")}{" "}
          <Link to={ROUTES.ORG_ADMIN_BATCHES} className="font-semibold text-navy hover:underline">
            {tr("Batches")} →
          </Link>
        </OrgNotice>
      )}

      {licenses && (
        <Link
          to={ROUTES.ORG_ADMIN_LICENSES}
          className="bg-surface border border-rule rounded-card shadow-sm p-5 flex items-center gap-x-6 gap-y-4 flex-wrap hover:border-rule-strong hover:shadow-md transition-all"
        >
          <span className="h-11 w-11 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
            <KeyRound size={22} strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-ink">{tr("Licenses")}</p>
            <p className="text-xs text-muted">
              {licenses.nextPoolExpiry
                ? tr("{{nextPoolExpiryQuantity}} unassigned expire {{formatShortDate}}", { nextPoolExpiryQuantity: licenses.nextPoolExpiryQuantity, formatShortDate: formatShortDate(licenses.nextPoolExpiry) })
                : tr("1 license = 1 learner-month")}
            </p>
          </div>
          {(
            [
              [tr("Available"), licenses.available, "text-ink"],
              [tr("Active learners"), licenses.activeLearners, "text-success"],
              [tr("Ending ≤ 7 days"), licenses.expiringSoonLearners, "text-navy-deep"],
              [tr("No license"), licenses.unlicensedLearners, "text-error"],
            ] as const
          ).map(([label, value, cls]) => (
            <div key={label} className="text-center min-w-24 sm:border-l sm:border-rule sm:pl-6">
              <p className={`font-display font-bold text-xl tabular-nums ${cls}`}>{value}</p>
              <p className="text-[11px] text-muted whitespace-nowrap">{label}</p>
            </div>
          ))}
          <ArrowRight size={16} className="text-muted shrink-0 hidden sm:block" />
        </Link>
      )}

      <RecentActivity data={overview.activityFeed} />
    </div>
  );
}
