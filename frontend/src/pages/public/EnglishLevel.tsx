import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowRight, Award, BookOpen, ClipboardCheck, Dumbbell, Headphones, Mic, PenLine } from "lucide-react";
import { BANDS, CAN_DO } from "@/components/report/ScoreReport";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// Public pages, one per CEFR level: what the level means, how Spica helps
// reach it and how the final assessment proves it. Open without an account,
// so people searching for "B2 English" find Spica and start a free level check.

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
type Level = (typeof LEVELS)[number];
const SKILLS = ["speaking", "listening", "reading", "writing"] as const;

const NAME: Record<Level, () => string> = {
  A1: () => tr("Beginner"),
  A2: () => tr("Elementary"),
  B1: () => tr("Intermediate"),
  B2: () => tr("Upper intermediate"),
  C1: () => tr("Advanced"),
  C2: () => tr("Proficient"),
};
const SKILL_ICON = { speaking: Mic, listening: Headphones, reading: BookOpen, writing: PenLine } as const;
const SKILL_NAME: Record<(typeof SKILLS)[number], () => string> = {
  speaking: () => tr("Speaking"),
  listening: () => tr("Listening"),
  reading: () => tr("Reading"),
  writing: () => tr("Writing"),
};
const USE: Record<Level, () => string> = {
  A1: () => tr("Enough for simple, slow everyday exchanges."),
  A2: () => tr("Enough for routine tasks and simple messages at work."),
  B1: () => tr("Enough for most everyday and routine work situations."),
  B2: () => tr("The level many employers and universities ask for: working and studying in English."),
  C1: () => tr("For demanding jobs and university study: complex topics, fluently."),
  C2: () => tr("Near-native command, for any professional or academic setting."),
};

function setMeta(title: string, description: string) {
  document.title = title;
  let m = document.querySelector('meta[name="description"]');
  if (!m) {
    m = document.createElement("meta");
    m.setAttribute("name", "description");
    document.head.appendChild(m);
  }
  m.setAttribute("content", description);
}

