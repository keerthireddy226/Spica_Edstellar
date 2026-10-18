// The question countdown's beeps (last seconds) and the learner's mute choice,
// which stays for every later question and visit.
let ctx: AudioContext | null = null;

export function beep(frequency = 880, ms = 110) {
  try {
    ctx ??= new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    // Quiet, so it doesn't drown a recording in progress.
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    // No audio output: the countdown still shows.
  }
}

const MUTE_KEY = "spica.countdownMuted";

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
