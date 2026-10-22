import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Download, RotateCcw, Share2, ShieldCheck, ShieldX } from "lucide-react";
import { linkedInAddUrl } from "@/lib/linkedin";
import { subBandLabel } from "@/lib/subBand";
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
  // A result certificate: one real assessment attempt, valid for a year.
  kind?: "completion" | "result";
  testName?: string | null;
  spicaScore?: number | null;
  // score: a Spica score; percent: a level test's share right.
  skillScores?: Record<string, { level: string; score?: number; percent?: number }> | null;
  validUntil?: string | null;
  expired?: boolean;
  // The test passed the face and ID checks.
  identityVerified?: boolean;
}

const SKILL_ORDER = ["speaking", "listening", "reading", "writing"];

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
  // Back: to the page it was opened from; opened in a new tab or from a
  // link, a signed-in learner goes to their certificates. Someone checking a
  // certificate from its link or QR code (not signed in) gets no Back.
  const navigate = useNavigate();
  const { key: locationKey } = useLocation();
  const { user } = useAuth();
  const back = locationKey !== "default" ? () => navigate(-1) : user?.role === "learner" ? () => navigate(ROUTES.MY_CERTIFICATES) : null;
  const [cert, setCert] = useState<VerifiedCertificate | null>(null);
  const [missing, setMissing] = useState(false);
  // The check itself failed (network or server), which isn't the same as "no such certificate".
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // On a narrow screen the whole page shrinks to fit (print is always full size).
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 24) / 960));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    setFailed(false);
    fetch(`/api/certificates/verify/${encodeURIComponent(code)}`)
      .then(async (r) => {
        if (r.status === 404) setMissing(true);
        else if (!r.ok) setFailed(true);
        else setCert(await r.json());
      })
      .catch(() => setFailed(true));
  }, [code, attempt]);

  if (missing || failed) {
    return (
      <div className="app-surface min-h-screen flex items-center justify-center p-6">
        <div className="bg-surface border border-rule rounded-card shadow-sm px-8 py-10 max-w-md w-full flex flex-col items-center text-center gap-3">
          <span className="font-logo font-bold text-2xl text-navy">Spica</span>
          <span className="h-14 w-14 rounded-2xl bg-error/10 text-error flex items-center justify-center mt-2">
            <ShieldX size={26} />
          </span>
          <p className="text-ink font-semibold">{missing ? t("certificate.notFound") : tr("This certificate couldn't be checked right now.")}</p>
          {missing ? (
            <p className="text-sm text-muted">{tr("Check the certificate ID and try the link again.")}</p>
          ) : (
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-pill border border-rule-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-paper-warm cursor-pointer"
            >
              <RotateCcw size={14} /> {tr("Try again")}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!cert)
    return (
      <div className="app-surface min-h-screen flex items-center justify-center p-6" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck size={16} className="animate-pulse" /> {tr("Checking the certificate…")}
        </p>
      </div>
    );

  const course = !!cert.courseName;
  const result = cert.kind === "result";
  const levels = result
    ? [
        cert.spicaScore != null ? { label: tr("Spica score"), value: String(cert.spicaScore), note: tr("out of 90") } : null,
        cert.cefrLevel
          ? { label: tr("CEFR level"), value: `${cert.cefrLevel}${subBandLabel(cert.spicaScore) ? ` · ${subBandLabel(cert.spicaScore)}` : ""}`, note: cert.spicaScore == null ? tr("Passed") : null }
          : null,
        ...SKILL_ORDER.filter((k) => cert.skillScores?.[k]).map((k) => {
          const s = cert.skillScores![k];
          return {
            label: t(`skills.${k}`),
            value: s.percent != null ? `${s.percent}%` : s.level,
            note: s.percent != null ? tr("right at {{level}}", { level: s.level }) : tr("score {{n}}", { n: s.score ?? "—" }),
          };
        }),
      ].filter((x): x is { label: string; value: string; note: string | null } => !!x)
    : [
    cert.goalLevel ? { label: tr("Goal"), value: cert.goalLevel, note: null } : null,
    cert.cefrLevel ? { label: course ? tr("Level reached in Spica") : tr("Level"), value: cert.cefrLevel, note: null } : null,
    cert.versantLevel
      ? {
          label: tr("Official test result"),
          value: cert.versantLevel,
          note: [cert.versantScore ? tr("score {{n}}", { n: cert.versantScore }) : null, cert.versantTakenOn ? formatDay(cert.versantTakenOn) : null].filter(Boolean).join(" · "),
        }
      : null,
      ].filter((x): x is { label: string; value: string; note: string | null } => !!x);

  return (
    <div className="app-surface min-h-screen flex flex-col items-center gap-4 p-3 sm:p-10 print:p-0 print:bg-white print:block">
      {/* One landscape A4 page when printed or saved as a PDF. */}
      <style>{`@page { size: A4 landscape; margin: 0; } @media print { html, body { background: #fff !important; } .cert-page { transform: none !important; } }`}</style>
      {back && (
        <button
          onClick={back}
          className="print:hidden self-start sm:self-auto sm:w-full sm:max-w-[960px] flex items-center gap-1.5 text-sm font-semibold text-navy-deep hover:underline cursor-pointer"
        >
          <ArrowLeft size={16} /> {tr("Back")}
        </button>
      )}
      <div className="print:hidden flex flex-wrap items-center justify-center gap-3">
        {cert.valid ? (
          <span className="flex items-center gap-1.5 text-sm text-success font-semibold">
            <ShieldCheck size={16} /> {tr("Valid certificate · {{code}}", { code: cert.code })}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-sm text-error font-semibold">
            <ShieldX size={16} /> {cert.expired && !cert.revoked && cert.validUntil ? tr("This certificate expired on {{date}}.", { date: formatDay(cert.validUntil, true) }) : t("certificate.revoked")}
          </span>
        )}
        {cert.valid && (
          <Button variant="secondary" onClick={() => window.print()} className="flex items-center gap-2 !px-3.5 !py-2">
            <Download size={15} /> {tr("Download PDF")}
          </Button>
        )}
        {cert.valid && cert.kind === "result" && (
          <a
            href={linkedInAddUrl({ name: `${cert.testName ?? "English"}: ${cert.cefrLevel ?? ""}${cert.spicaScore != null ? `, Spica score ${cert.spicaScore}` : ""}`, code: cert.code, issuedAt: cert.issuedAt, validUntil: cert.validUntil ?? null, verifyUrl: cert.verifyUrl })}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 px-3.5 py-2 rounded-pill border border-rule-strong text-sm font-semibold text-ink hover:bg-paper-warm"
          >
            <Share2 size={15} /> {tr("Add to LinkedIn")}
          </a>
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
                  {result ? tr("of English Proficiency") : tr("of Completion")}
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
                  {result && cert.spicaScore == null && cert.cefrLevel
                    ? tr("has passed the Spica level test at {{level}}, strictly proctored", { level: cert.cefrLevel })
                    : result
                    ? tr("has taken the {{test}} test, strictly proctored, with this result", { test: cert.testName ?? "" })
                    : course
                    ? tr("has completed the {{course}} course", { course: cert.courseName })
                    : `${t("certificate.completed")}${cert.batchName ? ` — ${cert.batchName}` : ""}`}
                  {course && cert.periodFrom && cert.periodTo ? (
                    <>
                      {" "}
                      {tr("from {{from}} to {{to}}", { from: formatDay(cert.periodFrom, true), to: formatDay(cert.periodTo, true) })}
                    </>
                  ) : null}
                  {!result && cert.organizationName ? `, ${cert.organizationName}` : ""}
                  {result ? ":" : "."}
                </p>
              </div>

              {/* Levels. */}
              {levels.length > 0 && (
                <div className={`flex justify-center ${result ? "gap-2.5" : "gap-4"} mt-5`}>
                  {levels.map((l, i) => (
                    <div
                      key={l.label}
                      className={`${result ? "min-w-[112px] px-3" : "min-w-[150px] px-5"} rounded-lg border py-2.5 text-center`}
                      style={{ borderColor: result && i < 2 ? GOLD : `${NAVY}33`, background: "#ffffff" }}
                    >
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
                  {cert.validUntil ? (
                    <span>
                      {tr("Valid until")} <b style={{ color: INK }}>{formatDay(cert.validUntil, true)}</b>
                    </span>
                  ) : cert.kind === "result" ? (
                    <span>
                      <b style={{ color: INK }}>{tr("Valid for life")}</b>
                    </span>
                  ) : null}
                  {cert.identityVerified && (
                    <span className="flex items-center gap-1" style={{ color: NAVY }}>
                      <BadgeCheck size={13} /> <b>{tr("Identity verified")}</b> · {tr("face and ID checked during the test")}
                    </span>
                  )}
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
