import path from "node:path";
import type { NextFunction, Response } from "express";
import { pool } from "../db.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { canReviewUser } from "../proctoring/routes.js";

// Files under /uploads are served to signed-in users, but being signed in
// isn't enough to open a personal one. Face photos and voice samples
// (biometric data) and recorded spoken answers open only for their owner, or
// someone allowed to review that person (their organisation's admin, the
// recruiter for a candidate, Spica staff with score review). Anyone else gets
// a plain 404, so the response doesn't reveal whether the file exists.
const OWNER_OF: Record<string, string> = {
  "face-enrollment": `SELECT user_id FROM face_enrollments WHERE sample_uri = $1`,
  "face-check": `SELECT user_id FROM face_check_results WHERE sample_uri = $1`,
  "voice-enrollment": `SELECT user_id FROM voice_enrollments WHERE sample_uri = $1 OR sample_uri_2 = $1`,
  "voice-check": `SELECT user_id FROM voice_check_results WHERE sample_uri = $1`,
  attempts: `SELECT s.user_id FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.response_uri = $1`,
};

// Never served as plain files: data exports are downloaded through their own
// route (which checks the owner), and the voice-lab folders are old test files.
const BLOCKED = new Set(["exports", "voice-lab", "voice-lab-v2"]);

// Test recordings are test content. A learner or candidate may play a real-test
// question's recording only when that question is in one of their own tests;
// questions of practice modules, practice sets and mocks stay open to them.
// Staff and organisation roles are not limited (they preview and review tests).
const LIMITED_ROLES = new Set(["learner", "candidate"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function mayPlayItemAudio(req: AuthedRequest, rel: string): Promise<boolean> {
  if (!LIMITED_ROLES.has(req.user?.role ?? "")) return true;
  const itemId = rel.split("/").pop()?.match(UUID)?.[0];
  if (!itemId) return false;
  const realTest = await pool.query(
    `SELECT 1 FROM items i JOIN exam_parts ep ON ep.id = i.exam_part_id JOIN exams e ON e.id = ep.exam_id
     WHERE i.id = $1 AND e.purpose = 'assessment' LIMIT 1`,
    [itemId],
  );
  if (!realTest.rowCount) return true;
  const own = await pool.query(
    `SELECT 1 FROM sessions WHERE user_id = $1
       AND (coalesce(composition->'itemIds', '[]'::jsonb) ? $2 OR coalesce(composition->'history', '[]'::jsonb) ? $2) LIMIT 1`,
    [req.user!.id, itemId],
  );
  return (own.rowCount ?? 0) > 0;
}

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
  try {
    if (BLOCKED.has(folder)) return res.status(404).json({ error: "not_found" });
    if (folder === "item-audio") {
      if (!(await mayPlayItemAudio(req, rel))) return res.status(404).json({ error: "not_found" });
      return next();
    }
    const query = OWNER_OF[folder];
    if (!query) return next();
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
