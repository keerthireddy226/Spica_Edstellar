import { useEffect, useState } from "react";
import { Mail, ShieldCheck, LogOut, CalendarDays, Clock, KeyRound, Monitor, Briefcase, Lock, LockOpen, Pencil, UserCircle2, BadgeCheck, UserCog, Building2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HERO_GRADIENT, LearnerCard } from "@/components/learner/LearnerHero";
import {
  useAuth,
  getLoginHistory,
  getActiveSessions,
  revokeSession,
  type LoginHistoryEntry,
  type ActiveSession,
} from "@/hooks/useAuth";
import { PERMISSION_LABELS, type AdminPermissions } from "@/api/admin";
import { getOrgOverview } from "@/api/orgAdmin";
import { Button } from "@/components/Button";
import { OrganizationProfileCard } from "@/components/OrganizationProfileCard";
import { HandoverCard } from "@/components/HandoverCard";
import { MfaCard } from "@/components/MfaCard";
import { MyRecentActions, RoleSummary, WorkDetailsCard } from "@/components/profile/ProfileExtras";
import { ManagerPreferencesCard } from "@/components/ManagerPreferencesCard";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  manager: "Manager",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "First login";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function SectionCard({ title, icon, color, children }: { title: string; icon: LucideIcon; color: string; children: React.ReactNode }) {
  return (
    <LearnerCard title={title} icon={icon} color={color}>
      {children}
    </LearnerCard>
  );
}

