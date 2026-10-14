import { enqueue, registerHandler, startWorker, type JobHandler } from "./queue.js";

interface Periodic {
  queue: string;
  everyMinutes: number;
  handler: JobHandler;
}

const periodic: Periodic[] = [];

// Periodic work is enqueued once per time slot (the dedupe key is the slot),
// so with several API instances each slot still runs exactly once, on
// whichever worker grabs it first.
export function every(minutes: number, queue: string, handler: JobHandler) {
  periodic.push({ queue, everyMinutes: minutes, handler });
  registerHandler(queue, handler);
}

export async function enqueueDuePeriodic(now = Date.now()) {
  for (const p of periodic) {
    const slot = Math.floor(now / (p.everyMinutes * 60_000));
    await enqueue(p.queue, { slot }, { dedupeKey: `periodic:${p.queue}:${slot}`, maxAttempts: 3 });
  }
}

export function startScheduler() {
  if (process.env.JOBS_ENABLED === "false") return;
  const tick = () => enqueueDuePeriodic().catch((err) => console.error("scheduler error:", err));
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);
  startWorker();
}
