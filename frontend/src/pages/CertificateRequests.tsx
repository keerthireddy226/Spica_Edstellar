import { useEffect, useState } from "react";
import { Award, CheckCircle2, ExternalLink, FileText, XCircle } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { decideCertificateRequest, formatDay, getCertificateRequests, versantProofUrl, type CertificateRequest } from "@/api/certificates";
import { tr } from "@/i18n/tr";

// Course certificate requests: an org admin sees their own learners', Spica
// staff the individual learners'. Each shows what the learner has done and
// any Versant result they uploaded (with the score report), then Issue or
// Decline with a reason.
export function CertificateRequests({ viewer }: { viewer: "org" | "staff" }) {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [rows, setRows] = useState<CertificateRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    getCertificateRequests(tab)
      .then((r) => setRows(r.requests))
      .catch(() => setError(tr("Couldn't load the requests.")));
  }, [tab, reload]);

  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink flex items-center gap-2">
          <Award size={22} className="text-accent" /> {tr("Certificate requests")}
        </h1>
        <p className="text-sm text-muted mt-1">
          {viewer === "org"
            ? tr("Your learners ask for a certificate of completion when they finish the course or their access ends. Check what they did, then issue it with your organization's logo, or decline with a reason.")
            : tr("Individual learners (not in an organization) ask the Spica team for their certificate of completion. Check what they did, then issue it or decline with a reason.")}
        </p>
      </div>
      <div className="flex gap-1 p-1 rounded-pill bg-paper self-start">
        {(["pending", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setRows(null);
              setTab(t);
            }}
            className={`px-4 py-1.5 rounded-pill text-sm font-semibold cursor-pointer ${tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t === "pending" ? tr("Waiting") : tr("All")}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-muted">{tab === "pending" ? tr("No requests waiting.") : tr("No requests yet.")}</p>}
      <div className="flex flex-col gap-3">
        {rows?.map((r) => (
          <RequestCard key={r.id} r={r} viewer={viewer} onDone={() => setReload((n) => n + 1)} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ r, viewer, onDone }: { r: CertificateRequest; viewer: "org" | "staff"; onDone: () => void }) {
  const [includeVersant, setIncludeVersant] = useState(!!r.versant?.hasProof);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = r.snapshot;
  const v = r.versant;

  async function decide(issue: boolean) {
    setBusy(true);
    setError(null);
    try {
      await decideCertificateRequest(r.id, issue ? { issue: true, includeVersant: includeVersant && !!v } : { issue: false, note: note.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.message === "not_pending" ? tr("Someone already decided this request.") : tr("Couldn't save. Try again."));
      setBusy(false);
    }
  }

  const facts = [
    tr("Practice tests {{done}} of {{total}}", { done: s.practice.done, total: s.practice.total }),
    tr("{{n}} mock test(s)", { n: s.mocks }),
    tr("Level {{level}}", { level: s.level ?? "—" }),
    s.goal ? tr("goal {{goal}}", { goal: s.goal }) : null,
    s.access.endsAt ? (s.access.ended ? tr("access ended {{date}}", { date: formatDay(s.access.endsAt) }) : tr("access until {{date}}", { date: formatDay(s.access.endsAt) })) : null,
  ].filter(Boolean);

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display font-bold text-base text-ink">{r.learner.name}</p>
          <p className="text-xs text-muted">
            {[r.learner.learnerId, r.learner.email, viewer === "staff" ? r.learner.org : r.learner.batch].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span
          className={`text-xs font-semibold px-2.5 py-1 rounded-pill ${
            r.status === "pending" ? "bg-warning/15 text-ink" : r.status === "issued" ? "bg-success/15 text-success" : "bg-error/10 text-error"
          }`}
        >
          {r.status === "pending"
            ? tr("Asked {{date}}", { date: formatDay(r.createdAt) })
            : r.status === "issued"
              ? tr("Issued {{date}}", { date: formatDay(r.decidedAt) })
              : tr("Declined {{date}}", { date: formatDay(r.decidedAt) })}
        </span>
      </div>

      <p className="text-sm text-ink">{facts.join(" · ")}</p>
      <p className="text-xs text-muted">{tr("Course period on the certificate: {{from}} to {{to}}", { from: formatDay(s.period.from), to: formatDay(s.period.to) })}</p>

      {v ? (
        <div className="rounded-input bg-paper-warm/70 border border-rule p-3 flex flex-col gap-2">
          <p className="text-sm text-ink">
            {tr("Official test result")}: <b>{v.overallLevel}</b>
            {v.overallScore ? ` (${tr("score {{n}}", { n: v.overallScore })})` : ""} · {formatDay(v.takenOn)}
            {s.goal ? <span className="text-muted"> · {tr("goal {{goal}}", { goal: s.goal })}</span> : null}
          </p>
          {Object.keys(v.skills).length > 0 && (
            <p className="text-xs text-muted">
              {Object.entries(v.skills)
                .map(([k, x]) => `${k}: ${x?.level ?? "—"}${x?.score ? ` (${x.score})` : ""}`)
                .join(" · ")}
            </p>
          )}
          {v.hasProof ? (
            <a href={versantProofUrl(v.id)} target="_blank" rel="noreferrer" className="self-start flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
              <FileText size={15} /> {tr("Open the score report")}
            </a>
          ) : (
            <p className="text-xs text-warning">{tr("No score report uploaded, so this result can't go on the certificate.")}</p>
          )}
          {r.status === "pending" && v.hasProof && (
            <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={includeVersant} onChange={(e) => setIncludeVersant(e.target.checked)} className="mt-0.5 accent-navy" />
              {tr("I checked the score report: put this official result on the certificate")}
            </label>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">{tr("No official test result uploaded. The certificate shows the level reached in Spica.")}</p>
      )}

      {r.status === "pending" ? (
        declining ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={tr("Why? The learner sees this.")}
              className="rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink"
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDeclining(false)} disabled={busy}>
                {tr("Cancel")}
              </Button>
              <Button onClick={() => decide(false)} disabled={busy || !note.trim()}>
                {tr("Decline")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => decide(true)} disabled={busy} className="flex items-center gap-1.5">
              <CheckCircle2 size={16} /> {busy ? tr("Issuing…") : tr("Issue certificate")}
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(true)} disabled={busy} className="flex items-center gap-1.5">
              <XCircle size={16} /> {tr("Decline")}
            </Button>
          </div>
        )
      ) : r.status === "issued" && r.certificateCode ? (
        <a href={`/certificate/${r.certificateCode}`} target="_blank" rel="noreferrer" className="self-start flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
          <ExternalLink size={15} /> {tr("View certificate {{code}}", { code: r.certificateCode })}
        </a>
      ) : r.note ? (
        <p className="text-sm text-muted">{tr("Reason: {{note}}", { note: r.note })}</p>
      ) : null}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
