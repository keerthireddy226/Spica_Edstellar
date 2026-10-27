import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Check,
  CheckCircle2,
  ClipboardList,
  Flag,
  Gauge,
  Headphones,
  Layers,
  Mic,
  PenLine,
  RotateCcw,
  Target,
  Timer,
} from "lucide-react";
import type { Journey, JourneyTask } from "@/api/roadmap";
import { CALENDAR_FILE_URL, emailTestDates } from "@/api/certificates";
import type { SkillTag } from "@/api/testSession";
import { SKILL_RING_COLOR } from "@/lib/skillTints";
import { formatShortDate } from "@/api/licenses";
import { ROUTES } from "@/constants/routes";
import { useReadiness } from "@/components/learner/useReadiness";
import { usePrepPrices } from "@/components/plans/usePrepPrices";
import { tr } from "@/i18n/tr";

const ICONS: Record<SkillTag, typeof Headphones> = { listening: Headphones, speaking: Mic, reading: BookOpen, writing: PenLine };

export const PACE: Record<Journey["pace"], { label: () => string; cls: string }> = {
  new: { label: () => tr("Just started"), cls: "bg-white/20 text-white" },
  on_track: { label: () => tr("On track"), cls: "bg-success text-white" },
  slightly_behind: { label: () => tr("Slightly behind"), cls: "bg-warning text-white" },
  behind: { label: () => tr("Behind plan"), cls: "bg-error text-white" },
};

