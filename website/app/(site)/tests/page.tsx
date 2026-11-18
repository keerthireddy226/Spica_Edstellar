import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Briefcase,
  ClipboardCheck,
  Clock,
  Compass,
  FlaskConical,
  Headphones,
  LayoutGrid,
  ListChecks,
  Mic,
  PenLine,
  QrCode,
  Repeat,
  Timer,
} from "lucide-react";
import { PageHero, type Tone } from "@/components/page/PageHero";
import { TESTS } from "@/lib/tests";
import { TEST_LOOK as LOOK, SKILL_ICON } from "@/components/page/looks";
import { money } from "@/lib/prices";

export const metadata: Metadata = {
  title: "English tests",
  description: "Six online English tests: 4 Skills Essentials, Placement, Professional English, Speaking & Listening, Writing and Level Tests, all on the Spica 10–90 scale and CEFR levels.",
};

// Which test answers which question.
const CHOOSER = [
  { need: "One reliable level for all four skills", slug: "english-4-skills-essentials" },
  { need: "Put learners in the right class or course", slug: "english-placement" },
  { need: "English for client-facing and professional roles", slug: "professional-english" },
  { need: "Check spoken English quickly, in about 17 minutes", slug: "speaking-and-listening" },
  { need: "Check written English for office, email or support work", slug: "writing" },
  { need: "Confirm someone has reached one chosen level", slug: "level-tests" },
];

// The Spica scale and the CEFR level each band of scores means.
const BANDS = [
  { level: "A1", range: "20–29" },
  { level: "A2", range: "30–39" },
  { level: "B1", range: "40–54" },
  { level: "B2", range: "55–69" },
  { level: "C1", range: "70–79" },
  { level: "C2", range: "80–90" },
];

function LevelLadder() {
  return (
    <div className="ladder" aria-label="The Spica scale from 10 to 90 and the CEFR levels A1 to C2">
      <div className="ladder-head">
        <b>One scale for every test</b>
        <span>Spica score → CEFR level</span>
      </div>
      <div className="ladder-bars">
        {BANDS.map((b, i) => (
          <div key={b.level} className={`ladder-col${b.level === "B2" ? " hl" : ""}`} style={{ ["--h" as string]: `${28 + i * 13}%` }}>
            {b.level === "B2" && <span className="ladder-tip">Example: 64 = B2</span>}
            <div className="ladder-bar">
              <b>{b.level}</b>
            </div>
            <small>{b.range}</small>
          </div>
        ))}
      </div>
      <div className="ladder-foot">
        <span>
          <Mic size={14} /> Speaking
        </span>
        <span>
          <Headphones size={14} /> Listening
        </span>
        <span>
          <BookOpen size={14} /> Reading
        </span>
        <span>
          <PenLine size={14} /> Writing
        </span>
      </div>
    </div>
  );
}

const minutesOf = (m: string) => Number(m.match(/\d+/)?.[0] ?? 0);

