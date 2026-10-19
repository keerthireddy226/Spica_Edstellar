import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Download, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/Button";
import { formatDay } from "@/api/certificates";

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
  courseName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  goalLevel: string | null;
  versantLevel: string | null;
  versantScore: number | null;
  versantTakenOn: string | null;
  orgLogoUrl: string | null;
  verifyUrl: string;
  qr: string;
}

const INK = "#1d2b3a";
const NAVY = "#1f3a5f";
const MUTED = "#5b6b7c";
const GOLD = "#b8893b";

// Public: the certificate itself (printable, or saved as a PDF) and the page
// anyone checks it on, by its code or QR code. An organization's learners'
// certificates carry its logo next to Spica's.
export function CertificateView() {
  const { t } = useTranslation();
  const { code = "" } = useParams();
  const [cert, setCert] = useState<VerifiedCertificate | null>(null);
  const [missing, setMissing] = useState(false);
  // On a narrow screen the whole page shrinks to fit (print is always full size).
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 24) / 960));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

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

  const course = !!cert.courseName;
  const levels = [
    cert.goalLevel ? { label: tr("Goal"), value: cert.goalLevel, note: null } : null,
    cert.cefrLevel ? { label: course ? tr("Level reached in Spica") : tr("Level"), value: cert.cefrLevel, note: null } : null,
    cert.versantLevel
      ? {
          label: tr("Versant test result"),
          value: cert.versantLevel,
          note: [cert.versantScore ? tr("score {{n}}", { n: cert.versantScore }) : null, cert.versantTakenOn ? formatDay(cert.versantTakenOn) : null].filter(Boolean).join(" · "),
        }
      : null,
  ].filter((x): x is { label: string; value: string; note: string | null } => !!x);

  return (
    <div className="app-surface min-h-screen flex flex-col items-center gap-4 p-3 sm:p-10 print:p-0 print:bg-white print:block">
      {/* One landscape A4 page when printed or saved as a PDF. */}
      <style>{`@page { size: A4 landscape; margin: 0; } @media print { html, body { background: #fff !important; } .cert-page { transform: none !important; } }`}</style>
      <div className="print:hidden flex flex-wrap items-center justify-center gap-3">
        {cert.valid ? (
          <span className="flex items-center gap-1.5 text-sm text-success font-semibold">
            <ShieldCheck size={16} /> {tr("Valid certificate · {{code}}", { code: cert.code })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-error font-semibold">
            <ShieldX size={16} /> {t("certificate.revoked")}
          </span>
        )}
        {cert.valid && (
          <Button variant="secondary" onClick={() => window.print()} className="flex items-center gap-2 !px-3.5 !py-2">
            <Download size={15} /> {tr("Download PDF")}
          </Button>
        )}
      </div>
      {cert.valid && <p className="print:hidden text-xs text-muted -mt-2 text-center">{tr("In the print window, choose \"Save as PDF\".")}</p>}

      <div className="print:!h-auto print:!w-auto" style={{ width: 960 * scale, height: 679 * scale }}>
        <div
          className={`cert-page relative w-[960px] h-[679px] print:w-[297mm] print:h-[210mm] bg-[#fffdf8] shadow-xl print:shadow-none p-[22px] origin-top-left ${cert.valid ? "" : "opacity-50"}`}
          style={{ color: INK, printColorAdjust: "exact", WebkitPrintColorAdjust: "exact", transform: scale < 1 ? `scale(${scale})` : undefined }}
        >
          <div className="h-full w-full border-[3px] p-[6px]" style={{ borderColor: NAVY }}>
            <div className="relative h-full w-full border flex flex-col px-14 py-9" style={{ borderColor: GOLD }}>
              {/* Logos. */}
              <div className="flex items-start justify-between">
                <div className="flex flex-col">
                  <span className="font-logo font-bold text-[34px] leading-none" style={{ color: "#3f9e8f" }}>
                    Spica
                  </span>
                  <span className="text-[10px] tracking-[0.25em] uppercase mt-1" style={{ color: MUTED }}>
                    {tr("by Edstellar")}
                  </span>
                </div>
                {cert.orgLogoUrl || cert.organizationName ? (
                  <div className="flex items-center gap-3">
                    {cert.organizationName && (
                      <span className="text-sm font-semibold text-right max-w-[220px] leading-tight" style={{ color: NAVY }}>
                        {cert.organizationName}
                      </span>
                    )}
                    {cert.orgLogoUrl && <img src={cert.orgLogoUrl} alt="" className="h-14 w-14 object-contain" />}
                  </div>
                ) : null}
              </div>

              {/* Title and name. */}
              <div className="flex flex-col items-center text-center mt-3">
                <p className="text-[12px] tracking-[0.45em] uppercase" style={{ color: GOLD }}>
                  {tr("Certificate")}
                </p>
                <h1 className="font-display font-bold text-[40px] leading-tight" style={{ color: NAVY }}>
                  {tr("of Completion")}
                </h1>
                <p className="text-sm mt-4" style={{ color: MUTED }}>
                  {t("certificate.awardedTo")}
                </p>
                <p className="font-logo font-bold text-[38px] leading-tight mt-1 px-10 pb-1 border-b" style={{ borderColor: `${GOLD}88` }}>
                  {cert.learnerName}
                </p>
                {cert.participantId && (
                  <p className="text-[11px] font-mono mt-1" style={{ color: MUTED }}>
                    {tr("Learner ID {{id}}", { id: cert.participantId })}
                  </p>
                )}
                <p className="text-[15px] mt-4 max-w-[640px] leading-relaxed">
                  {course
                    ? tr("has completed the {{course}} course", { course: cert.courseName })
                    : `${t("certificate.completed")}${cert.batchName ? ` — ${cert.batchName}` : ""}`}
                  {course && cert.periodFrom && cert.periodTo ? (
                    <>
                      {" "}
                      {tr("from {{from}} to {{to}}", { from: formatDay(cert.periodFrom, true), to: formatDay(cert.periodTo, true) })}
                    </>
                  ) : null}
                  {cert.organizationName ? `, ${cert.organizationName}` : ""}.
                </p>
              </div>

              {/* Levels. */}
              {levels.length > 0 && (
                <div className="flex justify-center gap-4 mt-5">
                  {levels.map((l) => (
                    <div key={l.label} className="min-w-[150px] rounded-lg border px-5 py-2.5 text-center" style={{ borderColor: `${NAVY}33`, background: "#ffffff" }}>
                      <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: MUTED }}>
                        {l.label}
                      </p>
                      <p className="font-display font-bold text-[26px] leading-tight" style={{ color: NAVY }}>
                        {l.value}
                      </p>
                      {l.note && (
                        <p className="text-[10px]" style={{ color: MUTED }}>
                          {l.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Issue date, ID and QR code. */}
              <div className="mt-auto flex items-end justify-between">
                <div className="flex flex-col gap-0.5 text-[11px]" style={{ color: MUTED }}>
                  <span>
                    {tr("Issued")} <b style={{ color: INK }}>{formatDay(cert.issuedAt, true)}</b>
                  </span>
                  <span>
                    {tr("Certificate ID")} <b className="font-mono" style={{ color: INK }}>{cert.code}</b>
                  </span>
                  <span className="max-w-[420px]">{tr("Check it at {{url}}", { url: cert.verifyUrl })}</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <img src={cert.qr} alt={tr("QR code to verify this certificate")} className="h-[92px] w-[92px]" />
                  <span className="text-[10px]" style={{ color: MUTED }}>
                    {tr("Scan to verify")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
