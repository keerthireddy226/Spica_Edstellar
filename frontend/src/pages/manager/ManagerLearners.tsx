import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { BulkLearnerUpload } from "@/components/BulkLearnerUpload";
import { validateBulkEmails } from "@/api/orgAdmin";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { UserPlus, X, Mail, ArrowRightLeft, Ban, RotateCcw, Search, Users, BellRing, Undo2 } from "lucide-react";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import { MoveLearnerModal } from "@/components/MoveLearnerModal";
import { LicenseStatusPill } from "@/components/licenses/LicenseStatusPill";
import { AssignLicenseModal } from "@/components/licenses/AssignLicenseModal";
import { LICENSE_ERROR_TEXT, getManagerLicenseOverview, managerAssignLicenses, type BatchBudget, type ManagerPool } from "@/api/licenses";
import { RequestLicenseChangeModal } from "@/components/licenses/RequestLicenseChangeModal";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { LearnerDetailsFields } from "@/components/LearnerDetailsFields";
import { EMPTY_LEARNER_DETAILS, detailsErrorMessage, filledDetails, type LearnerDetails } from "@/api/details";
import {
  getManagerBatches,
  managerUpdateLearnerDetails,
  type ManagerBatch,
  getManagerLearners,
  managerOnboardLearner,
  managerOnboardLearnersBulk,
  managerMoveLearner,
  managerResendInvite,
  managerDeactivateLearner,
  managerReactivateLearner,
  getManagerLearnerDetail,
} from "@/api/manager";
import type { OrgLearner } from "@/api/orgAdmin";

import { tr } from "@/i18n/tr";
import { CertifiedCell } from "@/components/CertifiedCell";
function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

const LICENSE_CHOICES = [0, 1, 2, 3, 6, 9, 12, 18, 24];

// How many new learners the licenses at hand cover, at `months` each: the
// batch's fixed licenses first, then the Manager's pool, one source per learner.
function learnersCovered(batch: ManagerBatch | undefined, pool: ManagerPool | undefined, months: number, count: number): number {
  if (!months) return count;
  let fixed = batch && batch.fixedLicenses != null ? Math.max(0, batch.fixedLicenses - batch.licenses.fixedUsed) : 0;
  let mine = pool?.remaining ?? 0;
  let covered = 0;
  for (let i = 0; i < count; i++) {
    if (fixed >= months) fixed -= months;
    else if (mine >= months) mine -= months;
    else break;
    covered++;
  }
  return covered;
}

