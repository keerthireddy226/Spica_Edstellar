import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  UserPlus,
  X,
  Mail,
  Users,
  CalendarClock,
  UserCheck,
  UserX,
  Upload,
  FileText,
  Pencil,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, StatusPill, paletteColor } from "@/components/staff/StaffKit";
import { ago, getPortfolio, shortDate } from "@/api/staff";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import {
  getAdmins,
  onboardAdmin,
  onboardAdminsBulk,
  editAdmin,
  deleteAdmin,
  reactivateAdmin,
  getAdminActivityDetail,
  PERMISSION_LABELS,
  type AdminAccount,
  type AdminPermissions,
  type OnboardAdminPayload,
  type EditAdminPayload,
  type BulkAdminRow,
  type BulkAdminResult,
  type AdminOnboardedOrg,
} from "@/api/admin";
import { DetailModal } from "@/components/DetailModal";
import { AdminProfileFields, toAdminPayloadExtras, type AdminProfile } from "@/components/staff/AdminProfileFields";
import { OrgAdminDetailModal } from "@/components/OrgAdminDetailModal";
import { ManagerDetailModal } from "@/components/ManagerDetailModal";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

const EMPTY_PERMISSIONS: AdminPermissions = {};

// Minimal CSV parsing on purpose — no quoted-comma/escaping support, matching
// what a plain "email,firstName,lastName,department" export already is.
// Good enough for the realistic size of an admin onboarding batch.
function parseAdminCsv(text: string): BulkAdminRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const startIdx = /^email\s*,/i.test(lines[0]) ? 1 : 0;
  const rows: BulkAdminRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const [email, firstName, lastName, department] = lines[i].split(",").map((c) => c.trim());
    if (!email) continue;
    rows.push({ email, firstName: firstName ?? "", lastName: lastName ?? "", department: department || undefined });
  }
  return rows;
}

