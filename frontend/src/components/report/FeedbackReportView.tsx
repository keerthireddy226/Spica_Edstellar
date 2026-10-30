import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, MinusCircle, Target, Sparkles, Loader2, Lightbulb, Award } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import type { ReportAbout, FeedbackReport, ReportQuestion, ReportResponse, WordOp } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";
import { TestFeedbackCard } from "@/components/report/AfterTest";
import { FinalResultWaiting, ScoreReport } from "@/components/report/ScoreReport";
import { SkillLevelCompare } from "@/components/report/SkillLevelCompare";
import { Confetti } from "@/components/Confetti";
import { useAuth } from "@/hooks/useAuth";

const ERROR_TYPE: Record<string, () => string> = {
  spelling: () => tr("Spelling"),
  grammar: () => tr("Grammar"),
  vocabulary: () => tr("Vocabulary"),
  punctuation: () => tr("Punctuation"),
  task: () => tr("Task"),
};

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3 ${className}`}>{children}</div>;
}

// Right, wrong, skipped or still being scored (older reports: from the score).
function outcome(q: ReportQuestion): "right" | "wrong" | "skipped" | "pending" {
  if (q.outcome) return q.outcome;
  if (!q.answered) return "skipped";
  if (q.score === null) return "pending";
  return q.score >= 0.75 ? "right" : "wrong";
}

const OUTCOME: Record<ReturnType<typeof outcome>, { label: () => string; cls: string }> = {
  right: { label: () => tr("Right"), cls: "bg-success/15 text-success" },
  wrong: { label: () => tr("Wrong"), cls: "bg-error/15 text-error" },
  skipped: { label: () => tr("Skipped"), cls: "bg-warning/15 text-warning" },
  pending: { label: () => tr("Being scored"), cls: "bg-paper-warm text-muted" },
};

function StatusIcon({ q }: { q: ReportQuestion }) {
  const o = outcome(q);
  if (o === "skipped") return <MinusCircle size={18} className="text-warning shrink-0" />;
  if (o === "pending") return <Loader2 size={18} className="text-muted shrink-0" />;
  return o === "right" ? <CheckCircle2 size={18} className="text-success shrink-0" /> : <XCircle size={18} className="text-error shrink-0" />;
}

// The right answer for a question that isn't multiple choice, and why.
function Expected({ q }: { q: ReportQuestion }) {
  if (!q.expected) return null;
  const wrong = outcome(q) === "wrong";
  return (
    <div className="text-sm bg-success/10 rounded-input px-3 py-2 flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-success">
        {q.expected.points ? tr("A good answer covers") : wrong ? tr("The right answer is") : tr("Correct answer")}
      </span>
      {q.expected.text && <span className="text-ink">{q.expected.text}</span>}
      {q.expected.points && (
        <ul className="list-disc pl-5 text-ink">
          {q.expected.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Choices({ q }: { q: ReportQuestion }) {
  return (
    <div className="flex flex-col gap-3">
      {q.choices!.map((c, i) => (
        <div key={i} className="flex flex-col gap-1">
          {c.stem && <p className="text-sm font-semibold text-ink">{c.stem}</p>}
          <ul className="flex flex-col gap-1">
            {c.options.map((o, j) => {
              const right = j === c.correct;
              const chosenWrong = j === c.chosen && !right;
              return (
                <li key={j} className={`text-sm flex items-start gap-2 ${right ? "text-success font-semibold" : chosenWrong ? "text-error line-through" : "text-muted"}`}>
                  <span className="font-mono text-xs mt-0.5">{String.fromCharCode(65 + j)}</span>
                  <span className="flex-1">{o}</span>
                  {j === c.chosen && <span className="text-[11px] no-underline">{tr("your answer")}</span>}
                </li>
              );
            })}
          </ul>
          {c.chosen === null && <p className="text-xs text-warning">{tr("You skipped this. The right answer is marked in green.")}</p>}
          {c.explanation?.why && (
            <p className="text-sm text-ink bg-paper-warm rounded-input px-3 py-2">
              {c.explanation.why}
              {c.explanation.evidence && <span className="block text-xs text-muted mt-1">“{c.explanation.evidence}”</span>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Words({ q }: { q: ReportQuestion }) {
  const ops = q.words!.ops;
  const wrong = ops.filter((o) => o.op !== "same");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-relaxed">
        {ops.map((o: WordOp, i) => (
          <span key={i} className="mr-1">
            {o.op === "same" && <span className="text-ink">{o.word}</span>}
            {o.op === "sub" && (
              <>
                <span className="text-success font-semibold">{o.word}</span> <span className="text-error line-through text-xs">{o.said}</span>
              </>
            )}
            {o.op === "missing" && <span className="text-warning font-semibold underline decoration-dotted">{o.word}</span>}
            {o.op === "extra" && <span className="text-error italic text-xs">+{o.said}</span>}
          </span>
        ))}
      </p>
      {wrong.length > 0 ? (
        <ul className="text-xs text-muted flex flex-col gap-0.5">
          {wrong.slice(0, 8).map((o, i) => (
            <li key={i}>
              {o.op === "sub"
                ? tr("You said “{{said}}” instead of “{{word}}”.", { said: o.said, word: o.word })
                : o.op === "missing"
                  ? tr("You left out “{{word}}”.", { word: o.word })
                  : tr("You added “{{said}}”.", { said: o.said })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-success">{tr("Every word matched.")}</p>
      )}
      <p className="text-[11px] text-muted">{tr("Only different or missing words count here, never your accent.")}</p>
    </div>
  );
}

// The answer with each error's words marked.
function MarkedAnswer({ answer, errors }: { answer: string; errors: { text: string }[] }) {
  const spans: { start: number; end: number; n: number }[] = [];
  errors.forEach((e, n) => {
    const start = answer.indexOf(e.text);
    if (start >= 0 && !spans.some((s) => start < s.end && start + e.text.length > s.start)) spans.push({ start, end: start + e.text.length, n });
  });
  spans.sort((a, b) => a.start - b.start);
  const out: ReactNode[] = [];
  let at = 0;
  for (const s of spans) {
    out.push(answer.slice(at, s.start));
    out.push(
      <mark key={s.start} className="bg-error/15 text-ink rounded px-0.5">
        {answer.slice(s.start, s.end)}
        <sup className="text-error font-bold ml-0.5">{s.n + 1}</sup>
      </mark>,
    );
    at = s.end;
  }
  out.push(answer.slice(at));
  return <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed bg-paper-warm rounded-input p-3">{out}</p>;
}

function Writing({ q }: { q: ReportQuestion }) {
  const w = q.writing!;
  const [showModel, setShowModel] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <MarkedAnswer answer={w.answer} errors={w.errors} />
      {w.errors.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {w.errors.map((e, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className="text-error font-bold text-xs mt-0.5">{i + 1}</span>
              <span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted mr-1.5">{ERROR_TYPE[e.type]?.() ?? e.type}</span>
                <span className="line-through text-muted">{e.text}</span> → <span className="text-success font-semibold">{e.correction}</span>
                <span className="block text-xs text-muted">{e.reason}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-success">{tr("No errors found.")}</p>
      )}
      {w.comment && <p className="text-sm text-ink">{w.comment}</p>}
      {w.modelAnswer && (
        <div>
          <button onClick={() => setShowModel((s) => !s)} className="text-xs font-semibold text-navy-deep hover:underline cursor-pointer">
            {showModel ? tr("Hide the corrected version") : tr("Show your answer corrected")}
          </button>
          {showModel && <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed mt-2 border-l-4 border-success/40 pl-3">{w.modelAnswer}</p>}
        </div>
      )}
      <p className="text-[11px] text-muted">{tr("British, American and Indian spellings are all correct.")}</p>
    </div>
  );
}

function Speech({ q }: { q: ReportQuestion }) {
  const s = q.speech!;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {s.wordsPerMinute !== null && <span>{tr("Pace: {{n}} words a minute", { n: s.wordsPerMinute })}</span>}
        {s.fillers !== null && <span>{tr("Fillers (um, uh): {{n}}", { n: s.fillers })}</span>}
        {s.clarity !== null && <span>{tr("Clarity: {{n}}%", { n: Math.round(s.clarity * 100) })}</span>}
      </div>
      {s.comment && <p className="text-sm text-ink">{s.comment}</p>}
      {s.noisy && <p className="text-xs text-warning">{tr("There was a lot of background noise in this recording.")}</p>}
    </div>
  );
}

// The learner's own answer, right or wrong: the typed text, or for a spoken
// answer what we heard (unless the word-by-word block already shows it). Same
// view in Practice Modules, practice tests and mock tests; no recording player.
function Given({ q }: { q: ReportQuestion }) {
  const g = q.given;
  if (!g) return null;
  const spoken = !!g.audioUri;
  const showText = !q.words && !q.writing && g.text;
  // A right or wrong answer is boxed and marked, so the right answer under a
  // wrong one is never read as the learner's own.
  const o = outcome(q);
  const marked = o === "right" || o === "wrong";
  return (
    <div className="flex flex-col gap-1.5">
      {showText && !marked && (
        <p className="text-sm text-ink">
          <span className="font-semibold">{spoken ? tr("What we heard:") : tr("Your answer:")}</span> {g.text}
        </p>
      )}
      {showText && marked && (
        <div className={`text-sm rounded-input px-3 py-2 flex flex-col gap-1 border ${o === "right" ? "bg-success/10 border-success/40" : "bg-error/10 border-error/40"}`}>
          <span className={`text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${o === "right" ? "text-success" : "text-error"}`}>
            {o === "right" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {spoken ? tr("What we heard") : tr("Your answer")} · {o === "right" ? tr("Right") : tr("Wrong")}
          </span>
          <span className="text-ink">{g.text}</span>
        </div>
      )}
      {g.noSpeech && <p className="text-sm text-warning">{tr("No words were heard in your recording. Check your microphone before your next test.")}</p>}
    </div>
  );
}

export function QuestionCard({ q, n }: { q: ReportQuestion; n?: number }) {
  const { t } = useTranslation();
  const o = outcome(q);
  const edge = { right: "border-l-4 border-l-success", wrong: "border-l-4 border-l-error", skipped: "border-l-4 border-l-warning", pending: "" }[o];
  return (
    <Card className={edge}>
      <div className="flex items-start gap-2">
        <StatusIcon q={q} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted">
            {n ? `${n}. ` : ""}{q.typeName} · {q.skills.map((s) => t(`skills.${s}`)).join(", ")}
            {q.level ? ` · ${q.level}` : ""}
          </div>
          <p className="text-sm text-ink mt-1">{q.prompt}</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-pill shrink-0 ${OUTCOME[o].cls}`}>{OUTCOME[o].label()}</span>
      </div>
      {o === "skipped" && !q.choices && <p className="text-xs text-warning">{tr("You skipped this question.")}</p>}
      {q.choices && <Choices q={q} />}
      {q.words && <Words q={q} />}
      {q.writing && <Writing q={q} />}
      {q.speech && <Speech q={q} />}
      <Given q={q} />
      {!q.choices && !q.words && <Expected q={q} />}
      {q.comment && !q.writing && !q.choices && (
        <p className="text-sm text-ink">
          <span className="font-semibold">{tr("Why:")}</span> {q.comment}
        </p>
      )}
    </Card>
  );
}

