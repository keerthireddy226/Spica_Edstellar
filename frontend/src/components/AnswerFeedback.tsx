import { CheckCircle2, Loader2, XCircle, AlertCircle } from "lucide-react";
import type { PracticeFeedback } from "@/api/practiceTests";
import type { TestItem } from "@/api/testSession";
import { getGroupQuestions, getOptions } from "@/lib/testItemDisplay";
import { tr } from "@/i18n/tr";

// Shown after each answer in practice mode: right or wrong, the correct
// answer, and the grader's reason for writing and speaking.
export function AnswerFeedback({ item, feedback }: { item: TestItem; feedback: PracticeFeedback }) {
  const key = feedback.answer;
  const questions = key?.indexes ? getGroupQuestions(item) : [];
  const options = key?.index !== undefined ? getOptions(item) : [];
  const groupRight = key?.indexes && feedback.score !== null ? Math.round(feedback.score * key.indexes.length) : null;

  const header =
    feedback.status === "pending"
      ? { icon: <Loader2 size={18} className="animate-spin" />, text: tr("Scoring your answer…"), cls: "text-navy-deep bg-navy/10 border-navy/20" }
      : feedback.status === "failed"
        ? { icon: <AlertCircle size={18} />, text: tr("This answer couldn't be scored yet. It will be in your result."), cls: "text-muted bg-paper-warm border-rule" }
        : feedback.correct
          ? { icon: <CheckCircle2 size={18} />, text: tr("Correct"), cls: "text-success bg-success/10 border-success/25" }
          : { icon: <XCircle size={18} />, text: tr("Not quite"), cls: "text-error bg-error/10 border-error/25" };

  return (
    <div className={`rounded-card border p-4 flex flex-col gap-2.5 ${header.cls}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2 font-semibold text-sm">
        {header.icon}
        {header.text}
        {groupRight !== null && feedback.status === "scored" && (
          <span className="ml-auto text-xs font-mono">{tr("{{right}} of {{total}} right", { right: groupRight, total: key!.indexes!.length })}</span>
        )}
      </div>
      {feedback.status !== "pending" && (
        <div className="flex flex-col gap-2 text-sm text-ink">
          {key?.index !== undefined && options[key.index] !== undefined && (
            <p>
              <span className="font-semibold">{tr("Correct answer:")}</span> {options[key.index]}
            </p>
          )}
          {key?.indexes && (
            <div>
              <span className="font-semibold">{tr("Correct answers:")}</span>
              <ol className="list-decimal pl-5 mt-1 flex flex-col gap-0.5">
                {key.indexes.map((ix, i) => (
                  <li key={i}>{questions[i]?.options[ix] ?? "—"}</li>
                ))}
              </ol>
            </div>
          )}
          {key?.text && (
            <p>
              <span className="font-semibold">{tr("Model answer:")}</span> {key.text}
            </p>
          )}
          {key?.points && key.points.length > 0 && (
            <div>
              <span className="font-semibold">{tr("A good answer covers:")}</span>
              <ul className="list-disc pl-5 mt-1 flex flex-col gap-0.5">
                {key.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {feedback.reason && (
            <p>
              <span className="font-semibold">{tr("Why:")}</span> {feedback.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
