// Marketing emails (news, tips, offers): sent only to people who opted in
// (users.marketing_consent), and always with a one-click unsubscribe link.
// Service emails (invites, results, receipts, password resets) don't use this.
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { sendNotificationEmail } from "../auth/mailer.js";

function secret(): string {
  return process.env.NOTIFICATION_SECRET ?? process.env.SESSION_SECRET ?? "dev-notification-secret";
}

export function marketingUnsubscribeToken(userId: string): string {
  return createHmac("sha256", secret()).update(`unsub-marketing:${userId}`).digest("hex").slice(0, 32);
}

export function verifyMarketingUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(marketingUnsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function marketingUnsubscribeUrl(userId: string): string {
  const api = process.env.PUBLIC_API_URL ?? "http://localhost:4000";
  return `${api}/api/notifications/unsubscribe-marketing?u=${userId}&t=${marketingUnsubscribeToken(userId)}`;
}

// Sends one marketing email if, and only if, the person agreed to them.
// Returns false (and sends nothing) otherwise.
export async function sendMarketingEmail(userId: string, subject: string, text: string): Promise<boolean> {
  const u = (
    await pool.query(`SELECT email FROM users WHERE id = $1 AND marketing_consent AND erased_at IS NULL AND deleted_at IS NULL`, [userId])
  ).rows[0];
  if (!u?.email) return false;
  await sendNotificationEmail({ to: u.email, subject, text, unsubscribeUrl: marketingUnsubscribeUrl(userId) });
  return true;
}
