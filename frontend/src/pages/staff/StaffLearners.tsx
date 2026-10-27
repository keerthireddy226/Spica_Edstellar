import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { useTranslation } from "react-i18next";
import { JOB_ROLES, sortedCountries } from "@/constants/demographics";
import type { JobRole } from "@/api/onboarding";
import { Building2, Eye, Gift, Mail, Pencil, RotateCcw, Ban, UserPlus, Users, User, CreditCard, X } from "lucide-react";
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
  renameIndividual,
  resendIndividualInvite,
  shortDate,
  validateIndividualEmails,
  type IndividualLearner,
  type OrgLearnerRow,
} from "@/api/staff";
import { Avatar, EmptyNote, FilterPills, Notice, PageError, PageHeader, SearchBox, SelectFilter, StatCard, StatusPill, Tabs, useStaffPermissions } from "@/components/staff/StaffKit";
import { CitySelect } from "@/components/CitySelect";

import { tr } from "@/i18n/tr";
import { CertifiedCell } from "@/components/CertifiedCell";
const MONTHS = [0, 1, 2, 3, 6, 12];
const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

function InviteIndividualModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [compMonths, setCompMonths] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [more, setMore] = useState({ phone: "", country: "", city: "", jobRole: "" });
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await inviteIndividual({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        compMonths,
        phone: more.phone.trim() || undefined,
        country: more.country || undefined,
        city: more.city.trim() || undefined,
        jobRole: (more.jobRole || undefined) as JobRole | undefined,
      });
      onDone(
        r.accessError
          ? tr("Invite sent to {{email}}. The free months couldn't be added.", { email: r.email })
          : compMonths
            ? compMonths === 1
              ? tr("Invite sent to {{email}} with 1 free month of full access.", { email: r.email })
              : tr("Invite sent to {{email}} with {{n}} free months of full access.", { email: r.email, n: compMonths })
            : tr("Invite sent to {{email}}.", { email: r.email }),
      );
    } catch (err) {
      setError(err instanceof ApiError && err.message === "email_already_registered" ? tr("That email already has an account.") : tr("Something went wrong."));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <div>
            <h2 className="font-display font-bold text-lg text-ink">{tr("Invite individual learners")}</h2>
            <p className="text-xs text-muted">{tr("Their own account, not part of any organization. Organization learners are added by their Org Admin or Manager.")}</p>
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
                {m === "single" ? tr("Single learner") : tr("Bulk upload (CSV)")}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Free full access to give now")}</label>
            <select value={compMonths} onChange={(e) => setCompMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? tr("None — free plan (they can upgrade themselves)") : m === 1 ? tr("1 month complimentary") : tr("{{n}} months complimentary", { n: m })}
                </option>
              ))}
            </select>
          </div>
        </div>
        {mode === "single" ? (
          <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder={tr("First name")} value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
              <input required placeholder={tr("Last name")} value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
            <input required type="email" placeholder={tr("Email")} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <input placeholder={tr("Phone (optional)")} value={more.phone} onChange={(e) => setMore((m) => ({ ...m, phone: e.target.value }))} className={inputClass} />
              <select value={more.jobRole} onChange={(e) => setMore((m) => ({ ...m, jobRole: e.target.value }))} className={`${inputClass} cursor-pointer`}>
                <option value="">{tr("Job role (optional)")}</option>
                {JOB_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`demographics.jobRole.${r}`)}
                  </option>
                ))}
              </select>
              <select value={more.country} onChange={(e) => setMore((m) => ({ ...m, country: e.target.value, city: "" }))} className={`${inputClass} cursor-pointer`}>
                <option value="">{tr("Country (optional)")}</option>
                {sortedCountries(i18n.language).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <CitySelect country={more.country} value={more.city} onChange={(city) => setMore((m) => ({ ...m, city }))} className={inputClass} placeholder={tr("City (optional)")} />
            </div>
            <p className="text-xs text-muted">{tr("These are pre-filled in their onboarding; they can change them.")}</p>
            {error && <p className="text-sm text-error">{error}</p>}
            <p className="text-xs text-muted">{tr("They'll get an email to set their password.")}</p>
            <div className="flex gap-3">
              <Button type="submit" disabled={busy} className="flex-1">
                {busy ? tr("Sending…") : tr("Send invite")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {tr("Cancel")}</Button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5">
            <BulkLearnerUpload
              maxRows={200}
              checkExisting={(emails) => validateIndividualEmails(emails).then((r) => r.existing)}
              submit={async (rows) => (await inviteIndividualsBulk(compMonths, rows.map(({ email, firstName, lastName }) => ({ email, firstName, lastName })))).results}
              extraNote={compMonths ? (compMonths === 1 ? tr("1 free month each") : tr("{{n}} free months each", { n: compMonths })) : null}
              onDone={(n) => onDone(n === 1 ? tr("1 individual learner invited.") : tr("{{n}} individual learners invited.", { n: n }))}
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
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    getStaffOrgLearners()
      .then((r) => setRows(r.learners))
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) return <PageError message={tr("Could not load organization learners.")} onRetry={load} />;
  if (!rows) return <TableLoading />;
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
      <Notice tone="info">
        {tr("Organization learners are added and managed by their Org Admin and Managers. Here you can see them")}{canView ? tr(" and open their full profile") : ""}.
      </Notice>
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by name, email, batch, department or ID")} />
        <SelectFilter label={tr("Organization")} value={org} onChange={setOrg} options={[["all", tr("All organizations")], ...orgs]} />
      </div>
      <FilterPills
        value={status}
        onChange={setStatus}
        options={[
          ["all", tr("All"), rows.length],
          ["active", tr("Practising"), rows.filter((r) => st(r) === "active").length],
          ["inactive", tr("Inactive 14+ days"), rows.filter((r) => st(r) === "inactive").length],
          ["pending", tr("Invite pending"), rows.filter((r) => st(r) === "pending").length],
          ["deactivated", tr("Deactivated"), rows.filter((r) => st(r) === "deactivated").length],
        ]}
      />
      {shown.length === 0 ? (
        <EmptyNote>{tr("No learners match.")}</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-2.5 py-3">{tr("Learner")}</th>
                <th className="px-2.5 py-3">{tr("Organization · batch")}</th>
                <th className="px-2.5 py-3">{tr("Level")}</th>
                <th className="px-2.5 py-3">{tr("Certified")}</th>
                <th className="px-2.5 py-3">{tr("Sessions")}</th>
                <th className="px-2.5 py-3">{tr("Last practised")}</th>
                <th className="px-2.5 py-3">{tr("License")}</th>
                <th className="px-2.5 py-3">{tr("Status")}</th>
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
                    <td className="px-2.5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar first={r.firstName} last={r.lastName} email={r.email} />
                        <div className="min-w-0">
                          <p className="text-ink font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                          <p className="text-xs text-muted truncate">
                            {r.participantId ? `${r.participantId} · ` : ""}
                            {r.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-3">
                      <p className="text-ink">{r.orgName}</p>
                      <p className="text-xs text-muted">
                        {r.batchName ?? tr("No batch")}
                        {r.department ? ` · ${r.department}` : ""}
                      </p>
                    </td>
                    <td className="px-2.5 py-3 text-ink">{r.cefr ?? "—"}</td>
                    <td className="px-2.5 py-3"><CertifiedCell c={r.certified} /></td>
                    <td className="px-2.5 py-3 text-muted">{r.sessionCount}</td>
                    <td className="px-2.5 py-3 text-muted whitespace-nowrap">{r.lastActiveOn ? shortDate(r.lastActiveOn) : tr("Never")}</td>
                    <td className="px-2.5 py-3">{r.license && <LicenseStatusPill license={r.license} />}</td>
                    <td className="px-2.5 py-3">
                      <StatusPill tone={s === "active" ? "success" : s === "pending" ? "warning" : s === "inactive" ? "muted" : "error"}>
                        {s === "active" ? tr("Practising") : s === "pending" ? tr("Invite pending") : s === "inactive" ? tr("Inactive") : tr("Deactivated")}
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
  const [failed, setFailed] = useState(false);
  const [deactivating, setDeactivating] = useState<IndividualLearner | null>(null);
  const [renaming, setRenaming] = useState<{ row: IndividualLearner; firstName: string; lastName: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const load = () => {
    setFailed(false);
    getIndividuals()
      .then((r) => setRows(r.learners))
      .catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
  }, []);
  // The dashboard's "Invite an individual learner" lands here with ?invite=1.
  useEffect(() => {
    if (params.get("invite") && canInvite) {
      setInviting(true);
      setParams({}, { replace: true });
    }
  }, [params, canInvite, setParams]);
  if (failed) return <PageError message={tr("Could not load individual learners.")} onRetry={load} />;
  if (!rows) return <TableLoading tiles />;

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
    setNotice(null);
    try {
      await fn();
      setNotice(msg);
      load();
    } catch {
      setError(tr("That didn't work. Please try again."));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="glass" palette="sage" index={0} icon={Users} value={rows.length} label={tr("Individual learners")} sub={tr("{{length}} joined this week", { length: rows.filter((r) => Date.now() - new Date(r.createdAt).getTime() < 7 * 86400000).length })} />
        <StatCard variant="glass" palette="sage" index={1} icon={CreditCard} value={rows.filter((r) => r.plan === "paid").length} label={tr("Paid")} sub={revenue ? tr("{{money}} paid in total", { money: money(revenue, currency) }) : tr("No payments yet")} />
        <StatCard variant="glass" palette="sage" index={2} icon={Gift} value={rows.filter((r) => r.plan === "complimentary").length} label={tr("Complimentary")} sub={tr("{{length}} on the free plan", { length: rows.filter((r) => r.plan === "free").length })} />
        <StatCard variant="glass" palette="sage" index={3} icon={User} value={rows.filter((r) => r.source === "invited").length} label={tr("Invited by Edstellar")} sub={tr("{{length}} signed up themselves", { length: rows.filter((r) => r.source === "signup").length })} />
      </div>
      {notice && <Notice onClose={() => setNotice(null)}>{notice}</Notice>}
      {error && (
        <Notice tone="error" onClose={() => setError(null)}>
          {error}
        </Notice>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <SearchBox value={query} onChange={setQuery} placeholder={tr("Search by name, email or ID")} />
        <SelectFilter label={tr("Status")} value={status} onChange={setStatus} options={[["all", tr("Any status")], ["active", tr("Active")], ["pending", tr("Invite pending")], ["deactivated", tr("Deactivated")]]} />
        <span className="flex-1" />
        {canInvite && (
          <Button onClick={() => setInviting(true)} className="flex items-center gap-2">
            <UserPlus size={17} /> {tr("Invite individual learner")}</Button>
        )}
      </div>
      <FilterPills
        value={plan}
        onChange={setPlan}
        options={[
          ["all", tr("All plans"), rows.length],
          ["free", tr("Free"), rows.filter((r) => r.plan === "free").length],
          ["paid", tr("Paid"), rows.filter((r) => r.plan === "paid").length],
          ["complimentary", tr("Complimentary"), rows.filter((r) => r.plan === "complimentary").length],
        ]}
      />
      {shown.length === 0 ? (
        <EmptyNote>{tr("No individual learners match.")}</EmptyNote>
      ) : (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-2.5 py-3">{tr("Learner")}</th>
                <th className="px-2.5 py-3">{tr("Plan")}</th>
                <th className="px-2.5 py-3">{tr("Level")}</th>
                <th className="px-2.5 py-3">{tr("Certified")}</th>
                <th className="px-2.5 py-3">{tr("Sessions")}</th>
                <th className="px-2.5 py-3">{tr("Last practised")}</th>
                <th className="px-2.5 py-3">{tr("Joined")}</th>
                <th className="px-2.5 py-3">{tr("Status")}</th>
                <th className="px-2.5 py-3"><span className="sr-only">{tr("Actions")}</span></th>
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
                    <td className="px-2.5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar first={r.firstName} last={r.lastName} email={r.email} />
                        <div className="min-w-0 max-w-48">
                          <p className="text-ink font-medium truncate">{[r.firstName, r.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                          <p className="text-xs text-muted truncate" title={r.email}>{r.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2.5 py-3">
                      <StatusPill tone={r.plan === "paid" ? "success" : r.plan === "complimentary" ? "navy" : "muted"}>
                        {r.plan === "paid" ? tr("Paid") : r.plan === "complimentary" ? tr("Complimentary") : tr("Free")}
                      </StatusPill>
                      {r.license && r.license.status !== "none" && <div className="mt-1"><LicenseStatusPill license={r.license} /></div>}
                    </td>
                    <td className="px-2.5 py-3 text-ink">{r.cefr ?? "—"}</td>
                    <td className="px-2.5 py-3"><CertifiedCell c={r.certified} /></td>
                    <td className="px-2.5 py-3 text-muted">{r.sessions}</td>
                    <td className="px-2.5 py-3 text-muted whitespace-nowrap">{r.lastActiveOn ? shortDate(r.lastActiveOn) : tr("Never")}</td>
                    <td className="px-2.5 py-3 text-muted whitespace-nowrap">
                      <p>{shortDate(r.createdAt)}</p>
                      <p className="text-xs max-w-40 truncate" title={r.invitedByName ?? undefined}>
                        {r.invitedByName ? tr("Invited by {{invitedByName}}", { invitedByName: r.invitedByName }) : tr("Signed up")}
                      </p>
                    </td>
                    <td className="px-2.5 py-3">
                      <StatusPill tone={s === "active" ? "success" : s === "pending" ? "warning" : "error"}>
                        {s === "active" ? tr("Active · {{ago}}", { ago: ago(r.lastActiveOn) }) : s === "pending" ? tr("Invite pending") : tr("Deactivated")}
                      </StatusPill>
                    </td>
                    <td className="px-2.5 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5 justify-end whitespace-nowrap">
                        {canView && (
                          <IconBtn title={tr("View profile")} onClick={() => setViewing(r.id)}>
                            <Eye size={15} />
                          </IconBtn>
                        )}
                        {canInvite && (
                          <IconBtn title={tr("Edit name")} onClick={() => setRenaming({ row: r, firstName: r.firstName ?? "", lastName: r.lastName ?? "" })}>
                            <Pencil size={15} />
                          </IconBtn>
                        )}
                        {canInvite && r.active && (
                          <IconBtn title={tr("Give free months")} onClick={() => setGranting(r)}>
                            <Gift size={15} />
                          </IconBtn>
                        )}
                        {canInvite && s === "pending" && (
                          <IconBtn title={tr("Resend invite")} onClick={() => act(() => resendIndividualInvite(r.id), tr("A new invite link was sent to {{email}}.", { email: r.email }))}>
                            <Mail size={15} />
                          </IconBtn>
                        )}
                        {canInvite &&
                          (r.active ? (
                            <IconBtn title={tr("Deactivate")} danger onClick={() => setDeactivating(r)}>
                              <Ban size={15} />
                            </IconBtn>
                          ) : (
                            <IconBtn title={tr("Reactivate")} onClick={() => act(() => reactivateIndividual(r.id), tr("{{email}} reactivated.", { email: r.email }))}>
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
            <h2 className="font-display font-bold text-lg text-ink">{tr("Give free months")}</h2>
            <p className="text-sm text-muted">{tr("Complimentary full access for {{email}}, added after any access they already have.", { email: granting.email })}</p>
            <select value={grantMonths} onChange={(e) => setGrantMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {MONTHS.slice(1).map((m) => (
                <option key={m} value={m}>
                  {m === 1 ? tr("1 month") : tr("{{n}} months", { n: m })}
                </option>
              ))}
            </select>
            <div className="flex gap-3">
              <Button
                className="flex-1"
                onClick={() => {
                  const g = granting;
                  setGranting(null);
                  act(() => grantIndividualAccess(g.id, grantMonths), grantMonths === 1 ? tr("1 free month given to {{email}}.", { email: g.email }) : tr("{{n}} free months given to {{email}}.", { n: grantMonths, email: g.email }));
                }}
              >
                {tr("Give access")}</Button>
              <Button variant="secondary" onClick={() => setGranting(null)}>
                {tr("Cancel")}</Button>
            </div>
          </div>
        </div>
      )}
      {renaming && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRenaming(null)}>
          <form
            className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const n = renaming;
              if (!n.firstName.trim() || !n.lastName.trim()) return;
              setRenaming(null);
              act(() => renameIndividual(n.row.id, n.firstName.trim(), n.lastName.trim()), tr("Name changed to {{name}}.", { name: `${n.firstName.trim()} ${n.lastName.trim()}` }));
            }}
          >
            <h2 className="font-display font-bold text-lg text-ink">{tr("Edit name")}</h2>
            <p className="text-sm text-muted">{tr("{{email}}'s name, as it appears on their certificate.", { email: renaming.row.email })}</p>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {tr("First name")}
              <input value={renaming.firstName} onChange={(e) => setRenaming({ ...renaming, firstName: e.target.value })} className={inputClass} maxLength={100} required />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {tr("Last name")}
              <input value={renaming.lastName} onChange={(e) => setRenaming({ ...renaming, lastName: e.target.value })} className={inputClass} maxLength={100} required />
            </label>
            <div className="flex gap-3">
              <Button type="submit" className="flex-1">
                {tr("Save")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
                {tr("Cancel")}
              </Button>
            </div>
          </form>
        </div>
      )}
      {deactivating && (
        <ConfirmActionModal
          title={tr("Deactivate learner")}
          message={tr("Deactivate {{email}}? They can't sign in until you reactivate them.", { email: deactivating.email })}
          confirmLabel={tr("Deactivate")}
          destructive
          submitting={false}
          onClose={() => setDeactivating(null)}
          onConfirm={() => {
            const d = deactivating;
            setDeactivating(null);
            act(() => deactivateIndividual(d.id), tr("{{email}} deactivated.", { email: d.email }));
          }}
        />
      )}
      {viewing && <LearnerProfileModal learnerId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function TableLoading({ tiles }: { tiles?: boolean }) {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-busy="true">
      {tiles && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[104px] rounded-card bg-surface border border-rule" />
          ))}
        </div>
      )}
      <div className="h-10 w-full max-w-md rounded-input bg-rule/70" />
      <div className="h-64 rounded-card bg-surface border border-rule" />
    </div>
  );
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`p-1 rounded-input text-muted transition-colors cursor-pointer ${danger ? "hover:bg-error/10 hover:text-error" : "hover:bg-paper-warm hover:text-ink"}`}
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
        title={tr("Learners")}
        subtitle={perms.isSuper ? tr("Every learner on Spica: in organizations, and on their own.") : tr("Learners in your organizations, and individual learners.")}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { key: "individual", label: tr("Individual learners"), icon: User },
          { key: "org", label: tr("Organization learners"), icon: Building2 },
        ]}
      />
      {tab === "individual" ? <IndividualsTab canInvite={perms.inviteLearners} canView={perms.viewLearnerInfo} /> : <OrgLearnersTab canView={perms.viewLearnerInfo} />}
    </div>
  );
}
