import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { pool } from "../db.js";
import { generateToken, hashToken, SESSION_COOKIE } from "./tokens.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./mailer.js";
import { checkSession, requireAuth, type AuthedRequest } from "./middleware.js";
import { ORG_CONSOLE_ROLES, ipAllowed, passwordMinLengthFor, passwordProblem } from "./policy.js";
import { ssoForEmail } from "../sso/service.js";
import { checkSecondFactor, confirmMfaSetup, createChallenge, disableMfa, redeemChallenge, regenerateRecoveryCodes, startMfaSetup } from "./mfa.js";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  updateNameSchema,
  verifyEmailSchema,
} from "./schemas.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BCRYPT_ROUNDS = 12;
// Postgres unique_violation error code.
const PG_UNIQUE_VIOLATION = "23505";

// Separate instances so each endpoint gets its own budget. Skipped outside production.
function makeAuthLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV !== "production",
    handler: (_req, res) => {
      res.status(429).json({ error: "too_many_attempts" });
    },
  });
}
const signupLimiter = makeAuthLimiter();
const loginLimiter = makeAuthLimiter();
const forgotPasswordLimiter = makeAuthLimiter();

export const authRouter = Router();

// Accepts an in-transaction client too — signup needs the session on the same connection as the uncommitted user row.
export async function createSession(executor: Pick<typeof pool, "query">, userId: string) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await executor.query(
    `INSERT INTO auth_sessions (user_id, session_token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Configurable because the right value depends on production topology
    // (same-site works today via the dev proxy; a frontend/backend split
    // across subdomains later may need "none" + secure instead).
    sameSite: (process.env.COOKIE_SAMESITE as "lax" | "strict" | "none") ?? "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
  });
}

authRouter.post("/signup", signupLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = signupSchema.parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) return res.status(400).json({ error: problem, minLength: 8 });
    await client.query("BEGIN");

    const tenant = await client.query(
      `INSERT INTO tenants (name, type) VALUES ($1, 'individual_free') RETURNING id`,
      [`${body.email} (individual)`],
    );
    const tenantId = tenant.rows[0].id;

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const user = await client.query(
      `INSERT INTO users (tenant_id, role, email, password_hash, first_name, last_name)
       VALUES ($1, 'learner', $2, $3, $4, $5) RETURNING id`,
      [tenantId, body.email, passwordHash, body.firstName, body.lastName],
    );
    const userId = user.rows[0].id;

    const verifyToken = generateToken();
    await client.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, hashToken(verifyToken), new Date(Date.now() + VERIFY_TOKEN_TTL_MS)],
    );

    await client.query("COMMIT");

    // No session is created here on purpose — signup ends with "check your
    // email," not an automatic login. The learner logs in for real afterward.
    sendVerificationEmail(body.email, verifyToken).catch((err) =>
      console.error("failed to send verification email:", err),
    );
    res.status(201).json({ email: body.email });
  } catch (err) {
    await client.query("ROLLBACK");
    // A concurrent signup with the same email can race past an existence
    // check — this constraint is the actual, atomic source of truth.
    if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return res.status(409).json({ error: "email_already_registered" });
    }
    next(err);
  } finally {
    client.release();
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await pool.query(
      `SELECT u.id, u.password_hash, u.role, u.email_verified, u.first_name, u.last_name, u.preferred_language, u.mfa_enabled_at,
         t.deactivated_at AS tenant_deactivated_at, t.ip_allowlist
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
      [body.email],
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (!user.email_verified) {
      return res.status(403).json({ error: "email_not_verified" });
    }
    // A deactivated organization blocks everyone in it — its Org Admin,
    // its Managers, and its learners — the same way a soft-deleted account
    // blocks login, without destroying anyone's history.
    if (user.tenant_deactivated_at) {
      return res.status(403).json({ error: "organization_deactivated" });
    }
    // Enforces the login portal as a real access boundary, not just a
    // different-looking page — a learner's credentials don't work at
    // /admin/login even though the password itself is correct. A portal may
    // accept more than one role (e.g. /admin/login accepts admin and
    // super_admin), so this is a membership check, not an exact match.
    if (!body.allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "wrong_login_portal" });
    }

    // Once an organization turns on "SSO only", its learners and Managers sign
    // in through their identity provider. The Org Admin keeps a password as a
    // way back in if the provider is down.
    if (["learner", "manager"].includes(user.role)) {
      const sso = await ssoForEmail(body.email);
      if (sso?.enforce) return res.status(403).json({ error: "sso_required" });
    }
    // Org Admins and Managers can be limited to the organization's networks.
    if (ORG_CONSOLE_ROLES.includes(user.role) && !ipAllowed(req.ip, user.ip_allowlist)) {
      return res.status(403).json({ error: "ip_not_allowed" });
    }
    // Password was right; with two-factor on, a code is still owed before
    // any session exists.
    if (user.mfa_enabled_at) {
      const challenge = await createChallenge(user.id);
      return res.json({ mfaRequired: true, challenge });
    }
    await finishLogin(req, res, user.id);
  } catch (err) {
    next(err);
  }
});

