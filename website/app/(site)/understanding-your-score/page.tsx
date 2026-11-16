import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BarChart3, Gauge, Layers, ListChecks, Medal, Target, TrendingUp } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { MockFrame } from "@/components/page/Visuals";
import { ReportMock } from "@/components/home/Mocks";
import { LEVELS } from "@/lib/levels";

export const metadata: Metadata = {
  title: "Understanding your score",
  description: "How to read a Spica score report: the Spica score, CEFR levels, a level for each skill, detailed scores, your goal and what to work on next.",
};

const PARTS: [React.ElementType, string, string][] = [
  [Gauge, "Spica score and CEFR level", "Your overall result: a Spica score from 10 to 90 and the CEFR level it stands for."],
  [Layers, "A level for each skill", "Speaking, listening, reading and writing each get their own level, for the skills the test measures."],
  [BarChart3, "Detailed scores", "Listening and reading comprehension, fluency, pronunciation, grammar, vocabulary, and spelling and punctuation."],
  [Target, "Your goal", "If you or your organisation set a goal, each skill shows whether it is above, meets or is below that goal."],
  [TrendingUp, "What to work on next", "Practice tips for the question types where you lost the most marks."],
  [ListChecks, "Your answers", "How many answers were right for each type of question."],
  [Medal, "Certificate", "After a real test, a certificate with a code and QR code that anyone can check."],
];

export default function UnderstandingScorePage() {
  return (
    <>
      <PageHero
        crumbs={[{ href: "/levels", label: "English levels" }, { label: "Understanding your score" }]}
        eyebrow="Score reports"
        icon={<BarChart3 size={16} />}
        title={
          <>
            Understanding your <span className="ph-accent">Spica score</span>
          </>
        }
        lead="Every Spica test ends in a score report. Here is what each part means."
        actions={
          <>
            <Link className="btn primary" href="/demo">
              See sample reports <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link className="btn ghost" href="/levels">
              English levels
            </Link>
          </>
        }
        visual={
          <MockFrame>
            <ReportMock />
          </MockFrame>
        }
      />
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">The report, part by part</p>
            <h2>What you will see</h2>
          </div>
          <div className="grid g3">
            {PARTS.map(([I, h, t], i) => (
              <div key={h} className="card icard" data-reveal style={{ ["--i" as string]: i % 3 }}>
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
        <div className="wrap split">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">The Spica scale</p>
            <h2>Which score means which level</h2>
            <p className="muted">
              The same scale is used for every Spica test, so results from different tests can be compared. A score from 10 to 19 is below A1.
            </p>
          </div>
          <div className="table-wrap" data-reveal>
            <table className="t">
              <thead>
                <tr>
                  <th>Spica score</th>
                  <th>CEFR level</th>
                  <th>In short</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map((l) => (
                  <tr key={l.code}>
                    <td>
                      <b>{l.range}</b>
                    </td>
                    <td>
                      <Link href={`/levels/${l.slug}`}>
                        {l.code} · {l.name}
                      </Link>
                    </td>
                    <td>{l.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="wrap">
          <div className="sec-head" data-reveal>
            <p className="eyebrow">Good to know</p>
            <h2>A few things about scores</h2>
          </div>
          <ul className="ticks" style={{ maxWidth: 820 }}>
            <li>If some answers are still being scored, the report says so. Check back a little later.</li>
            <li>You see your scores, but not the questions or the correct answers of a real test.</li>
            <li>You can ask once for each result for a person to review it.</li>
            <li>
              Spica scores are Spica&apos;s own measure of English. They are not an official result of any other exam board and are not designed for
              immigration, visa or university admission decisions that require a specific approved test.
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
