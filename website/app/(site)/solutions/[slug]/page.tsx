import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SOLUTIONS } from "@/lib/solutions";
import { TESTS } from "@/lib/tests";
import { app } from "@/lib/site";
import { ArrowRight, CheckCircle2, Lightbulb } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { MockFrame } from "@/components/page/Visuals";
import { SOLUTION_LOOK, TEST_LOOK } from "@/components/page/looks";
import { CandidatesMock, CertificateMock, PracticeMock, ReportMock, TeamMock } from "@/components/home/Mocks";

// The product picture shown beside each audience's headline.
const MOCK: Record<string, React.ReactNode> = {
  companies: <TeamMock />,
  recruiters: <CandidatesMock />,
  universities: <ReportMock />,
  "training-providers": <PracticeMock />,
  individuals: <CertificateMock />,
};

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  return s ? { title: `Spica for ${s.name.toLowerCase()}`, description: `${s.headline}. ${s.answer}` } : {};
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const s = SOLUTIONS.find((x) => x.slug === slug);
  if (!s) notFound();
  const cta = s.cta.href === "SIGNUP" ? app.signUp : s.cta.href;
  const look = SOLUTION_LOOK[s.slug];
  const Icon = look.icon;
  const tests = s.tests.map((t) => TESTS.find((x) => x.slug === t)!).filter(Boolean);
  return (
    <>
      <PageHero
        crumbs={[{ href: "/solutions", label: "Solutions" }, { label: s.name }]}
        eyebrow={`For ${s.name.toLowerCase()}`}
        icon={<Icon size={16} />}
        tone={look.tone}
        title={s.headline}
        lead={s.answer}
        actions={
          <>
            <a className="btn primary" href={cta}>
              {s.cta.label} <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn ghost" href="/demo">
              See a demo
            </Link>
          </>
        }
        visual={<MockFrame>{MOCK[s.slug]}</MockFrame>}
      />

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal style={{ maxWidth: 760 }}>
            <p className="eyebrow">The problem</p>
            <h2>{s.problem}</h2>
          </div>
          <div className="grid g3 steps">
            {s.steps.map(([h, t], i) => (
              <div className="card step" key={h} data-reveal style={{ ["--i" as string]: i }}>
                <h3>{h}</h3>
                <p className="muted">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">What you get</p>
            <h2>Everything in one place</h2>
            <ul className="ticks">
              {s.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className={`card example tone-${look.tone}`} data-reveal>
            <p className="example-tag">
              <Lightbulb size={15} /> For example
            </p>
            <p className="example-text">{s.example}</p>
            <h3 style={{ marginTop: 22 }}>Tests that fit best</h3>
            <div className="mini-tests">
              {tests.map((t) => {
                const T = (TEST_LOOK[t.slug] ?? { icon: CheckCircle2 }).icon;
                return (
                  <Link key={t.slug} href={`/tests/${t.slug}`} className={`tone-${TEST_LOOK[t.slug]?.tone ?? "clay"}`}>
                    <span className="chooser-icon">
                      <T size={17} />
                    </span>
                    <span>
                      <b>{t.name}</b>
                      <small>{t.short}</small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
            <Link className="btn ghost" href="/pricing" style={{ marginTop: 16 }}>
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
