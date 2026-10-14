import type { Request, Response } from "express";
import { pool } from "../db.js";
import { generateToken, hashToken, SESSION_COOKIE } from "./tokens.js";

const VIEW_AS_TTL_MS = 60 * 60 * 1000;
export const RETURN_COOKIE = "spica_return";

// Opens someone else's console read-only for an hour. The viewer's own
// session is kept in a separate cookie and restored on exit; writes are
// blocked server-side for the view-as session (see requireAuth).
export async function startViewAs(req: Request, res: Response, targetUserId: string, impersonatorId: string) {
  const token = generateToken();
  await pool.query(
    `INSERT INTO auth_sessions (user_id, session_token_hash, expires_at, impersonator_id, read_only) VALUES ($1, $2, $3, $4, true)`,
    [targetUserId, hashToken(token), new Date(Date.now() + VIEW_AS_TTL_MS), impersonatorId],
  );
  const opts = {
    httpOnly: true,
    sameSite: (process.env.COOKIE_SAMESITE as "lax" | "strict" | "none") ?? "lax",
    secure: process.env.NODE_ENV === "production",
  };
  res.cookie(RETURN_COOKIE, req.cookies?.[SESSION_COOKIE], { ...opts, maxAge: VIEW_AS_TTL_MS * 2 });
  res.cookie(SESSION_COOKIE, token, { ...opts, maxAge: VIEW_AS_TTL_MS });
}
