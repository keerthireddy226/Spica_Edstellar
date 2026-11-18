import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, Eye, FileCheck2, GraduationCap, Lock, MonitorCheck, QrCode, ScanFace, ShieldCheck, Sparkles, UserCheck, Users } from "lucide-react";
import { CandidatesMock, FloatChips, ReportMock, TeamMock } from "@/components/home/Mocks";
import { Platform } from "@/components/home/Platform";
import { TestsExplorer } from "@/components/home/TestsExplorer";
import { DemoForm } from "@/components/home/DemoForm";
import { CertificateForm } from "@/components/CertificateForm";
import { app } from "@/lib/site";
import { money } from "@/lib/prices";
import { SampleQuestion } from "@/components/page/SampleQuestion";
import { CefrExplorer, Journey, Routes, WhyCompare } from "@/components/home/Extras";
import { SAMPLES } from "@/lib/samples";
import { EDSTELLAR } from "@/lib/edstellar";
import "./home.css";

export const metadata: Metadata = {
  title: { absolute: "Spica by Edstellar | Measure, build and certify English" },
  description:
    "Spica tests English in all four skills on one 10–90 scale with CEFR levels A1–C2, trains people with a plan for their level, and certifies results with a proctored test and a certificate anyone can check.",
};

// Who reads a Spica report, and what each one gets. Every point exists in Spica today.
const REPORTS: [React.ElementType, string, string, string[]][] = [
  [Users, "Recruiters", "Everything to decide on a candidate", ["Level, score and a score for each skill", "Spoken answers to play, with transcripts", "Suggested questions for the interview", "A secure link to share with hiring managers"]],
  [GraduationCap, "Learners", "A clear picture of where to improve", ["CEFR level and Spica score", "A score for each of the four skills", "What to work on next, linked to practice"]],
  [Building2, "Teams and classes", "Reports for every batch", ["Levels and progress by person and by batch", "Progress towards a target level", "Exports for HR and placement offices"]],
];

// The languages of Spica's menus and instructions (frontend/src/i18n).
const LANGUAGES = ["English", "हिन्दी Hindi", "తెలుగు Telugu", "中文 Chinese", "日本語 Japanese", "Tiếng Việt Vietnamese", "Français French", "Deutsch German", "Español Spanish", "Italiano Italian", "Nederlands Dutch", "Polski Polish", "Dansk Danish", "Suomi Finnish", "Norsk Norwegian", "Svenska Swedish"];


const FAQ: [string, string][] = [
  ["Is a Spica certificate official or accredited?", "It is Spica's own certificate. It shows a CEFR level and anyone can check it online. It is not a government or visa certificate."],
  ["How are answers scored?", "AI scores spoken and written answers against clear rules for each task; multiple-choice and gap-fill answers are marked automatically. People review every proctoring flag, and anyone can ask for a person to review a score."],
  ["Will an accent lower the score?", "Speaking is scored on how clearly you are understood, not on your accent. British, American and Indian spellings are all accepted."],
  ["What does a test taker need?", "A laptop or desktop computer with a camera, a microphone and a modern browser, a stable connection and a quiet room. A system check runs first."],
  ["Do job candidates need an account?", "No. Candidates open the link in their invitation, take one proctored test, and the recruiter receives the report."],
  ["Can we use our own sign-in and branding?", "Yes. Organisations can add their logo and colour, and on Enterprise use company sign-in (SAML or OpenID Connect) and automatic accounts (SCIM)."],
  ["How long is a certificate valid?", "12 months. It can be extended for another 12 months or made valid for life."],
  ["How is our data protected?", "Data is encrypted, recordings and photos are deleted on a fixed schedule, and data is never sold or used to train AI models. See Security and trust."],
];

