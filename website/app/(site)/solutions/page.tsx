import type { Metadata } from "next";
import Link from "next/link";
import { SOLUTIONS } from "@/lib/solutions";

export const metadata: Metadata = {
  title: "Who it's for",
  description: "Spica for companies, recruiters, universities, training providers and individuals: English tests, practice and certificates.",
};

export default function SolutionsPage() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="eyebrow">Who it's for</p>
        <h1>English testing and training for every need</h1>
        <p className="lead">The same tests and the same scale, set up the way each kind of organisation works.</p>
        <div className="grid g3" style={{ marginTop: 32 }}>
          {SOLUTIONS.map((s) => (
            <Link key={s.slug} className="card test-card" href={`/solutions/${s.slug}`}>
              <h3>{s.name}</h3>
              <p style={{ margin: 0 }}>{s.headline}</p>
              <p className="muted" style={{ margin: 0, fontSize: "0.92rem" }}>
                {s.problem}
              </p>
              <span className="more">Learn more →</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
