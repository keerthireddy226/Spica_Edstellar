import { registerHandler } from "./queue.js";
import { every } from "./schedule.js";
import { sendQueuedNotificationEmail } from "../notifications/service.js";
import { runAllJobs } from "../notifications/jobs.js";
import { refreshActivityRollup } from "../analytics/rollup.js";

// Every queue the app uses, in one place.
export function registerJobs() {
  registerHandler("email.notification", (p) => sendQueuedNotificationEmail(p as Parameters<typeof sendQueuedNotificationEmail>[0]));

  every(15, "notifications.run", async () => {
    const r = await runAllJobs();
    if (r && Object.values(r).some((n) => n > 0)) console.log("notification jobs:", r);
  });
  every(15, "analytics.rollup", async () => {
    await refreshActivityRollup(2);
  });
}
