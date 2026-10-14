import { pool } from "../db.js";
import { learnerAccessMap, type LearnerAccess } from "../licenses/service.js";

export type EngagementStatus = "not_started" | "inactive" | "slow" | "on_track" | "achieved";

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const INACTIVE_DAYS = 7;
export const REMINDER_COOLDOWN_HOURS = 48;

export interface LearnerEngagement {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  participantId: string | null;
  tenantId: string;
  batchId: string | null;
  batchName: string | null;
  status: EngagementStatus;
  sessionsCompleted: number;
  lastActiveAt: string | null;
  currentCefr: string | null;
  startCefr: string | null;
  targetCefr: string | null;
  // 0..1 of the way from start to target level, and where they should be by now.
  progress: number | null;
  expectedProgress: number | null;
  remindersSent: number;
  lastRemindedAt: string | null;
  canRemindAt: string | null;
  needsAttention: boolean;
  license: LearnerAccess;
}

// Same completion rule as everywhere else: a session counts only if every
// item in it got a real answer.
const GENUINE = `s.completed_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM attempts a WHERE a.session_id = s.id AND a.response_text IS NULL AND a.response_uri IS NULL)`;

export async function learnerEngagement(scope: { tenantId: string; batchIds?: string[]; learnerIds?: string[] }): Promise<LearnerEngagement[]> {
  const params: unknown[] = [scope.tenantId];
  let filter = "";
  if (scope.batchIds) {
    params.push(scope.batchIds);
    filter += ` AND u.batch_id = ANY($${params.length}::uuid[])`;
  }
  if (scope.learnerIds) {
    params.push(scope.learnerIds);
    filter += ` AND u.id = ANY($${params.length}::uuid[])`;
  }
  const result = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.participant_id, u.tenant_id, u.batch_id,
       b.name AS batch_name, b.start_cefr, b.target_cefr, b.start_date, b.duration_months, b.created_at AS batch_created_at,
       (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND ${GENUINE}) AS sessions_completed,
       (SELECT max(s.completed_at) FROM sessions s WHERE s.user_id = u.id AND ${GENUINE}) AS last_active_at,
       (SELECT p.cefr_level FROM placements p WHERE p.user_id = u.id ORDER BY p.taken_at DESC LIMIT 1) AS current_cefr,
       (SELECT count(*)::int FROM notifications n WHERE n.user_id = u.id AND n.kind IN ('manager_reminder', 'auto_reminder')) AS reminders_sent,
       (SELECT max(n.created_at) FROM notifications n WHERE n.user_id = u.id AND n.kind = 'manager_reminder') AS last_reminded_at
     FROM users u LEFT JOIN batches b ON b.id = u.batch_id
     WHERE u.tenant_id = $1 AND u.role = 'learner' AND u.deleted_at IS NULL ${filter}
     ORDER BY u.first_name NULLS LAST, u.email`,
    params,
  );
  const access = await learnerAccessMap(result.rows.map((r) => r.id));
  const now = Date.now();

  return result.rows.map((r) => {
    const lastActive = r.last_active_at ? new Date(r.last_active_at).getTime() : null;
    const cur = CEFR.indexOf(r.current_cefr ?? "");
    const start = CEFR.indexOf(r.start_cefr ?? "");
    const target = CEFR.indexOf(r.target_cefr ?? "");

    let progress: number | null = null;
    let expected: number | null = null;
    if (start >= 0 && target > start) {
      progress = Math.max(0, Math.min(1, ((cur >= 0 ? cur : start) - start) / (target - start)));
      const begin = r.start_date ? new Date(r.start_date).getTime() : new Date(r.batch_created_at).getTime();
      if (r.duration_months) {
        const span = r.duration_months * 30.44 * 86400000;
        expected = Math.max(0, Math.min(1, (now - begin) / span));
      }
    }

    let status: EngagementStatus;
    if (target >= 0 && cur >= target) status = "achieved";
    else if (r.sessions_completed === 0) status = "not_started";
    else if (!lastActive || now - lastActive > INACTIVE_DAYS * 86400000) status = "inactive";
    else if (progress !== null && expected !== null && expected > 0.3 && expected - progress > 0.25) status = "slow";
    else status = "on_track";

    const lastReminded = r.last_reminded_at ? new Date(r.last_reminded_at).getTime() : null;
    const canRemindAt =
      lastReminded && now - lastReminded < REMINDER_COOLDOWN_HOURS * 3600000
        ? new Date(lastReminded + REMINDER_COOLDOWN_HOURS * 3600000).toISOString()
        : null;

    return {
      id: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      participantId: r.participant_id,
      tenantId: r.tenant_id,
      batchId: r.batch_id,
      batchName: r.batch_name,
      status,
      sessionsCompleted: r.sessions_completed,
      lastActiveAt: r.last_active_at,
      currentCefr: r.current_cefr,
      startCefr: r.start_cefr,
      targetCefr: r.target_cefr,
      progress,
      expectedProgress: expected,
      remindersSent: r.reminders_sent,
      lastRemindedAt: r.last_reminded_at,
      canRemindAt,
      // Nudged twice already and still hasn't got going.
      needsAttention: r.reminders_sent >= 2 && (status === "not_started" || status === "inactive"),
      license: access.get(r.id)!,
    };
  });
}
