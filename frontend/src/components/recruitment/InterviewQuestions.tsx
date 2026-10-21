import { useTranslation } from "react-i18next";
import type { InterviewQuestion } from "@/api/recruitment";
import { trServer } from "@/i18n/serverText";
import { tr } from "@/i18n/tr";

// Questions for the interview, aimed at the skills the test showed weakest
// (or below the job's minimum), each with what a good answer shows.
export function InterviewQuestionList({ questions, print = false }: { questions: InterviewQuestion[]; print?: boolean }) {
  const { t } = useTranslation();
  if (!questions.length) return null;
  const skills = [...new Set(questions.map((q) => q.skill))];
  return (
    <div className="flex flex-col gap-3">
      {skills.map((s) => {
        const qs = questions.filter((q) => q.skill === s);
        return (
          <div key={s} className="flex flex-col gap-1.5">
            <p className={`text-sm font-semibold ${print ? "" : "text-ink"}`}>
              {t(`skills.${s}`)} · {qs[0].level} ·{" "}
              <span className={print ? "font-normal text-black/60" : "font-normal text-muted"}>
                {qs[0].reason === "below_minimum" ? tr("below the job's minimum") : tr("weakest skill in the test")}
              </span>
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-sm">
              {qs.map((q) => (
                <li key={q.question}>
                  {trServer(q.question)}
                  <span className={`block text-xs ${print ? "text-black/60" : "text-muted"}`}>
                    {tr("Listen for:")} {trServer(q.listenFor)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
