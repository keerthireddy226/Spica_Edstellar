import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, Headphones, Layers, Mic, PenLine } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { BELOW_A1, LEVELS } from "@/lib/levels";
import { LevelScale } from "@/components/page/LevelScale";
import { app } from "@/lib/site";

export const metadata: Metadata = {
  title: "English levels A1–C2",
  description: "What each English level from A1 to C2 means, skill by skill, and the Spica scores for each level.",
};

export default function LevelsPage() {
  return (
    <>
      <PageHero
        crumbs={[{ label: "English levels" }]}
        eyebrow="English levels"
        icon={<Layers size={16} />}
        title={
          <>
            What each English level <span className="ph-accent">really means</span>
          </>
        }
        lead="Spica reports English on the CEFR levels A1 to C2, the scale used around the world, with a Spica score from 10 to 90. Here is what each level means in each skill."
        actions={
          <>
            <a className="btn primary" href={app.signUp}>
              Find your level free <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn ghost" href="/understanding-your-score">
              Understanding your score
            </Link>
          </>
        }
        visual={<LevelScale />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Six levels</p>
            <h2>From beginner to proficient</h2>
            <p className="muted">Open a level to see what someone at that level can do in speaking, listening, reading and writing.</p>
          </div>
          <div className="test-grid">
            {LEVELS.map((l, i) => (
              <Link key={l.slug} href={`/levels/${l.slug}`} className="tcard" data-reveal style={{ ["--i" as string]: i % 3 }}>
                <div className="tcard-top">
                  <span className="tcard-icon level-badge">{l.code}</span>
                  <span className="tcard-time">Spica {l.range}</span>
                </div>
                <h3>
                  {l.code} · {l.name}
                </h3>
                <p className="muted">{l.summary}</p>
                <span className="tcard-more">
                  See {l.code} in each skill <ArrowRight size={16} aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Below A1</p>
            <h2>Just starting out (Spica {BELOW_A1.range})</h2>
          </div>
          <div className="icon-cards">
            {(
              [
                [Mic, "Speaking", BELOW_A1.speaking],
                [Headphones, "Listening", BELOW_A1.listening],
                [BookOpen, "Reading", BELOW_A1.reading],
                [PenLine, "Writing", BELOW_A1.writing],
              ] as [React.ElementType, string, string][]
            ).map(([I, h, t], i) => (
              <div key={h} className="icard" data-reveal style={{ ["--i" as string]: i }}>
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
