import Link from "next/link";
import { SampleCertificate } from "@/components/SampleCertificate";
import { app } from "@/lib/site";
import { TESTS } from "@/lib/tests";
import { money } from "@/lib/prices";

const AUDIENCES = [
  { title: "Individuals", text: "Find your level, practise every question type, and get a certificate employers can check.", href: "/solutions/individuals" },
  { title: "Companies", text: "Check and grow your team's English, with plans for each person and reports by team.", href: "/solutions/companies" },
  { title: "Recruiters", text: "Test applicants' English online before the interview, and compare results side by side.", href: "/solutions/recruiters" },
  { title: "Universities and schools", text: "Place, track and certify students' English, from admission to placement week.", href: "/solutions/universities" },
];

const FAQ: [string, string][] = [
  ["How long does a test take?", "From about 17 minutes (Speaking & Listening) to about 60 minutes (Professional English). Each test page lists its parts and timing."],
  ["Do I need special equipment?", "A laptop or desktop computer with a microphone, a camera and a modern browser. Headphones are best. Phones and small tablets are not supported for real tests."],
  ["How are answers scored?", "AI scores spoken and written answers against clear rules for each task; multiple-choice and gap-fill answers are marked automatically. People review any proctoring flags, and anyone can ask for a person to review their score."],
  ["Will my accent lower my score?", "No. Spoken answers are judged on how easily they can be understood, not on sounding like a native speaker. British, American and Indian spellings are all accepted."],
  ["How do others check my certificate?", "Every certificate has a code and a QR code. Anyone can enter the code on our check page to see the name, level, scores and whether it is still valid."],
  ["Is Spica accepted for visas or university admission?", "Spica tests are not designed for decisions that require a specific approved test, such as visa applications. Universities that use Spica do so for their own admission and placement."],
  ["Is my data safe?", "Data is stored in Singapore, protected in transit and at rest, and never sold. Recordings and photos are deleted on a fixed schedule. See Security and trust."],
];