// The top of the page: level now to goal, days to the exam, pace, and real
// progress (levels gained and sets passed, not days gone by).
export function JourneyHero({ j, firstName }: { j: Journey; firstName: string }) {
  const pace = PACE[j.pace];
  return (
    <section className="rounded-card text-white p-6 sm:p-8 shadow-sm relative overflow-hidden" style={{ background: "linear-gradient(135deg, var(--color-navy-deep), var(--color-navy))" }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">{tr("My journey")}</p>
      <h1 className="font-display font-bold text-3xl mt-1">
        {j.goalReached ? tr("You've reached {{goal}}, {{name}}", { goal: j.goal ?? "", name: firstName }) : tr("{{from}} → {{to}}", { from: j.current ?? "—", to: j.goal ?? "—" })}
      </h1>
      <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
        {j.daysLeft !== null && (
          <span className="flex items-center gap-1.5 bg-white/15 rounded-pill px-3 py-1">
            <CalendarDays size={14} /> {j.daysLeft === 1 ? tr("1 day to your exam") : tr("{{n}} days to your exam", { n: j.daysLeft })}
          </span>
        )}
        {!j.goalReached && <span className={`rounded-pill px-3 py-1 text-xs font-semibold ${pace.cls}`}>{pace.label()}</span>}
        {j.minutesPerDay && <span className="text-white/80">{tr("{{n}} min a day", { n: j.minutesPerDay })}</span>}
      </div>
      <div className="mt-5 flex flex-col gap-1.5 max-w-xl">
        <div className="flex justify-between text-xs text-white/80">
          <span>{tr("Progress to {{goal}}", { goal: j.goal ?? "" })}</span>
          <span className="font-semibold text-white">{j.progressPercent}%</span>
        </div>
        <div className="h-2.5 rounded-pill bg-white/20 overflow-hidden">
          <div className="h-full rounded-pill bg-white transition-all duration-700" style={{ width: `${j.progressPercent}%` }} />
        </div>
        <p className="text-[11px] text-white/70">{tr("Counts levels gained since your placement test and the sets you've passed, across all four skills.")}</p>
      </div>
    </section>
  );
}

// Each skill: level now, where it started, and its progress to the goal.
export function SkillProgress({ j }: { j: Journey }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
        <Target size={17} className="text-accent" /> {tr("Your skills")}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {j.skills.map((s) => {
          const Icon = ICONS[s.skill];
          return (
            <button
              key={s.skill}
              onClick={() => navigate(`/modules?skill=${s.skill}`)}
              className="text-left rounded-input border border-rule bg-paper-warm/50 px-3 py-2.5 flex flex-col gap-1.5 hover:shadow-md cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Icon size={15} className={SKILL_RING_COLOR[s.skill]} />
                <span className="text-xs font-semibold text-ink flex-1">{t(`skills.${s.skill}`)}</span>
                <span className="font-display font-bold text-lg text-ink leading-none">{s.level}</span>
              </div>
              <div className="h-1.5 rounded-full bg-rule overflow-hidden">
                <div className="h-full rounded-full bg-navy" style={{ width: `${s.progressPercent}%` }} />
              </div>
              <span className="text-[10px] text-muted">
                {s.startLevel && s.startLevel !== s.level ? tr("Started at {{level}} · ", { level: s.startLevel }) : ""}
                {s.progressPercent >= 100 ? tr("Goal reached") : tr("{{n}}% of the way", { n: s.progressPercent })}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// The levels still to reach, from the lowest skill up to the goal; each shows
// which skills are there, which are working on it (and how far), and which
// come later.
export function PathToGoal({ j }: { j: Journey }) {
  const { t } = useTranslation();
  const cert = useReadiness()?.certificate ?? null;
  const canBuy = usePrepPrices()?.canBuy ?? false;
  if (!j.steps.length) return null;
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
        <Flag size={17} className="text-accent" /> {tr("Path to {{goal}}", { goal: j.goal ?? "" })}
      </h2>
      <ol className="relative flex flex-col gap-4 pl-6">
        <span className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-rule" aria-hidden="true" />
        {j.steps.map((step, i) => {
          const done = step.skills.every((s) => s.state === "done");
          const active = !done && step.skills.some((s) => s.state === "now");
          // The level just finished in Practice Modules: a level test checks it (no certificate).
          const justDone = done && !j.steps[i + 1]?.skills.every((s) => s.state === "done");
          return (
            <li key={step.level} className="relative">
              <span
                className={`absolute -left-6 top-0.5 h-5 w-5 rounded-full flex items-center justify-center ${
                  done ? "bg-success text-white" : active ? "bg-navy text-white" : "bg-surface border-2 border-rule"
                }`}
              >
                {done ? <Check size={12} /> : null}
              </span>
              <div className="flex items-center justify-between gap-2">
                <p className={`text-sm font-semibold ${done ? "text-muted" : "text-ink"}`}>
                  {tr("Reach {{level}}", { level: step.level })}
                  {step.level === j.goal ? <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-accent">{tr("Goal")}</span> : null}
                </p>
                <span className={`text-xs ${done ? "text-success font-semibold" : "text-muted"}`}>
                  {done
                    ? tr("All four skills done")
                    : tr("{{n}} of 4 skills done", { n: step.skills.filter((s) => s.state === "done").length })}
                </span>
              </div>
              {/* A finished level is one line; the others show each skill. */}
              {!done && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                  {step.skills.map((s) => {
                    const Icon = ICONS[s.skill];
                    return (
                      <div
                        key={s.skill}
                        className={`rounded-lg px-2.5 py-2 text-xs flex flex-col gap-1.5 border ${
                          s.state === "done"
                            ? "bg-success/10 border-success/20"
                            : s.state === "now"
                              ? "bg-surface border-navy/40 shadow-sm"
                              : "bg-paper-warm/50 border-transparent text-muted"
                        }`}
                      >
                        <span className={`flex items-center gap-1.5 font-medium ${s.state === "later" ? "text-muted" : "text-ink"}`}>
                          <Icon size={13} className={s.state === "later" ? "text-muted" : SKILL_RING_COLOR[s.skill]} /> {t(`skills.${s.skill}`)}
                          {s.state === "done" && <CheckCircle2 size={13} className="text-success ml-auto" />}
                        </span>
                        {s.state === "now" && (
                          <span className="flex items-center gap-1.5">
                            <span className="flex-1 h-1.5 rounded-full bg-rule overflow-hidden">
                              <span className="block h-full bg-navy rounded-full" style={{ width: `${Math.max(3, Math.round(s.partWay * 100))}%` }} />
                            </span>
                            <span className="text-muted tabular-nums">{Math.round(s.partWay * 100)}%</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* A level test is bought on Plans; a learner whose organization gives access can't buy one. */}
              {justDone && canBuy && (
                <Link to={ROUTES.PLANS} className="inline-flex items-center gap-1 mt-1.5 text-xs font-semibold text-navy-deep hover:underline">
                  {tr("You finished {{level}} in Practice Modules. Check it with a level test", { level: step.level })} <ArrowRight size={12} />
                </Link>
              )}
            </li>
          );
        })}
        {/* The last step: practice ends with the final assessment, the one test that gives a certificate. */}
        <li className="relative">
          <span
            className={`absolute -left-6 top-0.5 h-5 w-5 rounded-full flex items-center justify-center ${cert ? "bg-success text-white" : "bg-surface border-2 border-navy text-navy-deep"}`}
          >
            {cert ? <Check size={12} /> : <Award size={11} />}
          </span>
          <p className="text-sm font-semibold text-ink">{tr("Final assessment: certify your level")}</p>
          {cert ? (
            <Link to={`/certificate/${cert.code}`} className="text-xs font-semibold text-success hover:underline mt-0.5 inline-block">
              {cert.score !== null ? tr("Certified {{level}} · Spica score {{score}}", { level: cert.level, score: cert.score }) : tr("Certified {{level}}", { level: cert.level })}
            </Link>
          ) : (
            <p className="text-xs text-muted mt-0.5">
              {tr("One strictly proctored real test gives your certificate, at the level you show.")}{" "}
              <Link to={ROUTES.MY_TESTS} className="font-semibold text-navy-deep hover:underline">
                {tr("Go to Assessment")}
              </Link>
            </p>
          )}
        </li>
      </ol>
      <p className="text-[11px] text-muted">{tr("A skill moves up a level when its question types pass 7 sets at 70% or more, or after a level check or a mock test.")}</p>
    </section>
  );
}

function taskText(task: JourneyTask, skillName: (s: SkillTag) => string): { icon: typeof Headphones; title: string } {
  switch (task.kind) {
    case "sets":
      return { icon: Layers, title: tr("Practise {{n}} sets a day · {{done}} today", { n: task.target ?? 1, done: task.count ?? 0 }) };
    case "practice_test":
      return { icon: ClipboardList, title: tr("Take a practice test this week") };
    case "final":
      return { icon: Award, title: tr("Take your final assessment: it's open") };
    case "final_choose":
      return { icon: Award, title: tr("Choose the test for your final assessment") };
    case "retry":
      return { icon: RotateCcw, title: tr("Retry {{n}} {{skill}} mistakes", { n: Math.min(5, task.count ?? 5), skill: task.skill ? skillName(task.skill).toLowerCase() : "" }) };
    case "level_check":
      return { icon: Gauge, title: tr("Level check: {{skill}} (a test came out lower)", { skill: task.skill ? skillName(task.skill) : "" }) };
    case "mock":
      return {
        icon: Timer,
        title: task.done
          ? tr("Mock test this week")
          : task.target != null
            ? tr("Mock test on {{date}} · {{left}} of {{n}} left this month", { date: formatShortDate(task.date ?? null), left: task.count ?? 0, n: task.target })
            : tr("Mock test on {{date}}", { date: formatShortDate(task.date ?? null) }),
      };
  }
}

// This week's tasks, ticked off by what's been done.
export function ThisWeek({ j }: { j: Journey }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const done = j.week.filter((x) => x.done).length;
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
          <CheckCircle2 size={17} className="text-accent" /> {tr("This week")}
        </h2>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-pill bg-success/15 text-success">{tr("{{done}}/{{total}} done", { done, total: j.week.length })}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {j.week.map((task) => {
          const { icon: Icon, title } = taskText(task, (s) => t(`skills.${s}`));
          return (
            <li key={task.id}>
              <button
                onClick={() => navigate(task.href)}
                className={`w-full text-left flex items-center gap-3 rounded-input border px-3 py-2.5 cursor-pointer hover:border-navy ${task.done ? "border-success/30 bg-success/5" : "border-rule bg-paper-warm/40"}`}
              >
                <span className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${task.done ? "bg-success text-white" : "border-2 border-rule"}`}>
                  {task.done ? <Check size={14} /> : null}
                </span>
                <Icon size={15} className="text-navy-deep shrink-0" />
                <span className={`text-sm flex-1 ${task.done ? "text-muted line-through" : "text-ink"}`}>{title}</span>
                {!task.done && <ArrowRight size={15} className="text-muted shrink-0" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The test plan on a timeline: recent tests (done, with their level), today,
// then practice tests and mocks spaced by the monthly allowance, up to the exam.
// How many upcoming tests show before "Show full plan".
const UPCOMING_SHOWN = 4;

export function Checkpoints({ j }: { j: Journey }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [full, setFull] = useState(false);
  // A final assessment not owned yet: bought on Plans, or given by the organization.
  const canBuy = usePrepPrices()?.canBuy ?? false;
  if (j.checkpoints.length < 2) return null;
  // Past tests and today always; then the next few, and exam day.
  let upcoming = 0;
  const shown = j.checkpoints.filter((c) => {
    // The end of the plan always shows: exam day, final assessment, certificate.
    if (c.done || c.kind === "today" || c.kind === "exam" || c.kind === "final" || c.kind === "certificate" || full) return true;
    upcoming++;
    return upcoming <= UPCOMING_SHOWN;
  });
  const hidden = j.checkpoints.length - shown.length;
  type C = Journey["checkpoints"][number];
  const label = (c: C) =>
    c.kind === "final"
      ? tr("Final assessment")
      : c.kind === "certificate"
        ? tr("Certificate")
        : c.kind === "today"
      ? tr("Today")
      : c.kind === "practice_test"
        ? tr("Practice test")
        : c.kind === "level_check"
          ? tr("Level check: {{skill}}", { skill: c.skill ? t(`skills.${c.skill}`) : "" })
          : c.kind === "mock"
            ? tr("Mock test")
            : tr("Exam day");
  const href = (c: C) =>
    c.kind === "final" ? (c.toGet && canBuy ? ROUTES.SPICA_PLANS : ROUTES.MY_TESTS) : c.kind === "certificate" ? (c.code ? `/certificate/${c.code}` : null) : c.kind === "practice_test" ? "/practice-tests" : c.kind === "mock" ? "/mock-exams" : c.kind === "level_check" && c.skill ? `/modules?skill=${c.skill}&check=1` : null;
  const Icon = (c: C) => (c.kind === "final" || c.kind === "certificate" ? Award : c.kind === "exam" ? Flag : c.kind === "mock" ? Timer : c.kind === "level_check" ? Gauge : c.kind === "practice_test" ? ClipboardList : null);
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
          <CalendarDays size={17} className="text-accent" /> {tr("Test plan")}
        </h2>
        <span className="flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1">
            <ClipboardList size={12} /> {tr("Practice test")}
          </span>
          <span className="flex items-center gap-1 text-accent">
            <Timer size={12} /> {tr("Mock test")}
          </span>
          <span className="flex items-center gap-1 text-navy-deep">
            <Award size={12} /> {tr("Final assessment")}
          </span>
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <ol className="flex items-start min-w-max">
          {shown.map((c, i) => {
            const I = Icon(c);
            const link = !c.done || c.kind === "certificate" ? href(c) : null;
            const mock = c.kind === "mock";
            return (
              <li key={`${c.kind}-${c.date}-${i}`} className="flex flex-col items-center w-28 relative">
                {i > 0 && <span className={`absolute top-4 right-1/2 w-full h-0.5 ${c.done || c.kind === "today" ? "bg-navy/40" : "bg-rule"}`} aria-hidden="true" />}
                <button
                  disabled={!link}
                  onClick={() => link && navigate(link)}
                  className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center ${link ? "cursor-pointer hover:scale-110 transition-transform" : "cursor-default"} ${
                    c.kind === "certificate" && c.done
                      ? "bg-success text-white ring-4 ring-success/15"
                      : c.kind === "final" || c.kind === "certificate"
                        ? c.toGet
                          ? "bg-surface text-muted border-2 border-dashed border-rule-strong"
                          : "bg-navy/10 text-navy-deep border-2 border-navy"
                        : c.kind === "exam"
                      ? "bg-accent text-white"
                      : c.kind === "today"
                        ? "bg-navy text-white ring-4 ring-navy/15"
                        : c.done
                          ? "bg-success text-white"
                          : mock
                            ? "bg-accent/15 text-accent border-2 border-accent"
                            : "bg-surface text-navy-deep border-2 border-navy/40"
                  }`}
                >
                  {c.done && c.kind !== "today" ? <Check size={14} /> : I ? <I size={14} /> : null}
                </button>
                <span className={`text-xs font-semibold mt-1.5 text-center ${mock ? "text-accent" : "text-ink"}`}>{label(c)}</span>
                <span className="text-[11px] text-muted">{formatShortDate(c.date)}</span>
                {c.done && (c.level || (c.attempts ?? 1) > 1) && (
                  <span className="text-[11px] font-semibold text-success">
                    {[c.level, (c.attempts ?? 1) > 1 ? tr("{{n}} attempts", { n: c.attempts }) : null].filter(Boolean).join(" · ")}
                  </span>
                )}
                {c.onReset && <span className="text-[10px] text-muted text-center leading-tight">{tr("new mocks that day")}</span>}
                {c.kind === "final" && !c.done && (
                  <span className="text-[10px] text-muted text-center leading-tight">
                    {c.toGet ? (canBuy ? tr("in Full access and preparation plans") : tr("given by your organization")) : c.open ? tr("open now") : c.needsMock ? tr("take a mock test first") : tr("opens after a mock test")}
                  </span>
                )}
                {c.kind === "certificate" && !c.done && <span className="text-[10px] text-muted text-center leading-tight">{tr("after your final assessment")}</span>}
              </li>
            );
          })}
        </ol>
      </div>
      {(hidden > 0 || full) && (
        <button onClick={() => setFull((v) => !v)} className="self-start text-xs font-semibold text-navy-deep hover:underline cursor-pointer">
          {full ? tr("Show less") : tr("Show full plan ({{n}} more)", { n: hidden })}
        </button>
      )}
      {j.planSource && (
        <p className="text-xs text-muted">
          {j.planSource.kind === "program"
            ? tr("Dates set by your organization's program: {{name}}.", { name: j.planSource.name })
            : tr("Spaced by your plan: {{practice}} and {{mocks}}.", {
                practice:
                  j.planSource.practicePerMonth === null
                    ? tr("practice tests with no monthly limit")
                    : tr("{{n}} practice tests a month", { n: j.planSource.practicePerMonth }),
                mocks:
                  j.planSource.mocksPerMonth === null ? tr("mock tests with no monthly limit") : tr("{{n}} mock test(s) a month", { n: j.planSource.mocksPerMonth }),
              })}
        </p>
      )}
      {!j.examDate && <p className="text-[11px] text-muted">{tr("Showing the next 8 weeks. Add your exam date and the plan counts down to it, ending with your final assessment.")}</p>}
      {/* Only when the monthly allowance is the reason: not for a program's own dates, or a plan
          that ends early on purpose (certified, or the final assessment comes first). */}
      {j.examDate &&
        j.planSource?.kind === "allowance" &&
        j.planSource.mocksPerMonth !== null &&
        !j.checkpoints.some((c) => (c.kind === "mock" && !c.done) || (c.kind === "certificate" && c.done) || (c.kind === "final" && !c.toGet)) && (
        <p className="text-xs text-warning">{tr("No mock test is left in this month's allowance before your exam. See the Mock Tests page for when new ones arrive.")}</p>
      )}
      {j.checkpoints.some((c) => !c.done && (c.kind === "practice_test" || c.kind === "mock" || c.kind === "exam" || (c.kind === "final" && !c.toGet))) && <CalendarActions />}
    </section>
  );
}

// The test dates into the learner's own calendar: by email (Google links and
// an .ics file), or the file straight away.
function CalendarActions() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function send() {
    setState("sending");
    try {
      await emailTestDates();
      setState("sent");
    } catch {
      setState("error");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3 text-xs">
      <span className="font-semibold text-ink flex items-center gap-1.5">
        <CalendarPlus size={14} className="text-accent" /> {tr("Add to your calendar")}
      </span>
      <button onClick={send} disabled={state === "sending" || state === "sent"} className="font-semibold text-navy-deep hover:underline cursor-pointer disabled:cursor-default disabled:no-underline">
        {state === "sending" ? tr("Sending…") : state === "sent" ? tr("Sent to your email ✓") : tr("Email me my test dates")}
      </button>
      <a href={CALENDAR_FILE_URL} className="font-semibold text-navy-deep hover:underline">
        {tr("Download for Apple Calendar or Outlook")}
      </a>
      {state === "error" && <span className="text-error">{tr("Couldn't send it. Try again in a minute.")}</span>}
    </div>
  );
}