export default function TestsPage() {
  const shortest = Math.min(...TESTS.map((t) => minutesOf(t.minutes)));
  const byslug = Object.fromEntries(TESTS.map((t) => [t.slug, t]));
  return (
    <>
      <PageHero
        crumbs={[{ label: "Tests" }]}
        eyebrow="The tests"
        icon={<ClipboardCheck size={16} />}
        tone="clay"
        title={
          <>
            Six English tests, <span className="ph-accent">one scale</span>
          </>
        }
        lead="Every Spica test runs online, is scored on the Spica scale from 10 to 90 and reports a CEFR level from A1 to C2. Choose the test that matches what you need to know."
        actions={
          <>
            <a className="btn primary" href="#choose">
              Find your test <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a className="btn ghost" href="#compare">
              Compare all six
            </a>
          </>
        }
        visual={<LevelLadder />}
      />

      <div className="stat-strip">
        <div className="wrap stat-grid">
          <div>
            <b data-count={TESTS.length}>{TESTS.length}</b>
            <span>tests, each for a different need</span>
          </div>
          <div>
            <b data-count="4">4</b>
            <span>skills, each with its own level</span>
          </div>
          <div>
            <b>10–90</b>
            <span>Spica scale, reported as CEFR A1–C2</span>
          </div>
          <div>
            <b data-count={shortest}>{shortest}</b>
            <span>minutes for the shortest test</span>
          </div>
        </div>
      </div>

      <section className="section" id="choose">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Choose a test</p>
            <h2>Find the test that fits</h2>
            <p className="muted">Open a test to see its parts, example tasks, scoring and a sample score report.</p>
          </div>
          <div className="test-grid">
            {TESTS.map((t, i) => {
              const look = LOOK[t.slug] ?? { icon: ClipboardCheck, tone: "clay" as Tone };
              const Icon = look.icon;
              return (
                <Link key={t.slug} href={`/tests/${t.slug}`} className={`tcard tone-${look.tone}`} data-reveal style={{ ["--i" as string]: i % 3 }}>
                  <div className="tcard-top">
                    <span className="tcard-icon">
                      <Icon size={22} />
                    </span>
                    <span className="tcard-time">
                      <Clock size={14} /> {t.minutes.replace("About ", "~")}
                    </span>
                  </div>
                  <h3>{t.name}</h3>
                  <p className="muted">{t.short}</p>
                  <div className="tcard-skills">
                    {t.skills.map((s) => {
                      const S = SKILL_ICON[s];
                      return (
                        <span key={s} title={s}>
                          <S size={14} aria-hidden="true" /> {s}
                        </span>
                      );
                    })}
                  </div>
                  <div className="tcard-foot">
                    <span>
                      <ListChecks size={15} aria-hidden="true" /> {t.questions} questions
                    </span>
                    <span className="tcard-price">
                      {money(t.priceKey, "INR")} <small>/ {money(t.priceKey, "USD")}</small>
                    </span>
                  </div>
                  <span className="tcard-more">
                    See the test <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap split">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Not sure?</p>
            <h2>Which test do I need?</h2>
            <p className="muted">Start from what you want to know. An organisation can use several tests, and every result sits on the same scale.</p>
          </div>
          <ul className="chooser" data-reveal>
            {CHOOSER.map((c) => {
              const t = byslug[c.slug];
              if (!t) return null;
              const Icon = (LOOK[c.slug] ?? { icon: ClipboardCheck }).icon;
              return (
                <li key={c.slug}>
                  <Link href={`/tests/${c.slug}`}>
                    <span className={`chooser-icon tone-${LOOK[c.slug]?.tone ?? "clay"}`}>
                      <Icon size={18} />
                    </span>
                    <span className="chooser-need">{c.need}</span>
                    <span className="chooser-test">
                      {t.name} <ArrowRight size={15} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section" id="compare">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">At a glance</p>
            <h2>Compare all six</h2>
          </div>
          <div className="table-wrap" data-reveal>
            <table className="t">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Best for</th>
                  <th>Questions and time</th>
                  <th>Skills</th>
                  <th>Price (individuals)</th>
                </tr>
              </thead>
              <tbody>
                {TESTS.map((t) => (
                  <tr key={t.slug}>
                    <td>
                      <Link href={`/tests/${t.slug}`}>
                        <b>{t.name}</b>
                      </Link>
                    </td>
                    <td>{t.short}</td>
                    <td>
                      {t.questions} questions, {t.minutes.toLowerCase()}
                    </td>
                    <td>{t.skills.join(", ")}</td>
                    <td>
                      {money(t.priceKey, "INR")} / {money(t.priceKey, "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: "0.9rem" }}>
            Prices are for one real test with a score report and a certificate (Level Tests: a certificate when you pass). Organisations pay with credits; see{" "}
            <Link href="/pricing">Pricing</Link>.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">How every test works</p>
            <h2>The same fair rules, every time</h2>
          </div>
          <div className="icon-cards">
            {[
              { icon: Timer, title: "A timer on each question", text: "Every question has its own time limit, so each person gets the same conditions." },
              { icon: Repeat, title: "Each recording plays once", text: "Press Play when you are ready. The answer timer starts when the recording ends. A question left blank counts as wrong." },
              { icon: FlaskConical, title: "A free sample first", text: "A short sample with the same checks makes sure the camera, microphone and screen sharing work." },
              { icon: QrCode, title: "Results anyone can check", text: "Real tests end in a score report and a certificate with a QR code that anyone can check online." },
            ].map((c, i) => {
              const I = c.icon;
              return (
                <div key={c.title} className="icard" data-reveal style={{ ["--i" as string]: i }}>
                  <span className="icard-icon">
                    <I size={20} />
                  </span>
                  <h3>{c.title}</h3>
                  <p className="muted">{c.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
