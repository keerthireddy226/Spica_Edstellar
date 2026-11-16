import type { Metadata } from "next";
import Link from "next/link";
import { Bot, Building2, Bug, Fingerprint, Lock, Scale, ShieldCheck, Timer, UserCog } from "lucide-react";
import { company } from "@/lib/site";
import { PageHero } from "@/components/page/PageHero";
import { SecurityMock } from "@/components/page/Visuals";

export const metadata: Metadata = {
  title: "Security and trust",
  description: "How Spica protects data: encryption, two-step sign-in, proctoring reviewed by people, and how long data is kept.",
};

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
      <PageHero
        crumbs={[{ label: "Security and trust" }]}
        eyebrow="Security and trust"
        icon={<ShieldCheck size={16} />}
        tone="sky"
        title={
          <>
            Your data is protected, and <span className="ph-accent">people make the decisions</span>
          </>
        }
        lead="How Spica protects data, how proctoring works, and how long data is kept."
        visual={<SecurityMock />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">How we protect it</p>
            <h2>Six promises we keep</h2>
          </div>
          <div className="grid g3">
            <div className="card icard" data-reveal style={{ ["--i" as string]: 0 }}>
              <span className="icard-icon">
                <Lock size={20} />
              </span>
              <h3>Your data, kept safe</h3>
              <p className="muted">Data is encrypted, kept only as long as it is needed, and never sold or used to train AI models.</p>
            </div>
            <div className="card icard" data-reveal style={{ ["--i" as string]: 1 }}>
              <span className="icard-icon">
                <ShieldCheck size={20} />
              </span>
              <h3>Protection</h3>
              <p className="muted">
                Encrypted connections and storage, hashed passwords, two-step sign-in, company sign-in, role-based access, one session per account
                and an audit log of every administrative change.
              </p>
            </div>
            <div className="card icard" data-reveal style={{ ["--i" as string]: 2 }}>
              <span className="icard-icon">
                <Bot size={20} />
              </span>
              <h3>AI and people</h3>
              <p className="muted">AI scores the answers. People review every proctoring flag and any score someone asks to have checked. Nobody is failed automatically.</p>
            </div>
            <div className="card icard" data-reveal style={{ ["--i" as string]: 0 }}>
              <span className="icard-icon">
                <Fingerprint size={20} />
              </span>
              <h3>Biometrics by choice</h3>
              <p className="muted">
                Face and voice matching only with separate consent, run on Spica&apos;s own servers. Anyone can choose a manual identity check instead.
              </p>
            </div>
            <div className="card icard" data-reveal style={{ ["--i" as string]: 1 }}>
              <span className="icard-icon">
                <Scale size={20} />
              </span>
              <h3>Privacy laws</h3>
              <p className="muted">Spica is built to meet India&apos;s Digital Personal Data Protection Act and the EU and UK GDPR, with standard contractual clauses for transfers outside Europe.</p>
            </div>
            <div className="card icard" data-reveal style={{ ["--i" as string]: 2 }}>
              <span className="icard-icon">
                <Building2 size={20} />
              </span>
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
        <div className="wrap">
          <div data-reveal>
            <p className="eyebrow">
              <Timer size={14} /> Retention
            </p>
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
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2">
          <div>
            <p className="eyebrow">
              <Bug size={14} /> Responsible disclosure
            </p>
            <h2>Report a security issue</h2>
            <p>
              If you think you have found a weakness in Spica, write to <b>{company.securityEmail}</b>. Please give us time to fix it before telling
              anyone else.
            </p>
          </div>
          <div className="card icard">
            <span className="icard-icon">
              <UserCog size={20} />
            </span>
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
