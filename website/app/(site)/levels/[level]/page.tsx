import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, Briefcase, BookOpen, Headphones, Layers, Mic, PenLine, TrendingUp } from "lucide-react";
import { AT_WORK } from "@/lib/levelExtras";
import { money } from "@/lib/prices";
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
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">
              <Briefcase size={14} /> At work
            </p>
            <h2>What {l.code} looks like at work</h2>
            <ul className="ticks">
              {(AT_WORK[l.code] ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="card" data-reveal>
            <p className="eyebrow">
              <BadgeCheck size={14} /> Prove it
            </p>
            <h3>The {l.code} Level Test</h3>
            <dl className="lv-facts">
              <div>
                <dt>Questions</dt>
                <dd>About 28, all at {l.code}</dd>
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
                <dt>Price</dt>
                <dd>
                  {money("level", "INR")} / {money("level", "USD")}
                </dd>
              </div>
            </dl>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              A passed or not-passed result with a score report; you can retake it after 7 days. For a certificate, take one of the full tests: every
              test reports levels from A1 to C2.
            </p>
            <div className="actions">
              <a className="btn primary small" href={app.signUp}>
                Take the {l.code} Level Test
              </a>
              <Link className="btn ghost small" href="/tests">
                Compare the tests
              </Link>
            </div>
          </div>
        </div>
      </section>

      {next && (
        <section className="section">
          <div className="wrap">
            <div className="sec-head" data-reveal>
              <p className="eyebrow">
                <TrendingUp size={14} /> Next step
              </p>
              <h2>
                From {l.code} to {next.code}
              </h2>
              <p className="muted">At {next.code}, a person {next.summary.charAt(0).toLowerCase() + next.summary.slice(1)}</p>
            </div>
            <div className="grid g3 steps">
              {[
                ["Find your weakest skill", "A free placement test shows your level in each skill, so you know where to start."],
                ["Practise with a plan", `Spica sets weekly tasks toward ${next.code}, with Practice Modules for every question type and feedback on every answer.`],
                ["Check you are ready", `Timed mock tests show how close you are; then take the ${next.code} Level Test or a full test to prove it.`],
              ].map(([h, t], k) => (
                <div className="card step" key={h} data-reveal style={{ ["--i" as string]: k }}>
                  <h3>{h}</h3>
                  <p className="muted">{t}</p>
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 20 }}>
              <a className="btn primary" href={app.signUp}>
                Start free <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      )}

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
