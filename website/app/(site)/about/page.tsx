import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Heart, Lock, Scale, Search, UserCheck, Users } from "lucide-react";
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
              Spica answers all three: tests on one scale linked to the CEFR levels, practice for every question type, and a proctored final test
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
          <p className="muted" style={{ marginTop: 24 }}>
            [Mission, team and Edstellar background to be written with the business.]
          </p>
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
    </>
  );
}