export default function Home() {
  return (
    <>
      <section className="wrap hero">
        <div>
          <p className="eyebrow">English tests, practice and certificates</p>
          <h1>
            Know your English level.
            <br />
            <span className="accent">Improve it. Prove it.</span>
          </h1>
          <p className="lead">
            One platform to learn, practise and certify English in all four skills. Every journey ends with a proctored test and a certificate
            anyone can check online.
          </p>
          <div className="actions">
            <a className="btn primary" href={app.signUp}>
              Start free
            </a>
            <Link className="btn ghost" href="/demo">
              Book a demo
            </Link>
          </div>
          <ul className="facts">
            <li>CEFR levels A1 to C2</li>
            <li>Spica scores from 10 to 90</li>
            <li>Proctored real test</li>
            <li>Certificates anyone can check</li>
          </ul>
        </div>
        <SampleCertificate />
      </section>

      <section className="section alt">
        <div className="wrap">
          <p className="eyebrow">Who it's for</p>
          <h2>One platform, four kinds of user</h2>
          <div className="grid g4" style={{ marginTop: 28 }}>
            {AUDIENCES.map((a) => (
              <Link key={a.title} className="card test-card" href={a.href}>
                <h3>{a.title}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {a.text}
                </p>
                <span className="more">Learn more →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="eyebrow">How it works</p>
          <h2>Three steps from first test to certificate</h2>
          <div className="grid g3 steps" style={{ marginTop: 28 }}>
            <div className="card step">
              <h3>Find your level</h3>
              <p className="muted">Start with a free placement test. You get a level for each skill and a study plan built around it.</p>
            </div>
            <div className="card step">
              <h3>Improve</h3>
              <p className="muted">Practise every question type, take practice tests you can pause, and timed mock tests with questions you haven't seen.</p>
            </div>
            <div className="card step">
              <h3>Prove it</h3>
              <p className="muted">Take the proctored real test. Your certificate has a QR code that anyone can check online.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <p className="eyebrow">The tests</p>
          <h2>Six tests for different needs</h2>
          <p className="lead">Every test is online, scored on the same Spica scale and linked to the CEFR levels.</p>
          <div className="grid g3" style={{ marginTop: 28 }}>
            {TESTS.map((t) => (
              <Link key={t.slug} className="card test-card" href={`/tests/${t.slug}`}>
                <h3>{t.name}</h3>
                <p style={{ margin: 0 }}>{t.short}</p>
                <div className="meta">
                  {t.questions} questions · {t.minutes.toLowerCase()} · from {money(t.priceKey, "INR")} / {money(t.priceKey, "USD")}
                </div>
                <div className="skills">
                  {t.skills.map((s) => (
                    <span key={s} className="pill">
                      {s}
                    </span>
                  ))}
                </div>
                <span className="more">See the test →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="eyebrow">Levels and scores</p>
          <h2>A score you can compare, a level everyone understands</h2>
          <p className="lead">
            Results use the Spica score from 10 to 90 and the six levels of the Common European Framework of Reference (CEFR), overall and for
            each skill.
          </p>
          <div className="scale">
            {[
              ["A1", "20–29", "Beginner"],
              ["A2", "30–39", "Elementary"],
              ["B1", "40–54", "Intermediate"],
              ["B2", "55–69", "Upper intermediate"],
              ["C1", "70–79", "Advanced"],
              ["C2", "80–90", "Proficient"],
            ].map(([l, s, n]) => (
              <div key={l}>
                <b>{l}</b>
                <small>
                  {n}
                  <br />
                  Score {s}
                </small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section band">
        <div className="wrap grid g2" style={{ alignItems: "center" }}>
          <div>
            <p className="eyebrow" style={{ color: "var(--accent-word)" }}>
              Why trust a Spica result
            </p>
            <h2>Proctored online, reviewed by people</h2>
            <p className="lead">AI scores the answers, and people review any flags. Nobody is failed by a machine.</p>
          </div>
          <ul className="ticks" style={{ color: "#fff" }}>
            <li>Identity check before the real test, with face and voice matching or a manual check by a person.</li>
            <li>Camera and screen checks during the test; leaving the test window is recorded.</li>
            <li>Every flag is reviewed by a trained person before a certificate is issued.</li>
            <li>Certificates anyone can check online, with a code and a QR code.</li>
            <li>Data stored in Singapore and never sold.</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="wrap grid g2" style={{ alignItems: "center" }}>
          <div>
            <p className="eyebrow">See the result</p>
            <h2>A clear score report for every test</h2>
            <p className="lead">
              Overall level and score, a level for each skill, strengths, what to work on next, and notes on speaking and writing. Organisations
              see the same report for their people.
            </p>
            <div className="actions">
              <a className="btn primary" href={app.sampleReport()}>
                See a sample report
              </a>
              <a className="btn ghost" href={app.sampleCertificate}>
                Check the sample certificate
              </a>
            </div>
          </div>
          <div className="card">
            <h3>Plans in short</h3>
            <ul className="ticks">
              <li>
                <b>Free:</b> a placement test and some practice every week.
              </li>
              <li>
                <b>Full access:</b> every test, unlimited practice and a final assessment with a certificate, from {money("full", "INR")} /{" "}
                {money("full", "USD")} a month.
              </li>
              <li>
                <b>Single tests:</b> from {money("assessment:placement", "INR")} / {money("assessment:placement", "USD")}, with a free sample first.
              </li>
              <li>
                <b>Organisations:</b> licences per learner-month from US$15, and credits for tests and recruitment.
              </li>
            </ul>
            <Link className="btn ghost" href="/pricing" style={{ marginTop: 16 }}>
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap faq" style={{ maxWidth: 820 }}>
          <p className="eyebrow">Questions</p>
          <h2>Frequently asked questions</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section center">
        <div className="wrap">
          <h2>Find your English level today</h2>
          <p className="lead">The placement test is free. It takes about 30 minutes and gives a level for each skill.</p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <a className="btn primary" href={app.signUp}>
              Start free
            </a>
            <Link className="btn ghost" href="/demo">
              Book a demo
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
