import { speak } from "@/hooks/useVoiceRecorder";
import type { TestItem } from "@/api/testSession";
import { beginAudioBusy } from "@/lib/audioBusy";

// Prefers pre-generated AI audio over browser speechSynthesis — falls back on missing URL or any error.
export function playSpokenAudio(item: TestItem, segments: string[]): Promise<void> {
  const done = beginAudioBusy();
  return play(item, segments).finally(done);
}

function play(item: TestItem, segments: string[]): Promise<void> {
  if (!item.audioUrl) return speak(segments);

  return new Promise((resolve) => {
    const audio = new Audio(item.audioUrl!);
    // A failed recording can report twice (load error and play() rejecting):
    // the browser voice reads the text once.
    let fellBack = false;
    const fallBack = () => {
      if (fellBack) return;
      fellBack = true;
      audio.pause();
      speak(segments).then(resolve);
    };
    audio.onended = () => resolve();
    audio.onerror = fallBack;
    audio.play().catch(fallBack);
  });
}
