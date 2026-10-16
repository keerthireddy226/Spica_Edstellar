import { useEffect, useState } from "react";
import { Mic, Square, CheckCircle2, Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TestItem } from "@/api/testSession";
import { getGroupQuestions, getOptions, parseGroupAnswer } from "@/lib/testItemDisplay";
import { tr } from "@/i18n/tr";

function OptionButton({ letter, label, selected, onClick }: { letter: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 text-left rounded-card border-2 px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
        selected ? "border-accent bg-accent/10 text-ink shadow-sm" : "border-rule hover:border-rule-strong hover:bg-paper-warm/60"
      }`}
    >
      <span
        className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
          selected ? "bg-accent text-white" : "bg-paper-warm text-muted"
        }`}
      >
        {letter}
      </span>
      {label}
    </button>
  );
}

// Several questions on one recording or text; the answer is a JSON array of
// chosen option indexes, one per question.
function GroupedQuestions({ item, answerText, onChange }: { item: TestItem; answerText: string; onChange: (value: string) => void }) {
  const questions = getGroupQuestions(item);
  const chosen = parseGroupAnswer(answerText, questions.length);
  return (
    <div className="flex flex-col gap-5 w-full">
      {questions.map((q, qi) => (
        <div key={qi} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">
            {qi + 1}. {q.stem ?? tr("Gap {{n}}", { n: qi + 1 })}
          </p>
          {q.options.map((option, oi) => (
            <OptionButton
              key={oi}
              letter={String.fromCharCode(65 + oi)}
              label={option}
              selected={chosen[qi] === oi}
              onClick={() => onChange(JSON.stringify(chosen.map((c, i) => (i === qi ? oi : c))))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Preparation time before a spoken answer (LanguageCert-style speaking);
// the learner can also start early.
function usePrepCountdown(item: TestItem): { left: number; skip: () => void } {
  const [left, setLeft] = useState(item.prepSeconds ?? 0);
  useEffect(() => {
    setLeft(item.prepSeconds ?? 0);
  }, [item.id, item.prepSeconds]);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return { left, skip: () => setLeft(0) };
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

interface AnswerInputControlProps {
  item: TestItem;
  answerText: string;
  onAnswerTextChange: (value: string) => void;
  recording: boolean;
  onToggleRecord: () => void;
  audioBlobUrl: string | null;
  needsAudioFirst: boolean;
  hasPlayed: boolean;
  playing: boolean;
  stopIconSize?: number;
  textareaRows?: number;
}

// Radio/mic/textarea/plain-text answer control shared by PlacementTest and Modules.
export function AnswerInputControl({
  item,
  answerText,
  onAnswerTextChange,
  recording,
  onToggleRecord,
  audioBlobUrl,
  needsAudioFirst,
  hasPlayed,
  playing,
  stopIconSize = 20,
  textareaRows = 5,
}: AnswerInputControlProps) {
  const { t } = useTranslation();
  const prep = usePrepCountdown(item);
  const c = item.content as Record<string, unknown>;
  // Discussion ideas or talk points shown with a speaking prompt.
  const promptList = (Array.isArray(c.ideas) ? c.ideas : Array.isArray(c.points) ? c.points : []) as string[];

  if (item.inputMethod === "mcq_group") {
    return <GroupedQuestions item={item} answerText={answerText} onChange={onAnswerTextChange} />;
  }

  if (item.inputMethod === "radio") {
    return (
      <div className="flex flex-col gap-2.5 w-full">
        {needsAudioFirst && typeof c.question === "string" && <p className="text-sm font-semibold text-ink">{c.question}</p>}
        {getOptions(item).map((option, i) => (
          <OptionButton
            key={i}
            letter={String.fromCharCode(65 + i)}
            label={option}
            selected={answerText === String(i)}
            onClick={() => onAnswerTextChange(String(i))}
          />
        ))}
      </div>
    );
  }

  if (item.inputMethod === "mic") {
    return (
      <div className="flex flex-col items-center gap-3 w-full">
        {promptList.length > 0 && (
          <ul className="self-stretch list-disc text-sm text-ink flex flex-col gap-1 bg-paper-warm rounded-card p-4 pl-8">
            {promptList.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {prep.left > 0 && !recording && (
          <div className="flex flex-col items-center gap-1.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Hourglass size={16} /> {tr("Preparation time: {{s}} s", { s: prep.left })}
            </span>
            <button onClick={prep.skip} className="text-xs font-semibold text-navy-deep underline underline-offset-4 cursor-pointer">
              {tr("I'm ready, start now")}
            </button>
          </div>
        )}
        <button
          onClick={onToggleRecord}
          disabled={playing || (needsAudioFirst && !hasPlayed) || (prep.left > 0 && !recording)}
          className={`h-14 w-14 rounded-full flex items-center justify-center shadow-[0_8px_18px_-8px_rgba(0,0,0,0.3)] transition-transform hover:scale-105 disabled:opacity-60 disabled:hover:scale-100 cursor-pointer disabled:cursor-not-allowed ${
            recording ? "bg-error text-white" : "bg-navy text-lime btn-shine"
          }`}
        >
          {recording ? <Square size={stopIconSize} /> : <Mic size={22} />}
        </button>

        {recording ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-error">{t("placementTest.stopRecording")}</span>
            <span className="flex items-center gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="recording-dot h-2 w-2 rounded-full bg-error"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
          </div>
        ) : (
          <span className="text-sm font-medium text-muted">
            {audioBlobUrl ? t("placementTest.recordAgain") : t("placementTest.record")}
          </span>
        )}

        {audioBlobUrl && !recording && (
          <div className="flex flex-col items-center gap-2 w-full">
            <span className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 size={18} />
              {t("placementTest.audioSaved")}
            </span>
            <audio controls src={audioBlobUrl} className="w-full h-9" />
          </div>
        )}
      </div>
    );
  }

  if (item.inputMethod === "textarea") {
    const words = wordCount(answerText);
    const outOfRange = (item.minWords != null && words < item.minWords) || (item.maxWords != null && words > item.maxWords);
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <textarea
          value={answerText}
          onChange={(e) => onAnswerTextChange(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          placeholder={t("placementTest.answerPlaceholder")}
          className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink shadow-sm focus:border-navy focus:outline-none transition-colors"
          rows={item.maxWords && item.maxWords > 120 ? 12 : textareaRows}
        />
        {(item.minWords != null || item.maxWords != null) && (
          <span className={`self-end text-xs font-mono ${outOfRange ? "text-warning" : "text-muted"}`}>
            {item.maxWords != null
              ? tr("{{n}} words ({{min}}-{{max}})", { n: words, min: item.minWords ?? 0, max: item.maxWords })
              : tr("{{n}} words (at least {{min}})", { n: words, min: item.minWords })}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={answerText}
      onChange={(e) => onAnswerTextChange(e.target.value)}
      onPaste={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
      placeholder={t("placementTest.answerPlaceholder")}
      className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink shadow-sm focus:border-navy focus:outline-none transition-colors"
    />
  );
}