export default function Home() {
  return (
    <div className="h">

      {/* HERO */}
      <section className="h-hero">
        <div className="h-wrap h-hero-grid">
          <div className="h-hero-copy">
            <span className="h-eyebrow">
              <Sparkles size={14} /> English assessment, training and certification
            </span>
            <h1>
              Measure English.
              <br />
              Build it. <span className="h-grad">Certify it.</span>
            </h1>
            <p className="h-lead">
              Spica gives every person a reliable English level in all four skills, a plan to improve it, and a proctored test that ends in a
              certificate anyone can check.
            </p>
            <div className="h-ctas">
              <a className="h-btn primary" href="#demo">
                Book a demo <ArrowRight size={17} />
              </a>
              <a className="h-btn ghost" href={app.signUp}>
                Take the free level test
              </a>
            </div>
            <ul className="h-trust">
              <li>
                <BadgeCheck size={16} /> CEFR A1–C2
              </li>
              <li>
                <ShieldCheck size={16} /> Proctored, reviewed by people
              </li>
              <li>
                <QrCode size={16} /> Verifiable certificates
              </li>
              <li>
                <Lock size={16} /> Data never sold
              </li>
            </ul>
          </div>
          <div className="h-hero-visual" aria-hidden="true">
            <div className="h-glow" />
            <ReportMock />
            <FloatChips />
          </div>
        </div>
      </section>

      {/* NUMBERS */}
      <section className="h-numbers">
        <div className="h-wrap h-num-grid">
          {[
            ["5", "tests for work, hiring and placement"],
            ["6", "level tests, from A1 to C2"],
            ["4", "skills, each with its own score"],
            ["90", "top of the Spica 10–90 scale"],
            ["17", "minutes for the shortest test"],
          ].map(([n, t]) => (
            <div key={t} className="h-num" data-reveal>
              <b data-count={n}>{n}</b>
              <span>{t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* PLATFORM */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">One platform</span>
            <h2>From a first level check to a certificate, in one place</h2>
            <p>Most tests only measure, and most learning apps never certify. Spica does both, with tools for the people who manage, train and hire.</p>
          </div>
          <div data-reveal>
            <Platform />
          </div>
        </div>
      </section>

      {/* JOURNEY */}
      <section className="h-section h-tint">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Get certified your way</span>
            <h2>Go straight to your certificate, or prepare first</h2>
            <p>Spica is not only for practice. Take the real test today, prepare for it first, or check one level at a time.</p>
          </div>
          <Routes />
          <div className="h-head" data-reveal style={{ marginTop: 44 }}>
            <span className="h-kicker">The full path</span>
            <h3 className="h-sub">With preparation: six steps from first level check to certificate</h3>
          </div>
          <Journey />
        </div>
      </section>

      {/* AUDIENCES */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Solutions</span>
            <h2>Built for every team that needs proof of English</h2>
          </div>
          <div className="h-bento">
            <Link href="/solutions/recruiters" className="h-card h-card-wide" data-reveal>
              <div className="h-card-copy">
                <span className="h-card-icon">
                  <UserCheck size={20} />
                </span>
                <h3>Recruiters and contact centres</h3>
                <p>Send one proctored test before the interview and shortlist only the candidates who meet the level the role needs.</p>
                <span className="h-link">
                  For recruiters <ArrowRight size={15} />
                </span>
              </div>
              <CandidatesMock />
            </Link>
            <Link href="/solutions/companies" className="h-card" data-reveal>
              <span className="h-card-icon">
                <Building2 size={20} />
              </span>
              <h3>Companies</h3>
              <p>Place everyone, train with a plan for each level, and see progress by team.</p>
              <span className="h-link">
                For companies <ArrowRight size={15} />
              </span>
            </Link>
            <Link href="/solutions/universities" className="h-card" data-reveal>
              <span className="h-card-icon">
                <GraduationCap size={20} />
              </span>
              <h3>Universities and colleges</h3>
              <p>Admission tests, preparation for placements and certificates students can share.</p>
              <span className="h-link">
                For universities <ArrowRight size={15} />
              </span>
            </Link>
            <Link href="/solutions/training-providers" className="h-card" data-reveal>
              <span className="h-card-icon">
                <Users size={20} />
              </span>
              <h3>Training providers</h3>
              <p>Test before and after each course on the same scale, and show clients the gain.</p>
              <span className="h-link">
                For trainers <ArrowRight size={15} />
              </span>
            </Link>
            <Link href="/solutions/individuals" className="h-card" data-reveal>
              <span className="h-card-icon">
                <Sparkles size={20} />
              </span>
              <h3>Individuals</h3>
              <p>Find your level free, practise every question type, and prove it to employers.</p>
              <span className="h-link">
                For you <ArrowRight size={15} />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* TRY A QUESTION */}
      <section className="h-section h-tint">
        <div className="h-wrap h-try">
          <div className="h-head" data-reveal style={{ textAlign: "left", margin: 0 }}>
            <span className="h-kicker">Try it now</span>
            <h2>Hear how a Spica test feels</h2>
            <p>
              Press Play when you are ready. Each recording plays once, like the real exam, and your answer time starts only when it ends. The timer sits
              next to the question, turns red in the last seconds, and every part opens with clear steps, so nothing catches you out.
            </p>
            <p>
              <Link href="/tests" className="h-link">
                See every test and its parts <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </p>
          </div>
          <div data-reveal>
            <SampleQuestion s={SAMPLES["english-4-skills-essentials"]} />
          </div>
        </div>
      </section>

      {/* TESTS */}
      <section className="h-section" id="tests">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">The tests</span>
            <h2>The right test for the job, on one scale</h2>
            <p>Every result is a CEFR level and a Spica score from 10 to 90, overall and for each skill.</p>
          </div>
          <div data-reveal>
            <TestsExplorer />
          </div>
        </div>
      </section>

      {/* CEFR */}
      <section className="h-section h-tint">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Levels</span>
            <h2>Every result on the international CEFR scale</h2>
            <p>Each test gives a CEFR level from A1 to C2 and a Spica score from 10 to 90. Choose a level to see what it means.</p>
          </div>
          <div className="h-cefr-grid">
            <div data-reveal>
              <CefrExplorer />
            </div>
            <div className="h-cefr-side" data-reveal>
              <h3>How people move up the scale</h3>
              <ol className="h-mini-steps">
                <li>A placement test sets the starting level.</li>
                <li>The study plan and mock tests build toward the next level.</li>
                <li>A proctored test certifies the level reached.</li>
              </ol>
              <h3>Level tests check one level at a time</h3>
              <dl className="h-facts">
                <div>
                  <dt>Questions</dt>
                  <dd>About 28, all at the chosen level</dd>
                </div>
                <div>
                  <dt>Skills</dt>
                  <dd>All four</dd>
                </div>
                <div>
                  <dt>Pass mark</dt>
                  <dd>70% overall, at least 50% in each skill</dd>
                </div>
                <div>
                  <dt>Retake</dt>
                  <dd>After 7 days</dd>
                </div>
              </dl>
              <p className="h-small">A level test gives a passed or not-passed result with a score report. Certificates come only from a final proctored test.</p>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRITY */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Integrity</span>
            <h2>A result you can rely on</h2>
            <p>AI scores the answers. People review every flag before a certificate is issued. Nobody is failed by a machine.</p>
          </div>
          <div className="h-timeline">
            {[
              [MonitorCheck, "Before the test", ["System check of camera, microphone and connection", "ID document and photo", "Face and voice matching, or a manual check by a person"]],
              [Eye, "During the test", ["Camera snapshots and screen recording", "Leaving the test window is recorded", "Each recording plays once; fresh questions each time"]],
              [FileCheck2, "After the test", ["Trained reviewers check every flag", "Certificate only when the checks are clear", "Anyone can ask for a person to review their score"]],
            ].map(([Icon, t, items], i) => {
              const I = Icon as typeof Eye;
              return (
                <div key={t as string} className="h-step" data-reveal style={{ ["--i" as string]: i }}>
                  <span className="h-step-icon">
                    <I size={22} />
                  </span>
                  <span className="h-step-n">0{i + 1}</span>
                  <h3>{t as string}</h3>
                  <ul className="h-checks">
                    {(items as string[]).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="h-fine" data-reveal>
            <ScanFace size={15} /> Biometric checks only with separate consent, run on Spica&apos;s own servers. Recordings and photos are deleted on a fixed
            schedule. <Link href="/security">How we protect data</Link>
          </p>
        </div>
      </section>

      {/* VERIFY + REPORTS */}
      <section className="h-section h-tint">
        <div className="h-wrap h-split">
          <div data-reveal>
            <span className="h-kicker">Certificates</span>
            <h2>Checked in seconds, by anyone</h2>
            <p className="h-p">
              Every certificate comes from a proctored real test and carries a code and a QR code. Employers enter the code to see the name, level,
              scores, test date and whether it is still valid. Try it with the sample code <b>SAMPLE</b>.
            </p>
            <div className="h-verify">
              <CertificateForm />
            </div>
          </div>
          <div data-reveal>
            <span className="h-kicker">Reports</span>
            <h2>More than a single score</h2>
            <p className="h-p">
              A level for each skill, strengths, what to work on next, notes on speaking and writing, and for recruiters, interview questions aimed
              at the weakest skill.
            </p>
            <TeamMock />
            <a className="h-link" href={app.sampleReport()} style={{ marginTop: 16 }}>
              Open a full sample report <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>

      {/* REPORTS */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Reports</span>
            <h2>Reports that go beyond a single score</h2>
            <p>Every report shows the CEFR level, a Spica score from 10 to 90 and each skill on its own, with clear next steps for the person reading it.</p>
          </div>
          <div className="grid g3">
            {REPORTS.map(([I, who, title, points], i) => (
              <div key={who} className="card icard" data-reveal style={{ ["--i" as string]: i }}>
                <span className="icard-icon">
                  <I size={20} />
                </span>
                <p className="eyebrow" style={{ margin: "14px 0 4px" }}>{who}</p>
                <h3>{title}</h3>
                <ul className="ticks">
                  {points.map((pt) => (
                    <li key={pt}>{pt}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LANGUAGES AND EDSTELLAR */}
      <section className="h-section h-tint">
        <div className="h-wrap grid g2" style={{ alignItems: "start", gap: 40 }}>
          <div data-reveal>
            <span className="h-kicker">Online, anywhere</span>
            <h2 style={{ margin: "10px 0 12px" }}>Menus and instructions in {LANGUAGES.length} languages</h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Spica runs in a web browser, so people can learn and test at home, at work or on campus, with nothing to install and no test centre. The
              tests themselves are in English.
            </p>
            <div className="lang-chips">
              {LANGUAGES.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
          <div data-reveal style={{ ["--i" as string]: 1 }}>
            <span className="h-kicker">Training and testing</span>
            <h2 style={{ margin: "10px 0 12px" }}>From the same partner</h2>
            <p className="muted" style={{ marginBottom: 18 }}>
              Spica is built by Edstellar, a corporate training company. Pair English testing with training programmes and the rest of the Edstellar
              platforms.
            </p>
            <div className="ed-list">
              {EDSTELLAR.map(([name, text]) => (
                <div key={name}>
                  <b>{name}</b>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHY SPICA */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Why Spica</span>
            <h2>Why teams choose Spica</h2>
            <p>Spica brings together what usually takes two separate tools, and adds the checks that make a result worth trusting.</p>
          </div>
          <div data-reveal>
            <WhyCompare />
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="h-section h-tint">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Pricing</span>
            <h2>Start free. Pay only for what you need.</h2>
          </div>
          <div className="h-prices">
            <div className="h-price" data-reveal>
              <small>Individuals</small>
              <h3>Free level test</h3>
              <p>A placement test with a level for each skill, and practice every week.</p>
              <b>Free</b>
            </div>
            <div className="h-price featured" data-reveal>
              <small>Individuals</small>
              <h3>Full access</h3>
              <p>All tests, unlimited practice, mock tests and a final assessment with a certificate.</p>
              <b>
                {money("full", "INR")} / {money("full", "USD")} <em>a month</em>
              </b>
            </div>
            <div className="h-price" data-reveal>
              <small>Organisations</small>
              <h3>Licences and credits</h3>
              <p>Learner licences from US$15 a month, and credits for single tests and recruitment.</p>
              <b>
                From US$3 <em>a credit</em>
              </b>
            </div>
          </div>
          <div className="h-center" data-reveal>
            <Link href="/pricing" className="h-btn ghost">
              See all prices <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="h-section">
        <div className="h-wrap">
          <div className="h-head" data-reveal>
            <span className="h-kicker">Questions</span>
            <h2>Answers to common questions</h2>
          </div>
          <div className="h-faq" data-reveal>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section className="h-section h-demo" id="demo">
        <div className="h-wrap h-demo-grid">
          <div className="h-demo-copy" data-reveal>
            <span className="h-kicker light">Book a demo</span>
            <h2>See Spica with your own use case</h2>
            <p>In 30 minutes an Edstellar specialist shows you the admin, manager and recruiter consoles with a demo organisation, and answers your questions.</p>
            <ul className="h-checks light">
              <li>Tailored to hiring, training or admissions</li>
              <li>Ask about a pilot: 10 licences for 30 days</li>
              <li>A reply within one business day</li>
            </ul>
          </div>
          <div className="h-demo-card" data-reveal>
            <DemoForm />
          </div>
        </div>
      </section>
    </div>
  );
}
