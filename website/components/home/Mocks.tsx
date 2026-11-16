import { BadgeCheck, CheckCircle2, Clock, Mic, ScanFace, ShieldCheck, Users } from "lucide-react";

// Product pictures built from HTML, with made-up people and figures.

const SKILLS: [string, number, string][] = [
  ["Speaking", 67, "B2"],
  ["Listening", 72, "C1"],
  ["Reading", 61, "B2"],
  ["Writing", 58, "B2"],
];

export function ScoreDial({ score = 64, level = "B2", size = 132 }: { score?: number; level?: string; size?: number }) {
  const pct = (score - 10) / 80;
  return (
    <div className="h-dial" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" className="h-dial-track" />
        <circle cx="60" cy="60" r="52" className="h-dial-val" pathLength={1} style={{ strokeDasharray: `${pct} 1` }} />
      </svg>
      <div>
        <b>{level}</b>
        <small>Spica {score}</small>
      </div>
    </div>
  );
}

export function ReportMock() {
  return (
    <div className="h-mock h-report" aria-label="Sample score report with made-up results">
      <div className="h-mock-head">
        <span className="h-avatar">PR</span>
        <div>
          <b>Priya Raman</b>
          <small>English 4 Skills Essentials · Real test</small>
        </div>
        <span className="h-chip ok">
          <BadgeCheck size={14} /> Certified
        </span>
      </div>
      <div className="h-report-body">
        <ScoreDial score={64} level="B2" />
        <div className="h-bars">
          {SKILLS.map(([s, v, l]) => (
            <div key={s} className="h-bar">
              <span>{s}</span>
              <span className="h-track">
                <i style={{ width: `${((v - 10) / 80) * 100}%` }} />
              </span>
              <b>{v}</b>
              <em>{l}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="h-report-foot">
        <div>
          <small>Strongest</small>
          <b>Listening</b>
        </div>
        <div>
          <small>Work on next</small>
          <b>Writing accuracy</b>
        </div>
        <div>
          <small>Answered</small>
          <b>68 of 70</b>
        </div>
      </div>
    </div>
  );
}

export function FloatChips() {
  return (
    <>
      <div className="h-float h-f1">
        <ScanFace size={18} />
        <div>
          <b>Identity confirmed</b>
          <small>ID and face check</small>
        </div>
      </div>
      <div className="h-float h-f2">
        <ShieldCheck size={18} />
        <div>
          <b>Certificate valid</b>
          <small>Checked by an employer</small>
        </div>
      </div>
    </>
  );
}

export function CandidatesMock() {
  const rows: [string, string, string, string][] = [
    ["AK", "Arjun Kumar", "B2", "ok"],
    ["ML", "Mei Lin", "C1", "ok"],
    ["DO", "Daniel Okafor", "B1", "warn"],
    ["SR", "Sofia Rossi", "B2", "ok"],
  ];
  return (
    <div className="h-mock">
      <div className="h-mock-title">
        <Users size={16} /> Customer support associate <span className="h-chip">Minimum B2</span>
      </div>
      {rows.map(([i, n, l, s]) => (
        <div className="h-row" key={n}>
          <span className="h-avatar sm">{i}</span>
          <span className="h-row-name">
            {n}
            <small>Speaking &amp; Listening · 17 min</small>
          </span>
          <b>{l}</b>
          <span className={`h-chip ${s}`}>{s === "ok" ? "Meets minimum" : "Below minimum"}</span>
        </div>
      ))}
    </div>
  );
}

export function TeamMock() {
  const teams: [string, number, number][] = [
    ["Support, Chennai", 82, 12],
    ["Sales, Bengaluru", 64, 9],
    ["New joiners", 41, 15],
  ];
  return (
    <div className="h-mock">
      <div className="h-mock-title">
        <Users size={16} /> Progress to B2 by team
      </div>
      {teams.map(([t, p, n]) => (
        <div className="h-team" key={t}>
          <div>
            <b>{t}</b>
            <small>{n} learners</small>
          </div>
          <span className="h-track wide">
            <i style={{ width: `${p}%` }} />
          </span>
          <b>{p}%</b>
        </div>
      ))}
      <div className="h-note">
        <Clock size={14} /> 3 learners haven&apos;t practised this week · <u>Send reminder</u>
      </div>
    </div>
  );
}

export function PracticeMock() {
  return (
    <div className="h-mock">
      <div className="h-mock-title">
        <Mic size={16} /> Practice · Repeats · B1
      </div>
      <div className="h-wave" aria-hidden="true">
        {Array.from({ length: 32 }, (_, i) => (
          <i key={i} style={{ height: `${18 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <p className="h-quote">“She asked if I could help her move the boxes after lunch.”</p>
      <div className="h-feedback">
        <CheckCircle2 size={16} /> Every word right. Pace natural. Try linking “help her” more smoothly.
      </div>
    </div>
  );
}

export function CertificateMock() {
  return (
    <div className="h-mock h-cert">
      <div className="h-cert-top">
        <b>Spica</b>
        <small>Certificate of English level</small>
      </div>
      <div className="h-cert-name">Priya Raman</div>
      <div className="h-cert-row">
        <ScoreDial score={64} level="B2" size={92} />
        <ul>
          <li>
            <CheckCircle2 size={14} /> Proctored real test
          </li>
          <li>
            <CheckCircle2 size={14} /> Identity verified
          </li>
          <li>
            <CheckCircle2 size={14} /> Valid until Jan 2028
          </li>
        </ul>
      </div>
      <div className="h-cert-code">Sample certificate · code SAMPLE</div>
    </div>
  );
}
