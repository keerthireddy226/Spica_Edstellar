import { useEffect, useState } from "react";
import { Layers, ShieldCheck, Users, CalendarCheck, Pencil, Check, X, UserPlus, CheckCircle2, Award } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
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
      return tr("{{who}} — {{v}} onboarded", { who: who, v: item.detail === "manager" ? "Manager" : "Learner" });
    case "session_completed":
      return tr("{{who}} completed a {{v}} session", { who: who, v: SESSION_TYPE_LABEL[item.detail ?? ""] ?? item.detail });
    case "placement":
      return `${who}'s placement result: ${item.detail === "certified" ? tr("Certified") : item.detail === "fraud_confirmed" ? tr("Fraud flagged") : tr("Pending review")}`;
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
    <div className="bg-navy/5 border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <h3 className="font-mono text-[11px] font-medium tracking-[.2em] uppercase text-muted">{tr("Recent activity")}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted">{tr("Nothing has happened yet.")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((item, i) => {
            const Icon = ACTIVITY_ICON[item.kind];
            return (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="h-8 w-8 rounded-full bg-navy/10 text-navy flex items-center justify-center shrink-0">
                  <Icon size={16} strokeWidth={1.8} />
                </span>
                <span className="text-ink flex-1">{activitySentence(item)}</span>
                <span className="text-muted text-xs shrink-0">{timeAgo(item.occurredAt)}</span>
              </div>
            );
          })}
        </div>
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

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
      </div>
    </div>
  );
}

export function OrgAdminDashboard() {
  const [overview, setOverview] = useState<OrgAdminOverview | null>(null);
  const [licenses, setLicenses] = useState<PoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrgOverview()
      .then(setOverview)
      .catch(() => setError(tr("Could not load your organization.")));
    getOrgLicenseSummary()
      .then(setLicenses)
      .catch(() => {});
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">{tr("Loading…")}</p>;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{overview.organizationName ?? tr("Your organization")}</h1>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <OrgNameEditor overview={overview} onRenamed={(name) => setOverview({ ...overview, organizationName: name })} />
          {overview.onboardedBy && (
            <span className="text-sm text-muted">{tr("· Onboarded by {{name}}({{email}})", { name: overview.onboardedBy.name, email: overview.onboardedBy.email })}</span>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={tr("Batches")} value={overview.totalBatches} icon={Layers} index={0} />
        <StatCard label={tr("Managers")} value={overview.totalManagers} icon={ShieldCheck} index={1} />
        <StatCard label={tr("Learners")} value={overview.totalLearners} icon={Users} index={2} />
        <StatCard label={tr("Sessions completed today")} value={overview.sessionsCompletedToday} icon={CalendarCheck} index={3} />
      </div>

      {overview.totalBatches === 0 && (
        <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
          {tr("No batches yet — create one from the Batches page, then invite learners into it.")}</p>
      )}

      {licenses && (
        <Link
          to={ROUTES.ORG_ADMIN_LICENSES}
          className="bg-surface border border-rule rounded-card shadow-sm p-5 flex items-center gap-5 flex-wrap hover:border-rule-strong transition-colors"
        >
          <span className="h-11 w-11 rounded-2xl bg-navy/10 text-navy flex items-center justify-center shrink-0">
            <KeyRound size={22} strokeWidth={1.8} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-ink">{tr("Licenses")}</p>
            <p className="text-xs text-muted">
              {licenses.nextPoolExpiry
                ? tr("{{nextPoolExpiryQuantity}} unassigned expire {{formatShortDate}}", { nextPoolExpiryQuantity: licenses.nextPoolExpiryQuantity, formatShortDate: formatShortDate(licenses.nextPoolExpiry) })
                : "1 license = 1 learner-month"}
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
            <div key={label} className="text-center min-w-20">
              <p className={`font-display font-bold text-xl ${cls}`}>{value}</p>
              <p className="text-[11px] text-muted">{label}</p>
            </div>
          ))}
        </Link>
      )}

      <RecentActivity data={overview.activityFeed} />
    </div>
  );
}
