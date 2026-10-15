// The device check before a test: a round trip, a download and an upload the
// browser times to estimate the learner's connection. Nothing is stored.
import { randomBytes } from "node:crypto";
import express, { Router } from "express";
import { requireAuth } from "../auth/middleware.js";

export const systemCheckRouter = Router();

const MAX_DOWNLOAD_BYTES = 2_000_000;
// Random bytes so no proxy or compression layer can shrink the transfer.
const PAYLOAD = randomBytes(MAX_DOWNLOAD_BYTES);

function noStore(res: express.Response) {
  res.setHeader("Cache-Control", "no-store");
}

systemCheckRouter.get("/ping", requireAuth, (_req, res) => {
  noStore(res);
  res.status(204).end();
});

systemCheckRouter.get("/download", requireAuth, (req, res) => {
  const bytes = Math.min(MAX_DOWNLOAD_BYTES, Math.max(1, Number(req.query.bytes) || 1_000_000));
  noStore(res);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Encoding", "identity");
  res.end(PAYLOAD.subarray(0, bytes));
});

systemCheckRouter.post("/upload", requireAuth, express.raw({ type: "application/octet-stream", limit: "1mb" }), (req, res) => {
  noStore(res);
  res.json({ bytes: Buffer.isBuffer(req.body) ? req.body.length : 0 });
});
