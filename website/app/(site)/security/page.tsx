import type { Metadata } from "next";
import Link from "next/link";
import { APP_URL, company } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security and trust",
  description: "How Spica protects data: encryption, two-step sign-in, proctoring reviewed by people, retention rules and the companies that process data.",
};

const PROVIDERS: [string, string][] = [
  ["Render", "Runs Spica's servers and stores files"],
  ["Supabase", "Database and a copy of stored files"],
  ["Vercel", "Delivers the website and app pages"],
  ["Google (Gemini)", "Transcribes and scores spoken and written answers"],
  ["Brevo", "Sends emails"],
  ["Stripe, Razorpay", "Online payments"],
];

const RETENTION: [string, string][] = [
  ["Proctoring photos, screen recordings, ID images", "30 days if nothing was flagged; up to 60 days if flagged"],
  ["Recordings of spoken answers, face-check photos", "3 months (organisations may choose up to 12)"],
  ["Face and voice templates", "3 months after the last test, or at once if consent is withdrawn"],
  ["Unused individual accounts", "Deleted after 12 months, with a warning 30 days before"],
  ["Candidates", "180 days after the hiring decision by default"],
  ["Audit log", "12 months"],
];

export default function SecurityPage() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Security and trust</p>
          <h1>Your data is protected, and people make the decisions</h1>
          <p className="lead">How Spica stores and protects data, how proctoring works, and which companies help us run the service.</p>
          <div className="grid g3" style={{ marginTop: 32 }}>
            <div className="card">
              <h3>Your data, kept safe</h3>
              <p className="muted">Data is encrypted, kept only as long as it is needed, and never sold or used to train AI models.</p>
            </div>
            <div className="card">
              <h3>Protection</h3>
              <p className="muted">
                Encrypted connections and storage, hashed passwords, two-step sign-in, company sign-in, role-based access, one session per account
                and an audit log of every administrative change.
              </p>
            </div>
            <div className="card">
              <h3>AI and people</h3>
              <p className="muted">AI scores the answers. People review every proctoring flag and any score someone asks to have checked. Nobody is failed automatically.</p>
            </div>
            <div className="card">
              <h3>Biometrics by choice</h3>
              <p className="muted">
                Face and voice matching only with separate consent, run on Spica&apos;s own servers. Anyone can choose a manual identity check instead.
              </p>
            </div>
            <div className="card">
              <h3>Privacy laws</h3>
              <p className="muted">Spica follows India&apos;s Digital Personal Data Protection Act and the EU and UK GDPR, with standard contractual clauses for transfers.</p>
            </div>
            <div className="card">
              <h3>For organisations</h3>
              <p className="muted">
                A Data Processing Agreement, IP limits, required two-step sign-in, data export and erasure, and your own retention periods. A
                completed security questionnaire is available on request.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap grid g2">
          <div>
            <h2>How long data is kept</h2>
            <div className="table-wrap">
              <table className="t">
                <tbody>
                  {RETENTION.map(([d, t]) => (
                    <tr key={d}>
                      <td>{d}</td>
                      <td>{t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2>Companies that process data for us</h2>
            <div className="table-wrap">
              <table className="t">
                <tbody>
                  {PROVIDERS.map(([n, w]) => (
                    <tr key={n}>
                      <td>
                        <b>{n}</b>
                      </td>
                      <td>{w}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: "0.9rem", marginTop: 12 }}>
              The full list, with safeguards, is in the <a href={`${APP_URL}/legal/data-processing-agreement.html`}>Data Processing Agreement</a>.
              Organisations are told 30 days before a new provider is added.
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2">
          <div>
            <h2>Report a security issue</h2>
            <p>
              If you think you have found a weakness in Spica, write to <b>{company.securityEmail}</b>. Please give us time to fix it before telling
              anyone else.
            </p>
          </div>
          <div className="card">
            <h3>Privacy questions</h3>
            <p className="muted">
              To download or delete your data, or for any privacy question, write to {company.privacyEmail}. See our <Link href="/legal">legal documents</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
