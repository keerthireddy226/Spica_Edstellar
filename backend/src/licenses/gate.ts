import type { NextFunction, Response } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { accessCache } from "./accessCache.js";
import { freeTierUsage, learnerAccess, learnerKind } from "./service.js";

export type GatedFeature = "practice" | "mocktest" | "placement" | "coach";

// Server-side access rules for starting/continuing learning activity. Reads
// (GET) are never blocked, so history and reports stay visible.
//  - Organization learners: need an active license (or the 3-day grace).
//  - Individual learners with an active plan: everything.
//  - Individual learners on the free tier: one placement test, a few practice
//    sessions a week, no mock tests or AI tutor.
export function requireAccess(feature: GatedFeature) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    requireAuth(req, res, async () => {
      try {
        const cached = await accessCache.getOrLoad(req.user!.id, async () => {
          const k = await learnerKind(req.user!.id);
          return { kind: k, access: k === "other" ? null : await learnerAccess(req.user!.id) };
        });
        const { kind } = cached;
        if (kind === "other" || !cached.access) return next();
        const access = cached.access;
        const live = access.status === "active" || access.status === "grace";
        if (live) return next();
        if (kind === "org") {
          return res.status(403).json({ error: "license_required", status: access.status, accessEndsAt: access.accessEndsAt });
        }

        const startsSomethingNew = req.path === "/session";
        if (feature === "mocktest" || feature === "coach") {
          return res.status(403).json({ error: "plan_required", feature });
        }
        if (!startsSomethingNew) return next();
        const usage = await freeTierUsage(req.user!.id);
        if (feature === "placement" && usage.placementTaken) {
          return res.status(403).json({ error: "plan_required", feature: "placement_retake" });
        }
        if (feature === "practice" && !usage.hasOpenPractice && usage.practiceUsed >= usage.practiceLimit) {
          return res.status(403).json({ error: "free_limit", feature, ...usage });
        }
        next();
      } catch (err) {
        next(err);
      }
    });
  };
}
