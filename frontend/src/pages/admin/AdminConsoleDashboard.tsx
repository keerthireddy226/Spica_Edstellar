import { useEffect, useState } from "react";
import { Building2, Users, Mail, GraduationCap, UserPlus, ShieldCheck, CheckCircle2, Award } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import {
  getAdminConsoleOverview,
  getAdminActivity,
  type AdminConsoleOverview,
  type AdminActivity,
  type ActivityKind,
} from "@/api/admin";

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

function RecentActivity({ data }: { data: AdminActivity["activityFeed"] }) {
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

// Deliberately smaller and shaped differently from the Super Admin
// dashboard: 4 cards, one combined org table, and a single activity feed —
// not the Super Admin's full 7-card/sessions-by-type layout.
export function AdminConsoleDashboard() {
  const [overview, setOverview] = useState<AdminConsoleOverview | null>(null);
  const [activity, setActivity] = useState<AdminActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminConsoleOverview()
      .then(setOverview)
      .catch(() => setError("Could not load organizations overview."));
    getAdminActivity()
      .then(setActivity)
      .catch(() => {});
  }, []);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!overview) return <p className="text-sm text-muted">Loading…</p>;

  const activeOrgs = overview.organizations.filter((o) => o.active);
  const universityCount = activeOrgs.filter((o) => o.category === "university").length;
  const organizationCount = activeOrgs.filter((o) => o.category !== "university").length;

  const cards: { label: string; value: number; icon: LucideIcon }[] = [
    { label: "Organizations", value: organizationCount, icon: Building2 },
    { label: "Universities", value: universityCount, icon: GraduationCap },
    { label: "Learners across orgs", value: overview.totalLearners, icon: Users },
    { label: "Pending invitations", value: overview.pendingInvitations, icon: Mail },
  ];

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Organizations overview</h1>
        <p className="text-sm text-muted mt-1">The organizations you work with, and how they're doing.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon }, i) => (
          <div
            key={label}
            style={cardGradient(i)}
            className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4"
          >
            <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
              <Icon size={22} strokeWidth={1.8} />
            </span>
            <div>
              <p className="text-2xl font-display font-bold text-white">{value}</p>
              <p className="text-xs text-white/80">{label}</p>
            </div>
          </div>
        ))}
      </div>


      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Organization</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Learners</th>
              <th className="px-4 py-3">Org Admin assigned</th>
            </tr>
          </thead>
          <tbody>
            {overview.organizations.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No organizations yet.
                </td>
              </tr>
            )}
            {overview.organizations.map((org) => (
              <tr key={org.id} className="border-b border-rule last:border-0">
                <td className="px-4 py-3 text-ink font-medium">{org.name}</td>
                <td className="px-4 py-3 text-muted">{org.category === "university" ? "University" : "Organization"}</td>
                <td className="px-4 py-3 text-muted">{org.learnerCount}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                      org.orgAdminStatus === "active"
                        ? "bg-success/15 text-success"
                        : org.orgAdminStatus === "pending"
                          ? "bg-warning/15 text-navy-deep"
                          : "bg-warning/15 text-warning"
                    }`}
                  >
                    {org.orgAdminStatus === "active" ? "Active" : org.orgAdminStatus === "pending" ? "Invite pending" : "Not yet"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activity && <RecentActivity data={activity.activityFeed} />}
    </div>
  );
}
