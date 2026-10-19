import { useState, type FormEvent } from "react";
import { X, Mail } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { LICENSE_ERROR_TEXT } from "@/api/licenses";
import { inviteLearner, inviteLearnersBulk, validateBulkEmails, type OrgBatch } from "@/api/orgAdmin";
import { BulkLearnerUpload } from "@/components/BulkLearnerUpload";
import { LearnerDetailsFields } from "@/components/LearnerDetailsFields";
import { EMPTY_LEARNER_DETAILS, detailsErrorMessage, filledDetails, type LearnerDetails } from "@/api/details";

import { tr } from "@/i18n/tr";
export const LICENSE_CHOICES = [0, 1, 2, 3, 6, 9, 12, 18, 24];

export function batchLabel(b: OrgBatch): string {
  return b.managerNames.length > 0 ? `${b.name} — ${b.managerNames.join(", ")}` : tr("{{name}} — no manager yet", { name: b.name });
}

// Org Admin adds learners directly: into any batch, or with no batch for now
// (move them under a Manager's batch later). Can hand out licenses at once
// so new learners aren't locked out on first login.
export function OrgInviteLearnerModal({
  batches,
  poolAvailable,
  onClose,
  onDone,
}: {
  batches: OrgBatch[];
  poolAvailable: number | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [batchId, setBatchId] = useState<string>("");
  const [licenseMonths, setLicenseMonths] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [bulkCount, setBulkCount] = useState(0);
  const [details, setDetails] = useState<LearnerDetails>(EMPTY_LEARNER_DETAILS);
  const [showDetails, setShowDetails] = useState(false);
  const batch = batches.find((b) => b.id === batchId);
  const seatsLeft = batch?.capacity ? Math.max(0, batch.capacity - batch.learnerCount) : null;

  function chooseBatch(id: string) {
    setBatchId(id);
    const b = batches.find((x) => x.id === id);
    if (b?.defaultLicenseMonths != null) setLicenseMonths(b.defaultLicenseMonths);
  }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = { batchId: batchId || null, licenseMonths };
  const needed = licenseMonths * (mode === "single" ? 1 : bulkCount);
  const shortOfLicenses = poolAvailable !== null && licenseMonths > 0 && needed > poolAvailable;

  async function submitSingle(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await inviteLearner({ ...options, email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), details: filledDetails(details) });
      onDone(
        r.licenseError
          ? tr("Invite sent to {{email}}, but no license was assigned: {{v}}", { email: r.email, v: LICENSE_ERROR_TEXT[r.licenseError] ?? r.licenseError })
          : licenseMonths
            ? licenseMonths === 1
              ? tr("Invite sent to {{email}} with 1 month of access.", { email: r.email })
              : tr("Invite sent to {{email}} with {{n}} months of access.", { email: r.email, n: licenseMonths })
            : tr("Invite sent to {{email}}.", { email: r.email }),
      );
    } catch (err) {
      const code = err instanceof ApiError ? err.message : undefined;
      setError(code === "email_already_registered" ? tr("That email is already registered.") : (detailsErrorMessage(code) ?? tr("Something went wrong.")));
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
              <option value="">{tr("No batch yet (assign later)")}</option>
              {batches.filter((b) => (b.status ?? "active") === "active").map((b) => (
                <option key={b.id} value={b.id}>
                  {batchLabel(b)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Access to give now")}</label>
            <select value={licenseMonths} onChange={(e) => setLicenseMonths(Number(e.target.value))} className={`${inputClass} cursor-pointer`}>
              {(LICENSE_CHOICES.includes(licenseMonths) ? LICENSE_CHOICES : [...LICENSE_CHOICES, licenseMonths].sort((a, b) => a - b)).map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? tr("None — assign later") : m === 1 ? tr("1 month (1 license each)") : tr("{{n}} months ({{n}} licenses each)", { n: m })}
                </option>
              ))}
            </select>
          </div>
          <p className={`sm:col-span-2 text-xs ${shortOfLicenses ? "text-error" : "text-muted"}`}>
            {poolAvailable === null
              ? ""
              : shortOfLicenses
                ? tr("Needs {{needed}} licenses but your pool has {{poolAvailable}}. Learners beyond that are invited without access.", { needed: needed, poolAvailable: poolAvailable })
                : tr("{{poolAvailable}} licenses available in your pool.", { poolAvailable: poolAvailable })}
            {!batchId && tr(" Without a batch, no Manager sees this learner until you move them into one.")}
            {seatsLeft !== null && tr(" {{name}} has {{seatsLeft}} of {{capacity}} seats left.", { name: batch!.name, seatsLeft: seatsLeft, capacity: batch!.capacity })}
          </p>
        </div>

        {mode === "single" ? (
          <form onSubmit={submitSingle} className="flex flex-col gap-4 px-8 py-6">
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
            <p className="text-xs text-muted">{tr("They'll get an email to set their own password.")}</p>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? tr("Sending invite…") : tr("Send invite")}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                {tr("Cancel")}</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 px-8 py-6">
            <BulkLearnerUpload
              maxRows={200}
              checkExisting={(emails) => validateBulkEmails("org-admin", emails).then((r) => r.existing)}
              submit={async (rows) => (await inviteLearnersBulk(options, rows)).results}
              extraNote={
                licenseMonths
                  ? shortOfLicenses
                    ? tr("needs {{needed}} licenses, only {{poolAvailable}} available — some learners won't get one", { needed: needed, poolAvailable: poolAvailable })
                    : licenseMonths === 1
                      ? tr("1 month of access each")
                      : tr("{{n}} months of access each", { n: licenseMonths })
                  : null
              }
              onReadyChange={setBulkCount}
              onDone={(created) => onDone(created === 1 ? tr("1 learner invited.") : tr("{{n}} learners invited.", { n: created }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
