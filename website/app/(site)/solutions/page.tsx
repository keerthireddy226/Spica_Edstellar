import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { SOLUTIONS } from "@/lib/solutions";
import { PageHero } from "@/components/page/PageHero";
import { AudienceTiles } from "@/components/page/Visuals";
import { SOLUTION_LOOK } from "@/components/page/looks";

export const metadata: Metadata = {
  title: "Who it's for",
  description: "Spica for companies, recruiters, universities, training providers and individuals: English tests, practice and certificates.",
};

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "Who it's for" }]}
        eyebrow="Who it's for"
        icon={<Users size={16} />}
        tone="plum"
        title={
          <>
            English testing and training <span className="ph-accent">for every need</span>
          </>
        }
        lead="The same tests and the same scale, set up the way each kind of organisation works."
        visual={<AudienceTiles items={SOLUTIONS.map((s) => ({ label: s.name, icon: SOLUTION_LOOK[s.slug].icon, tone: SOLUTION_LOOK[s.slug].tone }))} />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Choose your path</p>
            <h2>Find the setup that fits you</h2>
          </div>
          <div className="test-grid">
            {SOLUTIONS.map((s, i) => {
              const look = SOLUTION_LOOK[s.slug];
              const Icon = look.icon;
              return (
                <Link key={s.slug} className={`tcard tone-${look.tone}`} href={`/solutions/${s.slug}`} data-reveal style={{ ["--i" as string]: i % 3 }}>
                  <div className="tcard-top">
                    <span className="tcard-icon">
                      <Icon size={22} />
                    </span>
                  </div>
                  <h3>{s.name}</h3>
                  <p style={{ color: "var(--ink)", flex: "none" }}>{s.headline}</p>
                  <p className="muted">{s.problem}</p>
                  <span className="tcard-more">
                    See how it works <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
