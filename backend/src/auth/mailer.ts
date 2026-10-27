import nodemailer from "nodemailer";
import { languageForEmail, translateServerText } from "../i18n/translate.js";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // A blocked port (Render's free plan) fails in seconds instead of minutes.
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
});

// Every email goes out in the recipient's language: their own setting,
// else their organization's default, else English.
async function localize(to: string, subject: string, text: string): Promise<{ subject: string; text: string }> {
  const lang = await languageForEmail(to).catch(() => "en");
  return { subject: translateServerText(lang, subject), text: translateServerText(lang, text) };
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; contentType: string }[];
}

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";

// Brevo's email API, over HTTPS. Render's free plan blocks outgoing SMTP
// (ports 25, 465 and 587), so with BREVO_API_KEY set every email goes
// through Brevo; without it, through the SMTP server (Gmail).
export async function sendViaBrevo(msg: OutgoingEmail, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const senderEmail = process.env.BREVO_SENDER_EMAIL ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;
  if (!senderEmail) throw new Error("brevo: no sender address (set BREVO_SENDER_EMAIL or SMTP_FROM)");
  const res = await fetchImpl(BREVO_URL, {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: senderEmail, name: process.env.BREVO_SENDER_NAME ?? "Spica" },
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
      ...(msg.headers ? { headers: msg.headers } : {}),
      ...(msg.attachments?.length
        ? { attachment: msg.attachments.map((a) => ({ name: a.filename, content: Buffer.from(a.content, "utf8").toString("base64") })) }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`brevo: ${res.status} ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

async function deliver(msg: OutgoingEmail): Promise<void> {
  const brevoKey = process.env.BREVO_API_KEY;
  if (brevoKey) return sendViaBrevo(msg, brevoKey);
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    headers: msg.headers,
    attachments: msg.attachments,
  });
}

async function sendMail(to: string, subject: string, text: string, lang?: string) {
  // A known language wins (a candidate has no account to look it up from).
  const l = lang ? { subject: translateServerText(lang, subject), text: translateServerText(lang, text) } : await localize(to, subject, text);
  await deliver({ to, subject: l.subject, text: l.text });
}

export async function sendVerificationEmail(email: string, token: string) {
  const link = `${FRONTEND_URL}/verify-email?token=${token}`;
  await sendMail(email, "Verify your email — Spica", `Verify your email by opening this link:\n\n${link}\n\nIf you didn't create this account, ignore this message.`);
}

export async function sendFaceFallbackOtpEmail(email: string, code: string) {
  await sendMail(
    email,
    "Your verification code — Spica",
    `A face check didn't go through, so here's a one-time code to continue instead:\n\n${code}\n\nThis code expires in 10 minutes. If you didn't request this, ignore this message.`,
  );
}

// New Admin/Org Admin accounts are created by a Super Admin, not self-signup —
// reuses the same reset-password link/page, just with onboarding-appropriate
// copy and a longer window than a real password reset (they may not check
// email right away).
export async function sendAdminInviteEmail(email: string, token: string, roleLabel: string) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  await sendMail(
    email,
    "You've been added to Spica — Spica",
    `You've been added as ${roleLabel} on Spica. Set your password to get started (this link expires in 24 hours):\n\n${link}\n\nIf you weren't expecting this, you can ignore this message.`,
  );
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  await sendMail(email, "Reset your password — Spica", `Reset your password by opening this link (expires in 30 minutes):\n\n${link}\n\nIf you didn't request this, ignore this message.`);
}

export async function sendPlacementReminderEmail(email: string, token: string) {
  const link = `${FRONTEND_URL}/placement?reminder=${token}`;
  await sendMail(
    email,
    "Your placement test is waiting — Spica",
    `Whenever you're ready, come back and take your placement test:\n\n${link}\n\nThis reminder is valid for 1 week — after that, log in and you can send yourself a new one.`,
  );
}

// A recruitment assessment: the link signs the candidate straight in, no password.
// The code that confirms an applicant's email before they start a test
// through a job's public link.
export async function sendApplyCodeEmail(args: { to: string; code: string; orgName: string; jobTitle: string; minutes: number }) {
  await sendMail(
    args.to,
    `Your code for the English assessment for ${args.jobTitle}`,
    `Your code to start the English assessment for ${args.jobTitle} at ${args.orgName} is:\n\n${args.code}\n\nIt works for ${args.minutes} minutes. If you didn't ask for it, you can ignore this message.`,
  );
}

// minutes: the test itself (the checks before it add about 10 minutes).
export async function sendCandidateInviteEmail(args: { to: string; orgName: string; jobTitle: string; token: string; expiresAt: Date; minutes: string; lang?: string; reminder?: boolean }) {
  const link = `${FRONTEND_URL}/assess/${args.token}`;
  const until = args.expiresAt.toISOString().slice(0, 10);
  if (args.reminder) {
    await sendMail(
      args.to,
      `Reminder: your English assessment for ${args.jobTitle}`,
      `Your English assessment for ${args.jobTitle} at ${args.orgName} is still waiting. The link works until ${until}:\n\n${link}\n\nThe test takes ${args.minutes} minutes. Use a computer with a camera and microphone.`,
      args.lang,
    );
    return;
  }
  await sendMail(
    args.to,
    `Your English assessment for ${args.jobTitle}`,
    `${args.orgName} has invited you to an English assessment for ${args.jobTitle}.\n\nStart it here (the link works until ${until}):\n\n${link}\n\nThe test takes ${args.minutes} minutes. Use a computer with a camera and microphone, in a quiet room. If you weren't expecting this, you can ignore this message.`,
    args.lang,
  );
}

// Generic notification email (reminders, license alerts). Includes a one-click
// unsubscribe header when the email is something the user can switch off.
export async function sendNotificationEmail(args: { to: string; subject: string; text: string; unsubscribeUrl?: string }) {
  const l = await localize(
    args.to,
    args.subject,
    args.unsubscribeUrl ? `${args.text}\n\n—\nDon't want these emails? Turn them off: ${args.unsubscribeUrl}` : args.text,
  );
  await deliver({
    to: args.to,
    subject: l.subject,
    text: l.text,
    headers: args.unsubscribeUrl
      ? { "List-Unsubscribe": `<${args.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
  });
}

// The test plan's dates: the email lists them with Google Calendar links and
// attaches the .ics file for Apple Calendar and Outlook. The caller writes it
// in the learner's language line by line.
export async function sendCalendarEmail(args: { to: string; subject: string; text: string; ics: string }) {
  await deliver({
    to: args.to,
    subject: args.subject,
    text: args.text,
    attachments: [{ filename: "spica-test-plan.ics", content: args.ics, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
  });
}

export const APP_URL = FRONTEND_URL;
