import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { pool } from "../db.js";
import { generateToken, hashToken } from "./tokens.js";

// TOTP (RFC 6238): 6 digits, 30-second steps, SHA-1 — what Google
// Authenticator, Microsoft Authenticator, 1Password etc. all expect.
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "Spica";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretB32: string, at = Date.now()): string {
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString();
  return code.padStart(DIGITS, "0");
}

// Accepts the previous and next step too, for clock drift.
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = Buffer.from(totp(secretB32, at + w * STEP_SECONDS * 1000));
    return timingSafeEqual(expected, Buffer.from(clean));
  });
}

// ---- Secret at rest: AES-256-GCM with a key from the environment ----

function key(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? process.env.NOTIFICATION_SECRET ?? "spica-dev-only-mfa-key";
  return createHash("sha256").update(raw).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

function decrypt(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ---- Enrolment ----

// Step 1: a new secret, stored but not active until a code confirms it.
export async function startMfaSetup(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
  const secret = base32Encode(randomBytes(20));
  await pool.query(`UPDATE users SET mfa_secret = $2 WHERE id = $1 AND mfa_enabled_at IS NULL`, [userId, encrypt(secret)]);
  const otpauthUrl = `otpauth://totp/${encodeURIComponent(`${ISSUER}:${email}`)}?secret=${secret}&issuer=${ISSUER}&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl };
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

// Step 2: the first correct code turns it on; recovery codes are shown once.
export async function confirmMfaSetup(userId: string, code: string): Promise<string[] | null> {
  const u = (await pool.query(`SELECT mfa_secret, mfa_enabled_at FROM users WHERE id = $1`, [userId])).rows[0];
  if (!u?.mfa_secret || u.mfa_enabled_at) return null;
  if (!verifyTotp(decrypt(u.mfa_secret), code)) return null;
  const codes = newRecoveryCodes();
  await pool.query(`UPDATE users SET mfa_enabled_at = now(), mfa_recovery_hashes = $2 WHERE id = $1`, [userId, codes.map((c) => hashToken(c))]);
  return codes;
}

export async function disableMfa(userId: string) {
  await pool.query(`UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_recovery_hashes = NULL WHERE id = $1`, [userId]);
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await pool.query(`UPDATE users SET mfa_recovery_hashes = $2 WHERE id = $1 AND mfa_enabled_at IS NOT NULL`, [userId, codes.map((c) => hashToken(c))]);
  return codes;
}

// A code from the authenticator app, or a one-time recovery code (used up).
export async function checkSecondFactor(userId: string, code: string): Promise<boolean> {
  const u = (await pool.query(`SELECT mfa_secret, mfa_recovery_hashes FROM users WHERE id = $1 AND mfa_enabled_at IS NOT NULL`, [userId])).rows[0];
  if (!u) return false;
  if (verifyTotp(decrypt(u.mfa_secret), code)) return true;
  const h = hashToken(code.trim().toUpperCase());
  if ((u.mfa_recovery_hashes ?? []).includes(h)) {
    await pool.query(`UPDATE users SET mfa_recovery_hashes = array_remove(mfa_recovery_hashes, $2) WHERE id = $1`, [userId, h]);
    return true;
  }
  return false;
}

// ---- Login challenge ----

export async function createChallenge(userId: string): Promise<string> {
  const token = generateToken();
  await pool.query(`INSERT INTO mfa_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(token),
    new Date(Date.now() + CHALLENGE_TTL_MS),
  ]);
  return token;
}

// Returns the user id once the code checks out; burns the challenge after
// success or too many wrong codes.
export async function redeemChallenge(token: string, code: string): Promise<{ userId: string } | { error: "invalid_challenge" | "invalid_code" }> {
  const c = (
    await pool.query(
      `UPDATE mfa_challenges SET attempts = attempts + 1
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() AND attempts < $2
       RETURNING id, user_id`,
      [hashToken(token), MAX_CHALLENGE_ATTEMPTS],
    )
  ).rows[0];
  if (!c) return { error: "invalid_challenge" };
  if (!(await checkSecondFactor(c.user_id, code))) return { error: "invalid_code" };
  await pool.query(`UPDATE mfa_challenges SET used_at = now() WHERE id = $1`, [c.id]);
  return { userId: c.user_id };
}
