"use client";

import { useEffect, useRef, useState } from "react";
import { Award, BarChart3, BookOpen, Briefcase } from "lucide-react";
import { CandidatesMock, CertificateMock, PracticeMock, TeamMock } from "./Mocks";

const TABS = [
  {
    id: "assess",
    icon: BarChart3,
    title: "Assess",
    lead: "Know every person's level in about 30 minutes.",
    points: ["Six tests on one 10–90 scale, with CEFR levels A1–C2", "A level for each of the four skills", "Results in minutes, with a full score report"],
    mock: "team",
  },
  {
    id: "train",
    icon: BookOpen,
    title: "Train",
    lead: "A study plan for each level, with feedback on every answer.",
    points: ["Practice Modules for every question type", "Practice tests you can pause, timed mock tests", "Progress by person and by team"],
    mock: "practice",
  },
  {
    id: "certify",
    icon: Award,
    title: "Certify",
    lead: "A proctored final test and a certificate anyone can check.",
    points: ["ID, camera and screen checks, reviewed by people", "Certificate with a code and QR code", "Add it to LinkedIn, share it, or extend it"],
    mock: "cert",
  },
  {
    id: "hire",
    icon: Briefcase,
    title: "Hire",
    lead: "Test applicants' English before you spend time interviewing.",
    points: ["Job openings with a minimum level", "Email invitations or a public job link", "Reports, interview questions and decisions in one place"],
    mock: "candidates",
  },
];

// On a large screen the block stays in place while the page scrolls, and the
// four parts (Assess, Train, Certify, Hire) take turns as the reader scrolls
// down. Phones, small windows and reduced motion keep plain tabs.
const PIN_TOP = 110;
const pinned = () =>
  window.matchMedia("(min-width: 1021px) and (min-height: 760px)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Platform() {
  const [tab, setTab] = useState("assess");
  const t = TABS.find((x) => x.id === tab)!;
  const outer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = outer.current;
        if (!el || !pinned()) return;
        const r = el.getBoundingClientRect();
        const total = r.height - (window.innerHeight - PIN_TOP);
        if (total <= 0) return;
        const p = Math.min(0.9999, Math.max(0, (PIN_TOP - r.top) / total));
        setTab(TABS[Math.floor(p * TABS.length)].id);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // Choosing a part scrolls to its place, so scrolling on carries on from there.
  function choose(id: string) {
    setTab(id);
    const el = outer.current;
    if (!el || !pinned()) return;
    const r = el.getBoundingClientRect();
    const total = r.height - (window.innerHeight - PIN_TOP);
    const i = TABS.findIndex((x) => x.id === id);
    window.scrollTo({ top: window.scrollY + r.top - PIN_TOP + ((i + 0.5) / TABS.length) * total, behavior: "smooth" });
  }

  return (
    <div className="h-scrolly" ref={outer}>
    <div className="h-scrolly-pin">
    <div className="h-platform">
      <div className="h-tablist" role="tablist" aria-label="What Spica does">
        {TABS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} role="tab" aria-selected={x.id === tab} aria-controls={`panel-${x.id}`} id={`tab-${x.id}`} onClick={() => choose(x.id)} className="h-tab">
              <span className="h-tab-icon">
                <Icon size={20} />
              </span>
              <span>
                <b>{x.title}</b>
                <small>{x.lead}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-panel" role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} key={t.id}>
        <div className="h-panel-copy">
          <h3>{t.lead}</h3>
          <ul className="h-checks">
            {t.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <div className="h-panel-mock">
          {t.mock === "team" && <TeamMock />}
          {t.mock === "practice" && <PracticeMock />}
          {t.mock === "cert" && <CertificateMock />}
          {t.mock === "candidates" && <CandidatesMock />}
        </div>
      </div>
    </div>
    </div>
    </div>
  );
}
