import "dotenv/config";
import dns from "node:dns";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { pool } from "./db.js";
import { authRouter } from "./auth/routes.js";
import { onboardingRouter } from "./onboarding/routes.js";
import { placementRouter } from "./placement/routes.js";
import { roadmapRouter } from "./roadmap/routes.js";
import { dashboardRouter } from "./dashboard/routes.js";
import { practiceRouter } from "./practice/routes.js";
import { practiceTestsRouter } from "./practiceTests/routes.js";
import { adminRouter } from "./admin/routes.js";
import { orgAdminRouter } from "./orgAdmin/routes.js";
import { managerRouter } from "./manager/routes.js";
import { coachRouter } from "./coach/routes.js";
import { faceRouter } from "./face/routes.js";
import { requireAuth } from "./auth/middleware.js";
import { licensesRouter } from "./licenses/routes.js";
import { paymentsRouter, stripeWebhookHandler } from "./payments/routes.js";
import { notificationsRouter, remindersRouter } from "./notifications/routes.js";
import { registerJobs } from "./queue/jobs.js";
import { startScheduler } from "./queue/schedule.js";
import { analyticsRouter } from "./analytics/routes.js";
import { plansRouter } from "./plans/routes.js";
import { brandingRouter } from "./orgAdmin/branding.js";
import { staffConsoleRouter } from "./admin/console.js";
import { commercialRouter } from "./admin/commercial.js";
import { apiV1Router } from "./api/v1.js";
import { developerRouter } from "./api/manage.js";
import { governanceRouter, selfEraseRouter } from "./governance/routes.js";
import { ssoAdminRouter, ssoRouter } from "./sso/routes.js";
import { scimRouter } from "./sso/scim.js";
import { reportsRouter } from "./reports/routes.js";
import { certificatesRouter } from "./certificates/routes.js";
import { CERTIFICATE_AUDIT, MANAGER_AUDIT, ORG_ADMIN_AUDIT, auditTrail, STAFF_AUDIT } from "./audit/middleware.js";
import { PlanError } from "./plans/service.js";
import { BatchStateError } from "./batches/lifecycle.js";
import { DetailsError } from "./learners/details.js";
import { requireAccess } from "./licenses/gate.js";

// Railway's network has no IPv6 egress — without this, Node's dual-stack DNS
// resolution can still pick a host's IPv6 address (e.g. smtp.gmail.com) and
// fail with ENETUNREACH instead of falling back to IPv4.
dns.setDefaultResultOrder("ipv4first");

// Unset would make cors() below reflect any origin — fail loudly instead.
if (!process.env.FRONTEND_URL) {
  throw new Error("FRONTEND_URL must be set");
}

const app = express();

// Railway (and any platform behind a reverse proxy) forwards the real client
// IP via X-Forwarded-For — without this, req.ip is the proxy's own address
// for every request, breaking both rate-limiting and login IP logging.
app.set("trust proxy", 1);

app.use(helmet());
// Restricted to the actual frontend origin, not reflected for any caller —
// origin:true + credentials:true would let any site make credentialed requests.
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
// Raised from 100kb default — base64 audio/image payloads need the room.
// Stripe signs the raw request bytes, so its webhook must see them before JSON parsing.
app.post("/api/payments/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(morgan("dev"));
// Voice enrollment samples and attempt recordings live here — requiring a
// real session (not just an unguessable filename) before serving any of it.
app.use("/uploads", requireAuth, express.static("uploads"));

app.get("/api/health", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    next(err);
  }
});

app.use("/api/auth", authRouter, selfEraseRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/placement", requireAccess("placement"), placementRouter);
app.use("/api/roadmap", roadmapRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/practice", requireAccess("practice"), practiceRouter);
app.use("/api/practice-tests", requireAccess("mocktest"), practiceTestsRouter);
app.use("/api/coach", requireAccess("coach"), coachRouter);
app.use("/api/face", faceRouter);
app.use("/api/admin", auditTrail(STAFF_AUDIT), adminRouter);
app.use("/api/admin", commercialRouter);
app.use("/api/admin", staffConsoleRouter);
app.use("/api/org-admin", auditTrail(ORG_ADMIN_AUDIT), orgAdminRouter, developerRouter, governanceRouter, ssoAdminRouter);
app.use("/api/sso", ssoRouter);
app.use("/api/scim/v2", express.json({ type: ["application/json", "application/scim+json"] }), scimRouter);
app.use("/api/v1", apiV1Router);
app.use("/api/manager", auditTrail(MANAGER_AUDIT), managerRouter);
app.use("/api/licenses", licensesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/reminders", remindersRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/plans", plansRouter);
app.use("/api/branding", brandingRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/certificates", auditTrail(CERTIFICATE_AUDIT), certificatesRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_error", issues: err.issues });
  }
  // Any route can hit a plan gate; the details let the UI say which plan unlocks it.
  if (err instanceof PlanError) {
    return res.status(403).json({ error: err.code, ...err.detail });
  }
  if (err instanceof BatchStateError) {
    return res.status(err.code === "batch_not_found" ? 404 : 400).json({ error: err.code });
  }
  if (err instanceof DetailsError) {
    return res.status(409).json({ error: err.code });
  }
  console.error(err);
  res.status(500).json({ error: "internal_server_error" });
});

const port = process.env.PORT ?? 4000;
const server = app.listen(port, () => {
  console.log(`Spica backend listening on :${port}`);
  registerJobs();
  startScheduler();
});

// Exit promptly when asked to stop (deploys, and tsx watch restarting on a
// file change). Without this the job timers and the database pool keep the
// process alive and the restart hangs.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close();
    server.closeAllConnections?.();
    pool.end().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
