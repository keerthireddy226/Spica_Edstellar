import type { Metadata } from "next";
import Link from "next/link";
import { APP_URL } from "@/lib/site";

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
    <section className="section">
      <div className="wrap" style={{ maxWidth: 900 }}>
        <p className="eyebrow">Legal</p>
        <h1>Legal documents</h1>
        <div className="grid g2" style={{ marginTop: 24 }}>
          <Link className="card test-card" href="/legal/terms">
            <h3>Terms and Conditions</h3>
            <p className="muted" style={{ margin: 0 }}>The rules for using Spica, payments, refunds and test rules.</p>
          </Link>
          <Link className="card test-card" href="/legal/privacy">
            <h3>Privacy Policy</h3>
            <p className="muted" style={{ margin: 0 }}>What data Spica collects, why, who receives it, how long it is kept and your rights.</p>
          </Link>
        </div>
        <h2 style={{ marginTop: 40 }}>Privacy notices and agreements</h2>
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
  );
}
