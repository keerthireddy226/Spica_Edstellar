import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileText, Scale, ShieldCheck } from "lucide-react";
import { APP_URL } from "@/lib/site";
import { PageHero } from "@/components/page/PageHero";

export const metadata: Metadata = { title: "Legal", description: "Spica's terms, privacy policy, privacy notices and data processing agreement." };

const NOTICES: [string, string, string][] = [
  ["Privacy notice: free accounts", "privacy-individual-free.html", "For people using Spica for free."],
  ["Privacy notice: paid plans", "privacy-individual-paid.html", "For people who buy a plan or a test."],
  ["Privacy notice: organisations", "privacy-organizations.html", "For learners, managers and admins whose organisation gives them Spica."],
  ["Privacy notice: test takers", "privacy-assessment-only.html", "For candidates and applicants invited to a test."],
  ["Data Processing Agreement", "data-processing-agreement.html", "For organisations: how Spica processes their people's data, and the companies that help."],
];

export default function LegalPage() {
  return (
    <>
    <PageHero
      crumbs={[{ label: "Legal" }]}
      eyebrow="Legal"
      icon={<Scale size={16} />}
      tone="gold"
      title="Legal documents"
      lead="Our terms, privacy policy, the privacy notices for each kind of user, and the agreement for organisations."
    />
    <section className="section">
      <div className="wrap prose">
        <div className="grid g2">
          <Link className="tcard tone-gold" href="/legal/terms" data-reveal>
            <span className="tcard-icon">
              <FileText size={22} />
            </span>
            <h3>Terms and Conditions</h3>
            <p className="muted">The rules for using Spica, payments, refunds and test rules.</p>
            <span className="tcard-more">
              Read <ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
          <Link className="tcard tone-sky" href="/legal/privacy" data-reveal style={{ ["--i" as string]: 1 }}>
            <span className="tcard-icon">
              <ShieldCheck size={22} />
            </span>
            <h3>Privacy Policy</h3>
            <p className="muted">What data Spica collects, why, who receives it, how long it is kept and your rights.</p>
            <span className="tcard-more">
              Read <ArrowRight size={16} aria-hidden="true" />
            </span>
          </Link>
        </div>
        <h2 style={{ marginTop: 48 }}>Privacy notices and agreements</h2>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {NOTICES.map(([n, f, d]) => (
                <tr key={f}>
                  <td>
                    <a href={`${APP_URL}/legal/${f}`}>
                      <b>{n}</b>
                    </a>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: "0.92rem" }}>
          This website uses no analytics or advertising cookies, so there is no cookie banner.
        </p>
      </div>
    </section>
    </>
  );
}
