"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Clock, ListChecks } from "lucide-react";
import { TESTS } from "@/lib/tests";

const FILTERS = [
  { id: "all", label: "All tests" },
  { id: "work", label: "For work" },
  { id: "hire", label: "For hiring" },
  { id: "place", label: "For placement" },
];
const TAGS: Record<string, string[]> = {
  "english-4-skills-essentials": ["work", "hire"],
  "professional-english": ["work", "hire"],
  "speaking-and-listening": ["hire", "work"],
  writing: ["hire", "work"],
  "english-placement": ["place"],
};
const LEVELS: [string, string][] = [
  ["A1", "Beginner"],
  ["A2", "Elementary"],
  ["B1", "Intermediate"],
  ["B2", "Upper intermediate"],
  ["C1", "Advanced"],
  ["C2", "Proficient"],
];

export function TestsExplorer() {
  const [f, setF] = useState("all");
  const tests = TESTS.filter((t) => t.id !== "level" && (f === "all" || TAGS[t.slug]?.includes(f)));
  return (
    <>
      <div className="h-filters" role="group" aria-label="Filter tests">
        {FILTERS.map((x) => (
          <button key={x.id} aria-pressed={x.id === f} onClick={() => setF(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="h-tests">
        {tests.map((t) => (
          <Link key={t.slug} href={`/tests/${t.slug}`} className="h-test">
            <div className="h-test-meta">
              <span>
                <Clock size={14} /> {t.minutes.replace("About ", "")}
              </span>
              <span>
                <ListChecks size={14} /> {t.questions} questions
              </span>
            </div>
            <h3>{t.name}</h3>
            <p>{t.short}</p>
            <div className="h-skills">
              {(["Speaking", "Listening", "Reading", "Writing"] as const).map((s) => (
                <span key={s} className={t.skills.includes(s) ? "on" : ""}>
                  {s}
                </span>
              ))}
            </div>
            <span className="h-link">
              Explore the test <ArrowRight size={15} />
            </span>
          </Link>
        ))}
      </div>
      <div className="h-levels">
        <div className="h-levels-copy">
          <h3>Level tests, one for every level</h3>
          <p>28 questions, all at the chosen level. A clear passed or not passed, with results for each skill. To pass: 70% overall and at least 50% in every skill.</p>
          <Link href="/tests/level-tests" className="h-link">
            How level tests work <ArrowRight size={15} />
          </Link>
        </div>
        <div className="h-level-cards">
          {LEVELS.map(([c, n], i) => (
            <Link key={c} href="/tests/level-tests" className="h-level" style={{ ["--i" as string]: i }}>
              <b>{c}</b>
              <small>{n}</small>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
