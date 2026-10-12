import { Mic, Square, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TestItem } from "@/api/testSession";
import { getOptions } from "@/lib/testItemDisplay";

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

  if (item.inputMethod === "radio") {
    return (
      <div className="flex flex-col gap-2.5">
        {getOptions(item).map((option, i) => {
          const letter = String.fromCharCode(65 + i);
          const selected = answerText === String(i);
          return (
            <button
              key={i}
              onClick={() => onAnswerTextChange(String(i))}
              className={`flex items-center gap-3 text-left rounded-card border-2 px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
                selected
                  ? "border-accent bg-accent/10 text-ink shadow-sm"
                  : "border-rule hover:border-rule-strong hover:bg-paper-warm/60"
              }`}
            >
              <span
                className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  selected ? "bg-accent text-white" : "bg-paper-warm text-muted"
                }`}
              >
                {letter}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    );
  }

  if (item.inputMethod === "mic") {
    return (
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onToggleRecord}
          disabled={playing || (needsAudioFirst && !hasPlayed)}
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
    return (
      <textarea
        value={answerText}
        onChange={(e) => onAnswerTextChange(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        placeholder={t("placementTest.answerPlaceholder")}
        className="w-full rounded-card border border-rule bg-surface px-4 py-3 text-sm text-ink shadow-sm focus:border-navy focus:outline-none transition-colors"
        rows={textareaRows}
      />
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
