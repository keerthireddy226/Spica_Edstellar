import nodemailer from "nodemailer";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: process.env.SMTP_PORT === "465",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail(to: string, subject: string, text: string) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
  });
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
