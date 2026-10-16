import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, MinusCircle, Volume2, Target, Sparkles, Loader2, Lightbulb } from "lucide-react";
import { ROUTES } from "@/constants/routes";
import { speak } from "@/hooks/useVoiceRecorder";
import type { FeedbackReport, ReportQuestion, ReportResponse, WordOp } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

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

function StatusIcon({ q }: { q: ReportQuestion }) {
  if (!q.answered) return <MinusCircle size={18} className="text-muted shrink-0" />;
  if (q.score === null) return <Loader2 size={18} className="text-muted shrink-0" />;
  return q.score >= 0.75 ? <CheckCircle2 size={18} className="text-success shrink-0" /> : <XCircle size={18} className="text-error shrink-0" />;
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
          {c.chosen === null && <p className="text-xs text-muted">{tr("Not answered.")}</p>}
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
      <button onClick={() => speak([q.words!.target])} className="self-start flex items-center gap-1.5 text-xs font-semibold text-navy-deep hover:underline cursor-pointer">
        <Volume2 size={14} /> {tr("Hear the sentence")}
      </button>
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
      {s.transcript && <p className="text-sm text-ink italic bg-paper-warm rounded-input p-3">“{s.transcript}”</p>}
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

function QuestionCard({ q, n }: { q: ReportQuestion; n: number }) {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-start gap-2">
        <StatusIcon q={q} />
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted">
            {n}. {q.typeName} · {q.skills.map((s) => t(`skills.${s}`)).join(", ")}
            {q.level ? ` · ${q.level}` : ""}
          </div>
          <p className="text-sm text-ink mt-1">{q.prompt}</p>
        </div>
      </div>
      {!q.answered && !q.choices && <p className="text-xs text-muted">{tr("Not answered.")}</p>}
      {q.choices && <Choices q={q} />}
      {q.words && <Words q={q} />}
      {q.writing && <Writing q={q} />}
      {q.speech && <Speech q={q} />}
      {q.comment && !q.writing && !q.choices && <p className="text-xs text-muted">{q.comment}</p>}
    </Card>
  );
}

function Report({ report, upgradeLink }: { report: FeedbackReport; upgradeLink: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"wrong" | "all">("wrong");
  const qs = report.questions ?? [];
  const shown = filter === "all" ? qs : qs.filter((q) => !q.answered || (q.score !== null && q.score < 0.75));
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-stretch gap-3">
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
          {report.overall.skillLevels && (
            <div className="flex flex-wrap gap-2 items-center">
              {Object.entries(report.overall.skillLevels).map(([s, l]) => (
                <span key={s} className="text-sm bg-paper-warm rounded-input px-3 py-2">
                  {t(`skills.${s}`)} <b>{l}</b>
                </span>
              ))}
            </div>
          )}
        </div>
        {report.target && (
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Target size={15} /> {tr("Your target: {{level}} by {{date}} ({{program}})", { level: report.target.level, date: report.target.date, program: report.target.programName })}
          </p>
        )}
        <p className="text-sm text-ink leading-relaxed">{report.analysis}</p>
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
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-lg text-ink flex-1">{tr("Question by question")}</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value as "wrong" | "all")} className="rounded-input border border-rule bg-paper px-3 py-1.5 text-sm cursor-pointer">
              <option value="wrong">{tr("Only what to work on")}</option>
              <option value="all">{tr("All questions")}</option>
            </select>
          </div>
          {shown.length === 0 && <p className="text-sm text-success">{tr("Nothing to work on here: every answer was right.")}</p>}
          {shown.map((q) => (
            <QuestionCard key={q.itemId} q={q} n={qs.indexOf(q) + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// Loads a report and waits while it's being built.
export function FeedbackReportView({ load, upgradeLink = false }: { load: () => Promise<ReportResponse>; upgradeLink?: boolean }) {
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
  if (!data || (data.status === "pending" && !data.report)) {
    return (
      <p className="text-sm text-muted flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> {tr("Writing your report. This takes up to a minute.")}
      </p>
    );
  }
  if (!data.report) return <p className="text-sm text-error">{tr("The report couldn't be made. Try again later.")}</p>;
  return <Report report={data.report} upgradeLink={upgradeLink} />;
}
