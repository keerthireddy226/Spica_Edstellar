import type { Metadata } from "next";
import { BadgeCheck, CalendarCheck, FileSearch, QrCode, ShieldCheck, UserCheck } from "lucide-react";
import { CertificateForm } from "@/components/CertificateForm";
import { CertificateMock } from "@/components/home/Mocks";
import { PageHero } from "@/components/page/PageHero";
import { MockFrame } from "@/components/page/Visuals";
import { app } from "@/lib/site";

export const metadata: Metadata = {
  title: "Check a certificate",
  description: "Check a Spica English certificate: enter its code to see the name, level, scores, date and whether it is still valid.",
};

const SHOWS: [React.ElementType, string][] = [
  [UserCheck, "The name on the certificate and the test taken"],
  [BadgeCheck, "The CEFR level and Spica score, overall and for each skill"],
  [CalendarCheck, "The test date and the date the certificate is valid until"],
  [ShieldCheck, "Whether the identity was verified"],
  [FileSearch, "Whether the certificate is valid, expired or withdrawn"],
];

export default function CertificateCheckPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "Check a certificate" }]}
        eyebrow="Certificate check"
        icon={<QrCode size={16} />}
        tone="gold"
        title={
          <>
            Check a Spica <span className="ph-accent">certificate</span>
          </>
        }
        lead="Enter the code on the certificate, or scan its QR code. You will see the name, level, scores, the date and whether it is still valid, and the full score report if the holder chose to share it."
        actions={
          <div className="ph-form">
            <CertificateForm />
            <p className="muted">
              Want to see what a check looks like? <a href={app.sampleCertificate}>Open the sample certificate</a>.
            </p>
          </div>
        }
        visual={
          <MockFrame>
            <CertificateMock />
          </MockFrame>
        }
      />
      <section className="section">
        <div className="wrap split">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">What the check shows</p>
            <h2>Everything an employer needs to trust it</h2>
            <p className="muted">
              A certificate comes only from a proctored real test, after every answer is scored and any flags are reviewed by a person.
            </p>
          </div>
          <ul className="chooser" data-reveal>
            {SHOWS.map(([I, t]) => (
              <li key={t}>
                <div className="chooser-row">
                  <span className="chooser-icon tone-gold">
                    <I size={18} />
                  </span>
                  <span className="chooser-need">{t}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
