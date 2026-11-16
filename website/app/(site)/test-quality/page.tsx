import type { Metadata } from "next";
import Link from "next/link";
import { Clock, FileText, Languages, Layers, RefreshCw, Scale, ShieldCheck, UserCheck } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";
import { JourneyMock } from "@/components/page/Visuals";

export const metadata: Metadata = {
  title: "Test quality and fairness",
  description: "How Spica tests are built and checked: linked to CEFR, the same conditions for everyone, fair marking of accents and spellings, people reviewing flags and scores.",
};

const POINTS: [React.ElementType, string, React.ReactNode][] = [
  [Layers, "Linked to the CEFR", <>Every result is a Spica score from 10 to 90 and a CEFR level, overall and for each skill. See <Link href="/levels">English levels</Link>.</>],
  [Clock, "The same conditions for everyone", "Each question has its own timer, recordings play at most twice, and a question left blank counts as wrong."],
  [Languages, "Fair to every speaker", "Speaking is scored on how clearly you are understood, not on your accent. British, American and Indian spellings are all accepted."],
  [Scale, "Clear rules for each task", "Spoken and written answers are scored against clear rules for each task. Multiple-choice answers are marked by fixed rules."],
  [RefreshCw, "Fresh questions", "Each attempt uses questions you have not seen where possible, and real test questions are never shown afterwards."],
  [ShieldCheck, "Secure and proctored", <>Real tests check identity, camera and screen. See the <Link href="/legal/test-rules">test rules</Link>.</>],
  [UserCheck, "People make the decisions", "A trained person reviews every flagged session, and anyone can ask once for a person to review a result. Nobody is failed automatically."],
  [FileText, "Documented", "Each test has a Test Description and Validation Summary that sets out its parts, scoring rules and how it is checked. Ask us for a copy."],
];

export default function TestQualityPage() {
  return (
    <>
      <PageHero
        crumbs={[{ href: "/help", label: "Resources" }, { label: "Test quality and fairness" }]}
        eyebrow="Test quality"
        icon={<Scale size={16} />}
        title={
          <>
            Built to be <span className="ph-accent">fair and reliable</span>
          </>
        }
        lead="How Spica tests are built, marked and checked, so a result means the same thing for everyone."
        actions={
          <Link className="btn primary" href="/contact?topic=sales">
            Ask for a Test Description
          </Link>
        }
        visual={<JourneyMock />}
      />
      <section className="section">
        <div className="wrap">
          <div className="grid g2">
            {POINTS.map(([I, h, t], i) => (
              <div key={h} className="card icard" data-reveal style={{ ["--i" as string]: i % 2 }}>
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
