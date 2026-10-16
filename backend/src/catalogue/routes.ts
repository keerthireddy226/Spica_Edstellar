import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { listCatalogue } from "./service.js";

// The exam catalogue for any signed-in user (org settings, recruitment set-up).
export const catalogueRouter = Router();

catalogueRouter.get("/", requireAuth, async (_req, res, next) => {
  try {
    res.json({ families: await listCatalogue() });
  } catch (err) {
    next(err);
  }
});
