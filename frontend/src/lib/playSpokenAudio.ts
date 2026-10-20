import { tr } from "@/i18n/tr";
import type { TestItem } from "@/api/testSession";
import { beginAudioBusy } from "@/lib/audioBusy";

// Plays the question's recorded audio (Google Neural2 voices). There is no
// browser-voice fallback: a question without a recording, or one that fails
// to load, plays nothing and reports "missing" so the page can say so.
export function playSpokenAudio(item: TestItem, _segments: string[]): Promise<"played" | "missing" | "stopped"> {
  const done = beginAudioBusy();
  return play(item).finally(done);
}

// The recording playing now, so moving to another question can stop it.
let stopCurrent: (() => void) | null = null;

// Stops the question's recording (Skip, Back, Next, leaving the page).
export function stopSpokenAudio() {
  stopCurrent?.();
}

function play(item: TestItem): Promise<"played" | "missing" | "stopped"> {
  stopSpokenAudio();
  if (!item.audioUrl) return Promise.resolve("missing");
  return new Promise<"played" | "missing" | "stopped">((resolve) => {
    const audio = new Audio(item.audioUrl!);
    stopCurrent = () => {
      audio.pause();
      resolve("stopped");
    };
    // A failed recording can report twice (load error and play() rejecting).
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      audio.pause();
      resolve("missing");
    };
    audio.onended = () => resolve("played");
    audio.onerror = fail;
    audio.play().catch(fail);
  }).finally(() => {
    stopCurrent = null;
  });
}

export const NO_RECORDING_TEXT = () => tr("This question's recording isn't available yet, so there's nothing to play. Skip it for now.");

// A fixed recorded clip (voice preview, demo question); resolves when it ends or fails.
export function playClip(url: string): Promise<void> {
  const done = beginAudioBusy();
  return new Promise<void>((resolve) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.play().catch(() => resolve());
  }).finally(done);
}