function OnboardLearnerModal({
  batches,
  myPool,
  onClose,
  onCreated,
}: {
  batches: ManagerBatch[];
  myPool: ManagerPool | undefined;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const batch = batches.find((b) => b.id === batchId);
  const [licenseMonths, setLicenseMonths] = useState(batch?.defaultLicenseMonths ?? 1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [details, setDetails] = useState<LearnerDetails>(EMPTY_LEARNER_DETAILS);
  const [showDetails, setShowDetails] = useState(false);
  const [bulkCount, setBulkCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fixedLeft = batch && batch.fixedLicenses != null ? Math.max(0, batch.fixedLicenses - batch.licenses.fixedUsed) : null;
  const poolLeft = myPool?.allotment != null ? (myPool.remaining ?? 0) : null;
  const count = mode === "single" ? 1 : bulkCount;
  const covered = learnersCovered(batch, myPool, licenseMonths, count);
  const short = licenseMonths > 0 && covered < count;
  const seatsLeft = batch?.capacity ? Math.max(0, batch.capacity - batch.licenses.learners) : null;
  const choices = LICENSE_CHOICES.includes(licenseMonths) ? LICENSE_CHOICES : [...LICENSE_CHOICES, licenseMonths].sort((a, b) => a - b);

  function chooseBatch(id: string) {
    setBatchId(id);
    const b = batches.find((x) => x.id === id);
    if (b?.defaultLicenseMonths != null) setLicenseMonths(b.defaultLicenseMonths);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await managerOnboardLearner({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        batchId,
        licenseMonths,
        details: filledDetails(details),
      });
      onCreated(
        r.licenseError
          ? tr("Invite sent to {{email}}, but no license was assigned: {{v}}", { email: r.email, v: LICENSE_ERROR_TEXT[r.licenseError] ?? r.licenseError })
          : r.licenseMonths
            ? r.licenseMonths === 1
              ? tr("Invite sent to {{email}} with 1 month of access. They'll get an email to set their password.", { email: r.email })
              : tr("Invite sent to {{email}} with {{n}} months of access. They'll get an email to set their password.", { email: r.email, n: r.licenseMonths })
            : tr("Invite sent to {{email}}. They'll get an email to set their password.", { email: r.email }),
      );
    } catch (err) {
      const code = err instanceof ApiError ? err.message : undefined;
      setError(code === "email_already_registered" ? tr("That email is already registered.") : (detailsErrorMessage(code) ?? tr("Something went wrong inviting that learner.")));
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">{tr("Invite learners")}</h2>
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
              {m === "single" ? tr("Single learner") : tr("Bulk upload (CSV)")}
            </button>
          ))}
        </div>

        <div className="px-6 pt-4 grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Batch")}</label>
            <select value={batchId} onChange={(e) => chooseBatch(e.target.value)} className={`${inputClass} cursor-pointer`}>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("License to give now")}</label>
            <select value={licenseMonths} onChange={(e) => setLicenseMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {choices.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? tr("None — assign later") : m === 1 ? tr("1 month (1 license each)") : tr("{{n}} months ({{n}} licenses each)", { n: m })}
                </option>
              ))}
            </select>
          </div>
          <div className={`sm:col-span-2 text-xs rounded-input px-3 py-2 ${short ? "bg-error/10 text-error" : "bg-paper-warm text-muted"}`}>
            <p>
              {tr("Available for")}{" "}{batch?.name ?? tr("this batch")}: {fixedLeft !== null ? fixedLeft === 1 ? tr("1 fixed license (used first)") : tr("{{n}} fixed licenses (used first)", { n: fixedLeft }) : tr("no fixed licenses")}
              {" · "}
              {poolLeft !== null ? tr("{{poolLeft}} in your pool", { poolLeft: poolLeft }) : tr("no pool allotted to you")}.
            </p>
            {short && (
              <p className="mt-0.5 font-semibold">
                {count === 1
                  ? licenseMonths === 1
                    ? tr("Not enough licenses for 1 month. Pick fewer months, or request more from your Org Admin.")
                    : tr("Not enough licenses for {{n}} months. Pick fewer months, or request more from your Org Admin.", { n: licenseMonths })
                  : tr("Enough for {{covered}} of {{v}} learners. The rest are invited without access — request more licenses from your Org Admin.", { covered: covered, v: count })}
              </p>
            )}
            {seatsLeft !== null && (
              <p className="mt-0.5">
                {tr("{{seatsLeft}} of", { seatsLeft: seatsLeft })}{" "}{batch!.capacity} {tr("seats left in this batch.")}</p>
            )}
          </div>
        </div>

        {mode === "bulk" ? (
          <div className="px-6 py-6">
            <BulkLearnerUpload
              maxRows={200}
              checkExisting={(emails) => validateBulkEmails("manager", emails).then((r) => r.existing)}
              submit={async (rows) => (await managerOnboardLearnersBulk(batchId, rows, licenseMonths)).results}
              extraNote={licenseMonths ? (licenseMonths === 1 ? tr("1 month of access each") : tr("{{n}} months of access each", { n: licenseMonths })) : null}
              onReadyChange={setBulkCount}
              onDone={(created) => onCreated(created === 1 ? tr("1 learner invited.") : tr("{{n}} learners invited.", { n: created }))}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-6 py-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("First name")}</label>
                <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Last name")}</label>
                <input required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
                <Mail size={13} /> {tr("Email")}</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </div>
            <div className="border border-rule rounded-input">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-ink cursor-pointer"
              >
                {tr("Employee details (optional)")}<span className="text-xs text-muted">{showDetails ? tr("Hide") : tr("Employee ID, department, gender, age…")}</span>
              </button>
              {showDetails && (
                <div className="px-4 pb-4">
                  <LearnerDetailsFields value={details} onChange={setDetails} />
                </div>
              )}
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={submitting || (short && count === 1)} className="flex-1">
                {submitting ? tr("Sending invite…") : tr("Send invite")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {tr("Cancel")}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function ManagerLearners() {
  const [learners, setLearners] = useState<OrgLearner[] | null>(null);
  const [batches, setBatches] = useState<ManagerBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [movingLearner, setMovingLearner] = useState<OrgLearner | null>(null);
  const [assigning, setAssigning] = useState<OrgLearner | null>(null);
  const [returning, setReturning] = useState<OrgLearner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewingLearner, setViewingLearner] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BatchBudget[]>([]);
  const [myPool, setMyPool] = useState<ManagerPool | undefined>(undefined);
  const [query, setQuery] = useState("");
  // "All learners" or "Follow up" (the dashboard links straight to follow-up).
  const [params, setParams] = useSearchParams();
  const view: "all" | "follow-up" = params.get("view") === "follow-up" ? "follow-up" : "all";
  const setView = (v: "all" | "follow-up") => setParams(v === "all" ? {} : { view: v }, { replace: true });
  const q = query.trim().toLowerCase();
  const shown = (learners ?? []).filter(
    (l) =>
      !q ||
      [l.firstName, l.lastName, l.email, l.participantId, l.employeeId, l.department, l.jobTitle, l.batchName].some((v) => v?.toLowerCase().includes(q)),
  );

  function load() {
    getManagerLearners()
      .then((res) => {
        setLearners(res.learners);
        setError(null);
      })
      .catch(() => setError(tr("Could not load learners.")));
    // Learners can only be added to, or moved into, active batches.
    getManagerBatches()
      .then((res) => setBatches(res.batches.filter((b) => b.status === "active")))
      .catch(() => {});
    getManagerLicenseOverview()
      .then((res) => {
        setBudgets(res.batches);
        setMyPool(res.myPool);
      })
      .catch(() => {});
  }

  useEffect(load, []);

  const say = (text: string) => {
    setError(null);
    setNotice(text);
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Learners")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Only learners in your assigned batch(es).")}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setShowOnboard(true)} disabled={batches.length === 0} className="flex items-center gap-2 shrink-0">
            <UserPlus size={18} /> {tr("Invite Learner")}
          </Button>
          {learners !== null && batches.length === 0 && <p className="text-[11px] text-muted">{tr("No active batches.")}</p>}
        </div>
      </div>

      {notice && (
        <div className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} title={tr("Dismiss")} className="text-success/80 hover:text-success cursor-pointer shrink-0">
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="text-sm text-error bg-error/10 border border-error/25 rounded-card px-4 py-3 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} title={tr("Dismiss")} className="text-error/80 hover:text-error cursor-pointer shrink-0">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 border-b border-rule">
        {(
          [
            ["all", tr("All learners"), Users, learners?.length],
            ["follow-up", tr("Follow up with learners"), BellRing, undefined],
          ] as const
        ).map(([key, label, Icon, n]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
              view === key ? "border-navy text-navy-deep" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <Icon size={15} />
            {label}
            {n !== undefined && <span className={`text-xs px-1.5 rounded-pill ${view === key ? "bg-navy/10" : "bg-rule"}`}>{n}</span>}
          </button>
        ))}
      </div>

      {view === "follow-up" && <FollowUpPanel hideTitle />}

      {view === "all" && (
        <div className="bg-surface border border-rule rounded-card shadow-sm min-w-0">
          <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-4 border-b border-rule">
            <div className="relative flex-1 min-w-56 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={!learners?.length}
                placeholder={tr("Search by name, email, employee ID, department or batch")}
                className="w-full rounded-input border border-rule bg-paper pl-9 pr-3 py-2 text-sm text-ink focus:border-navy focus:outline-none disabled:opacity-60"
              />
            </div>
            {learners && learners.length > 0 && (
              <p className="text-xs text-muted">{q ? tr("Showing {{n}} of {{total}}", { n: shown.length, total: learners.length }) : tr("{{n}} learners", { n: learners.length })}</p>
            )}
          </div>

          {!learners && !error && (
            <div className="p-5 flex flex-col gap-3" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-input bg-paper-warm animate-pulse" />
              ))}
              <p className="sr-only">{tr("Loading…")}</p>
            </div>
          )}
          {learners?.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted">
              <Users size={22} className="mx-auto mb-2 text-muted/70" />
              {tr("No learners yet.")}
            </div>
          )}
          {learners && learners.length > 0 && shown.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">{tr("No learners match your search.")}</div>}

          {shown.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1100px]">
                <thead>
                  <tr className="border-b border-rule bg-paper-warm text-left text-[11px] font-semibold uppercase tracking-wide text-muted whitespace-nowrap">
                    <th className="px-5 py-3">{tr("Learner")}</th>
                    <th className="px-3 py-3">{tr("Department")}</th>
                    <th className="px-3 py-3">{tr("Batch")}</th>
                    <th className="px-3 py-3">{tr("Certified")}</th>
                    <th className="px-3 py-3 text-center" title={tr("Sessions completed")}>
                      {tr("Sessions")}
                    </th>
                    <th className="px-3 py-3">{tr("License")}</th>
                    <th className="px-3 py-3">{tr("Status")}</th>
                    <th className="px-4 py-3 sticky right-0 bg-paper-warm shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((l) => {
                    const licensed = l.license && (l.license.status === "active" || l.license.status === "grace");
                    return (
                      <tr key={l.id} onClick={() => setViewingLearner(l.id)} className="group border-b border-rule last:border-0 hover:bg-paper-warm cursor-pointer transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">{initials(l.firstName, l.lastName, l.email)}</span>
                            <div className="min-w-0">
                              <p className="text-ink font-medium truncate max-w-[11rem]">{[l.firstName, l.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                              <p className="text-muted text-xs truncate max-w-[11rem]" title={l.email}>
                                {l.participantId ? `${l.participantId} · ` : ""}
                                {l.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted">
                          <p className="truncate max-w-[7.5rem]" title={l.department ?? undefined}>{l.department ?? "—"}</p>
                          {(l.employeeId || l.jobTitle) && <p className="text-xs truncate max-w-[7.5rem]">{[l.employeeId, l.jobTitle].filter(Boolean).join(" · ")}</p>}
                        </td>
                        <td className="px-3 py-3 text-ink">
                          <p className="truncate max-w-[11rem]" title={l.batchName ?? undefined}>
                            {l.batchName ?? "—"}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <CertifiedCell c={l.certified} />
                        </td>
                        <td className="px-3 py-3 text-center font-medium text-ink tabular-nums">{l.sessionCount}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{l.license && <LicenseStatusPill license={l.license} />}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>{l.active ? tr("Active") : tr("Deactivated")}</span>
                          {l.active && l.hasLoggedIn === false && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                managerResendInvite(l.id)
                                  .then((r) => say(tr("A new invite link was sent to {{email}}.", { email: r.email })))
                                  .catch(() => setError(tr("Could not resend the invite.")));
                              }}
                              className="block mt-1 text-[11px] font-semibold text-navy-deep hover:underline cursor-pointer"
                            >
                              {tr("Invite pending · resend")}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap sticky right-0 bg-surface group-hover:bg-paper-warm transition-colors shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)]" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {l.license && l.license.queuedMonths > 0 && (
                              <button
                                onClick={() => setReturning(l)}
                                title={`${tr("Request unassign")}: ${tr("Ask your Org Admin to return this learner's unused months to the pool")}`}
                                aria-label={tr("Request unassign")}
                                className="h-8 w-8 flex items-center justify-center rounded-input border border-rule text-muted hover:text-error hover:bg-error/10 hover:border-error/30 transition-colors cursor-pointer"
                              >
                                <Undo2 size={15} />
                              </button>
                            )}
                            <Button variant={licensed ? "secondary" : "primary"} onClick={() => setAssigning(l)} disabled={!l.active} className="!px-3 !py-1.5 !text-xs min-w-[4.25rem]">
                              {licensed ? tr("Extend") : tr("Assign")}
                            </Button>
                            <button
                              onClick={async () => {
                                const name = [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email;
                                if (l.active && !window.confirm(tr("Deactivate {{name}}?", { name }))) return;
                                try {
                                  if (l.active) {
                                    const r = await managerDeactivateLearner(l.id);
                                    say(
                                      r.returnRequested
                                        ? r.returnRequested === 1
                                          ? tr("Deactivated. A request to return 1 unused month went to your Org Admin.")
                                          : tr("Deactivated. A request to return {{n}} unused months went to your Org Admin.", { n: r.returnRequested })
                                        : tr("Deactivated."),
                                    );
                                  } else {
                                    await managerReactivateLearner(l.id);
                                    say(tr("Reactivated."));
                                  }
                                  load();
                                } catch {
                                  setError(tr("Couldn't change that learner's status."));
                                }
                              }}
                              title={l.active ? tr("Deactivate") : tr("Reactivate")}
                              className={`h-8 w-8 flex items-center justify-center rounded-input border border-rule transition-colors cursor-pointer ${l.active ? "text-muted hover:bg-error/10 hover:text-error hover:border-error/30" : "text-success hover:bg-success/10"}`}
                            >
                              {l.active ? <Ban size={15} /> : <RotateCcw size={15} />}
                            </button>
                            <button
                              onClick={() => setMovingLearner(l)}
                              disabled={batches.length < 2}
                              title={batches.length < 2 ? tr("You only manage one batch") : tr("Move to another batch")}
                              className="h-8 w-8 flex items-center justify-center rounded-input border border-rule text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <ArrowRightLeft size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showOnboard && (
        <OnboardLearnerModal
          batches={batches}
          myPool={myPool}
          onClose={() => {
            setShowOnboard(false);
            load();
          }}
          onCreated={(message) => {
            setShowOnboard(false);
            say(message);
            load();
          }}
        />
      )}

      {assigning && assigning.license && (
        <AssignLicenseModal
          learnerName={[assigning.firstName, assigning.lastName].filter(Boolean).join(" ") || assigning.email}
          license={assigning.license}
          poolHint={(() => {
            const b = budgets.find((x) => x.batchId === assigning.batchId);
            const pool = myPool?.allotment != null ? tr("{{remaining}} left in your pool", { remaining: myPool.remaining }) : tr("no pool allotted to you yet");
            if (b && b.budget !== null && (b.remaining ?? 0) > 0) return tr("Uses {{batchName}}'s fixed licenses first ({{remaining}} left), then your pool ({{pool}}).", { batchName: b.batchName, remaining: b.remaining, pool: pool });
            return tr("Uses your pool — {{pool}}.", { pool: pool });
          })()}
          onAssign={(months) => managerAssignLicenses(assigning.id, months)}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            load();
          }}
        />
      )}

      {returning && returning.license && (
        <RequestLicenseChangeModal
          batches={budgets}
          learner={{
            id: returning.id,
            name: [returning.firstName, returning.lastName].filter(Boolean).join(" ") || returning.email,
            queuedMonths: returning.license.queuedMonths,
          }}
          onClose={() => setReturning(null)}
          onSent={() => {
            setReturning(null);
            say(tr("Unassign request sent to your Org Admin."));
          }}
        />
      )}

      {viewingLearner && (
        <LearnerProfileModal
          learnerId={viewingLearner}
          onClose={() => setViewingLearner(null)}
          fetcher={getManagerLearnerDetail}
          saveDetails={(id, d) => managerUpdateLearnerDetails(id, d).then(load)}
        />
      )}

      {movingLearner && (
        <MoveLearnerModal
          learnerName={[movingLearner.firstName, movingLearner.lastName].filter(Boolean).join(" ") || movingLearner.email}
          currentBatchName={movingLearner.batchName}
          batches={batches}
          onMove={(batchId, reason) => managerMoveLearner(movingLearner.id, batchId, reason)}
          onClose={() => setMovingLearner(null)}
          onMoved={() => {
            setMovingLearner(null);
            load();
          }}
        />
      )}
    </div>
  );
}
