import type { Metadata } from "next";
import Link from "next/link";
import { app, company } from "@/lib/site";
import { TESTS } from "@/lib/tests";
import { Award, FileBarChart, MonitorPlay, PlayCircle } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { MockFrame } from "@/components/page/Visuals";
import { ReportMock } from "@/components/home/Mocks";

export const metadata: Metadata = {
  title: "Demo",
  description: "See Spica: sample score reports for every test, a sample certificate, the free placement test, and a demo for your organisation.",
};

export default function DemoPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "Demo" }]}
        eyebrow="Demo"
        icon={<PlayCircle size={16} />}
        tone="clay"
        title={
          <>
            See Spica <span className="ph-accent">for yourself</span>
          </>
        }
        lead="Look at sample score reports and a certificate, try the free placement test, or ask us to show you the platform for your organisation."
        actions={
          <>
            <Link className="btn primary" href="/contact?topic=demo">
              Book a demo
            </Link>
            <a className="btn ghost" href={app.signUp}>
              Start free
            </a>
          </>
        }
        visual={
          <MockFrame>
            <ReportMock />
          </MockFrame>
        }
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Three ways to look</p>
            <h2>Start wherever suits you</h2>
          </div>
          <div className="grid g3">
            <div className="card plan icard" data-reveal>
              <span className="icard-icon">
                <FileBarChart size={20} />
              </span>
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
            <div className="card plan icard" data-reveal style={{ ["--i" as string]: 1 }}>
              <span className="icard-icon">
                <Award size={20} />
              </span>
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
            <div className="card plan featured icard" data-reveal style={{ ["--i" as string]: 2 }}>
              <span className="icard-icon">
                <MonitorPlay size={20} />
              </span>
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
