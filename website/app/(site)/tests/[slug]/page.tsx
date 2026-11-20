import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TASKS, TESTS } from "@/lib/tests";
import { LEVELS } from "@/lib/levels";
import { SAMPLES } from "@/lib/samples";
import { SampleQuestion } from "@/components/page/SampleQuestion";
import { money } from "@/lib/prices";
import { app } from "@/lib/site";
import { ArrowRight, BadgeCheck, Calculator, ClipboardList, FileText, Gauge, HelpCircle, Laptop, ListOrdered, Lock, Mic, PlayCircle, QrCode, Rocket, ShieldCheck, Timer } from "lucide-react";
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
        below={
          <ul className="tp-trust">
            <li>
              <BadgeCheck size={16} /> CEFR A1–C2 and a 10–90 score
            </li>
            <li>
              <Mic size={16} /> Scored on clarity, not accent
            </li>
            <li>
              <ShieldCheck size={16} /> {isLevel ? "Same rules for everyone" : "Proctored, reviewed by people"}
            </li>
            <li>
              <Lock size={16} /> Data never sold
            </li>
          </ul>
        }
        visual={
          <div className="tp-visual">
            <div className="tp-glow" aria-hidden="true" />
            <TestFacts t={t} />
            <div className="tp-float tp-f1" aria-hidden="true">
              <Timer size={18} />
              <div>
                <b>Timer starts after the recording</b>
                <small>Each recording plays once</small>
              </div>
            </div>
            <div className="tp-float tp-f2" aria-hidden="true">
              <QrCode size={18} />
              <div>
                <b>{isLevel ? "Passed or not passed" : "Certificate anyone can check"}</b>
                <small>{isLevel ? "With a score report for each skill" : "With a code and QR code"}</small>
              </div>
            </div>
          </div>
        }
      />

      <section className="tp-numbers">
        <div className="wrap tp-num-grid">
          {[
            [t.minutes.replace(/^About /, "~").replace(" minutes", " min"), "in one sitting, at your own computer"],
            [String(t.skills.length), t.skills.length === 4 ? "skills: speaking, listening, reading, writing" : `skills: ${t.skills.join(", ").toLowerCase()}`],
            [isLevel ? "1 level" : "A1–C2", isLevel ? "checked at a time, A1 to C2" : "reported for every skill"],
            ["Minutes", "until most results are ready"],
            ["1 play", "per recording, with the timer after it"],
          ].map(([n, l]) => (
            <div className="tp-num" key={l}>
              <b>{n}</b>
              <span>{l}</span>
            </div>
          ))}
        </div>
      </section>

      {SAMPLES[t.slug] && (
        <section className="section">
          <div className="wrap grid g2 sq-wrap">
            <div data-reveal>
              <p className="eyebrow">
                <PlayCircle size={14} /> Try it now
              </p>
              <h2>Answer a real question</h2>
              <p>
                This is how every listening question in {t.name} works. Press Play when you are ready: the recording plays once, and your answer time starts
                only when it ends, so you never lose time while listening.
              </p>
              <ul className="ticks">
                <li>The timer sits next to the question number, where your eyes already are.</li>
                <li>It turns red and blinks in the last seconds, so time never runs out by surprise.</li>
                <li>Recordings use clear female and male voices, mixed across the test.</li>
              </ul>
            </div>
            <SampleQuestion s={SAMPLES[t.slug]} />
          </div>
        </section>
      )}

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
                <b>{isLevel ? "Level test" : "Real test only"}:</b> {money(t.priceKey, "USD")}
                {isLevel ? ", for one level from A1 to C2, with a level certificate when you pass." : ", with a score report and certificate. A free sample first."}
              </li>
              {t.prepKey && (
                <li>
                  <b>Preparation + test:</b> {money(t.prepKey, "USD")}. 30 days of practice for this test, mock tests, then
                  the real test.
                </li>
              )}
              {!isLevel && (
                <li>
                  <b>Full access:</b> {money("full", "USD")} a month: every test, and one final assessment with a certificate.
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
              <Laptop size={14} /> On the day
            </p>
            <h2>What taking the test is like</h2>
            <p className="muted">One sitting at your own computer, with clear steps from start to finish.</p>
          </div>
          <div className="grid g4 steps">
            {[
              ["1", "Check your setup", isLevel ? "A quick check of your microphone, speakers and connection, so nothing goes wrong mid-test." : "A quick check of camera, microphone and connection, then a photo and your ID, so your result can be trusted."],
              ["2", "Read how each part works", "Every part opens with a short screen: how many questions, how you answer, the time you get and a tip."],
              ["3", "Answer at your own pace", "Press Play when you are ready; your answer time starts when the recording ends. Speak, type or choose, then the next question opens."],
              ["4", "Get your result", isLevel ? "A clear passed or not-passed result for your level, usually within minutes." : "Your Spica score and CEFR level for each skill, usually within minutes, and a certificate anyone can check."],
            ].map(([n, h, d]) => (
              <div className="card step" key={n} data-reveal>
                <h3>{h}</h3>
                <p className="muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
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

      <section className="section">
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

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Gauge size={14} /> Your result
            </p>
            <h2>{isLevel ? "What each level means" : "What your level means"}</h2>
            <p className="muted">
              {isLevel
                ? "Choose the level you want to confirm. Passing shows you can do what that level describes."
                : "Your result gives a Spica score from 10 to 90 and a CEFR level, overall and for each skill. This is what each level means in practice."}
            </p>
          </div>
          <div className="grid g3 levels-grid">
            {LEVELS.map((l) => (
              <Link className="card level-card" href={`/levels/${l.slug}`} key={l.slug} data-reveal>
                <span className="level-code">{l.code}</span>
                <span className="level-name">
                  {l.name} · Spica {l.range}
                </span>
                <p className="muted">{l.summary}</p>
                <p className="level-can">
                  <b>Speaking:</b> {l.speaking}
                </p>
              </Link>
            ))}
          </div>
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

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Rocket size={14} /> Get ready
            </p>
            <h2>From first try to {isLevel ? "your level" : "certificate"} in three steps</h2>
          </div>
          <div className="grid g3">
            <div className="card path" data-reveal>
              <span className="path-tag">Free</span>
              <h3>Try it</h3>
              <p className="muted">2 practice tests and 1 mock test a month, with your level and what to work on. No card needed.</p>
              <a className="btn ghost small" href={app.signUp}>
                Start free
              </a>
            </div>
            {t.prepKey ? (
              <div className="card path featured" data-reveal>
                <span className="path-tag">
                  {money(t.prepKey, "USD")}
                </span>
                <h3>Prepare</h3>
                <p className="muted">30 days of practice for {t.name}, mock tests under real conditions, then the real test with a score report and certificate.</p>
                <a className="btn primary small" href={app.signUp}>
                  Prepare and take the test
                </a>
              </div>
            ) : (
              <div className="card path featured" data-reveal>
                <span className="path-tag">
                  {money("full", "USD")} a month
                </span>
                <h3>Prepare</h3>
                <p className="muted">Full access: practice for every test, mock tests under real conditions and a final assessment with a certificate.</p>
                <a className="btn primary small" href={app.signUp}>
                  Get full access
                </a>
              </div>
            )}
            <div className="card path" data-reveal>
              <span className="path-tag">
                {money(t.priceKey, "USD")}
              </span>
              <h3>{isLevel ? "Confirm your level" : "Take the real test"}</h3>
              <p className="muted">
                {isLevel ? "One level test from A1 to C2, with a passed or not-passed result." : "Already confident? Take the real test with a free sample first, and get your certificate."}
              </p>
              <a className="btn ghost small" href={app.signUp}>
                {isLevel ? "Choose a level" : "Take the test"}
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap narrow">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <HelpCircle size={14} /> Questions
            </p>
            <h2>About {t.name}</h2>
          </div>
          <div className="faq">
            {[
              ["How long does it take?", `${t.minutes}, ${t.questions} questions. Every question has its own timer, the same for every test taker, so you always know how long you have.`],
              ["What do I need?", isLevel ? "A computer with a microphone, speakers or headphones and a steady internet connection, in a quiet room." : "A computer with a camera and a microphone, a quiet room, and a photo ID for the real test. Phones are not supported for tests."],
              ["Can I play a recording again?", "No. Each recording plays once, as in the real exam. You press Play when you are ready, and your answer time starts only when the recording ends."],
              ["Does my accent matter?", "No. Speaking is scored on how clearly you are understood, not on your accent. British, American and Indian spellings are all accepted in typed answers."],
              ["When do I get my result?", isLevel ? "Usually within minutes: a passed or not-passed result for the level you took." : "Usually within minutes; spoken answers can take a little longer. You get a Spica score and CEFR level overall and for each skill."],
              ...(isLevel
                ? []
                : [["Who can check my certificate?", "Anyone you share it with: each certificate has a check link and code, valid for one year, and you can extend it."]]),
              ["Can I practise before paying?", "Yes. The free plan gives 2 practice tests and 1 mock test a month, so you can see the questions and your level first."],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
