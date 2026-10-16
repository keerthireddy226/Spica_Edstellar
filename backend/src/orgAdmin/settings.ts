import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { pool } from "../db.js";
import { testTypeIds } from "../catalogue/service.js";

const LANGUAGES = ["en", "es", "fr", "de", "it", "nl", "pl", "da", "nb", "sv", "fi", "hi", "te", "ja", "zh", "vi"] as const;
// Any IANA zone name the runtime understands, including aliases such as
// Asia/Kolkata that aren't in Intl.supportedValuesOf's canonical list.
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const LOGO_DIR = path.resolve("uploads", "logos");

export interface OrgSettings {
  logoUrl: string | null;
  brandColor: string | null;
  defaultLanguage: string | null;
  timezone: string;
  reminderDefaultEnabled: boolean;
  reminderDefaultTime: string;
  faceCheckRequired: boolean;
  allowedTestProducts: string[] | null;
  mfaRequired: boolean;
  ipAllowlist: string[] | null;
  sessionIdleMinutes: number | null;
  passwordMinLength: number;
  inviteExpiryHours: number;
}

export const settingsSchema = z.object({
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  defaultLanguage: z.enum(LANGUAGES).nullable().optional(),
  timezone: z
    .string()
    .max(64)
    .refine(isTimeZone, "Unknown time zone")
    .optional(),
  reminderDefaultEnabled: z.boolean().optional(),
  reminderDefaultTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  faceCheckRequired: z.boolean().optional(),
  // null = every product; otherwise at least one.
  // Test type ids from the exam catalogue; checked against it when saved.
  allowedTestProducts: z.array(z.string().min(1).max(40)).min(1).nullable().optional(),
  mfaRequired: z.boolean().optional(),
  // null or [] = no restriction.
  ipAllowlist: z.array(z.string().trim().min(2).max(64)).max(50).nullable().optional(),
  sessionIdleMinutes: z.number().int().min(5).max(10080).nullable().optional(),
  passwordMinLength: z.number().int().min(8).max(64).optional(),
  inviteExpiryHours: z.number().int().min(1).max(720).optional(),
});

export async function getOrgSettings(tenantId: string): Promise<OrgSettings | null> {
  const r = await pool.query(
    `SELECT logo_path, brand_color, default_language, timezone, reminder_default_enabled,
       to_char(reminder_default_time, 'HH24:MI') AS reminder_default_time, face_check_required, allowed_test_products,
       mfa_required, ip_allowlist, session_idle_minutes, password_min_length, invite_expiry_hours
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  const t = r.rows[0];
  if (!t) return null;
  return {
    logoUrl: t.logo_path ? `/api/branding/logo/${tenantId}?v=${encodeURIComponent(t.logo_path)}` : null,
    brandColor: t.brand_color,
    defaultLanguage: t.default_language,
    timezone: t.timezone,
    reminderDefaultEnabled: t.reminder_default_enabled,
    reminderDefaultTime: t.reminder_default_time,
    faceCheckRequired: t.face_check_required,
    allowedTestProducts: t.allowed_test_products,
    mfaRequired: t.mfa_required,
    ipAllowlist: t.ip_allowlist,
    sessionIdleMinutes: t.session_idle_minutes,
    passwordMinLength: t.password_min_length,
    inviteExpiryHours: t.invite_expiry_hours,
  };
}

export class UnknownTestTypeError extends Error {}

export async function updateOrgSettings(tenantId: string, body: z.infer<typeof settingsSchema>) {
  if (body.allowedTestProducts) {
    const known = new Set(await testTypeIds());
    if (body.allowedTestProducts.some((id) => !known.has(id))) throw new UnknownTestTypeError("unknown_test_type");
  }
  const map: [keyof typeof body, string][] = [
    ["brandColor", "brand_color"],
    ["defaultLanguage", "default_language"],
    ["timezone", "timezone"],
    ["reminderDefaultEnabled", "reminder_default_enabled"],
    ["reminderDefaultTime", "reminder_default_time"],
    ["faceCheckRequired", "face_check_required"],
    ["allowedTestProducts", "allowed_test_products"],
    ["mfaRequired", "mfa_required"],
    ["ipAllowlist", "ip_allowlist"],
    ["sessionIdleMinutes", "session_idle_minutes"],
    ["passwordMinLength", "password_min_length"],
    ["inviteExpiryHours", "invite_expiry_hours"],
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of map) {
    if (body[key] === undefined) continue;
    values.push(body[key]);
    sets.push(`${col} = $${values.length}`);
  }
  if (sets.length === 0) return;
  values.push(tenantId);
  await pool.query(`UPDATE tenants SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
}

// Resized to fit 256×256 and re-encoded as PNG, which also strips anything
// that isn't an image.
export async function saveLogo(tenantId: string, imageBase64: string): Promise<void> {
  const data = Buffer.from(imageBase64.replace(/^data:image\/[a-z+]+;base64,/, ""), "base64");
  if (data.length > 2 * 1024 * 1024) throw new Error("logo_too_large");
  const png = await sharp(data).resize(256, 256, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  await mkdir(LOGO_DIR, { recursive: true });
  const file = `${tenantId}.png`;
  await writeFile(path.join(LOGO_DIR, file), png);
  // The path also busts browser caches: it changes on every upload.
  await pool.query(`UPDATE tenants SET logo_path = $2 WHERE id = $1`, [tenantId, `${file}#${Date.now()}`]);
}

export async function removeLogo(tenantId: string): Promise<void> {
  await unlink(path.join(LOGO_DIR, `${tenantId}.png`)).catch(() => {});
  await pool.query(`UPDATE tenants SET logo_path = NULL WHERE id = $1`, [tenantId]);
}

// Applied when an organization adds a learner: their language, and a daily
// reminder if the organization turned that on by default.
export async function applyLearnerDefaults(tenantId: string, userId: string): Promise<void> {
  const t = (
    await pool.query(`SELECT default_language, timezone, reminder_default_enabled, reminder_default_time FROM tenants WHERE id = $1`, [tenantId])
  ).rows[0];
  if (!t) return;
  if (t.default_language) {
    await pool.query(`UPDATE users SET preferred_language = coalesce(preferred_language, $2) WHERE id = $1`, [userId, t.default_language]);
  }
  if (t.reminder_default_enabled) {
    await pool.query(
      `INSERT INTO reminder_preferences (user_id, enabled, local_time, timezone) VALUES ($1, true, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
      [userId, t.reminder_default_time, t.timezone],
    );
  }
}

// For a learner: does their organization require face checks, and which
// practice-test products may they take? Individuals: yes, and all.
export async function learnerOrgPolicy(userId: string): Promise<{ faceCheckRequired: boolean; allowedTestProducts: string[] | null }> {
  const r = await pool.query(
    `SELECT u.role, t.type, t.face_check_required, t.allowed_test_products FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [userId],
  );
  const t = r.rows[0];
  // Candidates are identified by the proctoring steps instead (ID selfie,
  // snapshots), never by a learner's face enrollment.
  if (t?.role === "candidate") return { faceCheckRequired: false, allowedTestProducts: null };
  if (!t || t.type !== "cohort") return { faceCheckRequired: true, allowedTestProducts: null };
  return { faceCheckRequired: t.face_check_required, allowedTestProducts: t.allowed_test_products };
}
