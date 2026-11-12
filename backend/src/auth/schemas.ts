import { z } from "zod";

// max(72): bcrypt silently truncates anything past 72 bytes, so a longer
// input would create a false sense of a stronger password than is actually hashed.
export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // The Privacy Notice checkbox; sign-up is refused without it.
  acceptPrivacy: z.literal(true),
  // "I am 18 or older", ticked with it.
  adultConfirmed: z.literal(true),
  // The Terms and Conditions checkbox, required once Terms are published
  // (TERMS_VERSION set); see termsVersion().
  acceptTerms: z.boolean().optional(),
  // Optional, unticked by default: marketing emails.
  marketingConsent: z.boolean().optional(),
});

// The Privacy Notice version people agree to (its "last updated" date).
export const PRIVACY_NOTICE_VERSION = "2026-10-29";

// The Terms and Conditions version people agree to, and where they are
// published. Unset until the lawyer-approved Terms are live: then nobody is
// asked. Once set, sign-up requires the box, and everyone already signed up is
// asked once at their next login (and again whenever the version changes).
export function termsVersion(): string | null {
  return process.env.TERMS_VERSION?.trim() || null;
}
export function termsUrl(): string | null {
  return process.env.TERMS_URL?.trim() || null;
}

export const updateNameSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

// A login portal names which role(s) it accepts — a plain list even for one, e.g. admin or super_admin.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  allowedRoles: z.array(z.enum(["learner", "org_admin", "admin", "super_admin", "manager", "recruiter"])).min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
