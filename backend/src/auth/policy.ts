import { BlockList, isIP } from "node:net";
import { pool } from "../db.js";

// Console roles inside an organization: the people an organization's
// security policies (MFA, IP allowlist) are about. Learners practise from
// anywhere, so those two don't apply to them.
export const ORG_CONSOLE_ROLES = ["org_admin", "manager", "recruiter"];

const COMMON = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
  "11111111", "iloveyou", "admin123", "welcome1", "letmein1", "abc12345", "passw0rd", "spica123",
]);

export type PasswordProblem = "password_too_short" | "password_too_weak" | "password_too_common";

export function passwordProblem(password: string, minLength = 8): PasswordProblem | null {
  if (password.length < minLength) return "password_too_short";
  if (COMMON.has(password.toLowerCase())) return "password_too_common";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "password_too_weak";
  return null;
}

export async function passwordMinLengthFor(userId: string): Promise<number> {
  const r = await pool.query(`SELECT t.password_min_length FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`, [userId]);
  return r.rows[0]?.password_min_length ?? 8;
}

export async function inviteExpiryMs(tenantId: string | null): Promise<number> {
  if (!tenantId) return 24 * 3600 * 1000;
  const r = await pool.query(`SELECT invite_expiry_hours FROM tenants WHERE id = $1`, [tenantId]);
  return (r.rows[0]?.invite_expiry_hours ?? 24) * 3600 * 1000;
}

// Entries are single addresses or CIDR ranges, IPv4 or IPv6.
export function parseAllowlist(entries: string[]): BlockList | null {
  const list = new BlockList();
  for (const raw of entries) {
    const e = raw.trim();
    const [addr, bits] = e.split("/");
    const family = isIP(addr);
    if (!family) return null;
    const type = family === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const n = Number(bits);
      if (!Number.isInteger(n) || n < 0 || n > (family === 6 ? 128 : 32)) return null;
      list.addSubnet(addr, n, type);
    }
  }
  return list;
}

export function ipAllowed(ip: string | undefined, entries: string[] | null): boolean {
  if (!entries || entries.length === 0) return true;
  if (!ip) return false;
  const list = parseAllowlist(entries);
  if (!list) return true; // a malformed list never locks everyone out; it's validated on save
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const family = isIP(clean);
  return family !== 0 && list.check(clean, family === 6 ? "ipv6" : "ipv4");
}
