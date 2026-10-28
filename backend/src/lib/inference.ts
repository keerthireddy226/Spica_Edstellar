// The image models (face detection and matching, liveness, objects) share the
// server's CPU with everything else. Each runs on one thread, and only one
// runs at a time, so a burst of camera photos can't starve answer hand-ins
// and page loads (on a one-CPU server they used to time out).
export const ORT_OPTIONS = { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: "sequential" as const };

let chain: Promise<unknown> = Promise.resolve();

export function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}
