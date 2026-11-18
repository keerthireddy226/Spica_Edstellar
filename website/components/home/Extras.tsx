"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";
import { LEVELS } from "@/lib/levels";
import { money } from "@/lib/prices";
import { app } from "@/lib/site";

// Home sections added from the reference design (17 Nov 2026): the learner's
// journey, the CEFR scale explorer with level-test facts, and why teams choose Spica.

const STEPS: [string, string][] = [
  ["Find your level", "A placement test places you on the CEFR scale, from A1 to C2, with a level for each skill."],
  ["Get a study plan", "Spica sets weekly tasks toward your goal level and date."],
  ["Practise every skill", "Practice Modules and practice tests for speaking, listening, reading and writing, with feedback on every answer."],
  ["Take mock tests", "Timed like the real test, so you know how ready you are before it counts."],
  ["Take the proctored test", "Online, with camera, ID and face checks, or a manual check by a person."],
  ["Get your certificate", "With a QR code, a public check page and Add to LinkedIn."],
];

export function Journey() {
  return (
    <ol className="h-journey">
      {STEPS.map(([h, d], i) => (
        <li key={h} data-reveal style={{ ["--i" as string]: i }}>
          <span className="h-journey-num">{i + 1}</span>
          <b>{h}</b>
          <small>{d}</small>
        </li>
      ))}
    </ol>
  );
}

const BANDS: [string, string[]][] = [
  ["Basic user", ["A1", "A2"]],
  ["Independent user", ["B1", "B2"]],
  ["Proficient user", ["C1", "C2"]],
];

export function CefrExplorer() {
  const [code, setCode] = useState("B2");
  const l = LEVELS.find((x) => x.code === code)!;
  return (
    <div className="h-cefr">
      <div className="h-cefr-pick">
        {BANDS.map(([band, codes]) => (
          <div key={band} className="h-cefr-band">
            <small>{band}</small>
            <div>
              {codes.map((c) => (
                <button key={c} type="button" aria-pressed={c === code} onClick={() => setCode(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="h-cefr-card" key={l.code}>
        <div className="h-cefr-top">
          <b>{l.code}</b>
          <span>
            {l.name} · Spica {l.range}
          </span>
        </div>
        <p>{l.summary}</p>
        <ul>
          <li>
            <b>Speaking:</b> {l.speaking}
          </li>
          <li>
            <b>Listening:</b> {l.listening}
          </li>
          <li>
            <b>Reading:</b> {l.reading}
          </li>
          <li>
            <b>Writing:</b> {l.writing}
          </li>
        </ul>
        <Link href={`/levels/${l.slug}`} className="h-link">
          More about {l.code} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

const ROWS: [string, string, string][] = [
  ["Lessons, practice and a personal study plan", "Rarely", "Yes"],
  ["Proctored test with ID, face and voice checks", "Varies", "Rarely"],
  ["Certificate anyone can check online", "Varies", "Rarely"],
  ["Separate questions for practice, mock and real tests", "Varies", "Not applicable"],
  ["Tools for HR teams, recruiters and colleges", "Varies", "Rarely"],
  ["Training partner behind the platform", "Rarely", "Rarely"],
];

export function WhyCompare() {
  const cell = (v: string) =>
    v === "Yes" ? (
      <span className="h-yes">
        <Check size={16} aria-hidden="true" /> Yes
      </span>
    ) : (
      <span className="h-meh">
        <Minus size={14} aria-hidden="true" /> {v}
      </span>
    );
  return (
    <div className="h-why">
      <table>
        <thead>
          <tr>
            <th>What you get</th>
            <th>Typical test-only platform</th>
            <th>Typical learning-only app</th>
            <th className="h-why-us">Spica</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([what, test, learn], i) => (
            <tr key={what}>
              <td>{what}</td>
              <td>{cell(test)}</td>
              <td>{cell(learn)}</td>
              <td className="h-why-us">
                {i === ROWS.length - 1 ? (
                  <span className="h-yes">
                    <Check size={16} aria-hidden="true" /> Edstellar
                  </span>
                ) : (
                  cell("Yes")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="h-why-note">A general comparison of typical product categories, not of named products.</p>
    </div>
  );
}

// Ways to a result: a direct certificate, preparation then certificate, Full access, or a level test.
export function Routes() {
  const R = [
    { tag: "Certificate now", title: "Take the real test", price: `from ${money("assessment:placement", "INR")} / ${money("assessment:placement", "USD")}`, text: "Already confident? Take one proctored test now and get your score report and certificate. A free sample first.", cert: true },
    { tag: "Prepare, then certify", title: "Preparation + real test", price: `from ${money("prep:placement", "INR")} / ${money("prep:placement", "USD")}`, text: "30 days of practice and mock tests for one test, then the real test with a certificate.", cert: true, featured: true },
    { tag: "Everything", title: "Full access", price: `${money("full", "INR")} / ${money("full", "USD")} a month`, text: "Every test, unlimited practice tests, 2 mock tests a month in each test, and one final assessment with a certificate.", cert: true },
    { tag: "One level", title: "Level test (A1–C2)", price: `${money("level", "INR")} / ${money("level", "USD")}`, text: "Check one level at a time: a passed or not-passed result with a score report.", cert: false },
  ];
  return (
    <div className="h-routes">
      {R.map((r) => (
        <a key={r.title} href={app.signUp} className={`h-route${r.featured ? " feat" : ""}`} data-reveal>
          <span className="h-route-tag">{r.tag}</span>
          <b>{r.title}</b>
          <small>{r.text}</small>
          <span className="h-route-foot">
            <em>{r.price}</em>
            <span className={r.cert ? "yes" : "no"}>{r.cert ? <><Check size={14} aria-hidden="true" /> Certificate</> : "Score report"}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
