import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { generateToken, hashToken } from "./tokens.js";
import { sendAdminInviteEmail } from "./mailer.js";

const BCRYPT_ROUNDS = 12;
const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — same as the Admin/Org Admin invite, longer than a real password reset since an invite may sit unread a while

// Shared by Org Admin (inviting a Manager or a learner) and Manager
// (inviting a learner into their own batch) — same pattern as
// createAndInviteAdmin in admin/routes.ts: placeholder password, email
// verified immediately (the inviter vouches for the address), a reset-style
// token, and the same "set your password" email everyone else gets.
export async function createAndInviteUser(row: {
  role: "org_admin" | "manager" | "learner";
  tenantId: string;
  batchId?: string | null;
  email: string;
  firstName: string;
  lastName: string;
  roleLabel: string;
}): Promise<{ id: string }> {
  const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
  const inserted = await pool.query(
    `INSERT INTO users (role, tenant_id, batch_id, email, password_hash, first_name, last_name, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     RETURNING id`,
    [row.role, row.tenantId, row.batchId ?? null, row.email, placeholderHash, row.firstName, row.lastName],
  );
  const userId = inserted.rows[0].id;

  const inviteToken = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(inviteToken),
    new Date(Date.now() + INVITE_TOKEN_TTL_MS),
  ]);
  sendAdminInviteEmail(row.email, inviteToken, row.roleLabel).catch((err) =>
    console.error(`failed to send ${row.roleLabel} invite email:`, err),
  );

  return { id: userId };
}
