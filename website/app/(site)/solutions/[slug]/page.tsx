import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SOLUTIONS } from "@/lib/solutions";
import { SOLUTION_EXTRAS } from "@/lib/solutionExtras";
import { CREDIT_BANDS, EDUCATION_DISCOUNT, LICENCE_BANDS, PILOT, money } from "@/lib/prices";
import { TESTS } from "@/lib/tests";
import { app } from "@/lib/site";
import { ArrowRight, CheckCircle2, CreditCard, HelpCircle, Lightbulb, Sparkles } from "lucide-react";
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
  const extra = SOLUTION_EXTRAS[s.slug];
  const licences = s.slug === "companies" || s.slug === "universities" || s.slug === "training-providers";
  const off = (usd: number) => (s.slug === "universities" ? Math.round(usd * (100 - EDUCATION_DISCOUNT)) / 100 : usd);
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

      {extra && (
        <section className="section">
          <div className="wrap">
            <div className="sec-head" data-reveal>
              <p className="eyebrow">
                <Sparkles size={14} /> What changes
              </p>
              <h2>What you gain</h2>
            </div>
            <div className="grid g3">
              {extra.benefits.map(([h, t], i) => (
                <div className={`card gain tone-${look.tone}`} key={h} data-reveal style={{ ["--i" as string]: i }}>
                  <span className="gain-num">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{h}</h3>
                  <p className="muted">{t}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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

      <section className="section alt">
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">
              <CreditCard size={14} /> Pricing
            </p>
            <h2>{s.slug === "recruiters" ? "Pay per candidate, with credits" : s.slug === "individuals" ? "Start free, pay when you are ready" : "Licences per learner, per month"}</h2>
            <p className="muted">
              {s.slug === "recruiters"
                ? "Buy credits once and spend them as you invite. Each test costs a fixed number of credits, and credits for invitations that expire unused come back."
                : s.slug === "individuals"
                  ? "Try everything free, then choose a month of everything, preparation for one test, or just the real test."
                  : `One licence gives one learner Full access for one month. The more licences you buy at once, the less each costs.${s.slug === "universities" ? ` Universities and colleges get ${EDUCATION_DISCOUNT}% off.` : ""}`}
            </p>
            <div className="actions">
              <Link className="btn primary" href="/pricing">
                See full pricing <ArrowRight size={17} aria-hidden="true" />
              </Link>
              {s.slug !== "individuals" && (
                <Link className="btn ghost" href="/contact">
                  Ask for a quote
                </Link>
              )}
            </div>
          </div>
          <div className="card price-box" data-reveal>
            {s.slug === "recruiters" ? (
              <table className="t">
                <thead>
                  <tr>
                    <th>Test per candidate</th>
                    <th>Credits</th>
                    <th>At ${CREDIT_BANDS[0].usd} a credit</th>
                  </tr>
                </thead>
                <tbody>
                  {TESTS.filter((t) => t.id !== "level").map((t) => (
                    <tr key={t.slug}>
                      <td>{t.name}</td>
                      <td>{t.credits}</td>
                      <td>${t.credits * CREDIT_BANDS[0].usd}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="muted">
                      Credits cost {CREDIT_BANDS.map((b) => `$${b.usd}${b.from > 1 ? ` from ${b.from}` : ""}`).join(", ")}.
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : s.slug === "individuals" ? (
              <ul className="ticks">
                <li>
                  <b>Free:</b> placement test, weekly practice, 2 practice tests and 1 mock test a month
                </li>
                <li>
                  <b>Full access:</b> {money("full", "INR")} / {money("full", "USD")} a month
                </li>
                <li>
                  <b>Preparation + test:</b> from {money("prep:placement", "INR")} / {money("prep:placement", "USD")}
                </li>
                <li>
                  <b>Real test only:</b> from {money("assessment:placement", "INR")} / {money("assessment:placement", "USD")}
                </li>
              </ul>
            ) : (
              <>
                <div className="price-bands">
                  {LICENCE_BANDS.map((b) => (
                    <div key={b.tier}>
                      <small>{b.tier}</small>
                      <b>${off(b.usd)}</b>
                      <span>per learner-month{b.from > 1 ? `, ${b.from}+ licences` : ""}</span>
                    </div>
                  ))}
                </div>
                {licences && (
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Want to try first? A pilot gives {PILOT.licences} licences for {PILOT.days} days.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {extra && (
        <section className="section">
          <div className="wrap narrow">
            <div className="sec-head" data-reveal>
              <p className="eyebrow">
                <HelpCircle size={14} /> Questions
              </p>
              <h2>Common questions from {s.name.toLowerCase()}</h2>
            </div>
            <div className="faq">
              {extra.faq.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
