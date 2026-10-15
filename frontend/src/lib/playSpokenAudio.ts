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
    audio.onended = () => resolve();
    audio.onerror = () => speak(segments).then(resolve);
    audio.play().catch(() => speak(segments).then(resolve));
  });
}
