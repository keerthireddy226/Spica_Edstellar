import { useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/Button";
import { AnswerInputControl } from "@/components/AnswerInputControl";
import type { TestItem } from "@/api/testSession";
import type { CoachAnswer } from "@/api/coach";
import { blobToBase64, useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { AUDIO_FIRST_TYPES, getPassageAndQuestion, getSpokenSegments, getVisibleText } from "@/lib/testItemDisplay";
import { playSpokenAudio } from "@/lib/playSpokenAudio";
import { tr } from "@/i18n/tr";

// A coached question inside the chat: the question (or its recording), the
// answer control, and Check. Once answered it stays, read-only, with the answer.
export function CoachQuestionCard({
  item,
  answered,
  onSubmit,
}: {
  item: TestItem;
  // The answer given (the card is then read-only), or null.
  answered: string | null;
  onSubmit: (answer: CoachAnswer) => Promise<void>;
}) {
  // Speaking: the recording (and the browser's transcript as a fallback).
  const { recording, start, stop } = useVoiceRecorder();
  const [audio, setAudio] = useState<{ base64: string; mimeType: string; durationMs: number; url: string } | null>(null);
  const [micError, setMicError] = useState(false);
  const mic = item.inputMethod === "mic";
  async function toggleRecord() {
    setMicError(false);
    if (!recording) {
      try {
        await start();
      } catch {
        setMicError(true);
      }
      return;
    }
    const r = await stop();
    if (r.transcript) setAnswerText(r.transcript);
    if (r.blob) setAudio({ base64: await blobToBase64(r.blob), mimeType: r.mimeType, durationMs: r.durationMs, url: URL.createObjectURL(r.blob) });
  }
  const [answerText, setAnswerText] = useState(answered ?? "");
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [noAudio, setNoAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const audioFirst = AUDIO_FIRST_TYPES.has(item.itemTypeId);
  const pq = !audioFirst ? getPassageAndQuestion(item) : null;
  const locked = answered !== null;

  async function play() {
    setPlaying(true);
    const r = await playSpokenAudio(item, getSpokenSegments(item));
    setPlaying(false);
    if (r === "missing") setNoAudio(true);
    else setHasPlayed(true);
  }

  async function submit() {
    setBusy(true);
    try {
      const activeMs = Date.now() - shownAt.current;
      await onSubmit(
        mic && audio
          ? { audioBase64: audio.base64, audioMimeType: audio.mimeType, durationMs: audio.durationMs, responseText: answerText || undefined, activeMs }
          : { responseText: answerText, activeMs },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mt-2 flex flex-col gap-3 rounded-xl border border-rule bg-paper/60 p-3 ${locked ? "opacity-80 pointer-events-none" : ""}`}>
      {item.instructionText && <p className="text-xs text-muted">{item.instructionText}</p>}
      {audioFirst ? (
        <div className="flex items-center gap-3">
          <button
            onClick={play}
            disabled={playing || locked}
            aria-label={tr("Play the question")}
            className="h-11 w-11 rounded-full bg-navy text-white flex items-center justify-center cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Volume2 size={18} />
          </button>
          <span className="text-sm text-muted">{playing ? tr("Playing…") : hasPlayed ? tr("Play again") : tr("Play the question")}</span>
          {noAudio && <span className="text-xs text-error">{tr("This question's recording isn't available. Ask me for another one.")}</span>}
        </div>
      ) : pq ? (
        <>
          <p className="text-sm text-ink bg-surface rounded-lg border border-rule p-3 whitespace-pre-wrap leading-relaxed">{pq.passage}</p>
          <p className="text-sm font-semibold text-ink">{pq.question}</p>
        </>
      ) : (
        <p className="text-sm text-ink bg-surface rounded-lg border border-rule p-3 whitespace-pre-wrap leading-relaxed">{getVisibleText(item)}</p>
      )}
      <AnswerInputControl
        item={item}
        answerText={answerText}
        onAnswerTextChange={locked ? () => {} : setAnswerText}
        recording={recording}
        onToggleRecord={locked ? () => {} : toggleRecord}
        audioBlobUrl={audio?.url ?? null}
        needsAudioFirst={audioFirst}
        hasPlayed={hasPlayed || locked}
        playing={playing}
        textareaRows={4}
      />
      {micError && <p className="text-xs text-error">{tr("Your microphone couldn't start. Allow microphone access in your browser.")}</p>}
      {!locked && (
        <Button onClick={submit} disabled={busy || recording || (mic ? !audio : !answerText.trim())} className="self-end">
          {busy ? tr("Checking…") : tr("Check my answer")}
        </Button>
      )}
    </div>
  );
}
