import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Printer, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/Button";

import { tr } from "@/i18n/tr";
interface VerifiedCertificate {
  valid: boolean;
  revoked: boolean;
  code: string;
  learnerName: string;
  participantId: string | null;
  organizationName: string | null;
  batchName: string | null;
  cefrLevel: string | null;
  issuedAt: string;
}

// Public: the printable certificate, and the page anyone checks it on.
export function CertificateView() {
  const { t, i18n } = useTranslation();
  const { code = "" } = useParams();
  const [cert, setCert] = useState<VerifiedCertificate | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/certificates/verify/${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (r.status === 404) setMissing(true);
        else setCert(await r.json());
      })
      .catch(() => setMissing(true));
  }, [code]);

  if (missing) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center p-6">
        <p className="flex items-center gap-2 text-ink">
          <ShieldX className="text-error" /> {t("certificate.notFound")}
        </p>
      </div>
    );
  }
  if (!cert) return null;

  const issued = new Date(cert.issuedAt).toLocaleDateString(i18n.language, { year: "numeric", month: "long", day: "numeric" });
  const verifyUrl = `${window.location.origin}/certificate/${cert.code}`;

  return (
    <div className="app-surface min-h-screen flex flex-col items-center gap-4 p-4 sm:p-10 print:p-0 print:bg-white">
      <div className="print:hidden flex items-center gap-3">
        {cert.valid ? (
          <span className="flex items-center gap-1.5 text-sm text-success font-semibold">
            <ShieldCheck size={16} /> {cert.code}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-error font-semibold">
            <ShieldX size={16} /> {t("certificate.revoked")}
          </span>
        )}
        <Button variant="secondary" onClick={() => window.print()} className="flex items-center gap-2 !px-3.5 !py-2">
          <Printer size={15} /> {t("certificate.print")}
        </Button>
      </div>
      <div
        className={`w-full max-w-3xl aspect-[1.414] bg-white text-[#1d2b3a] border-[10px] border-double border-[#1f3a5f] shadow-xl print:shadow-none flex flex-col items-center justify-center text-center px-8 sm:px-16 gap-3 ${
          cert.valid ? "" : "opacity-50"
        }`}
      >
        <p className="text-xs tracking-[0.3em] uppercase text-[#5b6b7c]">{tr("Spica · Edstellar")}</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold">{t("certificate.heading")}</h1>
        <p className="text-sm text-[#5b6b7c] mt-2">{t("certificate.awardedTo")}</p>
        <p className="font-display text-2xl sm:text-3xl font-bold border-b border-[#1f3a5f]/30 px-6 pb-1">{cert.learnerName}</p>
        {cert.participantId && <p className="text-xs font-mono text-[#5b6b7c]">{cert.participantId}</p>}
        <p className="text-sm">
          {t("certificate.completed")}
          {cert.batchName ? ` — ${cert.batchName}` : ""}
          {cert.organizationName ? `, ${cert.organizationName}` : ""}
        </p>
        {cert.cefrLevel && <p className="text-lg font-semibold">{t("certificate.level", { level: cert.cefrLevel })}</p>}
        <p className="text-sm text-[#5b6b7c] mt-3">{issued}</p>
        <p className="text-[10px] text-[#5b6b7c] mt-4">{t("certificate.verify", { url: verifyUrl, code: cert.code })}</p>
      </div>
    </div>
  );
}
