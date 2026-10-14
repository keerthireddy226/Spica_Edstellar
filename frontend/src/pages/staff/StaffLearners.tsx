import { useEffect, useState, type FormEvent } from "react";
import { Building2, Eye, Gift, Mail, RotateCcw, Ban, UserPlus, Users, User, CreditCard, X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { BulkLearnerUpload } from "@/components/BulkLearnerUpload";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import {
  ago,
  deactivateIndividual,
  getIndividuals,
  getStaffOrgLearners,
  grantIndividualAccess,
  inviteIndividual,
  inviteIndividualsBulk,
  money,
  reactivateIndividual,
  resendIndividualInvite,
  shortDate,
  validateIndividualEmails,
  type IndividualLearner,
  type OrgLearnerRow,
} from "@/api/staff";
import { Avatar, EmptyNote, FilterPills, PageHeader, SearchBox, SelectFilter, StatCard, StatusPill, useStaffPermissions } from "@/components/staff/StaffKit";

const MONTHS = [0, 1, 2, 3, 6, 12];
const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

function InviteIndividualModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [compMonths, setCompMonths] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await inviteIndividual({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), compMonths });
      onDone(
        `Invite sent to ${r.email}${compMonths && !r.accessError ? ` with ${compMonths} free month${compMonths === 1 ? "" : "s"} of full access` : ""}.${
          r.accessError ? " The free months couldn't be added." : ""
        }`,
      );
    } catch (err) {
      setError(err instanceof ApiError && err.message === "email_already_registered" ? "That email already has an account." : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <div>
            <h2 className="font-display font-bold text-lg text-ink">Invite individual learners</h2>
            <p className="text-xs text-muted">Their own account, not part of any organization. Organization learners are added by their Org Admin or Manager.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-1">
            {(["single", "bulk"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 text-sm font-semibold rounded-input cursor-pointer ${mode === m ? "bg-navy/10 text-navy" : "text-muted hover:text-ink"}`}
              >
                {m === "single" ? "Single learner" : "Bulk upload (CSV)"}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Free full access to give now</label>
            <select value={compMonths} onChange={(e) => setCompMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "None — free plan (they can upgrade themselves)" : `${m} month${m === 1 ? "" : "s"} complimentary`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mode === "single" ? (
          <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
              <input required placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
            <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            {error && <p className="text-sm text-error">{error}</p>}
            <p className="text-xs text-muted">They'll get an email to set their password.</p>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy} className="flex-1">
                {busy ? "Sending…" : "Send invite"}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5">
            <BulkLearnerUpload
              maxRows={200}
              checkExisting={(emails) => validateIndividualEmails(emails).then((r) => r.existing)}
              submit={async (rows) => (await inviteIndividualsBulk(compMonths, rows.map(({ email, firstName, lastName }) => ({ email, firstName, lastName })))).results}
              extraNote={compMonths ? `${compMonths} free month${compMonths === 1 ? "" : "s"} each` : null}
              onDone={(n) => onDone(`${n} individual learner${n === 1 ? "" : "s"} invited.`)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function OrgLearnersTab({ canView }: { canView: boolean }) {
  const [rows, setRows] = useState<OrgLearnerRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [org, setOrg] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "pending" | "inactive" | "deactivated">("all");
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => {
    getStaffOrgLearners()
      .then((r) => setRows(r.learners))
      .catch(() => setRows([]));
  }, []);
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;
  const orgs = [...new Map(rows.map((r) => [r.tenantId, r.orgName])).entries()];
  const stale = (r: OrgLearnerRow) => !r.lastActiveOn || Date.now() - new Date(r.lastActiveOn).getTime() > 14 * 86400000;
  const st = (r: OrgLearnerRow) => (!r.active ? "deactivated" : !r.hasLoggedIn ? "pending" : stale(r) ? "inactive" : "active");
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (org === "all" || r.tenantId === org) &&
      (status === "all" || st(r) === status) &&
      (!q || [r.firstName, r.lastName, r.email, r.orgName, r.batchName, r.department, r.employeeId, r.participantId].some((v) => v?.toLowerCase().includes(q))),
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted bg-paper-warm border border-rule rounded-input px-3.5 py-2.5">
        Organization learners are added and managed by their Org Admin and Managers. Here you can see them{canView ? " and open their full profile" : ""}.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, email, batch, department or ID" />
        <SelectFilter label="Organization" value={org} onChange={setOrg} options={[["all", "All organizations"], ...orgs]} />
      </div>
      <FilterPills
        value={status}
        onChange={setStatus}
        options={[
          ["all", "All", rows.length],
          ["active", "Practising", rows.filter((r) => st(r) === "active").length],
          ["inactive", "Inactive 14+ days", rows.filter((r) => st(r) === "inactive").length],
          ["pending", "Invite pending", rows.filter((r) => st(r) === "pending").length],
          ["deactivated", "Deactivated", rows.filter((r) => st(r) === "deactivated").length],
        ]}
      />
      {shown.length === 0 ? (
        <EmptyNote>No learners match.</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Organization · batch</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Sessions</th>
                <th className="px-4 py-3">Last practised</th>
                <th className="px-4 py-3">License</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const s = st(r);
                return (
                  <tr
                    key={r.id}
                    onClick={() => canView && setViewing(r.id)}
                    className={`border-b border-rule last:border-0 ${canView ? "cursor-pointer hover:bg-paper-warm" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar first={r.firstName} last={r.lastName} email={r.email} />
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                          <p className="text-xs text-muted truncate">
                            {r.participantId ? `${r.participantId} · ` : ""}
                            {r.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-ink">{r.orgName}</p>
                      <p className="text-xs text-muted">
                        {r.batchName ?? "No batch"}
                        {r.department ? ` · ${r.department}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-ink">{r.cefr ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.sessionCount}</td>
                    <td className="px-4 py-3 text-muted">{r.lastActiveOn ? shortDate(r.lastActiveOn) : "Never"}</td>
                    <td className="px-4 py-3">{r.license && <LicenseStatusPill license={r.license} />}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={s === "active" ? "success" : s === "pending" ? "warning" : s === "inactive" ? "muted" : "error"}>
                        {s === "active" ? "Practising" : s === "pending" ? "Invite pending" : s === "inactive" ? "Inactive" : "Deactivated"}
                      </StatusPill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {viewing && <LearnerProfileModal learnerId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function IndividualsTab({ canInvite, canView }: { canInvite: boolean; canView: boolean }) {
  const [rows, setRows] = useState<IndividualLearner[] | null>(null);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<"all" | "free" | "paid" | "complimentary">("all");
  const [status, setStatus] = useState("all");
  const [inviting, setInviting] = useState(false);
  const [granting, setGranting] = useState<IndividualLearner | null>(null);
  const [grantMonths, setGrantMonths] = useState(1);
  const [viewing, setViewing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    getIndividuals()
      .then((r) => setRows(r.learners))
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <p className="text-sm text-muted">Loading…</p>;

  const q = query.trim().toLowerCase();
  const st = (r: IndividualLearner) => (!r.active ? "deactivated" : !r.hasLoggedIn ? "pending" : "active");
  const shown = rows.filter(
    (r) =>
      (plan === "all" || r.plan === plan) &&
      (status === "all" || st(r) === status) &&
      (!q || [r.firstName, r.lastName, r.email, r.participantId].some((v) => v?.toLowerCase().includes(q))),
  );
  const revenue = rows.filter((r) => r.paidTotal).reduce((n, r) => n + r.paidTotal, 0);
  const currency = rows.find((r) => r.paidCurrency)?.paidCurrency ?? "USD";
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      setNotice(msg);
      load();
    } catch {
      setError("That didn't work. Please try again.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard index={0} icon={Users} value={rows.length} label="Individual learners" sub={`${rows.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 7 * 86400000).length} joined this week`} />
        <StatCard index={1} icon={CreditCard} value={rows.filter((r) => r.plan === "paid").length} label="Paid" sub={revenue ? `${money(revenue, currency)} paid in total` : "No payments yet"} />
        <StatCard index={2} icon={Gift} value={rows.filter((r) => r.plan === "complimentary").length} label="Complimentary" sub={`${rows.filter((r) => r.plan === "free").length} on the free plan`} />
        <StatCard index={3} icon={User} value={rows.filter((r) => r.source === "invited").length} label="Invited by Edstellar" sub={`${rows.filter((r) => r.source === "signup").length} signed up themselves`} />
      </div>
      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder="Search by name, email or ID" />
        <SelectFilter label="Status" value={status} onChange={setStatus} options={[["all", "Any status"], ["active", "Active"], ["pending", "Invite pending"], ["deactivated", "Deactivated"]]} />
        <span className="flex-1" />
        {canInvite && (
          <Button onClick={() => setInviting(true)} className="flex items-center gap-2">
            <UserPlus size={17} /> Invite individual learner
          </Button>
        )}
      </div>
      <FilterPills
        value={plan}
        onChange={setPlan}
        options={[
          ["all", "All plans", rows.length],
          ["free", "Free", rows.filter((r) => r.plan === "free").length],
          ["paid", "Paid", rows.filter((r) => r.plan === "paid").length],
          ["complimentary", "Complimentary", rows.filter((r) => r.plan === "complimentary").length],
        ]}
      />
      {shown.length === 0 ? (
        <EmptyNote>No individual learners match.</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Sessions</th>
                <th className="px-4 py-3">Last practised</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const s = st(r);
                return (
                  <tr key={r.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar first={r.firstName} last={r.lastName} email={r.email} />
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                          <p className="text-xs text-muted truncate">{r.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={r.plan === "paid" ? "success" : r.plan === "complimentary" ? "navy" : "muted"}>
                        {r.plan === "paid" ? "Paid" : r.plan === "complimentary" ? "Complimentary" : "Free"}
                      </StatusPill>
                      {r.license && r.license.status !== "none" && <div className="mt-1"><LicenseStatusPill license={r.license} /></div>}
                    </td>
                    <td className="px-4 py-3 text-ink">{r.cefr ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{r.sessions}</td>
                    <td className="px-4 py-3 text-muted">{r.lastActiveOn ? shortDate(r.lastActiveOn) : "Never"}</td>
                    <td className="px-4 py-3 text-muted">
                      <p>{shortDate(r.createdAt)}</p>
                      <p className="text-xs">{r.invitedByName ? `Invited by ${r.invitedByName}` : "Signed up"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={s === "active" ? "success" : s === "pending" ? "warning" : "error"}>
                        {s === "active" ? `Active · ${ago(r.lastActiveOn)}` : s === "pending" ? "Invite pending" : "Deactivated"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {canView && (
                          <IconBtn title="View profile" onClick={() => setViewing(r.id)}>
                            <Eye size={15} />
                          </IconBtn>
                        )}
                        {canInvite && r.active && (
                          <IconBtn title="Give free months" onClick={() => setGranting(r)}>
                            <Gift size={15} />
                          </IconBtn>
                        )}
                        {canInvite && s === "pending" && (
                          <IconBtn title="Resend invite" onClick={() => act(() => resendIndividualInvite(r.id), `A new invite link was sent to ${r.email}.`)}>
                            <Mail size={15} />
                          </IconBtn>
                        )}
                        {canInvite &&
                          (r.active ? (
                            <IconBtn title="Deactivate" danger onClick={() => act(() => deactivateIndividual(r.id), `${r.email} deactivated.`)}>
                              <Ban size={15} />
                            </IconBtn>
                          ) : (
                            <IconBtn title="Reactivate" onClick={() => act(() => reactivateIndividual(r.id), `${r.email} reactivated.`)}>
                              <RotateCcw size={15} />
                            </IconBtn>
                          ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {inviting && (
        <InviteIndividualModal
          onClose={() => {
            setInviting(false);
            load();
          }}
          onDone={(msg) => {
            setInviting(false);
            setNotice(msg);
            load();
          }}
        />
      )}
      {granting && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setGranting(null)}>
          <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-sm p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display font-bold text-lg text-ink">Give free months</h2>
            <p className="text-sm text-muted">Complimentary full access for {granting.email}, added after any access they already have.</p>
            <select value={grantMonths} onChange={(e) => setGrantMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {MONTHS.slice(1).map((m) => (
                <option key={m} value={m}>
                  {m} month{m === 1 ? "" : "s"}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() => {
                  const g = granting;
                  setGranting(null);
                  act(() => grantIndividualAccess(g.id, grantMonths), `${grantMonths} free month${grantMonths === 1 ? "" : "s"} given to ${g.email}.`);
                }}
              >
                Give access
              </Button>
              <Button variant="secondary" onClick={() => setGranting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
      {viewing && <LearnerProfileModal learnerId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded-input text-muted transition-colors cursor-pointer ${danger ? "hover:bg-error/10 hover:text-error" : "hover:bg-paper-warm hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

// Learners for Edstellar staff: organizations' learners to look at, and
// individual learners (no organization) to invite and look after.
export function StaffLearners() {
  const perms = useStaffPermissions();
  const [tab, setTab] = useState<"individual" | "org">("individual");
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title="Learners"
        subtitle={perms.isSuper ? "Every learner on Spica: in organizations, and on their own." : "Learners in your organizations, and individual learners."}
      />
      <div className="flex items-center gap-1 border-b border-rule">
        {(
          [
            ["individual", "Individual learners", User],
            ["org", "Organization learners", Building2],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      {tab === "individual" ? <IndividualsTab canInvite={perms.inviteLearners} canView={perms.viewLearnerInfo} /> : <OrgLearnersTab canView={perms.viewLearnerInfo} />}
    </div>
  );
}
