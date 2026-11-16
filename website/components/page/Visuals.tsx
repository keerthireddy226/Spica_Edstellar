import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  KeyRound,
  ListChecks,
  Lock,
  MonitorUp,
  ScanFace,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { LICENCE_BANDS, money } from "@/lib/prices";
import type { TestInfo } from "@/lib/tests";
import { SKILL_ICON } from "./looks";

// Pictures for the right-hand side of page heroes. Built from HTML; any
// people or figures shown are labelled as examples.

// Wraps a Home page mock so its styles (scoped to .h) apply.
export function MockFrame({ children }: { children: React.ReactNode }) {
  return <div className="h ph-mock">{children}</div>;
}

export function TestFacts({ t }: { t: TestInfo }) {
  const isLevel = t.id === "level";
  return (
    <div className="vcard">
      <div className="vcard-head">
        <b>{t.name}</b>
        <span className="vchip">
          <Clock size={13} /> {t.minutes}
        </span>
      </div>
      <div className="facts">
        <div>
          <small>Questions</small>
          <b>{t.questions}</b>
        </div>
        <div>
          <small>Parts</small>
          <b>{t.parts.length}</b>
        </div>
        <div>
          <small>{isLevel ? "Level test" : "Real test"}</small>
          <b>{money(t.priceKey, "INR")}</b>
          <small>{money(t.priceKey, "USD")}</small>
        </div>
        <div>
          <small>Organisations</small>
          <b>{t.credits}</b>
          <small>credit{t.credits > 1 ? "s" : ""} per person</small>
        </div>
      </div>
      <div className="vskills">
        {t.skills.map((s) => {
          const I = SKILL_ICON[s];
          return (
            <span key={s}>
              <I size={15} /> {s}
            </span>
          );
        })}
      </div>
      <div className="vfoot">
        <CheckCircle2 size={15} /> {isLevel ? "Passed or not passed at the chosen level" : "Score report and certificate with a QR code"}
      </div>
    </div>
  );
}

export function PriceMock() {
  const lowest = Math.min(...LICENCE_BANDS.map((b) => b.usd));
  return (
    <div className="vstack">
      <div className="vcard">
        <div className="vcard-head">
          <b>Full access</b>
          <span className="vchip">
            <Sparkles size={13} /> Most complete
          </span>
        </div>
        <div className="vprice">
          {money("full", "INR")} <small>a month · {money("full", "USD")}</small>
        </div>
        <ul className="vlist">
          <li>
            <CheckCircle2 size={15} /> All five main tests and every Practice Module
          </li>
          <li>
            <CheckCircle2 size={15} /> 2 mock tests a month in each test
          </li>
          <li>
            <CheckCircle2 size={15} /> One final assessment with a certificate
          </li>
        </ul>
        <div className="vfoot">
          <Clock size={15} /> One month at a time. Nothing renews by surprise.
        </div>
      </div>
      <div className="vcard vmini">
        <b>Free</b>
        <span>A placement test and practice every week</span>
      </div>
      <div className="vcard vmini alt">
        <b>Organisations</b>
        <span>From US${lowest} per learner-month</span>
      </div>
    </div>
  );
}

export function SecurityMock() {
  const checks: [React.ElementType, string, string][] = [
    [UserCheck, "Identity", "ID check before the test"],
    [ScanFace, "Face", "Camera checks during the test"],
    [MonitorUp, "Screen", "Screen sharing for proctored tests"],
    [Eye, "People", "Every flag reviewed by a person"],
  ];
  return (
    <div className="vstack">
      <div className="vcard">
        <div className="vcard-head">
          <b>Proctored final assessment</b>
          <span className="vchip ok">
            <ShieldCheck size={13} /> Protected
          </span>
        </div>
        <ul className="vchecks">
          {checks.map(([I, h, t]) => (
            <li key={h}>
              <span>
                <I size={17} />
              </span>
              <div>
                <b>{h}</b>
                <small>{t}</small>
              </div>
              <CheckCircle2 size={17} className="vok" />
            </li>
          ))}
        </ul>
      </div>
      <div className="vrow">
        <div className="vcard vmini">
          <Lock size={17} />
          <span>Encrypted in transit and at rest</span>
        </div>
        <div className="vcard vmini">
          <KeyRound size={17} />
          <span>Two-step sign-in for staff</span>
        </div>
      </div>
    </div>
  );
}

export function AudienceTiles({ items }: { items: { label: string; icon: React.ElementType; tone: string }[] }) {
  return (
    <div className="tiles">
      {items.map((a, i) => {
        const I = a.icon;
        return (
          <div key={a.label} className={`tile tone-${a.tone}`} style={{ ["--i" as string]: i }}>
            <span>
              <I size={22} />
            </span>
            <b>{a.label}</b>
          </div>
        );
      })}
      <div className="tile tile-scale">
        <b>One scale</b>
        <small>10–90 · CEFR A1–C2</small>
      </div>
    </div>
  );
}

export function JourneyMock() {
  const steps: [React.ElementType, string, string][] = [
    [ListChecks, "Know", "A level for each skill from one placement test"],
    [TrendingUp, "Improve", "A study plan for that level, with feedback on every answer"],
    [BadgeCheck, "Prove", "A proctored final assessment and a certificate anyone can check"],
  ];
  return (
    <div className="journey">
      {steps.map(([I, h, t], i) => (
        <div key={h} className="vcard jstep" style={{ ["--i" as string]: i }}>
          <span className="jnum">{i + 1}</span>
          <span className="jicon">
            <I size={20} />
          </span>
          <div>
            <b>{h}</b>
            <small>{t}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DocMock({ lines }: { lines: string[] }) {
  return (
    <div className="vcard vdoc">
      <div className="vcard-head">
        <b>
          <FileCheck2 size={16} /> Documents
        </b>
      </div>
      <ul className="vlist">
        {lines.map((l) => (
          <li key={l}>
            <CheckCircle2 size={15} /> {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConnectMock({ items }: { items: string[] }) {
  return (
    <div className="connect">
      <div className="connect-hub">
        <b>Spica</b>
        <small>Enterprise</small>
      </div>
      <div className="connect-grid">
        {items.map((x, i) => (
          <span key={x} className="vchip" style={{ ["--i" as string]: i }}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}
