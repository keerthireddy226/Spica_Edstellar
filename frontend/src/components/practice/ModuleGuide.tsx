import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Headphones, Mic, Volume2, CheckCircle2, ListChecks, ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { SystemCheck } from "@/components/pretest/SystemCheck";
import type { TestItem } from "@/api/testSession";
import { testsLine, type PracticeContext } from "@/api/practiceSession";
import { AUDIO_FIRST_TYPES } from "@/lib/testItemDisplay";
import { tr } from "@/i18n/tr";

// How an answer of this kind is scored, in plain words.
function scoringNote(items: TestItem[]): string[] {
  const methods = new Set(items.map((i) => i.inputMethod));
  const types = new Set(items.map((i) => i.itemTypeId));
  const notes: string[] = [];
  if (methods.has("mic")) {
    if (["repeats", "reading", "sentence_builds"].some((t) => types.has(t)))
      notes.push(tr("Your recording is turned into text and compared word by word with the sentence you heard or read. Every word counts; your accent doesn't."));
    if (["conversations", "short_answer", "passage_comprehension", "reading_selective"].some((t) => types.has(t)))
      notes.push(tr("Your recording is turned into text and checked against the right answer. A short answer with the key words is enough."));
    if (["open_questions", "story_retelling", "speaking_situations"].some((t) => types.has(t)))
      notes.push(tr("Your recording is turned into text and judged on what you say (the task), grammar, vocabulary and how smoothly you speak."));
    notes.push(tr("At the end you see which answers were right, the right answers, and your recordings to listen to."));
  }
  if (methods.has("text") || methods.has("textarea") || methods.has("two-phase")) {
    if (["dictation", "typing", "sentence_completion"].some((t) => types.has(t)))
      notes.push(tr("Typed answers are checked against the right answer: spelling and every word count. British and American spellings are both fine."));
    if (["email_writing", "summary_and_opinion", "passage_reconstruction", "free_writing"].some((t) => types.has(t)))
      notes.push(tr("Written answers are judged on covering the task, grammar, vocabulary and organisation."));
  }
  if (methods.has("radio") || methods.has("mcq_group")) notes.push(tr("Choose one option; it's right or wrong."));
  return notes;
}

// Every time a Practice Modules set starts or resumes: a device check
// (internet always, speakers when the set plays audio, microphone when answers
// are spoken), then how it works and how it's scored.
export function ModuleGuide({
  items,
  context,
  typeName,
  instruction,
  onStart,
  onBack,
  resumeAt,
}: {
  // Resuming: the question the learner continues from (1-based).
  resumeAt?: number;
  items: TestItem[];
  context: PracticeContext | null;
  typeName: string;
  instruction: string;
  onStart: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const needsMic = items.some((i) => i.inputMethod === "mic");
  const needsSpeaker = items.some((i) => AUDIO_FIRST_TYPES.has(i.itemTypeId));
  const [stage, setStage] = useState<"check" | "guide">("check");
  const checks = [tr("internet"), needsSpeaker ? tr("speakers") : null, needsMic ? tr("microphone") : null].filter(Boolean).join(", ");

  if (stage === "check") {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-3">
        <p className="text-sm text-muted text-center">{tr("First a quick check of your {{checks}}, so the set runs smoothly and your answers are captured.", { checks })}</p>
        <SystemCheck
          needs={{ mic: needsMic, speaker: needsSpeaker }}
          onBack={onBack}
          onPassed={() => setStage("guide")}
        />
      </div>
    );
  }

  const minutes = Math.max(1, Math.round(items.reduce((n, i) => n + (i.questionSeconds ?? i.timerSeconds ?? 60), 0) / 60));
  const steps: [LucideIcon, string][] = [
    [ListChecks, tr("{{n}} questions, about {{m}} min in all.", { n: items.length, m: minutes })],
    ...(needsSpeaker ? ([[Headphones, tr("Press Play to hear each question. You can play it again if you need to.")]] as [LucideIcon, string][]) : []),
    ...(needsMic ? ([[Mic, tr("Press the microphone, speak your answer, then press it again to stop. Speak clearly in a quiet place.")]] as [LucideIcon, string][]) : []),
    [Clock, tr("Each question has a countdown. It beeps in the last 5 seconds; press the speaker icon next to it to mute the beeps.")],
    [Volume2, tr("You can skip a question or go back to one. A skipped question gets no marks.")],
    [CheckCircle2, tr("After each answer you see if it's right and the correct answer. A spoken answer can take a few seconds to score; you can go on meanwhile.")],
  ];

  return (
    <div className="max-w-2xl mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-5">
      <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm text-muted hover:text-ink cursor-pointer">
        <ArrowLeft size={15} /> {tr("Back")}
      </button>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">
          {[context?.skill ? t(`skills.${context.skill}`) : null, context?.unitName, context?.setName].filter(Boolean).join(" · ")}
        </p>
        <h1 className="font-display font-bold text-2xl text-ink mt-1">{typeName}</h1>
        {context?.tests?.length ? (
          <p className="text-sm text-navy-deep mt-1">{tr("A question type in these Versant tests: {{tests}}", { tests: testsLine(context.tests) })}</p>
        ) : null}
        <p className="text-sm text-ink mt-2 leading-relaxed">{instruction}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">{tr("How it works")}</h2>
        {steps.map(([Icon, text]) => (
          <p key={text} className="flex items-start gap-2.5 text-sm text-ink">
            <Icon size={16} className="text-navy-deep shrink-0 mt-0.5" /> {text}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-2 bg-paper-warm rounded-card p-4">
        <h2 className="text-sm font-semibold text-ink">{tr("How you're scored")}</h2>
        {scoringNote(items).map((text) => (
          <p key={text} className="flex items-start gap-2.5 text-sm text-ink">
            <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> {text}
          </p>
        ))}
      </div>
      <Button onClick={onStart} className="w-full">
        {resumeAt ? tr("Resume from question {{n}} of {{total}}", { n: resumeAt, total: items.length }) : tr("Start")}
      </Button>
    </div>
  );
}
