import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description: "Spica is built by Edstellar to give organisations and individuals one place to learn, practise and certify English.",
};

export default function AboutPage() {
  return (
    <>
      <section className="section">
        <div className="wrap" style={{ maxWidth: 860 }}>
          <p className="eyebrow">About</p>
          <h1>English you can measure, improve and prove</h1>
          <p className="lead">
            Spica is built by Edstellar, a corporate training company, to give organisations and individuals one place to learn, practise and
            certify English.
          </p>
          <p>
            Many companies spend money on English training without seeing who needs it or whether it worked. Recruiters spend interviews
            finding out that a candidate&apos;s English is not good enough. Learners have few affordable ways to show their level to an
            employer.
          </p>
          <p>
            Spica answers all three with one platform: tests on one scale linked to the CEFR levels, practice for every question type, and a
            proctored final test with a certificate anyone can check online.
          </p>
          <p className="muted">[Mission, team and Edstellar background to be written with the business.]</p>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap grid g3">
          <div className="card">
            <h3>Fair</h3>
            <p className="muted">Accents are never marked down, and British, American and Indian spellings are all accepted.</p>
          </div>
          <div className="card">
            <h3>Trustworthy</h3>
            <p className="muted">AI scores the answers, and people review flags and any score someone asks to have checked.</p>
          </div>
          <div className="card">
            <h3>Private</h3>
            <p className="muted">
              Data protected, deleted on a fixed schedule, and never sold. <Link href="/security">How we protect it</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
