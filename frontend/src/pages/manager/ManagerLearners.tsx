import { useEffect, useState, type FormEvent } from "react";
import { BulkLearnerUpload } from "@/components/BulkLearnerUpload";
import { validateBulkEmails } from "@/api/orgAdmin";
import { FollowUpPanel } from "@/components/FollowUpPanel";
import { UserPlus, X, Mail, ArrowRightLeft, Ban, RotateCcw } from "lucide-react";
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
          : tr("Invite sent to {{email}}{{v}}. They'll get an email to set their password.", { email: r.email, v: r.licenseMonths ? ` with ${r.licenseMonths} month${r.licenseMonths === 1 ? "" : "s"} of access` : "" }),
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

        <div className="px-8 pt-4 grid sm:grid-cols-2 gap-3">
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
                  {m === 0 ? tr("None — assign later") : tr("{{m}} month{{v}} ({{m2}} license{{v2}} each)", { m: m, v: m === 1 ? "" : "s", m2: m, v2: m === 1 ? "" : "s" })}
                </option>
              ))}
            </select>
          </div>
          <div className={`sm:col-span-2 text-xs rounded-input px-3 py-2 ${short ? "bg-error/10 text-error" : "bg-paper-warm text-muted"}`}>
            <p>
              {tr("Available for")}{" "}{batch?.name ?? tr("this batch")}: {fixedLeft !== null ? tr("{{fixedLeft}} fixed license{{v}} (used first)", { fixedLeft: fixedLeft, v: fixedLeft === 1 ? "" : "s" }) : tr("no fixed licenses")}
              {" · "}
              {poolLeft !== null ? tr("{{poolLeft}} in your pool", { poolLeft: poolLeft }) : tr("no pool allotted to you")}.
            </p>
            {short && (
              <p className="mt-0.5 font-semibold">
                {count === 1
                  ? tr("Not enough licenses for {{licenseMonths}} month{{v}}. Pick fewer months, or request more from your Org Admin.", { licenseMonths: licenseMonths, v: licenseMonths === 1 ? "" : "s" })
                  : tr("Enough for {{covered}} of {{v}} learners. The rest are invited without access — request more licenses from your Org Admin.", { covered: covered, v: count })}
              </p>
            )}
            {seatsLeft !== null && (
              <p className="mt-0.5">
                {seatsLeft} {tr("of")}{" "}{batch!.capacity} {tr("seats left in this batch.")}</p>
            )}
          </div>
        </div>

        {mode === "bulk" ? (
          <div className="px-8 py-6">
            <BulkLearnerUpload
              maxRows={200}
              checkExisting={(emails) => validateBulkEmails("manager", emails).then((r) => r.existing)}
              submit={async (rows) => (await managerOnboardLearnersBulk(batchId, rows, licenseMonths)).results}
              extraNote={licenseMonths ? tr("{{licenseMonths}} month{{v}} of access each", { licenseMonths: licenseMonths, v: licenseMonths === 1 ? "" : "s" }) : null}
              onReadyChange={setBulkCount}
              onDone={(created) => onCreated(tr("{{created}} learner{{v}} invited.", { created: created, v: created === 1 ? "" : "s" }))}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5 px-8 py-6">
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
  const q = query.trim().toLowerCase();
  const shown = (learners ?? []).filter(
    (l) =>
      !q ||
      [l.firstName, l.lastName, l.email, l.participantId, l.employeeId, l.department, l.jobTitle, l.batchName].some((v) => v?.toLowerCase().includes(q)),
  );

  function load() {
    getManagerLearners()
      .then((res) => setLearners(res.learners))
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


  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Learners")}</h1>
          <p className="text-sm text-muted mt-1">{tr("Only learners in your assigned batch(es).")}</p>
        </div>
        <Button
          onClick={() => setShowOnboard(true)}
          disabled={batches.length === 0}
          className="flex items-center gap-2 shrink-0"
        >
          <UserPlus size={18} /> {tr("Invite Learner")}</Button>
      </div>

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">{notice}</p>}

      {error && <p className="text-sm text-error">{error}</p>}
      {!learners && !error && <p className="text-sm text-muted">{tr("Loading…")}</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">{tr("No learners yet.")}</p>}

      <FollowUpPanel />

      {learners && learners.length > 0 && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("Search by name, email, employee ID, department or batch")}
          className="w-full sm:max-w-md rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
        />
      )}

      {learners && learners.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">{tr("Learner")}</th>
                <th className="px-4 py-3">{tr("Department")}</th>
                <th className="px-4 py-3">{tr("Batch")}</th>
                <th className="px-4 py-3">{tr("Sessions completed")}</th>
                <th className="px-4 py-3">{tr("License")}</th>
                <th className="px-4 py-3">{tr("Status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} onClick={() => setViewingLearner(l.id)} className="border-b border-rule last:border-0 hover:bg-paper-warm cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(l.firstName, l.lastName, l.email)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-ink font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || tr("Not named yet")}</p>
                        <p className="text-muted text-xs truncate">
                          {l.participantId ? `${l.participantId} · ` : ""}
                          {l.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <p>{l.department ?? "—"}</p>
                    {(l.employeeId || l.jobTitle) && <p className="text-xs">{[l.employeeId, l.jobTitle].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted">{l.batchName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                  <td className="px-4 py-3">{l.license && <LicenseStatusPill license={l.license} />}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? tr("Active") : tr("Deactivated")}
                    </span>
                    {l.active && l.hasLoggedIn === false && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          managerResendInvite(l.id)
                            .then((r) => setNotice(tr("A new invite link was sent to {{email}}.", { email: r.email })))
                            .catch(() => setError(tr("Could not resend the invite.")));
                        }}
                        className="block mt-1 text-xs font-semibold text-navy hover:underline cursor-pointer"
                      >
                        {tr("Invite pending · resend")}</button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {l.license && l.license.queuedMonths > 0 && (
                      <button
                        onClick={() => setReturning(l)}
                        title={tr("Ask your Org Admin to return this learner's unused months to the pool")}
                        className="text-xs font-semibold text-muted hover:text-error cursor-pointer mr-2"
                      >
                        {tr("Request unassign")}</button>
                    )}
                    <Button
                      variant={l.license && (l.license.status === "active" || l.license.status === "grace") ? "secondary" : "primary"}
                      onClick={() => setAssigning(l)}
                      disabled={!l.active}
                      className="!px-3 !py-1.5 !text-xs mr-1"
                    >
                      {l.license && (l.license.status === "active" || l.license.status === "grace") ? tr("Extend") : tr("Assign")}
                    </Button>
                    <button
                      onClick={async () => {
                        try {
                          if (l.active) {
                            const r = await managerDeactivateLearner(l.id);
                            setNotice(
                              r.returnRequested
                                ? tr("Deactivated. A request to return {{returnRequested}} unused month{{v}} went to your Org Admin.", { returnRequested: r.returnRequested, v: r.returnRequested === 1 ? "" : "s" })
                                : tr("Deactivated."),
                            );
                          } else {
                            await managerReactivateLearner(l.id);
                            setNotice(tr("Reactivated."));
                          }
                          load();
                        } catch {
                          setError(tr("Couldn't change that learner's status."));
                        }
                      }}
                      title={l.active ? tr("Deactivate") : tr("Reactivate")}
                      className={`p-1.5 rounded-input transition-colors cursor-pointer ${l.active ? "text-muted hover:bg-error/10 hover:text-error" : "text-success hover:bg-success/10"}`}
                    >
                      {l.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                    </button>
                    <button
                      onClick={() => setMovingLearner(l)}
                      disabled={batches.length < 2}
                      title={batches.length < 2 ? tr("You only manage one batch") : tr("Move to another batch")}
                      className="p-1.5 rounded-input text-muted hover:bg-paper-warm hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ArrowRightLeft size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            setNotice(message);
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
            setNotice(tr("Unassign request sent to your Org Admin."));
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