// Second step of a two-factor login.
authRouter.post("/mfa/verify", loginLimiter, async (req, res, next) => {
  try {
    const body = z.object({ challenge: z.string().min(10), code: z.string().trim().min(6).max(20) }).parse(req.body);
    const result = await redeemChallenge(body.challenge, body.code);
    if ("error" in result) return res.status(result.error === "invalid_code" ? 401 : 400).json({ error: result.error });
    await finishLogin(req, res, result.userId);
  } catch (err) {
    next(err);
  }
});

// Shared tail of every successful login: one active session per account,
// the cookie, the login record, and who you are.
async function finishLogin(req: import("express").Request, res: import("express").Response, userId: string) {
  // One active session per account — a second login while the first is still
  // open gets rejected instead of silently coexisting with it.
  const activeSession = await pool.query(
    `SELECT 1 FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND impersonator_id IS NULL LIMIT 1`,
    [userId],
  );
  if (activeSession.rows[0]) {
    res.status(409).json({ error: "already_logged_in" });
    return;
  }
  const u = (
    await pool.query(
      `SELECT u.id, u.email, u.role, u.email_verified, u.first_name, u.last_name, u.preferred_language, u.mfa_enabled_at, t.mfa_required
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId],
    )
  ).rows[0];
  const { token } = await createSession(pool, userId);
  setSessionCookie(res, token);
  // Passive signal only — no decision is made from this yet. Persisted so
  // there's real per-account login history to design anomaly detection
  // against later instead of guessing.
  pool
    .query(`INSERT INTO login_events (user_id, ip_address, user_agent) VALUES ($1, $2, $3)`, [userId, req.ip, req.headers["user-agent"] ?? null])
    .catch((err) => console.error("failed to record login event:", err));
  res.json({
    id: u.id,
    email: u.email,
    role: u.role,
    emailVerified: u.email_verified,
    firstName: u.first_name,
    lastName: u.last_name,
    preferredLanguage: u.preferred_language,
    // The organization requires two-factor sign-in and it isn't set up yet.
    mfaSetupRequired: ORG_CONSOLE_ROLES.includes(u.role) && u.mfa_required && !u.mfa_enabled_at,
  });
}

authRouter.post("/logout", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      await pool.query(
        `UPDATE auth_sessions SET revoked_at = now() WHERE session_token_hash = $1`,
        [hashToken(token)],
      );
    }
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const check = await checkSession(req.cookies?.[SESSION_COOKIE], req.ip);
    if (!check.user) return res.status(check.error === "ip_not_allowed" ? 403 : 401).json({ error: check.error });
    const result = await pool.query(
      `SELECT u.id, u.email, u.role, u.email_verified, u.tenant_id, u.first_name, u.last_name, u.created_at, u.department, u.permissions,
         u.participant_id, u.preferred_language,
         ib.id AS ib_id, ib.email AS ib_email, ib.role AS ib_role, nullif(concat_ws(' ', ib.first_name, ib.last_name), '') AS ib_name
       FROM users u LEFT JOIN users ib ON ib.id = u.invited_by
       WHERE u.id = $1`,
      [check.user.id],
    );
    const user = result.rows[0];

    // Second-most-recent login — the most recent one is this very session.
    const lastLogin = await pool.query(
      `SELECT created_at FROM login_events WHERE user_id = $1 ORDER BY created_at DESC OFFSET 1 LIMIT 1`,
      [user.id],
    );

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.email_verified,
      tenantId: user.tenant_id,
      firstName: user.first_name,
      lastName: user.last_name,
      createdAt: user.created_at,
      lastLoginAt: lastLogin.rows[0]?.created_at ?? null,
      department: user.department,
      permissions: user.permissions ?? {},
      participantId: user.participant_id,
      preferredLanguage: user.preferred_language,
      // Who added this account (staff and organization roles).
      onboardedBy: user.ib_id ? { id: user.ib_id, email: user.ib_email, name: user.ib_name ?? user.ib_email, role: user.ib_role } : null,
      mfaEnabled: check.user.mfaEnabled,
      mfaSetupRequired: check.user.mfaSetupRequired,
      viewAs: check.user.viewAs,
    });
  } catch (err) {
    next(err);
  }
});

// Persisted server-side (not just browser storage) so the choice follows the
// user across devices, drives email language, and is visible to analytics.
authRouter.patch("/me/language", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ language: z.string().min(2).max(10) }).parse(req.body);
    await pool.query(`UPDATE users SET preferred_language = $1, updated_at = now() WHERE id = $2`, [
      body.language,
      req.user!.id,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// First/last name are the only account fields Profile lets someone edit —
// email is tied to login/verification and isn't editable here.
authRouter.patch("/me", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = updateNameSchema.parse(req.body);
    await pool.query(`UPDATE users SET first_name = $1, last_name = $2, updated_at = now() WHERE id = $3`, [
      body.firstName,
      body.lastName,
      req.user!.id,
    ]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Crude device/browser label from the stored user agent — no new dependency,
// just enough for a human skimming their own login history to recognize it.
function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Unknown browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /Linux/.test(ua)
          ? "Linux"
          : /iPhone|iPad/.test(ua)
            ? "iOS"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

// Own login history only — never another account's, even for a Super Admin.
authRouter.get("/me/login-history", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ip_address, user_agent, created_at FROM login_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.user!.id],
    );
    res.json({
      logins: result.rows.map((r) => ({
        ipAddress: r.ip_address,
        device: describeUserAgent(r.user_agent),
        occurredAt: r.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Currently-active sessions only — the login flow already enforces one
// active session per account, but this is also the view that lets someone
// kill a stray session themselves instead of asking for a manual DB fix.
authRouter.get("/me/sessions", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const currentToken = req.cookies?.[SESSION_COOKIE];
    const currentHash = currentToken ? hashToken(currentToken) : null;
    const result = await pool.query(
      `SELECT id, session_token_hash, created_at, expires_at
       FROM auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() AND impersonator_id IS NULL
       ORDER BY created_at DESC`,
      [req.user!.id],
    );
    res.json({
      sessions: result.rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        isCurrent: r.session_token_hash === currentHash,
      })),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.delete("/me/sessions/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [req.params.id, req.user!.id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "session_not_found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

authRouter.post("/verify-email", async (req, res, next) => {
  try {
    const body = verifyEmailSchema.parse(req.body);
    const result = await pool.query(
      `SELECT evt.id, evt.user_id, evt.expires_at, u.role, u.email_verified
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token_hash = $1`,
      [hashToken(body.token)],
    );
    const row = result.rows[0];
    if (!row) return res.status(400).json({ error: "invalid_or_expired_token" });

    // A token can get consumed by something other than the learner's real
    // click (an email client prescanning the link, a double click) before
    // they follow it themselves. Once the account is verified, treat any
    // later use of the same link as success instead of a confusing "expired"
    // error — the outcome the learner cares about already happened.
    if (row.email_verified) {
      return res.json({ role: row.role });
    }
    if (row.expires_at < new Date()) {
      return res.status(400).json({ error: "invalid_or_expired_token" });
    }

    await pool.query("UPDATE email_verification_tokens SET used_at = now() WHERE id = $1", [row.id]);
    const user = await pool.query("UPDATE users SET email_verified = true WHERE id = $1 RETURNING role", [
      row.user_id,
    ]);
    // Returned so the frontend can send the learner back to *their* role's
    // login page, not always the learner one — verifying doesn't create a
    // session, so this is the only way it knows which portal to point at.
    res.json({ role: user.rows[0].role });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res, next) => {
  try {
    const body = forgotPasswordSchema.parse(req.body);
    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL",
      [body.email],
    );
    const user = result.rows[0];
    // Always respond the same way whether or not the email exists, so this
    // endpoint can't be used to enumerate registered accounts.
    if (user) {
      // Invalidate any still-live reset tokens from earlier requests, so only
      // the newest link actually works.
      await pool.query(
        "UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
        [user.id],
      );

      const resetToken = generateToken();
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, hashToken(resetToken), new Date(Date.now() + RESET_TOKEN_TTL_MS)],
      );
      sendPasswordResetEmail(body.email, resetToken).catch((err) =>
        console.error("failed to send password reset email:", err),
      );
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Whose account a set-password link is for, so the page can show it and the
// browser saves the new password under the right email (not whoever it
// last saw signed in on this site).
authRouter.get("/reset-password/info", forgotPasswordLimiter, async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.status(400).json({ error: "invalid_or_expired_token" });
    const r = await pool.query(
      `SELECT u.email, u.role, u.first_name FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
      [hashToken(token)],
    );
    if (r.rowCount === 0) return res.status(400).json({ error: "invalid_or_expired_token" });
    const u = r.rows[0];
    res.json({ email: u.email, role: u.role, firstName: u.first_name });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/reset-password", async (req, res, next) => {
  try {
    const body = resetPasswordSchema.parse(req.body);
    const result = await pool.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(body.token)],
    );
    const row = result.rows[0];
    if (!row) return res.status(400).json({ error: "invalid_or_expired_token" });
    const problem = passwordProblem(body.password, await passwordMinLengthFor(row.user_id));
    if (problem) return res.status(400).json({ error: problem, minLength: await passwordMinLengthFor(row.user_id) });

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    const user = await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING role", [
      passwordHash,
      row.user_id,
    ]);
    await pool.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
    // Resetting a password invalidates every existing session, in case the reset
    // was prompted by a compromised account.
    await pool.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [
      row.user_id,
    ]);
    // This same endpoint also serves every invite-accept flow (Org Admin,
    // Manager, Learner, Admin). An invite link is routinely opened in a
    // browser that's still signed in as the person who SENT the invite — if
    // we only revoke the invited user's own sessions above, that unrelated
    // cookie survives and the next page load bounces back to the inviter's
    // own console instead of showing a clean login page. Revoke + clear
    // whatever session cookie is actually sitting in this browser too.
    const currentToken = req.cookies?.[SESSION_COOKIE];
    if (currentToken) {
      await pool.query("UPDATE auth_sessions SET revoked_at = now() WHERE session_token_hash = $1 AND revoked_at IS NULL", [
        hashToken(currentToken),
      ]);
    }
    res.clearCookie(SESSION_COOKIE);
    // Returned so the frontend can send the learner back to *their* role's
    // login page, not always the learner one.
    res.json({ role: user.rows[0].role });
  } catch (err) {
    next(err);
  }
});

