import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { pool } from "../db.js";
import { generateToken, hashToken } from "./tokens.js";
import { sendAdminInviteEmail } from "./mailer.js";
import { applyLearnerDefaults } from "../orgAdmin/settings.js";
import { inviteExpiryMs } from "./policy.js";
import { emitEvent } from "../webhooks/service.js";
import { DetailsError, saveLearnerDetails, type LearnerDetails } from "../learners/details.js";
import { assertBatchCapacity } from "../batches/fields.js";

const BCRYPT_ROUNDS = 12;
// How long an invite link works is the organization's choice (24 hours by default).

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
  // Employee details and demographics the organization records for a learner.
  details?: LearnerDetails;
  // Who added them, shown as "Onboarded by".
  invitedBy?: string | null;
}): Promise<{ id: string }> {
  if (row.role === "learner") {
    await assertBatchCapacity(row.batchId);
    if (row.details?.employeeId) {
      const taken = await pool.query(`SELECT 1 FROM users WHERE tenant_id = $1 AND employee_id = $2`, [row.tenantId, row.details.employeeId]);
      if (taken.rowCount) throw new DetailsError("employee_id_taken");
    }
  }
  const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
  const inserted = await pool.query(
    `INSERT INTO users (role, tenant_id, batch_id, email, password_hash, first_name, last_name, invited_by, email_verified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     RETURNING id`,
    [row.role, row.tenantId, row.batchId ?? null, row.email, placeholderHash, row.firstName, row.lastName, row.invitedBy ?? null],
  );
  const userId = inserted.rows[0].id;
  // The organization's defaults for new learners (language, daily reminder).
  if (row.role === "learner") {
    if (row.details) await saveLearnerDetails(userId, row.details);
    await applyLearnerDefaults(row.tenantId, userId);
    await emitEvent(row.tenantId, "learner.created", { learnerId: userId, email: row.email, firstName: row.firstName, lastName: row.lastName, batchId: row.batchId ?? null });
  }

  const inviteToken = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(inviteToken),
    new Date(Date.now() + (await inviteExpiryMs(row.tenantId))),
  ]);
  sendAdminInviteEmail(row.email, inviteToken, row.roleLabel).catch((err) =>
    console.error(`failed to send ${row.roleLabel} invite email:`, err),
  );

  return { id: userId };
}

// A fresh "set your password" link for someone who already has an account:
// an invite that expired, or a person locked out of their account.
export async function resendSetPasswordLink(userId: string, roleLabel: string): Promise<string | null> {
  const u = await pool.query(`SELECT email, tenant_id FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
  if (u.rowCount === 0) return null;
  // Older links stop working, so only the newest one is ever valid.
  await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const token = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashToken(token),
    new Date(Date.now() + (await inviteExpiryMs(u.rows[0].tenant_id))),
  ]);
  sendAdminInviteEmail(u.rows[0].email, token, roleLabel).catch((err) => console.error("failed to resend invite email:", err));
  return u.rows[0].email;
}
