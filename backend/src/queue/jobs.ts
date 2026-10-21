import { registerHandler } from "./queue.js";
import { issueDueResultCertificates } from "../assessment/service.js";
import { refundExpiredTests } from "../orgTests/service.js";
import { runAutoCertificates } from "../certificates/course.js";
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
import { applyDueDowngrades } from "../plans/service.js";
import { runProgramAlerts } from "../programs/monitoring.js";
import { resumeStaleJobs } from "../generation/pipeline.js";
import { flagByStatistics } from "../generation/stats.js";
import { continueAutoBuilds } from "../builder/autoBuild.js";
import { buildReport, reportReady } from "../reports/feedbackReport.js";

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
  // The feedback report after a test; waits (retries) while recorded answers are still being graded.
  registerHandler("report.build", async (p, job) => {
    if (!(await reportReady(p.sessionId)) && job.attempts < 4) throw new Error("report: answers still being graded, will retry");
    await buildReport(p.sessionId);
  });
  registerHandler("email.notification", (p) => sendQueuedNotificationEmail(p as Parameters<typeof sendQueuedNotificationEmail>[0]));

  // Real assessment attempts: certificates once scored and proctoring is clear.
  every(60, "certificates.auto", async () => {
    const r = await runAutoCertificates();
    if (r.requested > 0) console.log(`course certificates: ${r.requested} requested, ${r.issued} issued`);
  });
  every(60, "org-tests.refunds", async () => {
    const n = await refundExpiredTests();
    if (n > 0) console.log(`org tests: ${n} unused real tests refunded`);
  });
  every(5, "assessment.certificates", async () => {
    const n = await issueDueResultCertificates();
    if (n > 0) console.log(`result certificates: ${n} issued`);
  });
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
  // Organizations that chose a lower plan move to it on its day.
  every(60, "plans.downgrades", async () => {
    const n = await applyDueDowngrades();
    if (n) console.log(`plans: ${n} scheduled downgrades applied`);
  });
  every(60, "programs.daily", async () => {
    const r = await runProgramsDaily();
    if (r.missed || r.completed || r.planned || r.finalAssessments) console.log("programs:", r);
  });
  // Program alerts (at risk, inactive, missed mock) to Org Admins and Managers, once a day.
  every(24 * 60, "programs.alerts", async () => {
    const n = await runProgramAlerts();
    if (n) console.log(`programs: ${n} alert summaries sent`);
  });
  // One-click tests waiting for AI-written questions finish once those are in.
  every(1, "forms.autobuild", async () => {
    const n = await continueAutoBuilds();
    if (n) console.log(`builder: ${n} tests completed with AI questions`);
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
