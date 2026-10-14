import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, ExternalLink } from "lucide-react";
import { myCertificates, type CertificateSummary } from "@/api/reports";

// The learner's completion certificates; hidden until they have one.
export function MyCertificates() {
  const { t, i18n } = useTranslation();
  const [certs, setCerts] = useState<CertificateSummary[]>([]);
  useEffect(() => {
    myCertificates()
      .then((r) => setCerts(r.certificates))
      .catch(() => {});
  }, []);
  if (certs.length === 0) return null;
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-3">
      <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
        <Award size={20} className="text-warning" /> {t("profile.certificates.title")}
      </h2>
      {certs.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 border border-rule rounded-input px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink truncate">{c.batchName ?? c.organizationName ?? t("certificate.heading")}</p>
            <p className="text-xs text-muted">
              {new Date(c.issuedAt).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" })}
              {c.cefrLevel ? ` · ${c.cefrLevel}` : ""} · <span className="font-mono">{c.code}</span>
            </p>
          </div>
          <a
            href={`/certificate/${c.code}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-semibold text-navy hover:underline shrink-0"
          >
            {t("profile.certificates.view")} <ExternalLink size={12} />
          </a>
        </div>
      ))}
    </div>
  );
}
