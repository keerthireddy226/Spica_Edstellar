import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Award, BookOpenCheck, ClipboardList, Laptop, MonitorCheck, Rocket, ShoppingCart, UserPlus } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { app } from "@/lib/site";

export const metadata: Metadata = {
  title: "How to take a test",
  description: "How to take a Spica English test, step by step: create an account, choose a test, prepare, the free sample, test day, results and your certificate.",
};

const STEPS: [React.ElementType, string, React.ReactNode][] = [
  [UserPlus, "Create a free account", "Sign up and take the free placement test. It gives you a level for each skill, so you know where you start."],
  [
    ShoppingCart,
    "Choose your test",
    <>
      Pick the test that fits what you need and buy it, or take it with Full access. If your employer or a recruiter invited you, open the link in
      their email instead: job candidates do not need an account.
    </>,
  ],
  [BookOpenCheck, "Prepare", "Use Practice Modules for every question type, practice tests you can pause, and timed mock tests, depending on your plan."],
  [MonitorCheck, "Take the free sample", "A short sample with the same checks makes sure your camera, microphone and screen sharing work before the real test."],
  [
    ClipboardList,
    "Test day",
    <>
      Take a photo of yourself and, where required, of your identity document. Share your whole screen, stay alone in a quiet room and follow the{" "}
      <Link href="/legal/test-rules">test rules</Link>. Every question has its own timer.
    </>,
  ],
  [Award, "Results and certificate", "You get a full score report. After a real test, your certificate is issued once every answer is scored and the checks are clear."],
];

const NEED = [
  "A laptop or desktop computer",
  "A camera and a microphone",
  "An up-to-date browser (the system check tells you if yours works)",
  "A stable internet connection",
  "A quiet room where you can be alone",
  "An identity document, where your test needs one",
];

export default function HowToTakeATestPage() {
  return (
    <>
      <PageHero
        crumbs={[{ href: "/tests", label: "Tests" }, { label: "How to take a test" }]}
        eyebrow="Step by step"
        icon={<Rocket size={16} />}
        title={
          <>
            How to take a <span className="ph-accent">Spica test</span>
          </>
        }
        lead="From signing up to sharing your certificate, in six steps."
        actions={
          <>
            <a className="btn primary" href={app.signUp}>
              Start free <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn ghost" href="/tests">
              Choose a test
            </Link>
          </>
        }
      />
      <section className="section">
        <div className="wrap">
          <ol className="steps-list">
            {STEPS.map(([I, h, t], i) => (
              <li key={h} data-reveal style={{ ["--i" as string]: i % 3 }}>
                <span className="steps-num">{i + 1}</span>
                <span className="icard-icon">
                  <I size={20} />
                </span>
                <div>
                  <h3>{h}</h3>
                  <p className="muted">{t}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap split">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Laptop size={14} /> What you need
            </p>
            <h2>Before test day</h2>
            <p className="muted">A system check runs first, so you will know if anything needs fixing.</p>
          </div>
          <ul className="ticks" data-reveal>
            {NEED.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
