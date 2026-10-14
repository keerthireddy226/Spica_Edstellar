import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { GraduationCap, Users, Briefcase, UserPlus, X, Mail, Upload, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cardGradient } from "@/lib/cardGradients";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { LearnerProfileModal } from "@/components/LearnerProfileModal";
import {
  getConsoleUserBreakdown,
  getConsoleLearners,
  getConsoleBatches,
  onboardConsoleLearner,
  onboardConsoleLearnersBulk,
  type ConsoleUserBreakdown,
  type ConsoleLearner,
  type ConsoleBatch,
} from "@/api/admin";
import type { BulkLearnerRow, BulkLearnerResult } from "@/api/orgAdmin";

function initials(firstName: string | null, lastName: string | null, email: string): string {
  const fromName = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase();
  return fromName || email.slice(0, 2).toUpperCase();
}

function parseLearnerCsv(text: string): BulkLearnerRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const startIdx = /^email\s*,/i.test(lines[0]) ? 1 : 0;
  const rows: BulkLearnerRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const [email, firstName, lastName] = lines[i].split(",").map((c) => c.trim());
    if (!email) continue;
    rows.push({ email, firstName: firstName ?? "", lastName: lastName ?? "" });
  }
  return rows;
}

function BulkUploadForm({ batchId, onDone }: { batchId: string; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkLearnerRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkLearnerResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResults(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseLearnerCsv(text);
    if (parsed.length === 0) {
      setError("Couldn't find any rows in that file. Expected columns: email, firstName, lastName.");
    }
    setRows(parsed);
  }

  async function handleUpload() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await onboardConsoleLearnersBulk(batchId, rows);
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
      <p className="text-sm text-muted">
        CSV with columns, in order: <code className="text-xs bg-paper-warm px-1.5 py-0.5 rounded">email, firstName, lastName</code>. A header row is optional.
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
          <p className="text-sm text-success">{createdCount} of {results.length} invites sent.</p>
          <div className="max-h-48 overflow-y-auto border border-rule rounded-card">
            <table className="w-full text-xs">
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <td className="px-3 py-2 text-ink">{r.email}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                          r.status === "created" ? "bg-success/15 text-success" : r.status === "duplicate" ? "bg-warning/15 text-navy-deep" : "bg-error/15 text-error"
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

function OnboardLearnerModal({
  batches,
  onClose,
  onCreated,
}: {
  batches: ConsoleBatch[];
  onClose: () => void;
  onCreated: (email: string) => void;
}) {
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onboardConsoleLearner({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim(), batchId });
      onCreated(email.trim());
    } catch (err) {
      if (err instanceof ApiError && err.message === "email_already_registered") {
        setError("That email is already registered.");
      } else {
        setError("Something went wrong onboarding that learner.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (batches.length === 0) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-md p-6 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          <p className="text-sm text-ink">No batches exist yet — create an organization and a batch first.</p>
          <Button onClick={onClose}>Got it</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">Invite Learner</h2>
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
              {m === "single" ? "Single learner" : "Bulk upload (CSV)"}
            </button>
          ))}
        </div>

        <div className="px-8 pt-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">Organization & batch</label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="w-full mt-1.5 rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none"
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.orgName} — {b.name}
              </option>
            ))}
          </select>
        </div>

        {mode === "bulk" ? (
          <BulkUploadForm batchId={batchId} onDone={onClose} />
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
            {error && <p className="text-sm text-error">{error}</p>}
            <p className="text-xs text-muted">They'll get an email to set their own password.</p>
            <div className="flex items-center gap-3 pt-1">
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

function StatCard({ label, value, icon: Icon, index }: { label: string; value: number; icon: LucideIcon; index: number }) {
  return (
    <div style={cardGradient(index)} className="rounded-card shadow-sm hover:shadow-md transition-shadow p-5 flex items-center gap-4">
      <span className="h-11 w-11 rounded-2xl bg-white/20 text-white flex items-center justify-center shrink-0">
        <Icon size={22} strokeWidth={1.8} />
      </span>
      <div>
        <p className="text-2xl font-display font-bold text-white">{value}</p>
        <p className="text-xs text-white/80">{label}</p>
      </div>
    </div>
  );
}

// Its own module, same way Super Admin splits Admins/Org Admins/Individual
// Learners into separate pages rather than one page trying to do everything.
export function AdminUsers() {
  const [breakdown, setBreakdown] = useState<ConsoleUserBreakdown | null>(null);
  const [learners, setLearners] = useState<ConsoleLearner[] | null>(null);
  const [batches, setBatches] = useState<ConsoleBatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [justInvited, setJustInvited] = useState<string | null>(null);
  const [viewingLearnerId, setViewingLearnerId] = useState<string | null>(null);

  function load() {
    getConsoleUserBreakdown()
      .then(setBreakdown)
      .catch(() => setError("Could not load users."));
    getConsoleLearners()
      .then((res) => setLearners(res.learners))
      .catch(() => setError("Could not load learners."));
    getConsoleBatches().then((res) => setBatches(res.batches));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!justInvited) return;
    const timer = setTimeout(() => setJustInvited(null), 5000);
    return () => clearTimeout(timer);
  }, [justInvited]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!breakdown) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Users</h1>
          <p className="text-sm text-muted mt-1">How learners on the platform are split by account type — and the organizations' learners themselves.</p>
        </div>
        <Button onClick={() => setShowOnboard(true)} className="flex items-center gap-2 shrink-0">
          <UserPlus size={18} /> Invite Learner
        </Button>
      </div>

      {justInvited && (
        <p className="text-sm text-success bg-success/10 border border-success/25 rounded-card px-4 py-3">
          Invite sent to {justInvited} — they'll receive an email to set their password.
        </p>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Organization learners" value={breakdown.companyLearners + breakdown.otherOrgLearners} icon={Briefcase} index={1} />
        <StatCard label="University learners" value={breakdown.universityLearners} icon={GraduationCap} index={2} />
        <StatCard label="Individual learners" value={breakdown.individualLearners} icon={Users} index={0} />
      </div>

      {!learners && <p className="text-sm text-muted">Loading learners…</p>}
      {learners?.length === 0 && <p className="text-sm text-muted">No learners yet.</p>}

      {learners && learners.length > 0 && (
        <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Learner</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Sessions completed</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {learners.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setViewingLearnerId(l.id)}
                  className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-warm transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-9 rounded-full bg-navy text-lime flex items-center justify-center text-xs font-bold shrink-0">
                        {initials(l.firstName, l.lastName, l.email)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-ink font-medium truncate">{[l.firstName, l.lastName].filter(Boolean).join(" ") || "Not named yet"}</p>
                        <p className="text-muted text-xs truncate">{l.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${
                        l.type === "university" ? "bg-navy/10 text-navy" : l.type === "organization" ? "bg-accent/15 text-accent" : "bg-muted/15 text-muted"
                      }`}
                    >
                      {l.type === "university" ? "University" : l.type === "organization" ? "Organization" : "Individual"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{l.type === "individual" ? "—" : l.orgName}</td>
                  <td className="px-4 py-3 text-muted">{l.batchName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{l.sessionCount}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill ${l.active ? "bg-success/15 text-success" : "bg-error/15 text-error"}`}>
                      {l.active ? "Active" : "Deactivated"}
                    </span>
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
          onClose={() => setShowOnboard(false)}
          onCreated={(email) => {
            setShowOnboard(false);
            setJustInvited(email);
            load();
          }}
        />
      )}

      {viewingLearnerId && <LearnerProfileModal learnerId={viewingLearnerId} onClose={() => setViewingLearnerId(null)} />}
    </div>
  );
}
