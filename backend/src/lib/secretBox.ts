import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for secrets stored in the database (MFA seeds, SSO client
// secrets). The key comes from the environment; changing it makes stored
// secrets unreadable.
function key(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY ?? process.env.NOTIFICATION_SECRET ?? "spica-dev-only-mfa-key";
  return createHash("sha256").update(raw).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function open(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
