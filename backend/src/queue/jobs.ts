import { registerHandler } from "./queue.js";
import { deliverWebhook } from "../webhooks/service.js";
import { buildExport, eraseLearner, runRetention } from "../governance/service.js";
import { every } from "./schedule.js";
import { sendQueuedNotificationEmail } from "../notifications/service.js";
import { runAllJobs } from "../notifications/jobs.js";
import { refreshActivityRollup } from "../analytics/rollup.js";
import { autoCompleteBatches } from "../batches/lifecycle.js";
import { runScheduledReports } from "../reports/service.js";
import { runContractRenewalAlerts } from "../admin/renewals.js";
import { runVoiceCheck } from "../proctoring/voiceCheck.js";
import { analyzeSession } from "../proctoring/analyze.js";
import { runRecruitmentLifecycle } from "../recruitment/service.js";
import { sendIntegrityDigests } from "../proctoring/alerts.js";
import { gradeSpeakingAttempt, sweepStuckSpeaking } from "../attemptGrading.js";
import { runProgramsDaily } from "../programs/service.js";
import { resumeStaleJobs } from "../generation/pipeline.js";
import { flagByStatistics } from "../generation/stats.js";

// Every queue the app uses, in one place.
export function registerJobs() {
  registerHandler("data.export", (p) => buildExport(p.exportId));
  registerHandler("webhook.deliver", (p, job) => deliverWebhook(p.deliveryId, job.attempts));
  // Voice consistency after a proctored test, then the session is re-scored.
  registerHandler("proctoring.voice", async (p) => {
    await runVoiceCheck(p.sessionId);
    await analyzeSession(p.sessionId);
  });
  // A recorded answer saved without waiting for Gemini; the last try grades
  // on the browser's transcript rather than leave it ungraded.
  registerHandler("grading.speaking", (p, job) => gradeSpeakingAttempt(p.attemptId, { final: job.attempts >= 4 }));
  registerHandler("grading.speaking.retry", (p, job) => gradeSpeakingAttempt(p.attemptId, { final: job.attempts >= 3 }));
  registerHandler("email.notification", (p) => sendQueuedNotificationEmail(p as Parameters<typeof sendQueuedNotificationEmail>[0]));

  every(15, "grading.speaking.sweep", async () => {
    const n = await sweepStuckSpeaking();
    if (n > 0) console.log(`speaking grading: ${n} stuck answers queued again`);
  });
  every(15, "notifications.run", async () => {
    const r = await runAllJobs();
    if (r && Object.values(r).some((n) => n > 0)) console.log("notification jobs:", r);
  });
  every(15, "analytics.rollup", async () => {
    await refreshActivityRollup(2);
  });
  every(60, "batches.lifecycle", async () => {
    await autoCompleteBatches();
  });
  every(60, "reports.scheduled", async () => {
    await runScheduledReports();
  });
  every(60, "recruitment.lifecycle", async () => {
    const r = await runRecruitmentLifecycle((userId) => eraseLearner({ userId, actorId: null, actorRole: "system", reason: "Candidate retention period ended" }));
    if (r.expired || r.reminded || r.erased) console.log("recruitment:", r);
  });
  every(60, "integrity.digest", async () => {
    const n = await sendIntegrityDigests();
    if (n) console.log("integrity summaries sent:", n);
  });
  // Missed items, finished programs and plans for new batch members (dates
  // are whole days, so running hourly changes nothing twice).
  every(60, "programs.daily", async () => {
    const r = await runProgramsDaily();
    if (r.missed || r.completed || r.planned) console.log("programs:", r);
  });
  // Question generation jobs interrupted by a restart carry on.
  every(15, "generation.resume", async () => {
    await resumeStaleJobs();
  });
  // Questions whose answers look wrong statistically go back to review.
  every(24 * 60, "content.statistics", async () => {
    const n = await flagByStatistics();
    if (n) console.log(`content: ${n} questions sent to review on their statistics`);
  });
  every(60, "contracts.renewals", async () => {
    await runContractRenewalAlerts();
  });
  every(24 * 60, "data.retention", async () => {
    const r = await runRetention();
    if (r.recordings || r.erased || r.expiredExports || r.proctoringMedia) console.log("retention:", r);
  });
}
