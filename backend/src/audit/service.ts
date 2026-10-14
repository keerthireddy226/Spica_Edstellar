import { pool } from "../db.js";
import { emitEvent, type WebhookEvent } from "../webhooks/service.js";

export interface AuditEntry {
  tenantId: string | null;
  actorId: string | null;
  actorRole?: string | null;
  // For actions without a person behind them, e.g. "API key: HR sync".
  actorLabel?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

// Never let auditing break the action it records — log and move on.
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_id, actor_label, actor_role, action, target_type, target_id, target_label, details, ip)
       VALUES ($1, $2,
         coalesce($10, (SELECT coalesce(nullif(concat_ws(' ', first_name, last_name), ''), email) FROM users WHERE id = $2)),
         $3, $4, $5, $6, $7, $8, $9)`,
      [
        e.tenantId,
        e.actorId,
        e.actorRole ?? null,
        e.action,
        e.targetType ?? null,
        e.targetId ?? null,
        e.targetLabel ?? null,
        JSON.stringify(e.details ?? {}),
        e.ip ?? null,
        e.actorLabel ?? null,
      ],
    );
  } catch (err) {
    console.error("audit log write failed:", err);
  }
  // Learner changes also go out to the organization's webhooks.
  const event = AUDIT_TO_WEBHOOK[e.action];
  if (event && e.tenantId) {
    await emitEvent(e.tenantId, event, { learnerId: e.targetId ?? null, learner: e.targetLabel ?? null, ...(e.action === "learner.moved" ? { toBatchId: e.details?.batchId ?? null } : {}) });
  }
}

const AUDIT_TO_WEBHOOK: Record<string, WebhookEvent> = {
  "learner.deactivated": "learner.deactivated",
  "learner.reactivated": "learner.reactivated",
  "learner.deleted": "learner.deleted",
  "learner.erased": "learner.deleted",
  "learner.moved": "learner.moved",
};

export interface AuditRow {
  id: string;
  source: "action" | "license" | "plan";
  action: string;
  actorLabel: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

// One timeline for an organization: console actions, license changes and
// plan changes, newest first. `before` pages backwards by timestamp.
export async function listAudit(args: {
  tenantId: string;
  limit?: number;
  before?: string | null;
  action?: string | null;
  actorId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<AuditRow[]> {
  const limit = Math.min(args.limit ?? 50, 1000);
  const result = await pool.query(
    `SELECT * FROM (
       SELECT a.id, 'action' AS source, a.action, a.actor_label, a.actor_role, a.actor_id, a.target_type, a.target_label, a.details, a.created_at
       FROM audit_log a WHERE a.tenant_id = $1
       UNION ALL
       SELECT e.id, 'license', 'license.' || e.kind,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email), u.role, e.actor_id,
         CASE WHEN e.user_email IS NOT NULL THEN 'learner' WHEN e.batch_name IS NOT NULL THEN 'batch' END,
         coalesce(e.user_email, e.batch_name),
         jsonb_build_object('quantity', e.quantity, 'note', e.note), e.created_at
       FROM license_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.tenant_id = $1
       UNION ALL
       SELECT p.id, 'plan', 'plan.' || p.kind,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email), u.role, p.actor_id,
         'organization', NULL,
         jsonb_build_object('fromTier', p.from_tier, 'toTier', p.to_tier, 'customPriceCents', p.custom_price_cents, 'note', p.note), p.created_at
       FROM tenant_plan_events p LEFT JOIN users u ON u.id = p.actor_id WHERE p.tenant_id = $1
     ) t
     WHERE ($2::timestamptz IS NULL OR created_at < $2)
       AND ($3::text IS NULL OR action LIKE $3 || '%')
       AND ($4::uuid IS NULL OR actor_id = $4)
       AND ($5::timestamptz IS NULL OR created_at >= $5)
       AND ($6::timestamptz IS NULL OR created_at < $6)
     ORDER BY created_at DESC
     LIMIT $7`,
    [args.tenantId, args.before ?? null, args.action ?? null, args.actorId ?? null, args.from ?? null, args.to ?? null, limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    source: r.source,
    action: r.action,
    actorLabel: r.actor_label,
    actorRole: r.actor_role,
    targetType: r.target_type,
    targetLabel: r.target_label,
    details: r.details ?? {},
    createdAt: r.created_at,
  }));
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditCsv(rows: AuditRow[]): string {
  const header = ["When (UTC)", "Who", "Role", "Action", "Target type", "Target", "Details"];
  const lines = rows.map((r) =>
    [new Date(r.createdAt).toISOString(), r.actorLabel, r.actorRole, r.action, r.targetType, r.targetLabel, r.details].map(csvCell).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

// A Manager's view: what happened to their batches and their learners, and
// what they did themselves. No plan or billing history.
export async function listScopedActivity(args: {
  tenantId: string;
  managerId: string;
  batchIds: string[];
  learnerIds: string[];
  before?: string | null;
  limit: number;
}): Promise<AuditRow[]> {
  const ids = [...args.batchIds, ...args.learnerIds];
  const r = await pool.query(
    `SELECT * FROM (
       SELECT a.id, 'action' AS source, a.action, a.actor_label, a.actor_role, a.target_type, a.target_label, a.details, a.created_at
       FROM audit_log a
       WHERE a.tenant_id = $1 AND (a.actor_id = $2 OR a.target_id = ANY($3::uuid[]))
       UNION ALL
       SELECT e.id, 'license', 'license.' || e.kind,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email), u.role,
         CASE WHEN e.user_email IS NOT NULL THEN 'learner' WHEN e.batch_name IS NOT NULL THEN 'batch' END,
         coalesce(e.user_email, e.batch_name),
         jsonb_build_object('quantity', e.quantity, 'note', e.note), e.created_at
       FROM license_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.tenant_id = $1 AND (e.actor_id = $2 OR e.user_id = ANY($4::uuid[]) OR e.batch_id = ANY($5::uuid[]))
     ) t
     WHERE ($6::timestamptz IS NULL OR created_at < $6)
     ORDER BY created_at DESC LIMIT $7`,
    [args.tenantId, args.managerId, ids, args.learnerIds, args.batchIds, args.before ?? null, args.limit],
  );
  return r.rows.map((x) => ({
    id: x.id,
    source: x.source,
    action: x.action,
    actorLabel: x.actor_label,
    actorRole: x.actor_role,
    targetType: x.target_type,
    targetLabel: x.target_label,
    details: x.details ?? {},
    createdAt: x.created_at,
  }));
}
