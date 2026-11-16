import type { Metadata } from "next";
import { CertificateForm } from "@/components/CertificateForm";
import { app } from "@/lib/site";

export const metadata: Metadata = {
  title: "Check a certificate",
  description: "Check a Spica English certificate: enter its code to see the name, level, scores, date and whether it is still valid.",
};

export default function CertificateCheckPage() {
  return (
    <section className="section">
      <div className="wrap grid g2" style={{ alignItems: "start", gap: 48 }}>
        <div>
          <p className="eyebrow">Certificate check</p>
          <h1>Check a Spica certificate</h1>
          <p className="lead">
            Enter the code printed on the certificate, or scan its QR code. You will see the name, level, scores, the date and whether it is
            still valid, and the full score report if the holder chose to share it.
          </p>
          <div className="card" style={{ marginTop: 24 }}>
            <CertificateForm />
          </div>
          <p className="muted" style={{ marginTop: 16, fontSize: "0.92rem" }}>
            Want to see what a check looks like? <a href={app.sampleCertificate}>Open the sample certificate</a>.
          </p>
        </div>
        <div className="card">
          <h3>What the check shows</h3>
          <ul className="ticks">
            <li>The name on the certificate and the test taken</li>
            <li>The CEFR level and Spica score, overall and for each skill</li>
            <li>The test date and the date the certificate is valid until</li>
            <li>Whether the identity was verified</li>
            <li>Whether the certificate is valid, expired or withdrawn</li>
          </ul>
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            A certificate comes only from a proctored real test, after every answer is scored and any flags are reviewed by a person.
          </p>
        </div>
      </div>
    </section>
  );
}
