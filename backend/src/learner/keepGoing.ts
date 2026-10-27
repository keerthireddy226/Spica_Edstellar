// "Keep going": when a learner needs more time or more tests to reach their
// goal: access ending, in grace or over; this month's tests used up; every
// practice set done; or the exam close, while the goal isn't reached. An
// individual extends from Plans; a learner in an organization asks its admin.
import { pool } from "../db.js";
import { learnerAccess, learnerKind } from "../licenses/service.js";
import { latestLearnerRequest } from "../licenses/requests.js";
import { mockAllowance, quotaUsage, testTypesPreparing } from "../programs/quotas.js";
import { daysUntilDate } from "./insights.js";
import { LEVELS, overallFromSkills, pathSummary } from "./path.js";

export type KeepGoingReason = "access_expired" | "access_grace" | "access_ending" | "quota_mocks" | "quota_practice" | "tests_done" | "exam_near";

const DAY_MS = 86_400_000;

// Practice test sets on offer, and how many the learner completed (every
// question answered).
export async function practiceSetProgress(userId: string): Promise<{ total: number; done: number }> {
  return (
    await pool.query(
      `SELECT count(*)::int AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM sessions s WHERE s.user_id = $1 AND s.session_type = 'mocktest' AND s.delivery_mode = 'practice' AND s.completed_at IS NOT NULL
             AND s.composition->>'examId' = e.id::text
             AND (SELECT count(*) FROM attempts a WHERE a.session_id = s.id AND (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL))
                 >= jsonb_array_length(coalesce(s.composition->'itemIds', '[]'::jsonb))
         ))::int AS done
       FROM exams e JOIN test_types tt ON tt.id = e.test_type_id JOIN exam_families f ON f.id = tt.family_id
       WHERE e.is_active AND e.purpose = 'practice' AND tt.status = 'live' AND f.active`,
      [userId],
    )
  ).rows[0];
}

export async function keepGoingStatus(userId: string) {
  const kind = await learnerKind(userId);
  const access = await learnerAccess(userId);
  const quota = await quotaUsage(userId).catch(() => null);
  const mocks = mockAllowance(quota, quota?.mocksPerTestType ? await testTypesPreparing(userId).catch(() => []) : []);
  const profile = (await pool.query(`SELECT goal_level, exam_date FROM participant_profiles WHERE user_id = $1`, [userId])).rows[0] ?? {};
  const current = overallFromSkills(await pathSummary(userId));
  const goal: string | null = profile.goal_level && profile.goal_level !== "unsure" ? profile.goal_level : null;
  const goalReached = !!goal && !!current && LEVELS.indexOf(current as never) >= LEVELS.indexOf(goal as never);
  const examDays = profile.exam_date ? daysUntilDate(profile.exam_date) : null;

  const sets = await practiceSetProgress(userId);

  const daysLeft = access.accessEndsAt ? Math.ceil((new Date(access.accessEndsAt).getTime() - Date.now()) / DAY_MS) : null;
  const reasons: KeepGoingReason[] = [];
  if (kind !== "other") {
    if (access.status === "expired") reasons.push("access_expired");
    else if (access.status === "grace") reasons.push("access_grace");
    else if (access.status === "active" && daysLeft !== null && daysLeft <= 7) reasons.push("access_ending");
  }
  // These only matter while the goal isn't reached.
  if (!goalReached) {
    if (quota && mocks.left === 0) reasons.push("quota_mocks");
    if (quota?.practicePerMonth != null && quota.practiceUsed >= quota.practicePerMonth) reasons.push("quota_practice");
    if (sets.total > 0 && sets.done >= sets.total) reasons.push("tests_done");
    if (examDays !== null && examDays >= 0 && examDays <= 14) reasons.push("exam_near");
  }

  return {
    kind,
    reasons,
    access: { status: access.status, accessEndsAt: access.accessEndsAt, graceEndsAt: access.graceEndsAt, daysLeft },
    goal: { current, goal, reached: goalReached, examDays },
    quota: quota
      ? {
          practiceLeft: quota.practicePerMonth == null ? null : Math.max(0, quota.practicePerMonth - quota.practiceUsed),
          mocksLeft: mocks.left,
          resetsOn: quota.resetsOn,
        }
      : null,
    sets: { total: sets.total, done: sets.done },
    request: kind === "org" ? await latestLearnerRequest(userId) : null,
  };
}

// One line of progress for the admin's request: level, goal, tests done.
export async function progressLine(userId: string): Promise<string> {
  const s = await keepGoingStatus(userId);
  // One fixed sentence (dashes for what's unknown), so emails can translate it.
  const ends = s.access.accessEndsAt ? new Date(s.access.accessEndsAt).toISOString().slice(0, 10) : "—";
  return `Level now ${s.goal.current ?? "—"}, goal ${s.goal.goal ?? "—"}, ${s.sets.done} of ${s.sets.total} practice sets completed, access ends ${ends}.`;
}
