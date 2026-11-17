import { tr } from "@/i18n/tr";
import type { TestItem } from "@/api/testSession";
import { beginAudioBusy } from "@/lib/audioBusy";

// Plays the question's recorded audio (Google Neural2 voices). There is no
// browser-voice fallback: a question without a recording, or one that fails
// to load, plays nothing and reports "missing" so the page can say so.
// onProgress: the playing position and length in seconds, a few times a second
// (used to light up the speaker who is talking in a conversation).
export function playSpokenAudio(
  item: TestItem,
  _segments: string[],
  onProgress?: (seconds: number, duration: number) => void,
): Promise<"played" | "missing" | "stopped"> {
  const done = beginAudioBusy();
  return play(item, onProgress).finally(done);
}

// The recording playing now, so moving to another question can stop it.
let stopCurrent: (() => void) | null = null;

// Stops the question's recording (Skip, Back, Next, leaving the page).
export function stopSpokenAudio() {
  stopCurrent?.();
}

function play(item: TestItem, onProgress?: (seconds: number, duration: number) => void): Promise<"played" | "missing" | "stopped"> {
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
    if (onProgress) audio.ontimeupdate = () => onProgress(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onended = () => resolve("played");
    audio.onerror = fail;
    audio.play().catch(fail);
  }).finally(() => {
    stopCurrent = null;
  });
}

// The question recording's length in seconds (null if it has none or can't load
// within 4 s). Used to know how long a test taker can wait before pressing Play.
export function spokenAudioSeconds(item: TestItem): Promise<number | null> {
  if (!item.audioUrl) return Promise.resolve(null);
  return new Promise<number | null>((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    const t = setTimeout(() => resolve(null), 4000);
    audio.onloadedmetadata = () => {
      clearTimeout(t);
      resolve(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    audio.src = item.audioUrl!;
  });
}

// Loads the next questions' recordings ahead of time, so pressing Next plays
// at once instead of waiting for the download. Each recording is loaded once.
const preloaded = new Set<string>();
export function preloadSpokenAudio(items: (TestItem | undefined)[]) {
  for (const item of items) {
    const url = item?.audioUrl;
    if (!url || preloaded.has(url)) continue;
    preloaded.add(url);
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
  }
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
