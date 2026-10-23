import path from "node:path";
import type { NextFunction, Response } from "express";
import { pool } from "../db.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { canReviewUser } from "../proctoring/routes.js";

// Face photos (enrolment and checks during tests) are biometric data. Being
// signed in isn't enough to open one: only its owner, or someone allowed to
// review that person's proctoring, can. Anyone else gets a plain 404, so the
// response doesn't reveal whether the photo exists.
const OWNER_OF: Record<string, string> = {
  "face-enrollment": `SELECT user_id FROM face_enrollments WHERE sample_uri = $1`,
  "face-check": `SELECT user_id FROM face_check_results WHERE sample_uri = $1`,
};

// Mounted on /uploads, after requireAuth and before the files are served.
export async function guardFacePhotos(req: AuthedRequest, res: Response, next: NextFunction) {
  // The file server decodes and tidies the path ("/./face-check//x.jpg",
  // "%66ace-check/x.jpg"), so check the same tidied path it will serve.
  let rel: string;
  try {
    rel = path.posix.normalize(decodeURIComponent(req.path));
  } catch {
    return res.status(404).json({ error: "not_found" });
  }
  const folder = rel.split("/").filter(Boolean)[0] ?? "";
  const query = OWNER_OF[folder];
  if (!query) return next();
  try {
    const owner = (await pool.query(query, [`/uploads${rel.startsWith("/") ? rel : `/${rel}`}`])).rows[0]?.user_id as string | undefined;
    if (!owner || (owner !== req.user?.id && !(await canReviewUser(req, owner)))) {
      return res.status(404).json({ error: "not_found" });
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (err) {
    next(err);
  }
}
