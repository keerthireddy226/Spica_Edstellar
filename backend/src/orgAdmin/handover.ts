import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { pool } from "../db.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { sendAdminInviteEmail } from "../auth/mailer.js";
import { notify } from "../notifications/service.js";

const BCRYPT_ROUNDS = 12;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const PG_UNIQUE_VIOLATION = "23505";

export const newOrgAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).optional(),
  jobTitle: z.string().trim().max(100).optional(),
});

export class HandoverError extends Error {
  constructor(public code: "organization_not_found" | "email_already_registered") {
    super(code);
  }
}

// Swaps an organization's one Org Admin for a new person in a single
// transaction, so there is never a moment with two (the database forbids it)
// or with none. The outgoing account is deactivated and signed out
// everywhere; its history stays attributed to it.
export async function replaceOrgAdmin(args: {
  tenantId: string;
  next: z.infer<typeof newOrgAdminSchema>;
  actorId: string;
  reason: "replaced_by_admin" | "handover";
}): Promise<{ newOrgAdminId: string; previousOrgAdminId: string | null }> {
  const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
  const client = await pool.connect();
  let newId: string;
  let previousId: string | null = null;
  let orgName: string;
  let managedBy: string | null;
  try {
    await client.query("BEGIN");
    const t = await client.query(`SELECT name, managed_by FROM tenants WHERE id = $1 AND type = 'cohort' FOR UPDATE`, [args.tenantId]);
    if (t.rowCount === 0) throw new HandoverError("organization_not_found");
    orgName = t.rows[0].name;
    managedBy = t.rows[0].managed_by;

    const prev = await client.query(
      `UPDATE users SET deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND role = 'org_admin' AND deleted_at IS NULL RETURNING id`,
      [args.tenantId],
    );
    previousId = prev.rows[0]?.id ?? null;
    if (previousId) {
      await client.query(`UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [previousId]);
      await client.query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [previousId]);
    }

    try {
      const inserted = await client.query(
        `INSERT INTO users (role, tenant_id, email, password_hash, first_name, last_name, phone, job_title, email_verified)
         VALUES ('org_admin', $1, $2, $3, $4, $5, $6, $7, true) RETURNING id`,
        [args.tenantId, args.next.email, placeholderHash, args.next.firstName, args.next.lastName, args.next.phone ?? null, args.next.jobTitle ?? null],
      );
      newId = inserted.rows[0].id;
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) throw new HandoverError("email_already_registered");
      throw err;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const token = generateToken();
  await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    newId,
    hashToken(token),
    new Date(Date.now() + INVITE_TTL_MS),
  ]);
  sendAdminInviteEmail(args.next.email, token, "an Org Admin").catch((err) => console.error("failed to send org admin invite:", err));

  // The managing Admin should know who now runs the account.
  if (args.reason === "handover" && managedBy) {
    await notify({
      userId: managedBy,
      kind: "org_admin_changed",
      title: `${orgName} has a new Org Admin`,
      body: `${args.next.firstName} ${args.next.lastName} (${args.next.email}) took over from the previous Org Admin.`,
      link: "/admin/organizations",
      email: true,
      sentBy: args.actorId,
    });
  }
  return { newOrgAdminId: newId, previousOrgAdminId: previousId };
}
