import type { NextFunction, Response } from "express";
import { accessOf, opensPractice } from "../access/entitlements.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { accessCache } from "./accessCache.js";
import { freeTierUsage, learnerAccess, learnerKind } from "./service.js";
import { candidateMayStart } from "../recruitment/service.js";

export type GatedFeature = "practice" | "mocktest" | "placement" | "coach";

// Server-side access rules for starting/continuing learning activity. Reads
// (GET) are never blocked, so history and reports stay visible.
//  - Organization learners: need an active license (or the 3-day grace).
//  - Individual learners with an active plan: everything.
//  - Individual learners on the free tier: one placement test, a few practice
//    sessions a week, no AI tutor. Practice tests and mock tests have monthly
//    limits for everyone, enforced where they start (programs/quotas.ts).
//  - Anyone with Full access as a product (bought, or given by Spica staff): everything.
//  - Anything else owned opens only its part: a preparation or a practice
//    pack opens practice (the routes narrow it to what it includes), a test
//    is started from the tests page. The AI tutor needs Full access, and
//    placement follows the free rules (one test, no retakes).
export function requireAccess(feature: GatedFeature) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    requireAuth(req, res, async () => {
      try {
        // A candidate may only take the one test they were invited to.
        if (req.user!.role === "candidate") {
          if (await candidateMayStart(req.user!.id, feature)) return next();
          return res.status(403).json({ error: "candidate_not_allowed", feature });
        }
        const cached = await accessCache.getOrLoad(req.user!.id, async () => {
          const k = await learnerKind(req.user!.id);
          return { kind: k, access: k === "other" ? null : await learnerAccess(req.user!.id) };
        });
        const { kind } = cached;
        if (kind === "other" || !cached.access) return next();
        const access = cached.access;
        const live = access.status === "active" || access.status === "grace";
        if (live) return next();
        // Something bought or given outside a licence: Full access opens
        // everything; anything else only its own part (see above).
        const owned = await accessOf(req.user!.id);
        if (owned.full) return next();
        const licenseRequired = () => res.status(403).json({ error: "license_required", status: access.status, accessEndsAt: access.accessEndsAt });
        if (kind === "org" && !owned.owned.length) return licenseRequired();

        const startsSomethingNew = req.path === "/session";
        if (feature === "coach") {
          return kind === "org" ? licenseRequired() : res.status(403).json({ error: "plan_required", feature });
        }
        // Practice tests and mock tests: the routes check which tests are included.
        if (feature === "mocktest") return next();
        // A preparation or a practice pack: the practice routes narrow it to its question types.
        if (feature === "practice" && opensPractice(owned)) return next();
        // An organization learner given only a test: no practice without a licence.
        if (kind === "org" && feature !== "placement") return licenseRequired();
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
