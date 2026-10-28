// Every camera, microphone and screen stream the app opens, so a finished test
// can turn them all off at once: the camera light goes out straight away,
// whichever part of the test page opened it (monitoring, face checks, the
// room check, recording an answer).
const live = new Set<MediaStream>();
let installed = false;

export function trackMediaStreams() {
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (installed || !md) return;
  installed = true;
  const wrap = <A extends unknown[]>(open: (...a: A) => Promise<MediaStream>) =>
    async (...a: A) => {
      const s = await open(...a);
      live.add(s);
      return s;
    };
  if (md.getUserMedia) md.getUserMedia = wrap(md.getUserMedia.bind(md));
  if (md.getDisplayMedia) md.getDisplayMedia = wrap(md.getDisplayMedia.bind(md));
}

export function stopAllMedia() {
  for (const s of live) s.getTracks().forEach((t) => t.stop());
  live.clear();
}
