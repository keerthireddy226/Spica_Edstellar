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

app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/placement", placementRouter);
app.use("/api/roadmap", roadmapRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/practice", practiceRouter);
app.use("/api/practice-tests", practiceTestsRouter);
app.use("/api/coach", coachRouter);
app.use("/api/face", faceRouter);
app.use("/api/admin", adminRouter);
app.use("/api/org-admin", orgAdminRouter);
app.use("/api/manager", managerRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_error", issues: err.issues });
  }
  console.error(err);
  res.status(500).json({ error: "internal_server_error" });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`Spica backend listening on :${port}`);
});
