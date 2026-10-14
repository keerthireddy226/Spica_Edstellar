import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { APP_URL, sendNotificationEmail } from "../auth/mailer.js";

// Learner-facing nudges (reminders, streak alerts) share one daily budget so
// nobody gets spammed; transactional alerts (license ending) aren't capped.
export const LEARNER_NUDGE_EMAILS_PER_DAY = 2;

export type NotificationKind =
  | "license_expiring"
  | "license_ended"
  | "license_grace_ended"
  | "org_license_digest"
  | "pool_expiring"
  | "pool_low"
  | "manager_reminder"
  | "auto_reminder"
  | "escalation"
  | "daily_reminder"
  | "streak_alert"
  | "license_request"
  | "license_request_decided"
  | "pilot"
  | "plan_inquiry"
  | "plan_changed";

const NUDGE_KINDS: NotificationKind[] = ["manager_reminder", "auto_reminder", "daily_reminder", "streak_alert"];

// Scheduled emails go to real inboxes. Outside production they're off unless
// explicitly enabled, so test accounts on real domains never get mailed by a
// background job; the in-app notification is still created.
export function notificationEmailsEnabled(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NOTIFICATION_EMAILS === "true";
}

function secret(): string {
  return process.env.NOTIFICATION_SECRET ?? process.env.SESSION_SECRET ?? "dev-notification-secret";
}

// One-click unsubscribe from daily reminders without logging in.
export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", secret()).update(`unsub:${userId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function unsubscribeUrl(userId: string): string {
  const api = process.env.PUBLIC_API_URL ?? "http://localhost:4000";
  return `${api}/api/notifications/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`;
}

async function nudgeEmailsToday(userId: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM notifications
     WHERE user_id = $1 AND emailed_at > now() - interval '24 hours' AND kind = ANY($2::text[])`,
    [userId, NUDGE_KINDS],
  );
  return r.rows[0].n;
}

export interface NotifyArgs {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string | null;
  dedupeKey?: string | null;
  email?: boolean;
  emailSubject?: string;
  emailText?: string;
  unsubscribable?: boolean;
  sentBy?: string | null;
  batchId?: string | null;
  meta?: Record<string, unknown>;
}

// Creates the notification (skipped if dedupeKey already exists) and sends
// the email if asked and allowed. Returns null when it was a duplicate.
export async function notify(args: NotifyArgs): Promise<{ id: string; emailed: boolean } | null> {
  const inserted = await pool.query(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key, sent_by, batch_id, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      args.userId,
      args.kind,
      args.title,
      args.body,
      args.link ?? null,
      args.dedupeKey ?? null,
      args.sentBy ?? null,
      args.batchId ?? null,
      JSON.stringify(args.meta ?? {}),
    ],
  );
  if (inserted.rowCount === 0) return null;
  const id = inserted.rows[0].id as string;

  let emailed = false;
  if (args.email && notificationEmailsEnabled()) {
    const underCap = !NUDGE_KINDS.includes(args.kind) || (await nudgeEmailsToday(args.userId)) < LEARNER_NUDGE_EMAILS_PER_DAY;
    const user = (await pool.query(`SELECT email, deleted_at FROM users WHERE id = $1`, [args.userId])).rows[0];
    if (underCap && user && !user.deleted_at) {
      const link = args.link ? `${APP_URL}${args.link}` : null;
      try {
        await sendNotificationEmail({
          to: user.email,
          subject: `${args.emailSubject ?? args.title} — Spica`,
          text: `${args.emailText ?? args.body}${link ? `\n\n${link}` : ""}`,
          unsubscribeUrl: args.unsubscribable ? unsubscribeUrl(args.userId) : undefined,
        });
        await pool.query(`UPDATE notifications SET emailed_at = now() WHERE id = $1`, [id]);
        emailed = true;
      } catch (err) {
        console.error(`notification email failed (${args.kind}):`, err);
      }
    }
  }
  return { id, emailed };
}

export async function listNotifications(userId: string, limit = 30) {
  const [rows, unread] = await Promise.all([
    pool.query(
      `SELECT id, kind, title, body, link, read_at, created_at FROM notifications
       WHERE user_id = $1 AND in_app ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    ),
    pool.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND in_app AND read_at IS NULL`, [userId]),
  ]);
  return {
    unread: unread.rows[0].n as number,
    notifications: rows.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      link: r.link,
      read: r.read_at !== null,
      createdAt: r.created_at,
    })),
  };
}

// Org Admins of a tenant (usually one).
export async function orgAdminIds(tenantId: string): Promise<string[]> {
  const r = await pool.query(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'org_admin' AND deleted_at IS NULL`, [tenantId]);
  return r.rows.map((x) => x.id);
}

export async function batchManagerIds(batchId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT u.id FROM batch_managers bm JOIN users u ON u.id = bm.user_id WHERE bm.batch_id = $1 AND u.deleted_at IS NULL`,
    [batchId],
  );
  return r.rows.map((x) => x.id);
}
