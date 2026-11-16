import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SOLUTIONS } from "@/lib/solutions";
import { TESTS } from "@/lib/tests";
import { app } from "@/lib/site";

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
  const tests = s.tests.map((t) => TESTS.find((x) => x.slug === t)!).filter(Boolean);
  return (
    <>
      <section className="section">
        <div className="wrap">
          <p className="crumbs">
            <Link href="/solutions">Who it&apos;s for</Link> / {s.name}
          </p>
          <h1>{s.headline}</h1>
          <p className="lead">{s.answer}</p>
          <div className="actions">
            <a className="btn primary" href={cta}>
              {s.cta.label}
            </a>
            <Link className="btn ghost" href="/demo">
              See a demo
            </Link>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <p className="eyebrow">The problem</p>
          <h2 style={{ maxWidth: 760 }}>{s.problem}</h2>
          <div className="grid g3 steps" style={{ marginTop: 28 }}>
            {s.steps.map(([h, t]) => (
              <div className="card step" key={h}>
                <h3>{h}</h3>
                <p className="muted">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2">
          <div>
            <h2>What you get</h2>
            <ul className="ticks">
              {s.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3>For example</h3>
            <p className="muted">{s.example}</p>
            <h3 style={{ marginTop: 20 }}>Tests that fit best</h3>
            <ul className="ticks">
              {tests.map((t) => (
                <li key={t.slug}>
                  <Link href={`/tests/${t.slug}`}>{t.name}</Link>: {t.short}
                </li>
              ))}
            </ul>
            <Link className="btn ghost" href="/pricing" style={{ marginTop: 16 }}>
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
