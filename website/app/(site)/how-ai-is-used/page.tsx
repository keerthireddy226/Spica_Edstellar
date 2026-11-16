import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Bot, CheckCircle2, Fingerprint, Lock, MessageSquareText, UserCheck } from "lucide-react";
import { PageHero } from "@/components/page/PageHero";

export const metadata: Metadata = {
  title: "How AI is used",
  description: "What AI does in Spica, what it never decides, how people check its work, and what happens to your data.",
};

const DOES: [React.ElementType, string, string][] = [
  [Bot, "Scores spoken and written answers", "AI turns spoken answers into text and scores spoken and written answers against clear rules for each task."],
  [MessageSquareText, "Writes feedback", "In practice, AI explains what went well and what to improve in each answer."],
];
const NEVER: [React.ElementType, string, string][] = [
  [Ban, "Fails anyone automatically", "Nothing fails you automatically. Proctoring flags are reviewed by a trained person."],
  [CheckCircle2, "Marks multiple-choice answers", "Multiple-choice answers are marked by fixed rules, not by AI."],
];

export default function HowAiIsUsedPage() {
  return (
    <>
      <PageHero
        crumbs={[{ href: "/help", label: "Resources" }, { label: "How AI is used" }]}
        eyebrow="AI at Spica"
        icon={<Bot size={16} />}
        title={
          <>
            AI scores. <span className="ph-accent">People decide.</span>
          </>
        }
        lead="Spica uses AI to score answers quickly and consistently. Here is what it does, what it never decides, and how people check its work."
      />
      <section className="section">
        <div className="wrap grid g2">
          <div data-reveal>
            <p className="eyebrow">What AI does</p>
            <div className="ai-list">
              {DOES.map(([I, h, t]) => (
                <div key={h} className="card icard">
                  <span className="icard-icon">
                    <I size={20} />
                  </span>
                  <h3>{h}</h3>
                  <p className="muted">{t}</p>
                </div>
              ))}
            </div>
          </div>
          <div data-reveal>
            <p className="eyebrow">What AI does not do</p>
            <div className="ai-list">
              {NEVER.map(([I, h, t]) => (
                <div key={h} className="card icard">
                  <span className="icard-icon">
                    <I size={20} />
                  </span>
                  <h3>{h}</h3>
                  <p className="muted">{t}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap grid g3">
          <div className="card icard" data-reveal>
            <span className="icard-icon">
              <UserCheck size={20} />
            </span>
            <h3>People check the work</h3>
            <p className="muted">AI can make mistakes. Scores are checked by people when something looks unusual, and anyone can ask once for a person to review a result.</p>
          </div>
          <div className="card icard" data-reveal style={{ ["--i" as string]: 1 }}>
            <span className="icard-icon">
              <Fingerprint size={20} />
            </span>
            <h3>Face and voice matching by choice</h3>
            <p className="muted">Face and voice matching are used only with separate consent and run on Spica&apos;s own servers. Anyone can choose a manual identity check instead.</p>
          </div>
          <div className="card icard" data-reveal style={{ ["--i" as string]: 2 }}>
            <span className="icard-icon">
              <Lock size={20} />
            </span>
            <h3>Your data stays yours</h3>
            <p className="muted">
              Your answers and recordings are never sold or used to train AI models. See <Link href="/security">Security and trust</Link>.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
