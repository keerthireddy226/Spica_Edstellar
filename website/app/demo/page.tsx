import type { Metadata } from "next";
import Link from "next/link";
import { app, company } from "@/lib/site";
import { TESTS } from "@/lib/tests";

export const metadata: Metadata = {
  title: "Demo",
  description: "See Spica: sample score reports for every test, a sample certificate, the free placement test, and a demo for your organisation.",
};

export default function DemoPage() {
  return (
    <>
      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Demo</p>
          <h1>See Spica for yourself</h1>
          <p className="lead">Look at real score reports and a certificate, try the free placement test, or ask us to show you the platform for your organisation.</p>
          <div className="grid g3" style={{ marginTop: 32 }}>
            <div className="card plan">
              <h3>Sample score reports</h3>
              <p className="muted">The full report a test taker and their organisation receive, with made-up details. One for each test.</p>
              <ul className="ticks">
                {TESTS.map((t) => (
                  <li key={t.slug}>
                    <a href={app.sampleReport(t.id)}>{t.name}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card plan">
              <h3>Sample certificate</h3>
              <p className="muted">The public check page that anyone sees when they enter a certificate code or scan its QR code.</p>
              <a className="btn ghost" href={app.sampleCertificate}>
                Open the sample certificate
              </a>
              <h3 style={{ marginTop: 16 }}>Free placement test</h3>
              <p className="muted">Sign up and take the placement test yourself. It is free and gives a level for each skill.</p>
              <a className="btn primary" href={app.signUp}>
                Start free
              </a>
            </div>
            <div className="card plan featured">
              <h3>A demo for your organisation</h3>
              <p className="muted">
                We show you the admin, manager and recruiter consoles with a demo organisation full of made-up learners, results and candidates, and
                answer your questions.
              </p>
              <ul className="ticks">
                <li>About 30 minutes, online</li>
                <li>Companies, recruiters, universities and training providers</li>
                <li>Ask about a pilot: 10 licences for 30 days</li>
              </ul>
              <Link className="btn primary" href="/contact?topic=demo">
                Book a demo
              </Link>
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                Or write to {company.salesEmail}.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