function AccountDetails({ user, onboardedBy, firstName, lastName, setFirstName, setLastName, saving, saved, onSave }: {
  user: ReturnType<typeof useAuth>["user"];
  onboardedBy: { id: string; email: string; name: string; role?: string } | null;
  firstName: string;
  lastName: string;
  setFirstName: (v: string) => void;
  setLastName: (v: string) => void;
  saving: boolean;
  saved: boolean;
  onSave: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const origFirstName = user?.firstName ?? "";
  const origLastName = user?.lastName ?? "";
  const isDirty = firstName.trim() !== origFirstName || lastName.trim() !== origLastName;

  function handleCancel() {
    setFirstName(origFirstName);
    setLastName(origLastName);
    setEditing(false);
  }

  async function handleSave() {
    await onSave();
    setEditing(false);
  }

  return (
    <SectionCard title="Account details" icon={UserCircle2} color="var(--color-navy)">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div className="flex items-start gap-2 text-sm">
          <UserCircle2 size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted">Name</p>
            <p className="text-ink">{[origFirstName, origLastName].filter(Boolean).join(" ") || "Not named yet"}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Mail size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted">Email</p>
            <p className="text-ink">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <BadgeCheck size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted">Role</p>
            <p className="text-ink">{user ? (ROLE_LABEL[user.role] ?? user.role) : "—"}</p>
          </div>
        </div>
        {user?.department && (
          <div className="flex items-start gap-2 text-sm">
            <Briefcase size={16} className="text-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted">Department</p>
              <p className="text-ink">{user.department}</p>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2 text-sm">
          <CalendarDays size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted">Member since</p>
            <p className="text-ink">{formatDate(user?.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <Clock size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-muted">Last login</p>
            <p className="text-ink">{formatDateTime(user?.lastLoginAt)}</p>
          </div>
        </div>
        {onboardedBy && (
          <div className="flex items-start gap-2 text-sm">
            <UserCog size={16} className="text-muted mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-muted">Onboarded by</p>
              <p className="text-ink">
                {onboardedBy.name}
                {onboardedBy.role ? `, ${ROLE_LABEL[onboardedBy.role] ?? onboardedBy.role}` : ""}
              </p>
              {onboardedBy.name !== onboardedBy.email && <p className="text-xs text-muted">{onboardedBy.email}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-3 border-t border-rule">
        {!editing ? (
          <Button
            variant="secondary"
            onClick={() => setEditing(true)}
            className="self-start flex items-center gap-2 !px-3.5 !py-1.5 !text-xs"
          >
            <Pencil size={13} /> Edit name
          </Button>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">First name</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoFocus
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">Last name</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving || !isDirty || !firstName.trim() || !lastName.trim()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="secondary" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
              {saved && <span className="text-xs text-success">Saved.</span>}
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}

export function SecuritySection({ email }: { email: string | undefined }) {
  const { forgotPassword } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleResetPassword() {
    if (!email) return;
    setSending(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <SectionCard title="Password" icon={KeyRound} color="#c9965c">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2 text-sm">
          <KeyRound size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-ink">Change your password with a link sent to your email.</p>
            <p className="text-xs text-muted">You don't need your current password.</p>
          </div>
        </div>
        <Button variant="secondary" onClick={handleResetPassword} disabled={sending || sent}>
          {sent ? "Email sent" : sending ? "Sending…" : "Send reset link"}
        </Button>
      </div>
      {sent && <p className="text-xs text-success">Check {email} for a link to set a new password.</p>}
    </SectionCard>
  );
}

export function LoginHistorySection() {
  const [logins, setLogins] = useState<LoginHistoryEntry[] | null>(null);

  useEffect(() => {
    getLoginHistory()
      .then((res) => setLogins(res.logins))
      .catch(() => setLogins([]));
  }, []);

  return (
    <SectionCard title="Recent sign-ins" icon={Monitor} color="#b97a62">
      {!logins && <p className="text-sm text-muted">Loading…</p>}
      {logins?.length === 0 && <p className="text-sm text-muted">No login history yet.</p>}
      {logins && logins.length > 0 && (
        <div className="flex flex-col gap-3">
          {logins.map((l, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <span className="h-8 w-8 rounded-full bg-navy/10 text-navy flex items-center justify-center shrink-0">
                <Monitor size={15} strokeWidth={1.8} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-ink truncate">{l.device}</p>
                <p className="text-xs text-muted truncate">{l.ipAddress ?? "Unknown IP"}</p>
              </div>
              <span className="text-muted text-xs shrink-0">{formatDateTime(l.occurredAt)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function PermissionsSection({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  // Org Admin / Manager aren't gated by the permissions system at all — their
  // scope comes from tenant/batch assignment instead, so this card doesn't apply.
  if (user?.role === "org_admin" || user?.role === "manager") return null;

  if (user?.role === "super_admin") {
    return (
      <SectionCard title="Your permissions" icon={ShieldCheck} color="var(--color-success)">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck size={16} className="text-success shrink-0" />
          <span className="text-ink">Full platform access — Super Admin isn't gated by individual permissions.</span>
        </div>
      </SectionCard>
    );
  }

  const permissions = (user?.permissions ?? {}) as AdminPermissions;
  const granted = (Object.keys(PERMISSION_LABELS) as (keyof AdminPermissions)[]).filter((k) => permissions[k]);

  return (
    <SectionCard title="Your permissions" icon={ShieldCheck} color="var(--color-success)">
      {granted.length === 0 ? (
        <p className="text-sm text-muted">No permissions granted yet — ask a Super Admin to grant you some.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {granted.map((key) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <ShieldCheck size={15} className="text-success shrink-0" />
              <span className="text-ink">{PERMISSION_LABELS[key]}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  function load() {
    getActiveSessions()
      .then((res) => setSessions(res.sessions))
      .catch(() => setSessions([]));
  }

  useEffect(load, []);

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await revokeSession(id);
      load();
    } finally {
      setRevoking(null);
    }
  }

  return (
    <SectionCard title="Active sessions" icon={Lock} color="#8a8f4f">
      {!sessions && <p className="text-sm text-muted">Loading…</p>}
      {sessions?.length === 0 && <p className="text-sm text-muted">No active sessions.</p>}
      {sessions && sessions.length > 0 && (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 text-sm">
              <span className="h-8 w-8 rounded-full bg-navy/10 text-navy flex items-center justify-center shrink-0">
                {s.isCurrent ? <LockOpen size={15} strokeWidth={1.8} /> : <Lock size={15} strokeWidth={1.8} />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-ink truncate">{s.isCurrent ? "This device" : "Other session"}</p>
                <p className="text-xs text-muted truncate">
                  Started {formatDateTime(s.createdAt)} · Expires {formatDateTime(s.expiresAt)}
                </p>
              </div>
              {s.isCurrent ? (
                <span className="text-xs text-muted shrink-0">Current</span>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => handleRevoke(s.id)}
                  disabled={revoking === s.id}
                  className="!px-3 !py-1.5 !text-xs shrink-0"
                >
                  {revoking === s.id ? "Logging out…" : "Log out"}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

type ProfileTab = "account" | "organization" | "security" | "activity";

// One profile page for every staff and organization role: a header with who
// they are, then tabs so each part has room without one long scroll.
export function AdminProfile() {
  const { user, updateName, logout } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Whoever added this account: an Org Admin for Managers, an Admin for Org Admins.
  const onboardedBy = user?.onboardedBy ?? null;
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("account");

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
  }, [user]);

  useEffect(() => {
    if (user?.role !== "org_admin") return;
    getOrgOverview()
      .then((o) => {
        setOrganizationName(o.organizationName);
      })
      .catch(() => {});
  }, [user?.role]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await updateName(firstName.trim(), lastName.trim());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || user?.email.slice(0, 2).toUpperCase() || "?";
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Not named yet";
  const role = user?.role;
  const tabs: [ProfileTab, string][] = [
    ["account", "Account"],
    ...(role === "org_admin" ? ([["organization", "Organization"]] as [ProfileTab, string][]) : []),
    ["security", "Security"],
    ["activity", "Activity"],
  ];

  const account = (
    <AccountDetails
      user={user}
      onboardedBy={onboardedBy}
      firstName={firstName}
      lastName={lastName}
      setFirstName={setFirstName}
      setLastName={setLastName}
      saving={saving}
      saved={saved}
      onSave={handleSave}
    />
  );

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto">
      <div className="relative overflow-hidden rounded-card shadow-sm text-white" style={{ background: HERO_GRADIENT }}>
        <span className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute right-56 -bottom-28 h-56 w-56 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-5 flex-wrap px-6 sm:px-8 pt-7 pb-6">
          <span className="h-20 w-20 rounded-2xl ring-2 ring-white/40 flex items-center justify-center text-2xl font-display font-bold shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
            {initials}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-2xl sm:text-3xl truncate">{fullName}</h1>
            <p className="text-sm text-white/85 truncate flex items-center gap-1.5 mt-0.5">
              <Mail size={14} /> {user?.email}
              {organizationName ? <span className="flex items-center gap-1.5"> · <Building2 size={14} /> {organizationName}</span> : null}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-pill bg-white text-navy-deep">
                <ShieldCheck size={13} /> {role ? (ROLE_LABEL[role] ?? role) : "—"}
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-pill border border-white/30" style={{ background: "rgba(255,255,255,0.15)" }}>
                Member since {formatDate(user?.createdAt)}
              </span>
              {onboardedBy && (
                <span className="text-xs font-semibold px-2.5 py-1 rounded-pill border border-white/30" style={{ background: "rgba(255,255,255,0.15)" }}>
                  Onboarded by {onboardedBy.name}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 px-4 py-2 rounded-pill bg-white text-navy-deep text-sm font-semibold hover:bg-white/90 transition-colors cursor-pointer shrink-0"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
        <div className="relative flex items-center gap-1 px-4 sm:px-6 bg-surface border-b border-rule overflow-x-auto">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                tab === key ? "border-navy text-navy-deep" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "account" && (
        <>
          <RoleSummary />
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <div className="flex flex-col gap-6">{account}</div>
            <div className="flex flex-col gap-6">
              <WorkDetailsCard showRegion={role === "admin" || role === "super_admin"} />
              <PermissionsSection user={user} />
              {role === "manager" && <ManagerPreferencesCard />}
            </div>
          </div>
        </>
      )}

      {tab === "organization" && role === "org_admin" && (
        <>
          <OrganizationProfileCard />
          <HandoverCard />
        </>
      )}

      {tab === "security" && (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <div className="flex flex-col gap-6">
            <SecuritySection email={user?.email} />
            <MfaCard />
          </div>
          <div className="flex flex-col gap-6">
            <ActiveSessionsSection />
            <LoginHistorySection />
          </div>
        </div>
      )}

      {tab === "activity" && <MyRecentActions />}
    </div>
  );
}
