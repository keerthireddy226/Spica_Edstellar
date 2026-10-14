import { useEffect, useState } from "react";
import { Mail, ShieldCheck, LogOut, CalendarDays, Clock, KeyRound, Monitor, Briefcase, Lock, LockOpen, Pencil, UserCircle2, BadgeCheck, UserCog } from "lucide-react";
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

function SectionCard({ title, tint, children }: { title: string; tint: string; children: React.ReactNode }) {
  return (
    <div className={`${tint} border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4`}>
      <h2 className="font-mono text-[11px] font-medium tracking-[.2em] uppercase text-muted">{title}</h2>
      {children}
    </div>
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
    <SectionCard title="Account details" tint="bg-navy/5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
    <SectionCard title="Security" tint="bg-warning/5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-2 text-sm">
          <KeyRound size={16} className="text-muted mt-0.5 shrink-0" />
          <div>
            <p className="text-ink font-medium">Password</p>
            <p className="text-xs text-muted">Reset your password via an emailed link — no current password needed here.</p>
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
    <SectionCard title="Recent login activity" tint="bg-error/5">
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
      <SectionCard title="Your permissions" tint="bg-accent/5">
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
    <SectionCard title="Your permissions" tint="bg-accent/5">
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
    <SectionCard title="Active sessions" tint="bg-navy/5">
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

export function AdminProfile() {
  const { user, updateName, logout } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Whoever added this account: an Org Admin for Managers, an Admin for Org Admins.
  const onboardedBy = user?.onboardedBy ?? null;
  const [organizationName, setOrganizationName] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Profile</h1>
        <p className="text-sm text-muted mt-1">Your account, work details, what you look after, security and sign-in activity.</p>
      </div>

      <div
        style={{ background: "linear-gradient(135deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 100%, black 35%))" }}
        className="rounded-card shadow-sm p-6 flex items-center gap-5 flex-wrap"
      >
        <span className="h-16 w-16 rounded-full bg-white/20 text-white flex items-center justify-center text-xl font-bold shrink-0">
          {initials}
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-xl text-white truncate">{fullName}</p>
          <p className="text-sm text-white/80 truncate">
            {user?.email}
            {organizationName ? ` · ${organizationName}` : ""}
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-pill bg-white/20 text-white mt-2">
            <ShieldCheck size={13} /> {user ? (ROLE_LABEL[user.role] ?? user.role) : "—"}
          </span>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 px-4 py-2 rounded-pill border border-white/40 text-white text-sm font-semibold hover:bg-white/15 transition-colors cursor-pointer shrink-0"
        >
          <LogOut size={16} /> Log out
        </button>
      </div>

      <RoleSummary />

      <div className="grid lg:grid-cols-2 gap-4 items-start">
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
        <div className="flex flex-col gap-4">
          <SecuritySection email={user?.email} />
          <PermissionsSection user={user} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <WorkDetailsCard showRegion={user?.role === "admin" || user?.role === "super_admin"} />
        <MyRecentActions />
      </div>

      <MfaCard />
      {user?.role === "manager" && <ManagerPreferencesCard />}
      {user?.role === "org_admin" && <OrganizationProfileCard />}
      {user?.role === "org_admin" && <HandoverCard />}

      <div className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-lg text-ink">Sign-in activity</h2>
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <ActiveSessionsSection />
          <LoginHistorySection />
        </div>
      </div>
    </div>
  );
}
