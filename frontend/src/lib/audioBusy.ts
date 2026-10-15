// Tells proctoring's microphone monitor when speech is expected: the learner
// recording an answer, or a question's audio playing through the speakers.
// Talking picked up at any other time is flagged for review.
let active = 0;
let quietAfter = 0;
// Speaker echo and the end of a sentence trail on a little.
const GRACE_MS = 1500;

export function beginAudioBusy(): () => void {
  active++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active = Math.max(0, active - 1);
    quietAfter = Date.now() + GRACE_MS;
  };
}

export function isAudioBusy(): boolean {
  return active > 0 || Date.now() < quietAfter;
}