export function EnglishLevelPage() {
  const { level: raw = "" } = useParams();
  const level = raw.toUpperCase() as Level;
  const valid = (LEVELS as readonly string[]).includes(level);
  const band = BANDS.find((b) => b.level === level);
  useEffect(() => {
    if (valid) setMeta(tr("English level {{level}} ({{name}}): what it means and how to prove it · Spica", { level, name: NAME[level]() }), USE[level]());
  }, [level, valid]);
  if (!valid) return <Navigate to="/english-level" replace />;
  const i = LEVELS.indexOf(level);
  return (
    <div className="app-surface min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Link to="/english-level" className="self-start font-logo font-bold text-2xl text-navy">
            Spica
          </Link>
          <div className="flex items-start gap-5">
            <span className="hidden sm:flex h-20 w-20 shrink-0 rounded-3xl bg-navy text-white font-display font-bold text-3xl items-center justify-center shadow-sm">{level}</span>
            <div className="flex flex-col gap-2 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("CEFR level")}</p>
              <h1 className="font-display font-bold text-3xl sm:text-4xl text-ink leading-tight">{tr("English level {{level}}: {{name}}", { level, name: NAME[level]() })}</h1>
              <p className="text-lg text-muted">{USE[level]()}</p>
            </div>
          </div>
          {band && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm text-ink">{tr("On the Spica score (10–90), {{level}} is {{min}} to {{max}}.", { level, min: band.min, max: band.max })}</p>
              {/* Where this level's band sits on the 10–90 scale. */}
              <div className="relative h-2 rounded-pill bg-rule overflow-hidden max-w-md" aria-hidden="true">
                <span className="absolute inset-y-0 rounded-pill bg-navy" style={{ left: `${((band.min - 10) / 80) * 100}%`, width: `${((band.max - band.min) / 80) * 100}%` }} />
              </div>
            </div>
          )}
        </header>

        <section className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-4">
          <h2 className="font-display font-bold text-lg text-ink">{tr("What you can do at {{level}}", { level })}</h2>
          <ul className="grid sm:grid-cols-2 gap-3">
            {SKILLS.map((s) => {
              const Icon = SKILL_ICON[s];
              return (
                <li key={s} className="flex items-start gap-3 rounded-input bg-paper-warm/60 border border-rule px-4 py-3">
                  <span className="h-8 w-8 rounded-lg bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
                    <Icon size={16} />
                  </span>
                  <span className="text-sm text-ink">
                    <b className="block">{SKILL_NAME[s]()}</b>
                    {CAN_DO[s][level]?.()}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="grid sm:grid-cols-3 gap-3">
          {[
            { icon: ClipboardCheck, title: tr("1. Find your level"), text: tr("A free 30-minute level test across all four skills.") },
            { icon: Dumbbell, title: tr("2. Practise to {{level}}", { level }), text: tr("Practice tests, mock tests and Practice Modules, planned around your goal.") },
            { icon: Award, title: tr("3. Prove it"), text: tr("One strictly proctored final assessment gives your certificate, valid for a year and checkable by anyone.") },
          ].map((c) => (
            <div key={c.title} className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-2">
              <span className="h-10 w-10 rounded-xl bg-navy/10 text-navy-deep flex items-center justify-center mb-1">
                <c.icon size={20} />
              </span>
              <h3 className="font-display font-semibold text-ink">{c.title}</h3>
              <p className="text-sm text-muted">{c.text}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap gap-3">
          <Link to={ROUTES.SIGNUP} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-pill bg-navy text-white text-sm font-semibold shadow-sm hover:opacity-90">
            {tr("Start a free level check")} <ArrowRight size={15} />
          </Link>
          <Link to={ROUTES.LOGIN} className="px-5 py-2.5 rounded-pill border border-rule-strong bg-surface text-ink text-sm font-semibold hover:bg-paper-warm">
            {tr("Log in")}
          </Link>
        </div>

        <nav className="flex flex-wrap gap-2 text-sm" aria-label={tr("Other levels")}>
          {LEVELS.filter((l) => l !== level).map((l) => (
            <Link key={l} to={`/english-level/${l.toLowerCase()}`} className="px-3 py-1 rounded-pill border border-rule bg-surface text-ink hover:bg-paper-warm">
              {l} · {NAME[l]()}
            </Link>
          ))}
        </nav>
        {i >= 0 && <p className="text-xs text-muted">{tr("Spica's tests and certificates are Spica's own. Levels follow the CEFR (Common European Framework of Reference).")}</p>}
      </div>
    </div>
  );
}

// All levels at a glance.
export function EnglishLevelsIndex() {
  useEffect(() => {
    setMeta(tr("English levels A1 to C2 explained · Spica"), tr("What each CEFR English level means, how to reach it and how to prove it with a certificate."));
  }, []);
  return (
    <div className="app-surface min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-6">
        <span className="font-logo font-bold text-2xl text-navy">Spica</span>
        <h1 className="font-display font-bold text-3xl text-ink">{tr("English levels, A1 to C2")}</h1>
        <p className="text-muted">{tr("Find your level for free, practise towards your goal, and prove it with one final assessment and a certificate.")}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {LEVELS.map((l) => (
            <Link key={l} to={`/english-level/${l.toLowerCase()}`} className="group bg-surface border border-rule rounded-card shadow-sm p-4 flex items-start gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
              <span className="h-12 w-12 shrink-0 rounded-2xl bg-navy text-white font-display font-bold text-lg flex items-center justify-center">{l}</span>
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="font-display font-bold text-lg text-ink">{NAME[l]()}</span>
                <span className="text-sm text-muted">{USE[l]()}</span>
              </span>
            </Link>
          ))}
        </div>
        <Link to={ROUTES.SIGNUP} className="self-start inline-flex items-center gap-1.5 px-5 py-2.5 rounded-pill bg-navy text-white text-sm font-semibold shadow-sm hover:opacity-90">
          {tr("Start a free level check")} <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
