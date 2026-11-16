import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TASKS, TESTS } from "@/lib/tests";
import { money } from "@/lib/prices";
import { app } from "@/lib/site";
import { ArrowRight, Calculator, ClipboardList, FileText, ListOrdered } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { TestFacts } from "@/components/page/Visuals";
import { TEST_LOOK } from "@/components/page/looks";

export function generateStaticParams() {
  return TESTS.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const t = TESTS.find((x) => x.slug === slug);
  return t ? { title: t.name, description: `${t.short} ${t.questions} questions, ${t.minutes.toLowerCase()}. ${t.purpose}` } : {};
}

export default async function TestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = TESTS.find((x) => x.slug === slug);
  if (!t) notFound();
  const taskNames = [...new Set(t.parts.map((p) => p.task))];
  const isLevel = t.id === "level";
  const look = TEST_LOOK[t.slug] ?? TEST_LOOK["english-4-skills-essentials"];
  const Icon = look.icon;
  return (
    <>
      <PageHero
        crumbs={[{ href: "/tests", label: "Tests" }, { label: t.name }]}
        eyebrow={isLevel ? "Level test" : "English test"}
        icon={<Icon size={16} />}
        tone={look.tone}
        title={t.name}
        lead={t.purpose}
        actions={
          <>
            <a className="btn primary" href={app.signUp}>
              Start free <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="btn ghost" href={app.sampleReport(t.id)}>
              See a sample report
            </a>
          </>
        }
        visual={<TestFacts t={t} />}
      />

      <section className="section alt">
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">
              <ClipboardList size={14} /> Audience
            </p>
            <h2>Who it&apos;s for</h2>
            <p>{t.forWho}</p>
            <h2 style={{ marginTop: 28 }}>The result</h2>
            <p>{t.result}</p>
            <div className="actions">
              <a className="btn primary" href={app.sampleReport(t.id)}>
                See a sample report
              </a>
              {!isLevel && (
                <a className="btn ghost" href={app.sampleCertificate}>
                  Sample certificate
                </a>
              )}
            </div>
          </div>
          <div className="card">
            <h3>Ways to take it</h3>
            <ul className="ticks">
              <li>
                <b>{isLevel ? "Level test" : "Real test only"}:</b> {money(t.priceKey, "INR")} / {money(t.priceKey, "USD")}
                {isLevel ? ", for one level from A1 to C2. No certificate." : ", with a score report and certificate. A free sample first."}
              </li>
              {t.prepKey && (
                <li>
                  <b>Preparation + test:</b> {money(t.prepKey, "INR")} / {money(t.prepKey, "USD")}. 30 days of practice for this test, mock tests, then
                  the real test.
                </li>
              )}
              {!isLevel && (
                <li>
                  <b>Full access:</b> {money("full", "INR")} / {money("full", "USD")} a month: every test, and one final assessment with a certificate.
                </li>
              )}
              <li>
                <b>Organisations:</b> {t.credits} credit{t.credits > 1 ? "s" : ""} per person, or included with learner licences.
              </li>
            </ul>
            <a className="btn primary" href={app.signUp} style={{ marginTop: 16 }}>
              Start free
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <ListOrdered size={14} /> Structure
            </p>
            <h2>The parts of the test</h2>
            <p className="muted">Each part starts with a short instruction and an example. Every question has its own timer.</p>
          </div>
          <div className="table-wrap" style={{ marginTop: 24 }}>
            <table className="t">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Task</th>
                  <th>Questions</th>
                  <th>Answer by</th>
                  <th>Time per question</th>
                </tr>
              </thead>
              <tbody>
                {t.parts.map((p, i) => (
                  <tr key={i}>
                    <td>{String.fromCharCode(65 + i)}</td>
                    <td>{p.task}</td>
                    <td>{p.items}</td>
                    <td>{p.answer === "Chosen" ? "Choosing" : p.answer === "Spoken" ? "Speaking" : "Typing"}</td>
                    <td>{p.time}</td>
                  </tr>
                ))}
                <tr>
                  <td />
                  <td>
                    <b>Total</b>
                  </td>
                  <td>
                    <b>{t.questions}</b>
                  </td>
                  <td />
                  <td>{t.minutes}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <FileText size={14} /> Tasks
            </p>
            <h2>What each task asks</h2>
          </div>
          <div className="grid g3">
            {taskNames.map((n, i) => (
              <div className={`card task tone-${look.tone}`} key={n} data-reveal style={{ ["--i" as string]: i % 3 }}>
                <span className="task-num">{String(i + 1).padStart(2, "0")}</span>
                <h3>{n}</h3>
                <p className="muted">{TASKS[n]?.does}</p>
                <p style={{ fontSize: "0.92rem", margin: 0 }}>
                  <i>Example:</i> {TASKS[n]?.example}
                </p>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 18, fontSize: "0.88rem" }}>
            Examples are written in the style of the test; real test questions are never shown.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">
              <Calculator size={14} /> Scoring
            </p>
            <h2>How answers are scored</h2>
            <ul className="ticks">
              <li>Spoken answers are scored for what was said and how clearly and fluently it was said. Speaking is scored on how clearly you are understood, not on your accent.</li>
              <li>Typed answers are scored for the right words, grammar and meaning; longer writing for covering the task, organisation, grammar and vocabulary.</li>
              <li>Multiple-choice answers are right or wrong. British, American and Indian spellings are all accepted.</li>
              <li>AI scores the answers, people review any proctoring flags, and anyone can ask for a person to review their score.</li>
            </ul>
          </div>
          <div className="card">
            <h3>Want the full details?</h3>
            <p className="muted">
              The Test Description and Validation Summary for {t.name} sets out every part, the scoring rules and how the test is checked.
            </p>
            <Link className="btn ghost" href="/contact">
              Ask for the full document
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
