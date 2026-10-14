import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Building2, GraduationCap, ShieldCheck, CheckCircle2, UserPlus, Activity, AlertTriangle, UserCheck2, Award } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getAdminStats, getAdminActivity, type AdminStats, type AdminActivity, type ActivityKind } from "@/api/admin";
import { ROUTES } from "@/constants/routes";
import { cardGradient } from "@/lib/cardGradients";

const CARDS: { key: keyof AdminStats; label: string; icon: LucideIcon }[] = [
  { key: "totalLearners", label: "Total learners", icon: Users },
  { key: "totalOrganizations", label: "Organizations", icon: Building2 },
  { key: "totalUniversities", label: "Universities", icon: GraduationCap },
  { key: "totalAdmins", label: "Admins & org admins", icon: ShieldCheck },
  { key: "sessionsCompletedToday", label: "Sessions completed today", icon: CheckCircle2 },
  { key: "signupsThisWeek", label: "Signups this week", icon: UserPlus },
  // Distinct accounts with a currently valid, non-revoked session —
  // "logged in right now," not "doing something right now."
  { key: "activeNow", label: "Logged in now", icon: Activity },
];

const SESSION_TYPE_LABEL: Record<string, string> = {
  practice: "Practice",
  mocktest: "Mock Test",
  placement: "Placement",
  coach: "Coach Mode",
};

const ACTIVITY_ICON: Record<ActivityKind, LucideIcon> = {
  signup: UserPlus,
  admin_created: ShieldCheck,
  session_completed: CheckCircle2,
  placement: Award,
};

function activitySentence(item: AdminActivity["activityFeed"][number]): string {
  const who = item.who.trim() || "Someone";
  switch (item.kind) {
    case "signup":
      return `${who} signed up`;
    case "admin_created":
      return `${who} — ${item.detail === "org_admin" ? "Org Admin" : "Admin"} account created`;
    case "session_completed":
      return `${who} completed a ${SESSION_TYPE_LABEL[item.detail ?? ""] ?? item.detail} session`;
    case "placement":
      return `${who}'s placement result: ${item.detail === "certified" ? "Certified" : item.detail === "fraud_confirmed" ? "Fraud flagged" : "Pending review"}`;
    default:
      return who;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Same gradient treatment as the other stat cards — green when all-clear,
// red (and clickable through to the Review Queue) when something's waiting.
function NeedsAttention({ count }: { count: number }) {
  const gradient =
    count > 0
      ? { background: "linear-gradient(135deg, var(--color-error), color-mix(in srgb, var(--color-error) 100%, black 30%))" }
      : { background: "linear-gradient(135deg, var(--color-success), color-mix(in srgb, var(--color-success) 100%, black 35%))" };

  const content = (
    <>
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        {count > 0 ? <AlertTriangle size={22} strokeWidth={1.8} /> : <UserCheck2 size={22} strokeWidth={1.8} />}
      </span>
      <div>
        <p className="text-2xl font-display font-bold text-white">{count}</p>
        <p className="text-xs text-white/80">{count === 1 ? "placement pending review" : "placements pending review"}</p>
      </div>
    </>
  );

  if (count === 0) {
    return (
      <div style={gradient} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
        {content}
      </div>
    );
  }
  return (
    <Link to={ROUTES.ADMIN_REVIEW} style={gradient} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
      {content}
    </Link>
  );
}

function ActivityFeed({ data }: { data: AdminActivity["activityFeed"] }) {
  return (
    <div className="bg-navy/5 border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <h3 className="font-mono text-[11px] font-medium tracking-[.2em] uppercase text-muted">Recent activity</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted">Nothing has happened yet.</p>
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

function SessionsByTypeBars({ data }: { data: AdminActivity["sessionsByType"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bg-accent/5 border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <h3 className="font-mono text-[11px] font-medium tracking-[.2em] uppercase text-muted">Sessions by type</h3>
      <div className="flex flex-col gap-3">
        {data.length === 0 && <p className="text-sm text-muted">No sessions yet.</p>}
        {data.map((d) => (
          <div key={d.type} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink font-medium">{SESSION_TYPE_LABEL[d.type] ?? d.type}</span>
              <span className="text-muted font-mono text-xs">{d.count}</span>
            </div>
            <div className="h-2 rounded-pill bg-paper-warm overflow-hidden">
              <div className="h-full bg-accent rounded-pill" style={{ width: `${(d.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentSignupsTable({ data }: { data: AdminActivity["recentSignups"] }) {
  return (
    <div className="bg-warning/5 border border-rule rounded-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-rule">
        <h3 className="font-mono text-[11px] font-medium tracking-[.2em] uppercase text-muted">Recent signups</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted px-5 py-4">No signups yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Email</th>
              <th className="px-5 py-3">Organization</th>
              <th className="px-5 py-3">Joined</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-b border-rule last:border-0">
                <td className="px-5 py-3 text-ink font-medium">{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-5 py-3 text-muted">{u.email}</td>
                <td className="px-5 py-3 text-muted">{u.tenantName && u.tenantType === "cohort" ? u.tenantName : "Individual"}</td>
                <td className="px-5 py-3 text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${u.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                    {u.active ? "Active" : "Deactivated"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<AdminActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAdminStats(), getAdminActivity()])
      .then(([s, a]) => {
        setStats(s);
        setActivity(a);
      })
      .catch(() => setError("Could not load the dashboard."));
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Platform overview</h1>
        <p className="text-sm text-muted mt-1">Everything on Spica, at a glance.</p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {!stats && !error && <p className="text-sm text-muted">Loading…</p>}

      {stats && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {activity && <NeedsAttention count={activity.needsAttention} />}
          {CARDS.map(({ key, label, icon: Icon }, i) => (
            <div
              key={key}
              style={cardGradient(i)}
              className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4"
            >
              <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-2xl font-display font-bold text-white">{stats[key]}</p>
                <p className="text-xs text-white/80">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activity && (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <ActivityFeed data={activity.activityFeed} />
            <SessionsByTypeBars data={activity.sessionsByType} />
          </div>
          <RecentSignupsTable data={activity.recentSignups} />
        </>
      )}
    </div>
  );
}