// ---- Two-factor sign-in, for any account ----

authRouter.get("/mfa/status", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const r = await pool.query(
      `SELECT u.mfa_enabled_at, coalesce(array_length(u.mfa_recovery_hashes, 1), 0) AS codes_left, t.mfa_required
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [req.user!.id],
    );
    const u = r.rows[0];
    res.json({
      enabled: u.mfa_enabled_at !== null,
      enabledAt: u.mfa_enabled_at,
      recoveryCodesLeft: u.codes_left,
      requiredByOrganization: ORG_CONSOLE_ROLES.includes(req.user!.role) && !!u.mfa_required,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/mfa/setup", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const u = (await pool.query(`SELECT email, mfa_enabled_at FROM users WHERE id = $1`, [req.user!.id])).rows[0];
    if (u.mfa_enabled_at) return res.status(400).json({ error: "already_enabled" });
    res.json(await startMfaSetup(req.user!.id, u.email));
  } catch (err) {
    next(err);
  }
});

authRouter.post("/mfa/enable", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ code: z.string().trim().min(6).max(10) }).parse(req.body);
    const codes = await confirmMfaSetup(req.user!.id, body.code);
    if (!codes) return res.status(400).json({ error: "invalid_code" });
    res.json({ recoveryCodes: codes });
  } catch (err) {
    next(err);
  }
});

// Turning it off needs the password and a current code, and isn't allowed
// when the organization requires it.
authRouter.post("/mfa/disable", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20) }).parse(req.body);
    const u = (
      await pool.query(`SELECT u.password_hash, t.mfa_required FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [req.user!.id])
    ).rows[0];
    if (ORG_CONSOLE_ROLES.includes(req.user!.role) && u.mfa_required) return res.status(403).json({ error: "required_by_organization" });
    if (!(await bcrypt.compare(body.password, u.password_hash))) return res.status(401).json({ error: "invalid_credentials" });
    if (!(await checkSecondFactor(req.user!.id, body.code))) return res.status(401).json({ error: "invalid_code" });
    await disableMfa(req.user!.id);
    res.json({ enabled: false });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/mfa/recovery-codes", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    if (!(await checkSecondFactor(req.user!.id, body.code))) return res.status(401).json({ error: "invalid_code" });
    res.json({ recoveryCodes: await regenerateRecoveryCodes(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// Leave a staff "view as" session and go back to the staff account.
authRouter.post("/view-as/exit", async (req, res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE session_token_hash = $1 AND impersonator_id IS NOT NULL`, [hashToken(token)]);
    }
    const back = req.cookies?.spica_return;
    res.clearCookie("spica_return");
    const check = await checkSession(back, req.ip);
    if (back && check.user && ["admin", "super_admin", "org_admin"].includes(check.user.role)) {
      setSessionCookie(res, back);
      return res.json({ restored: true, role: check.user.role });
    }
    res.clearCookie(SESSION_COOKIE);
    res.json({ restored: false });
  } catch (err) {
    next(err);
  }
});
