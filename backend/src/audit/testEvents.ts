// Audit entries for a learner's or candidate's test: when it started and
// when it ended, with the test, the attempt and the result.
import { pool } from "../db.js";
import { recordAudit } from "./service.js";

async function testContext(sessionId: string) {
  const r = await pool.query(
    `SELECT s.user_id, s.session_type, s.test_code, s.started_at, s.completed_at, u.role, u.tenant_id,
       coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS person,
       e.name AS exam_name, e.test_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
     WHERE s.id = $1`,
    [sessionId],
  );
  return r.rows[0] ?? null;
}

export async function auditTestStarted(sessionId: string, ip?: string | null): Promise<void> {
  const t = await testContext(sessionId);
  if (!t) return;
  await recordAudit({
    tenantId: t.tenant_id,
    actorId: t.user_id,
    actorRole: t.role,
    action: "test.started",
    targetType: "test",
    targetId: sessionId,
    targetLabel: t.exam_name ?? "Placement test",
    details: { testId: t.test_id ?? null, attemptId: t.test_code, kind: t.session_type },
    ip: ip ?? null,
  });
}

export async function auditTestCompleted(
  sessionId: string,
  result: { cefrLevel?: string | null; overallPercent?: number | null; answered?: number; skipped?: number },
  ip?: string | null,
): Promise<void> {
  const t = await testContext(sessionId);
  if (!t) return;
  const minutes = t.completed_at ? Math.max(1, Math.round((new Date(t.completed_at).getTime() - new Date(t.started_at).getTime()) / 60000)) : null;
  await recordAudit({
    tenantId: t.tenant_id,
    actorId: t.user_id,
    actorRole: t.role,
    action: "test.completed",
    targetType: "test",
    targetId: sessionId,
    targetLabel: t.exam_name ?? "Placement test",
    details: {
      testId: t.test_id ?? null,
      attemptId: t.test_code,
      kind: t.session_type,
      level: result.cefrLevel ?? null,
      score: result.overallPercent ?? null,
      minutes,
      answered: result.answered ?? null,
      skipped: result.skipped ?? null,
    },
    ip: ip ?? null,
  });
}
