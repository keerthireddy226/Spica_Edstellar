import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Heart, Layers, Lock, Scale, Search, ShieldCheck, UserCheck, Users } from "lucide-react";
import { EDSTELLAR } from "@/lib/edstellar";
import { PageHero } from "@/components/page/PageHero";
import { JourneyMock } from "@/components/page/Visuals";

export const metadata: Metadata = {
  title: "About",
  description: "Spica is built by Edstellar to give organisations and individuals one place to learn, practise and certify English.",
};

const PROBLEMS: [React.ElementType, string, string][] = [
  [Building2, "Companies", "Spend money on English training without seeing who needs it or whether it worked."],
  [Search, "Recruiters", "Spend interviews finding out that a candidate's English is not good enough."],
  [Users, "Learners", "Have few affordable ways to show their level to an employer."],
];

const VALUES: [React.ElementType, string, React.ReactNode][] = [
  [Scale, "Fair", "Speaking is scored on how clearly you are understood, not on your accent, and British, American and Indian spellings are all accepted."],
  [UserCheck, "Trustworthy", "AI scores the answers, and people review flags and any score someone asks to have checked."],
  [
    Lock,
    "Private",
    <>
      Data protected, deleted on a fixed schedule, and never sold. <Link href="/security">How we protect it</Link>.
    </>,
  ],
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "About" }]}
        eyebrow="About Spica"
        icon={<Heart size={16} />}
        tone="plum"
        title={
          <>
            English you can <span className="ph-accent">measure, improve and prove</span>
          </>
        }
        lead="Spica is built by Edstellar, a corporate training company, to give organisations and individuals one place to learn, practise and certify English."
        visual={<JourneyMock />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Why we built it</p>
            <h2>Three problems, one platform</h2>
            <p className="muted">
              Spica answers all three: tests on one scale that reports the CEFR levels, practice for every question type, and a proctored final test
              with a certificate anyone can check online.
            </p>
          </div>
          <div className="grid g3">
            {PROBLEMS.map(([I, h, t], i) => (
              <div key={h} className="card icard" data-reveal style={{ ["--i" as string]: i }}>
                <span className="icard-icon">
                  <I size={20} />
                </span>
                <h3>{h}</h3>
                <p className="muted">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">What we stand for</p>
            <h2>Fair, trustworthy and private</h2>
          </div>
          <div className="grid g3">
            {VALUES.map(([I, h, t], i) => (
              <div key={h} className="card icard" data-reveal style={{ ["--i" as string]: i }}>
                <span className="icard-icon">
                  <I size={20} />
                </span>
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
            <p className="eyebrow">
              <ShieldCheck size={14} /> How Spica is built
            </p>
            <h2>Built so a result means something</h2>
            <ul className="ticks">
              <li>Every question is written to CEFR-based specifications, checked automatically and answered blind by a separate reviewer.</li>
              <li>Practice, mock and real tests use separate question banks. Real-test questions are never shown afterwards.</li>
              <li>Every test taker gets the same time, and each recording plays once, in a clear female or male voice.</li>
              <li>Speaking is scored on how clearly you are understood, not on your accent.</li>
              <li>People decide every proctoring flag. Nothing fails anyone automatically.</li>
              <li>Menus and instructions in 16 languages.</li>
            </ul>
          </div>
          <div className="card" data-reveal>
            <p className="eyebrow">
              <Layers size={14} /> At a glance
            </p>
            <div className="about-stats">
              <div>
                <b>5</b>
                <span>main tests, plus Level Tests from A1 to C2</span>
              </div>
              <div>
                <b>10–90</b>
                <span>one Spica scale, reported on the CEFR levels</span>
              </div>
              <div>
                <b>Minutes</b>
                <span>for most results; spoken answers can take a little longer</span>
              </div>
              <div>
                <b>Online</b>
                <span>certificates anyone can check with a code or QR code</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">
              <Building2 size={14} /> Built by Edstellar
            </p>
            <h2>Training and testing from the same partner</h2>
            <p className="muted">
              Spica is built by Edstellar, a corporate training company. Organisations can pair English testing with training programmes and the rest
              of the Edstellar platforms.
            </p>
          </div>
          <div className="grid g4">
            {EDSTELLAR.map(([name, text], i) => (
              <div className="card" key={name} data-reveal style={{ ["--i" as string]: i }}>
                <CheckCircle2 size={18} className="about-tick" aria-hidden="true" />
                <h3>{name}</h3>
                <p className="muted">{text}</p>
              </div>
            ))}
          </div>
          <div className="actions" style={{ marginTop: 24 }}>
            <Link className="btn primary" href="/demo">
              Book a demo <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="btn ghost" href="/contact">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