// Every question with a filter: right, wrong or skipped, the learner's answer
// and the right one. Shared by the feedback report and Practice Modules results.
export function QuestionReview({
  questions: qs,
  initialFilter = "all",
  note,
}: {
  questions: ReportQuestion[];
  initialFilter?: "right" | "wrong" | "skipped" | "all";
  note?: string;
}) {
  const [filter, setFilter] = useState(initialFilter);
  const counts = {
    total: qs.length,
    right: qs.filter((q) => outcome(q) === "right").length,
    wrong: qs.filter((q) => outcome(q) === "wrong").length,
    skipped: qs.filter((q) => outcome(q) === "skipped").length,
  };
  const shown = qs.filter((q) => {
    const o = outcome(q);
    return filter === "all" || o === filter;
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display font-bold text-lg text-ink flex-1 min-w-[12rem]">{tr("Question by question")}</h2>
        {(
          [
            ["all", tr("All questions ({{n}})", { n: counts.total }), "border-navy bg-navy/10 text-navy-deep"],
            ["right", tr("Right ({{n}})", { n: counts.right }), "border-success bg-success/15 text-success"],
            ["wrong", tr("Wrong ({{n}})", { n: counts.wrong }), "border-error bg-error/15 text-error"],
            ["skipped", tr("Skipped ({{n}})", { n: counts.skipped }), "border-warning bg-warning/15 text-warning"],
          ] as const
        ).map(([k, label, on]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`px-3 py-1 rounded-pill border text-sm cursor-pointer ${filter === k ? `${on} font-semibold` : "border-rule text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {note && <p className="text-sm text-muted">{note}</p>}
      {shown.length === 0 && <p className="text-sm text-success">{filter === "all" ? tr("No questions.") : tr("Nothing here.")}</p>}
      {shown.map((q) => (
        <QuestionCard key={q.itemId} q={q} n={qs.indexOf(q) + 1} />
      ))}
    </div>
  );
}

function Report({ report, upgradeLink, kind, scored = false }: { report: FeedbackReport; upgradeLink: boolean; kind?: "practice" | "mock"; scored?: boolean }) {
  const { t } = useTranslation();
  const qs = report.questions ?? [];
  const counts = report.counts ?? {
    total: qs.length,
    right: qs.filter((q) => outcome(q) === "right").length,
    wrong: qs.filter((q) => outcome(q) === "wrong").length,
    skipped: qs.filter((q) => outcome(q) === "skipped").length,
    pending: qs.filter((q) => outcome(q) === "pending").length,
  };
  return (
    <div className="flex flex-col gap-5">
      <Card>
        {/* With the score report above, its level and score aren't repeated here. */}
        {!scored && <div className="flex flex-wrap items-stretch gap-3">
          {report.overall.cefrLevel && (
            <div className="flex flex-col items-center bg-navy/10 rounded-card px-5 py-3">
              <span className="text-3xl font-display font-bold text-navy-deep">{report.overall.cefrLevel}</span>
              <span className="text-[11px] text-muted uppercase tracking-wide">{tr("CEFR level")}</span>
            </div>
          )}
          {report.overall.percent !== null && (
            <div className="flex flex-col items-center bg-paper-warm rounded-card px-5 py-3">
              <span className="text-3xl font-display font-bold text-ink">{report.overall.percent}%</span>
              <span className="text-[11px] text-muted uppercase tracking-wide">{tr("Overall")}</span>
            </div>
          )}
          {report.overall.scoreBand && (
            <div className="flex flex-col items-center bg-accent/10 rounded-card px-5 py-3">
              <span className="text-3xl font-display font-bold text-ink">
                {report.overall.scoreBand.from}-{report.overall.scoreBand.to}
              </span>
              <span className="text-[11px] text-muted uppercase tracking-wide">{tr("Estimated score")}</span>
            </div>
          )}
          {report.overall.skillLevels && !report.overall.pathCompare && (
            <div className="flex flex-wrap gap-2 items-center">
              {Object.entries(report.overall.skillLevels).map(([s, l]) => (
                <span key={s} className="text-sm bg-paper-warm rounded-input px-3 py-2">
                  {t(`skills.${s}`)} <b>{l}</b>
                </span>
              ))}
            </div>
          )}
        </div>}
        {report.overall.pathCompare && Object.keys(report.overall.pathCompare).length > 0 && <SkillLevelCompare compare={report.overall.pathCompare} kind={kind} />}
        {report.target && (
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Target size={15} /> {tr("Your target: {{level}} by {{date}} ({{program}})", { level: report.target.level, date: report.target.date, program: report.target.programName })}
          </p>
        )}
        {counts.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                ["right", tr("Right"), counts.right],
                ["wrong", tr("Wrong"), counts.wrong],
                ["skipped", tr("Skipped"), counts.skipped],
                ["all", tr("Questions"), counts.total],
              ] as const
            ).map(([k, label, n]) => (
              <div key={k} className={`rounded-input px-3 py-2 ${k === "all" ? "bg-paper-warm" : OUTCOME[k].cls}`}>
                <div className="text-xl font-display font-bold">{n}</div>
                <div className="text-xs">{label}</div>
              </div>
            ))}
          </div>
        )}
        {!scored && <p className="text-sm text-ink leading-relaxed">{report.analysis}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
          <Lightbulb size={18} /> {tr("What to practise next")}
        </h2>
        <div className="grid md:grid-cols-3 gap-3">
          {report.nextSteps.map((n, i) => (
            <Card key={i}>
              <span className="text-xs text-muted uppercase tracking-wide">{t(`skills.${n.skill}`)}</span>
              <span className="font-semibold text-ink">{n.title}</span>
              <span className="text-sm text-muted">{n.why}</span>
              {n.link && (
                <Link to={`${ROUTES.PRACTICE_TESTS}?product=${encodeURIComponent(n.link.testTypeId)}`} className="text-sm font-semibold text-navy-deep hover:underline mt-auto">
                  {tr("Practise")} →
                </Link>
              )}
            </Card>
          ))}
        </div>
      </div>

      {report.level === "summary" ? (
        <Card className="items-start">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <Sparkles size={16} /> {tr("See every question explained")}
          </span>
          <span className="text-sm text-muted">{tr("The full report shows why each answer was right or wrong, your writing corrected and the words you said differently.")}</span>
          {upgradeLink && (
            <Link to={ROUTES.PLANS} className="text-sm font-semibold text-navy-deep hover:underline">
              {tr("Get the full report with Plus")}
            </Link>
          )}
        </Card>
      ) : (
        <div className="print:hidden"><QuestionReview
          questions={qs}
          note={
            report.explanationsMissing
              ? tr("Explanations for some answers are still being written. The right answers are shown now; open this report again later for the reasons.")
              : undefined
          }
        /></div>
      )}
    </div>
  );
}

// The first time a learner opens their final assessment result with its
// certificate: a full-screen celebration (confetti from the top and both
// corners, then a second wave) over a congratulations card. Remembered per
// test in this browser; later visits keep only the banner.
function CertificateCelebration({ sessionId, level, score, checkUrl }: { sessionId: string; level: string; score: number; checkUrl: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => {
    try {
      const key = `spica.celebrated.${sessionId}`;
      if (localStorage.getItem(key)) return false;
      localStorage.setItem(key, "1");
    } catch {
      // Storage blocked: celebrate anyway.
    }
    return true;
  });
  const [wave, setWave] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setWave(true), 1800);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <>
      {open && (
        <div className="print:hidden fixed inset-0 z-40 bg-ink/60 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <style>{`@keyframes cert-pop { 0% { transform: scale(.4); opacity: 0 } 70% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1) } }`}</style>
          <Confetti variant="cannons" pieces={220} durationMs={4500} />
          <Confetti pieces={200} durationMs={5000} />
          {wave && <Confetti variant="cannons" pieces={160} durationMs={4000} />}
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-surface rounded-card shadow-xl p-8 flex flex-col items-center text-center gap-4"
            style={{ animation: "cert-pop .6s ease-out" }}
          >
            <div className="h-20 w-20 rounded-full bg-warning/20 text-warning flex items-center justify-center ring-8 ring-warning/10">
              <Award size={44} />
            </div>
            <p className="font-display font-bold text-2xl text-ink">
              {user?.firstName ? tr("Congratulations, {{name}}!", { name: user.firstName }) : tr("Congratulations!")}
            </p>
            <p className="text-sm text-muted">{tr("You completed your final assessment and earned your Spica certificate.")}</p>
            <div className="flex items-center gap-6 py-2">
              <div className="flex flex-col items-center">
                <span className="text-4xl font-display font-bold text-navy-deep">{level}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted">{tr("CEFR level")}</span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-4xl font-display font-bold text-ink">{score}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted">{tr("Spica score")}</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2 w-full">
              <a href={checkUrl} className="flex-1 px-4 py-2.5 rounded-pill bg-navy text-white text-sm font-semibold hover:opacity-90">
                {tr("View certificate")}
              </a>
              <button type="button" onClick={() => setOpen(false)} className="flex-1 px-4 py-2.5 rounded-pill border border-rule text-sm font-semibold text-ink cursor-pointer">
                {tr("See my result")}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="print:hidden rounded-card border border-success/40 bg-success/10 p-5 flex flex-wrap items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-success/20 text-success flex items-center justify-center shrink-0">
          <Award size={26} />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <p className="font-display font-bold text-lg text-ink">{tr("Congratulations! You're certified at {{level}}.", { level })}</p>
          <p className="text-sm text-muted">{tr("Your certificate is ready to view, download and share.")}</p>
        </div>
        <a href={checkUrl} className="px-4 py-2 rounded-pill bg-navy text-white text-sm font-semibold hover:opacity-90">
          {tr("View certificate")}
        </a>
      </div>
    </>
  );
}

// Loads a report and waits while it's being built.
// viewer "org": an Org Admin or Manager reading a learner's report.
export function FeedbackReportView({
  load,
  upgradeLink = false,
  viewer = "learner",
  sessionId,
}: {
  load: () => Promise<ReportResponse>;
  upgradeLink?: boolean;
  viewer?: "learner" | "org";
  // The learner's own test: the feedback form and "Request a review" go under it.
  sessionId?: string;
}) {
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const poll = () =>
      load()
        .then((r) => {
          if (stopped) return;
          setData(r);
          if (r.status === "pending" && tries++ < 45) timer = setTimeout(poll, 4000);
        })
        .catch(() => !stopped && setError(true));
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (error) return <p className="text-sm text-error">{tr("Could not load the report.")}</p>;
  const about = data?.about ? <AboutLine about={data.about} /> : null;
  if (!data || (data.status === "pending" && !data.report && data.about?.deliveryMode !== "certified")) {
    return (
      <div className="flex flex-col gap-3">
        {about}
        <p className="text-sm text-muted flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> {tr("Writing your report. This takes up to a minute.")}
        </p>
      </div>
    );
  }
  // A real assessment attempt has its score report only (its questions stay secret).
  // The feedback form follows the final assessment only; a review is asked
  // for from the test's row in My reports.
  const afterTest =
    viewer === "learner" && sessionId && data.about?.deliveryMode === "certified" ? (
      <div className="print:hidden">
        <TestFeedbackCard sessionId={sessionId} />
      </div>
    ) : null;
  if (!data.report && data.about?.deliveryMode === "certified") {
    return data.score?.overall ? (
      <div className="flex flex-col gap-4">
        {viewer === "learner" && sessionId && !data.about?.levelTest && <CertificateCelebration sessionId={sessionId} level={data.score.overall.level} score={data.score.overall.score} checkUrl={data.score.check.url} />}
        <ScoreReport score={data.score} about={data.about} analysis="" viewer={viewer} />
        {afterTest}
      </div>
    ) : (
      // Right after the final assessment, while it is scored or reviewed: the
      // feedback form is asked now, not when the result comes.
      <div className="flex flex-col gap-4">
        <FinalResultWaiting status={data.status} waiting={data.waiting} />
        {afterTest}
      </div>
    );
  }
  if (!data.report) return <p className="text-sm text-error">{tr("The report couldn't be made. Try again later.")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <div className={data.score?.overall ? "print:hidden" : ""}>{about}</div>
      {data.score?.overall && <ScoreReport score={data.score} about={data.about} analysis={data.report.analysis} viewer={viewer} />}
      {/* The PDF is the score report alone. */}
      <div className={data.score?.overall ? "print:hidden" : ""}>
        <Report report={data.report} upgradeLink={upgradeLink} kind={data.about?.deliveryMode === "mock" ? "mock" : data.about ? "practice" : undefined} scored={!!data.score?.overall} />
      </div>
      {afterTest}
    </div>
  );
}

// Which test the report is for: practice test or mock test, the test, set, date and code.
function AboutLine({ about }: { about: ReportAbout }) {
  const mock = about.deliveryMode === "mock";
  // A proctored real attempt or a level test isn't a practice test.
  const kind = about.levelTest
    ? tr("Level {{level}} test", { level: about.levelTest })
    : about.deliveryMode === "certified"
      ? tr("Final assessment")
      : mock
        ? tr("Mock test")
        : tr("Practice test");
  const test = about.testTypeName ? (about.familyName ? tr("{{family}}-style {{test}}", { family: about.familyName, test: about.testTypeName }) : about.testTypeName) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={`text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill ${mock ? "bg-navy text-white" : "bg-success/15 text-success"}`}>
        {kind}
      </span>
      {test && <span className="font-display font-bold text-ink">{test}</span>}
      <span className="text-sm text-muted">
        {[
          about.setName,
          about.completedAt ? new Date(about.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null,
          about.testCode ? tr("Test ID {{code}}", { code: about.testCode }) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </div>
  );
}