function BulkUploadForm({ onDone }: { onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkAdminRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkAdminResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResults(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseAdminCsv(text);
    if (parsed.length === 0) {
      setError("Couldn't find any rows in that file. Expected columns: email, firstName, lastName, department.");
    }
    setRows(parsed);
  }

  async function handleUpload() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await onboardAdminsBulk(rows);
      setResults(res.results);
    } catch {
      setError("Something went wrong uploading that batch.");
    } finally {
      setSubmitting(false);
    }
  }

  const createdCount = results?.filter((r) => r.status === "created").length ?? 0;

  return (
    <div className="flex flex-col gap-5 px-8 py-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">
          CSV with columns, in order: <code className="text-xs bg-paper-warm px-1.5 py-0.5 rounded">email, firstName, lastName, department</code>.
          A header row is optional. New admins get no permissions by default — grant them individually afterward.
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-rule rounded-card px-4 py-6 text-sm text-muted hover:border-navy hover:text-navy transition-colors cursor-pointer"
        >
          <Upload size={18} />
          {fileName ? `Selected: ${fileName}` : "Choose a CSV file"}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {rows.length > 0 && !results && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{rows.length} rows found</p>
          <div className="max-h-48 overflow-y-auto border border-rule rounded-card">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2 text-ink">{r.email}</td>
                    <td className="px-3 py-2 text-muted">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.department ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={handleUpload} disabled={submitting} className="self-start flex items-center gap-2">
            <FileText size={16} /> {submitting ? "Uploading…" : `Send ${rows.length} invites`}
          </Button>
        </div>
      )}

      {results && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-success">
            {createdCount} of {results.length} invites sent.
          </p>
          <div className="max-h-48 overflow-y-auto border border-rule rounded-card">
            <table className="w-full text-xs">
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2 text-ink">{r.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                          r.status === "created"
                            ? "bg-success/15 text-success"
                            : r.status === "duplicate"
                              ? "bg-warning/15 text-navy-deep"
                              : "bg-error/15 text-error"
                        }`}
                      >
                        {r.status === "created" ? "Invited" : r.status === "duplicate" ? "Already exists" : r.message ?? "Invalid"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={onDone} className="self-start">
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

function OnboardAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string) => void }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState<AdminProfile>({
    department: "",
    jobTitle: "",
    phone: "",
    region: "",
    city: "",
    country: "",
    notes: "",
    organizationIds: [],
    permissions: EMPTY_PERMISSIONS,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: OnboardAdminPayload = {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...toAdminPayloadExtras(profile),
      };
      await onboardAdmin(payload);
      onCreated(payload.email);
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That email is already registered.");
      } else {
        setError("Something went wrong onboarding that admin.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-3xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Onboard Admin</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-6 pt-4">
          {(["single", "bulk"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-4 py-2 text-sm font-semibold rounded-input transition-colors cursor-pointer ${
                mode === m ? "bg-navy/10 text-navy" : "text-muted hover:text-ink"
              }`}
            >
              {m === "single" ? "Single admin" : "Bulk upload (CSV)"}
            </button>
          ))}
        </div>

        {mode === "bulk" ? (
          <BulkUploadForm onDone={onClose} />
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">First name</label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Last name</label>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
              <Mail size={13} /> Email
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
            />
          </div>

          <AdminProfileFields value={profile} onChange={setProfile} />

          {error && <p className="text-sm text-error">{error}</p>}

          <p className="text-xs text-muted">
            They'll get an email to set their own password — no password is created or shared here.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Sending invite…" : "Send invite"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

function EditAdminModal({
  admin,
  onClose,
  onSaved,
}: {
  admin: AdminAccount;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(admin.firstName ?? "");
  const [lastName, setLastName] = useState(admin.lastName ?? "");
  const [profile, setProfile] = useState<AdminProfile>({
    department: admin.department ?? "",
    jobTitle: admin.jobTitle ?? "",
    phone: admin.phone ?? "",
    region: admin.region ?? "",
    city: admin.city ?? "",
    country: admin.country ?? "",
    notes: admin.notes ?? "",
    organizationIds: admin.managedOrgIds ?? [],
    permissions: admin.permissions,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: EditAdminPayload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...toAdminPayloadExtras(profile),
      };
      await editAdmin(admin.id, payload);
      onSaved();
    } catch {
      setError("Something went wrong saving those changes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-3xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Edit Admin</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">First name</label>
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted">Last name</label>
              <input
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Email</label>
            <input
              disabled
              value={admin.email}
              className="rounded-input border border-rule bg-paper-warm px-3 py-2 text-sm text-muted"
            />
          </div>

          <AdminProfileFields value={profile} onChange={setProfile} />

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Saving…" : "Save changes"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeactivateAdminModal({
  admin,
  onClose,
  onConfirm,
  submitting,
}: {
  admin: AdminAccount;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Deactivate admin</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5">
          <p className="text-sm text-ink">
            Deactivate <span className="font-semibold">{admin.email}</span>? They'll immediately lose access.
          </p>
          <div className="flex items-center gap-3">
            <Button type="button" onClick={onConfirm} disabled={submitting} className="flex-1 !bg-error hover:!bg-error/90">
              {submitting ? "Deactivating…" : "Deactivate"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminActivityModal({ admin, onClose }: { admin: AdminAccount; onClose: () => void }) {
  const [organizations, setOrganizations] = useState<AdminOnboardedOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingOrgAdminId, setViewingOrgAdminId] = useState<string | null>(null);
  const [viewingManagerId, setViewingManagerId] = useState<string | null>(null);

  useEffect(() => {
    getAdminActivityDetail(admin.id)
      .then((res) => setOrganizations(res.organizations))
      .catch(() => setError("Could not load this admin's activity."));
  }, [admin.id]);

  const name = [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email;

  return (
    <DetailModal title={`${name}'s activity`} subtitle="Organizations onboarded by this admin" onClose={onClose} wide>
      {error && <p className="text-sm text-error">{error}</p>}
      {!organizations && !error && <p className="text-sm text-muted">Loading…</p>}
      {organizations?.length === 0 && <p className="text-sm text-muted">Hasn't onboarded any organizations yet.</p>}
      {organizations && organizations.length > 0 && (
        <div className="flex flex-col gap-4">
          {organizations.map((org) => (
            <div key={org.id} className="border border-rule rounded-input overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3 bg-paper-warm">
                <div>
                  <p className="text-sm font-medium text-ink">{org.name}</p>
                  <p className="text-xs text-muted">
                    {org.category === "university" ? "University" : "Organization"} · {org.learnerCount} learner{org.learnerCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-pill shrink-0 ${
                    !org.active
                      ? "bg-error/15 text-error"
                      : org.orgAdminStatus === "active"
                        ? "bg-success/15 text-success"
                        : "bg-warning/15 text-navy-deep"
                  }`}
                >
                  {!org.active ? "Deactivated" : org.orgAdminStatus === "active" ? "Org Admin active" : org.orgAdminStatus === "pending" ? "Invite pending" : "No Org Admin"}
                </span>
              </div>

              <div className="px-4 py-3 border-t border-rule">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Org Admin</p>
                {!org.orgAdmin ? (
                  <p className="text-xs text-muted">No Org Admin assigned yet.</p>
                ) : (
                  <button
                    onClick={() => setViewingOrgAdminId(org.orgAdmin!.id)}
                    className="flex items-center gap-2.5 text-sm w-full text-left hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
                  >
                    <span className="h-7 w-7 rounded-full bg-navy text-lime flex items-center justify-center text-[10px] font-bold shrink-0">
                      {(org.orgAdmin.name.trim() || org.orgAdmin.email).slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-ink">{org.orgAdmin.name.trim() || "Not named yet"}</span>
                      <span className="text-muted text-xs ml-2">{org.orgAdmin.email}</span>
                    </div>
                  </button>
                )}
              </div>

              <div className="px-4 py-3 border-t border-rule">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">
                  Managers onboarded by this org's Org Admin
                </p>
                {org.managers.length === 0 ? (
                  <p className="text-xs text-muted">None yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {org.managers.map((mgr) => (
                      <button
                        key={mgr.id}
                        onClick={() => setViewingManagerId(mgr.id)}
                        className="flex items-center gap-2.5 text-sm w-full text-left hover:bg-paper-warm rounded-input px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
                      >
                        <span className="h-7 w-7 rounded-full bg-navy text-lime flex items-center justify-center text-[10px] font-bold shrink-0">
                          {(mgr.name.trim() || mgr.email).slice(0, 2).toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-ink">{mgr.name.trim() || mgr.email}</span>
                          <span className="text-muted text-xs ml-2">{mgr.email}</span>
                        </div>
                        <span className="text-xs text-muted shrink-0">
                          {mgr.learnerCount} learner{mgr.learnerCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewingOrgAdminId && (
        <OrgAdminDetailModal
          orgAdminId={viewingOrgAdminId}
          onClose={onClose}
          onBack={() => setViewingOrgAdminId(null)}
        />
      )}
      {viewingManagerId && (
        <ManagerDetailModal
          managerId={viewingManagerId}
          onClose={onClose}
          onBack={() => setViewingManagerId(null)}
        />
      )}
    </DetailModal>
  );
}

function isWithinDays(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() <= days * 86400000;
}

function isSameDay(iso: string, ref: Date): boolean {
  return new Date(iso).toDateString() === ref.toDateString();
}

type AdminFilter = "all" | "active" | "pending" | "quiet" | "deactivated";
const adminStatus = (a: AdminAccount) => (!a.active ? "deactivated" : !a.hasLoggedIn ? "pending" : "active");
const isQuiet = (a: AdminAccount) => a.active && a.hasLoggedIn && (!a.lastLoginAt || Date.now() - new Date(a.lastLoginAt).getTime() > 14 * 86400000);

export function AdminsList() {
  const [admins, setAdmins] = useState<AdminAccount[] | null>(null);
  const [portfolio, setPortfolio] = useState<Map<string, { learners: number; atRisk: number; organizations: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [justInvited, setJustInvited] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<AdminAccount | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [viewingActivity, setViewingActivity] = useState<AdminAccount | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AdminFilter>("all");
  const [dept, setDept] = useState("all");

  function load() {
    getAdmins()
      .then((res) => setAdmins(res.admins))
      .catch(() => setError("Could not load admins."));
    getPortfolio()
      .then((p) => setPortfolio(new Map((p.admins ?? []).map((a) => [a.id, { learners: a.learners, atRisk: a.atRisk, organizations: a.organizations }]))))
      .catch(() => {});
  }

  useEffect(load, []);

  async function handleDelete(admin: AdminAccount) {
    setDeletingId(admin.id);
    try {
      await deleteAdmin(admin.id);
      setConfirmingDelete(null);
      load();
    } catch {
      setError("Could not deactivate that admin.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleReactivate(admin: AdminAccount) {
    setReactivatingId(admin.id);
    try {
      await reactivateAdmin(admin.id);
      load();
    } catch {
      setError("Could not reactivate that admin.");
    } finally {
      setReactivatingId(null);
    }
  }

  useEffect(() => {
    if (!justInvited) return;
    const timer = setTimeout(() => setJustInvited(null), 5000);
    return () => clearTimeout(timer);
  }, [justInvited]);

  const all = admins ?? [];
  const depts = [...new Set(all.map((a) => a.department).filter(Boolean) as string[])].sort();
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (a) =>
      (filter === "all" || (filter === "quiet" ? isQuiet(a) : adminStatus(a) === filter)) &&
      (dept === "all" || a.department === dept) &&
      (!q || [a.firstName, a.lastName, a.email, a.department, ...a.managedOrgNames].some((v) => v?.toLowerCase().includes(q))),
  );
  const totalPerms = Object.keys(PERMISSION_LABELS).length;

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Admins"
        subtitle="Edstellar staff who onboard and look after organizations — Sales, Delivery, L&D — and what each may do."
        actions={
          <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
            <UserPlus size={18} /> Onboard Admin
          </Button>
        }
      />

      {justInvited && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          Invite sent to {justInvited} — they'll receive an email to set their password.
        </p>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
      {!admins && !error && <p className="text-sm text-muted">Loading…</p>}

      {admins && (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard variant="outline" palette="rose" index={0} icon={Users} value={all.filter((a) => adminStatus(a) === "active").length} label="Active Admins" sub={`${all.filter((a) => isWithinDays(a.createdAt, 7)).length} added this week`} />
            <StatCard variant="outline" palette="rose" index={1} icon={UserX} value={all.filter((a) => adminStatus(a) === "pending").length} label="Invite not accepted" sub={`${all.filter(isQuiet).length} quiet for 14+ days`} />
            <StatCard variant="outline" palette="rose" index={2} icon={CalendarClock} value={[...portfolio.values()].reduce((n, p) => n + p.organizations, 0)} label="Organizations owned" sub={`${all.filter((a) => a.active && a.managedOrgCount === 0).length} Admins own none`} />
            <StatCard variant="outline" palette="rose" index={3} icon={UserCheck} value={[...portfolio.values()].reduce((n, p) => n + p.atRisk, 0)} label="Accounts at risk" sub={`${[...portfolio.values()].reduce((n, p) => n + p.learners, 0)} learners in their portfolios`} />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <SearchBox value={query} onChange={setQuery} placeholder="Search by name, email, department or organization" />
            {depts.length > 0 && <SelectFilter label="Department" value={dept} onChange={setDept} options={[["all", "All departments"], ...depts.map((d) => [d, d] as [string, string])]} />}
            <FilterPills<AdminFilter>
              value={filter}
              onChange={setFilter}
              options={[
                ["all", "All", all.length],
                ["active", "Active", all.filter((a) => adminStatus(a) === "active").length],
                ["pending", "Invite pending", all.filter((a) => adminStatus(a) === "pending").length],
                ["quiet", "Quiet 14+ days", all.filter(isQuiet).length],
                ["deactivated", "Deactivated", all.filter((a) => adminStatus(a) === "deactivated").length],
              ]}
            />
          </div>

          {all.length === 0 && <EmptyNote>No Admins yet — onboard your first one.</EmptyNote>}
          {all.length > 0 && shown.length === 0 && <EmptyNote>No Admins match.</EmptyNote>}

          <div className="grid lg:grid-cols-2 2xl:grid-cols-3 gap-4">
            {shown.map((a, i) => {
              const c = paletteColor("rose", i);
              const st = adminStatus(a);
              const p = portfolio.get(a.id);
              const granted = (Object.keys(PERMISSION_LABELS) as (keyof AdminPermissions)[]).filter((k) => a.permissions[k]);
              return (
                <div
                  key={a.id}
                  style={{ background: `color-mix(in srgb, ${c} 9%, var(--color-surface))` }}
                  className={`rounded-card border border-rule shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3 ${a.active ? "" : "opacity-60"}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => setViewingActivity(a)}
                      title="View their organizations"
                      style={{ background: c }}
                      className="h-12 w-12 rounded-2xl text-white flex items-center justify-center text-sm font-bold shrink-0 cursor-pointer"
                    >
                      {initials(a.firstName, a.lastName, a.email)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-display font-bold text-ink truncate">{[a.firstName, a.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                        <StatusPill tone={st === "active" ? "success" : st === "pending" ? "warning" : "error"}>
                          {st === "active" ? "Active" : st === "pending" ? "Invite pending" : "Deactivated"}
                        </StatusPill>
                        {isSameDay(a.createdAt, new Date()) && <StatusPill tone="navy">New</StatusPill>}
                      </div>
                      <p className="text-xs text-muted truncate">
                        {a.department ?? "No department"} · {a.email}
                        {a.phone ? ` · ${a.phone}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        [p?.organizations ?? a.managedOrgCount, "Organizations"],
                        [p?.learners ?? 0, "Learners"],
                        [p?.atRisk ?? 0, "At risk"],
                      ] as const
                    ).map(([v, l]) => (
                      <div key={l} className="rounded-input bg-surface border border-rule px-3 py-2">
                        <p className="font-display font-bold text-xl" style={{ color: l === "At risk" && v ? "var(--color-error)" : c }}>
                          {v}
                        </p>
                        <p className="text-[11px] text-muted">{l}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {a.managedOrgNames.length === 0 ? (
                      <span className="text-xs text-muted italic">Owns no organizations yet</span>
                    ) : (
                      a.managedOrgNames.map((n) => (
                        <span key={n} style={{ color: c, background: `color-mix(in srgb, ${c} 14%, var(--color-surface))` }} className="text-xs font-semibold px-2.5 py-1 rounded-pill">
                          {n}
                        </span>
                      ))
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">
                      Permissions · {granted.length} of {totalPerms}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(PERMISSION_LABELS) as (keyof AdminPermissions)[]).map((k) => (
                        <span
                          key={k}
                          className={`text-[11px] px-2 py-0.5 rounded-pill border ${a.permissions[k] ? "border-success/30 bg-success/10 text-success" : "border-rule text-muted line-through"}`}
                        >
                          {PERMISSION_LABELS[k]}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-rule">
                    <span className="text-xs text-muted">
                      {st === "pending" ? "Hasn't signed in yet" : `Last signed in ${ago(a.lastLoginAt)}`} · Added {shortDate(a.createdAt)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setViewingActivity(a)} className="text-xs font-semibold text-navy hover:underline cursor-pointer px-1">
                        Organizations
                      </button>
                      {st === "deactivated" ? (
                        <button
                          onClick={() => handleReactivate(a)}
                          disabled={reactivatingId === a.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs font-semibold bg-success/10 text-success hover:bg-success/20 cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw size={13} /> {reactivatingId === a.id ? "Activating…" : "Reactivate"}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditing(a)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-pill border border-rule text-xs font-semibold text-ink hover:bg-paper-warm cursor-pointer"
                          >
                            <Pencil size={13} /> Edit & permissions
                          </button>
                          <button
                            onClick={() => setConfirmingDelete(a)}
                            disabled={deletingId === a.id}
                            title="Deactivate"
                            className="p-1.5 rounded-input text-muted hover:bg-error/10 hover:text-error cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showOnboard && (
        <OnboardAdminModal
          onClose={() => setShowOnboard(false)}
          onCreated={(email) => {
            setShowOnboard(false);
            setJustInvited(email);
            load();
          }}
        />
      )}

      {editing && (
        <EditAdminModal
          admin={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {confirmingDelete && (
        <DeactivateAdminModal
          admin={confirmingDelete}
          onClose={() => setConfirmingDelete(null)}
          onConfirm={() => handleDelete(confirmingDelete)}
          submitting={deletingId === confirmingDelete.id}
        />
      )}

      {viewingActivity && <AdminActivityModal admin={viewingActivity} onClose={() => setViewingActivity(null)} />}
    </div>
  );
}
