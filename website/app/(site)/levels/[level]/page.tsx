import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Headphones, Layers, Mic, PenLine } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { LEVELS } from "@/lib/levels";
import { app } from "@/lib/site";
import { LevelScale } from "@/components/page/LevelScale";

export function generateStaticParams() {
  return LEVELS.map((l) => ({ level: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ level: string }> }): Promise<Metadata> {
  const { level } = await params;
  const l = LEVELS.find((x) => x.slug === level);
  return l ? { title: `${l.code} English level (${l.name})`, description: `What ${l.code} English means in speaking, listening, reading and writing. ${l.summary}` } : {};
}

export default async function LevelPage({ params }: { params: Promise<{ level: string }> }) {
  const { level } = await params;
  const i = LEVELS.findIndex((x) => x.slug === level);
  if (i < 0) notFound();
  const l = LEVELS[i];
  const prev = LEVELS[i - 1];
  const next = LEVELS[i + 1];
  const skills: [React.ElementType, string, string][] = [
    [Mic, "Speaking", l.speaking],
    [Headphones, "Listening", l.listening],
    [BookOpen, "Reading", l.reading],
    [PenLine, "Writing", l.writing],
  ];
  return (
    <>
      <PageHero
        crumbs={[{ href: "/levels", label: "English levels" }, { label: l.code }]}
        eyebrow={`Spica score ${l.range}`}
        icon={<Layers size={16} />}
        title={
          <>
            {l.code} English: <span className="ph-accent">{l.name}</span>
          </>
        }
        lead={l.summary}
        actions={
          <>
            <a className="btn primary" href={app.signUp}>
              Find your level free <ArrowRight size={17} aria-hidden="true" />
            </a>
            <Link className="btn ghost" href="/tests/level-tests">
              Take the {l.code} Level Test
            </Link>
          </>
        }
        visual={<LevelScale active={l.code} />}
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Skill by skill</p>
            <h2>At {l.code}, you can…</h2>
          </div>
          <div className="icon-cards">
            {skills.map(([I, h, t], k) => (
              <div key={h} className="icard" data-reveal style={{ ["--i" as string]: k }}>
                <span className="icard-icon">
                  <I size={20} />
                </span>
                <h3>{h}</h3>
                <p className="muted">{t}</p>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 20, fontSize: "0.92rem" }}>
            People often have different levels in different skills. A Spica score report shows a level for each skill.
          </p>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap level-nav">
          {prev ? (
            <Link href={`/levels/${prev.slug}`} className="tcard">
              <span className="tcard-more">
                <ArrowLeft size={16} aria-hidden="true" /> {prev.code} · {prev.name}
              </span>
              <p className="muted">{prev.summary}</p>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/levels/${next.slug}`} className="tcard">
              <span className="tcard-more">
                {next.code} · {next.name} <ArrowRight size={16} aria-hidden="true" />
              </span>
              <p className="muted">{next.summary}</p>
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
