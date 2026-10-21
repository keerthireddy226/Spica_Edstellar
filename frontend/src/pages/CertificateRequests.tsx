import { useEffect, useState } from "react";
import { Award, ExternalLink, FileText} from "lucide-react";
import { Button } from "@/components/Button";
import {
  formatDay,
  getCertificatePrints,
  getCertificateRequests,
  markCertificatePosted,
  versantProofUrl,
  type CertificatePrint,
  type CertificateRequest,
} from "@/api/certificates";
import { tr } from "@/i18n/tr";
import { orgCertificates, type CertificateSummary } from "@/api/reports";

// Printed copies of final assessment certificates that learners paid for: print, post, mark posted.
function PrintsToPost() {
  const [prints, setPrints] = useState<CertificatePrint[] | null>(null);
  const load = () =>
    getCertificatePrints()
      .then((r) => setPrints(r.prints))
      .catch(() => setPrints([]));
  useEffect(() => {
    load();
  }, []);
  if (!prints?.length) return null;
  return (
    <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3">
      <h2 className="font-display font-semibold text-lg text-ink">{tr("Printed certificates to post")}</h2>
      {prints.map((p) => (
        <div key={p.id} className="flex flex-wrap items-start gap-3 border-t border-rule pt-3 first:border-t-0 first:pt-0 text-sm">
          <div className="flex-1 min-w-[220px]">
            <a href={`/certificate/${p.code}`} target="_blank" rel="noopener" className="font-semibold text-navy-deep hover:underline">
              {p.learnerName} · {p.code}
            </a>
            <p className="text-muted whitespace-pre-line">
              {[p.shipping.name, p.shipping.line1, p.shipping.line2, `${p.shipping.city} ${p.shipping.postalCode}`, p.shipping.country, p.shipping.phone].filter(Boolean).join("\n")}
            </p>
          </div>
          {p.status === "to_print" ? (
            <Button variant="secondary" onClick={() => markCertificatePosted(p.id).then(load)} className="!py-1.5 !px-3 text-sm">
              {tr("Mark as posted")}
            </Button>
          ) : (
            <span className="text-xs text-success font-semibold">{tr("Posted {{date}}", { date: formatDay(p.postedAt ?? p.createdAt) })}</span>
          )}
        </div>
      ))}
    </section>
  );
}

// The organization's final assessment certificates, newest first.
function OrgCertificates() {
  const [certs, setCerts] = useState<CertificateSummary[] | null>(null);
  useEffect(() => {
    orgCertificates()
      .then((r) => setCerts(r.certificates.filter((c) => c.kind === "result" && !c.revokedAt)))
      .catch(() => setCerts([]));
  }, []);
  if (!certs) return null;
  return (
    <section className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-3">
      <h2 className="font-display font-semibold text-lg text-ink">{tr("Final assessment certificates")}</h2>
      {certs.length === 0 ? (
        <p className="text-sm text-muted">{tr("No learner is certified yet. Certificates come from the final assessment, given on Tests & credits or at the end of a program.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted border-b border-rule">
                <th className="py-2 pr-3">{tr("Learner")}</th>
                <th className="py-2 pr-3">{tr("Test")}</th>
                <th className="py-2 pr-3">{tr("Level")}</th>
                <th className="py-2 pr-3">{tr("Issued")}</th>
                <th className="py-2 pr-3">{tr("Valid until")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.id} className="border-t border-rule">
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-ink">{c.learnerName}</span>
                    {c.participantId && <span className="block text-xs text-muted font-mono">{c.participantId}</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink">{c.testName ?? "—"}</td>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">
                    {c.cefrLevel ?? "—"}
                    {c.spicaScore != null && <span className="text-muted"> · {c.spicaScore}</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{formatDay(c.issuedAt.slice(0, 10))}</td>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{c.validUntil ? formatDay(c.validUntil) : tr("Valid for life")}</td>
                  <td className="py-2">
                    <a href={`/certificate/${c.code}`} target="_blank" rel="noopener" className="text-sm font-semibold text-navy-deep hover:underline">
                      {tr("Open")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Course certificate requests: an org admin sees their own learners', Spica
// staff the individual learners'. Each shows what the learner has done and
// any Versant result they uploaded (with the score report), then Issue or
// Decline with a reason.
export function CertificateRequests({ viewer }: { viewer: "org" | "staff" }) {
  const tab = "all" as const;
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
          <Award size={22} className="text-accent" /> {tr("Certificates")}
        </h1>
        <p className="text-sm text-ink mt-2 bg-paper-warm rounded-input px-4 py-3 max-w-3xl">
          {tr("Certificates now come only from the final assessment: a real, strictly proctored test. Certificates of completion are no longer issued, and requests that were waiting were closed. Certificates already issued stay valid.")}
        </p>
      </div>
      {viewer === "org" && <OrgCertificates />}
      {viewer === "staff" && <PrintsToPost />}
      {rows && rows.length > 0 && <h2 className="font-display font-semibold text-lg text-ink">{tr("Earlier course certificate requests")}</h2>}
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex flex-col gap-3">
        {rows?.map((r) => (
          <RequestCard key={r.id} r={r} viewer={viewer} onDone={() => setReload((n) => n + 1)} />
        ))}
      </div>
    </div>
  );
}

// An earlier course certificate request (no longer issued): what the learner had done and how it ended.
function RequestCard({ r, viewer }: { r: CertificateRequest; viewer: "org" | "staff"; onDone: () => void }) {
  const s = r.snapshot;
  const v = r.versant;

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
        </div>
      ) : (
        <p className="text-xs text-muted">{tr("No official test result uploaded. The certificate shows the level reached in Spica.")}</p>
      )}

      {r.status === "issued" && r.certificateCode ? (
        <a href={`/certificate/${r.certificateCode}`} target="_blank" rel="noreferrer" className="self-start flex items-center gap-1.5 text-sm font-semibold text-navy hover:underline">
          <ExternalLink size={15} /> {tr("View certificate {{code}}", { code: r.certificateCode })}
        </a>
      ) : r.note ? (
        <p className="text-sm text-muted">{tr("Reason: {{note}}", { note: r.note })}</p>
      ) : null}
    </div>
  );
}
