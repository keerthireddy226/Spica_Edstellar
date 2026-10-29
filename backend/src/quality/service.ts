// The assessment quality track for Spica staff: the question pool and how
// often real tests used each question, the speaking fairness study (scores
// by first language), a technical report (reliability, score spread, item
// statistics) and appeals against real test results.
import { pool } from "../db.js";
import { accessCache } from "../licenses/accessCache.js";
import { notify } from "../notifications/service.js";
import { holdResultCertificate } from "../assessment/service.js";
import { LEVEL_TEST_BLUEPRINT } from "../practiceTests/modes.js";
import type { ExamPurpose } from "../catalogue/banks.js";
import { qualitySettings } from "./settings.js";
import { settleLevelTests } from "../practiceTests/sessionScore.js";

const round = (x: number | null, d = 1) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function sd(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function correlation(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  if (mx === null || my === null || xs.length < 3) return null;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Cronbach's alpha over parts scored for each test taker (rows: people, columns: parts).
export function cronbachAlpha(rows: number[][]): number | null {
  const k = rows[0]?.length ?? 0;
  if (rows.length < 3 || k < 2) return null;
  const itemVars = Array.from({ length: k }, (_, j) => sd(rows.map((r) => r[j])) ?? 0).map((s) => s * s);
  const totalVar = (sd(rows.map((r) => r.reduce((a, b) => a + b, 0))) ?? 0) ** 2;
  if (!totalVar) return null;
  return (k / (k - 1)) * (1 - itemVars.reduce((a, b) => a + b, 0) / totalVar);
}

// ---- Question pool ----

export async function poolReport() {
  const { exposureCap } = await qualitySettings();
  const tests = await pool.query(
    `SELECT e.test_type_id AS test, e.purpose AS bank, ep.sort_order, ep.part_label AS part,
       count(*) FILTER (WHERE i.status = 'approved')::int AS approved,
       count(*) FILTER (WHERE i.status = 'approved' AND i.mock_approved)::int AS for_mocks,
       count(*) FILTER (WHERE i.status = 'approved' AND i.certified_exposures >= $1)::int AS over_cap,
       coalesce(round(avg(i.certified_exposures) FILTER (WHERE i.status = 'approved'), 1), 0)::float AS mean_exposure,
       coalesce(max(i.certified_exposures), 0)::int AS max_exposure
     FROM exams e JOIN exam_parts ep ON ep.exam_id = e.id JOIN items i ON i.exam_part_id = ep.id JOIN test_types tt ON tt.id = e.test_type_id
     WHERE e.is_active AND tt.family_id = 'versant'
     GROUP BY 1, 2, 3, 4 ORDER BY 1, array_position(ARRAY['practice', 'mock', 'assessment'], e.purpose), 3`,
    [exposureCap],
  );
  const levels = await pool.query(
    `SELECT i.item_type_id AS type, it.name, i.cefr_level AS level, count(*)::int AS approved,
       count(*) FILTER (WHERE i.certified_exposures >= $1)::int AS over_cap, coalesce(max(i.certified_exposures), 0)::int AS max_exposure
     FROM items i JOIN item_types it ON it.id = i.item_type_id
     WHERE i.exam_part_id IS NULL AND i.status = 'approved' AND i.item_type_id = ANY($2::text[]) AND i.cefr_level IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY 1, 3`,
    [exposureCap, LEVEL_TEST_BLUEPRINT.map((p) => p.itemTypeId)],
  );
  return {
    exposureCap,
    // Each bank (practice sets, mock bank, real-test bank) on its own rows: they never share questions.
    tests: tests.rows.map((r) => ({ test: r.test, bank: r.bank as ExamPurpose, part: r.part, approved: r.approved, forMocks: r.for_mocks, overCap: r.over_cap, meanExposure: r.mean_exposure, maxExposure: r.max_exposure })),
    levelTests: levels.rows.map((r) => {
      const need = LEVEL_TEST_BLUEPRINT.find((p) => p.itemTypeId === r.type)?.count ?? 0;
      return { type: r.name, level: r.level, approved: r.approved, overCap: r.over_cap, maxExposure: r.max_exposure, perTest: need, testsLeft: need ? Math.floor((r.approved - r.over_cap) / need) : null };
    }),
  };
}

// ---- Speaking fairness study ----

// Spoken answers' scores (0-100) by the speaker's first language (else their
// country), from the last `days`. A group is flagged when it has enough
// people and its mean differs from everyone's by `gap` points or more.
export async function fairnessStudy(days = 180, minLearners = 20, gap = 8) {
  const r = await pool.query(
    `SELECT coalesce(nullif(pp.first_language, ''), 'Country: ' || coalesce(nullif(pp.country, ''), 'unknown')) AS grp,
       a.session_id, s.user_id, sc.content_score, (sc.manner_scores->'gemini'->>'pronunciation')::float AS clarity, (sc.manner_scores->'gemini'->>'fluency')::float AS fluency
     FROM attempts a JOIN sessions s ON s.id = a.session_id JOIN scores sc ON sc.attempt_id = a.id
     JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
     LEFT JOIN participant_profiles pp ON pp.user_id = s.user_id
     WHERE it.input_method = 'mic' AND sc.status = 'scored' AND a.response_uri IS NOT NULL AND s.started_at > now() - make_interval(days => $1)`,
    [days],
  );
  const all = r.rows.map((x) => Number(x.content_score) * 100);
  const overall = mean(all);
  const groups = new Map<string, { users: Set<string>; scores: number[]; clarity: number[]; fluency: number[] }>();
  for (const x of r.rows) {
    const g = groups.get(x.grp) ?? { users: new Set(), scores: [], clarity: [], fluency: [] };
    g.users.add(x.user_id);
    g.scores.push(Number(x.content_score) * 100);
    if (x.clarity !== null) g.clarity.push(Number(x.clarity) * 100);
    if (x.fluency !== null) g.fluency.push(Number(x.fluency) * 100);
    groups.set(x.grp, g);
  }
  return {
    days,
    minLearners,
    gap,
    answers: all.length,
    overall: round(overall),
    groups: [...groups.entries()]
      .map(([name, g]) => {
        const m = mean(g.scores);
        const diff = m !== null && overall !== null ? m - overall : null;
        return {
          group: name,
          learners: g.users.size,
          answers: g.scores.length,
          mean: round(m),
          clarity: round(mean(g.clarity)),
          fluency: round(mean(g.fluency)),
          diff: round(diff),
          flagged: g.users.size >= minLearners && diff !== null && Math.abs(diff) >= gap,
          tooFew: g.users.size < minLearners,
        };
      })
      .sort((a, b) => b.learners - a.learners),
  };
}

// ---- Technical report ----

// For one test: how many finished mock tests and real tests, each skill's
// mean and spread, internal consistency (Cronbach's alpha over the four
// skills), the levels reached, proctoring outcomes, appeals, and each
// question's difficulty and discrimination (enough answers only).
export async function technicalReport(testTypeId: string, minAnswers = 10) {
  const sessions = (
    await pool.query(
      `SELECT s.id, s.delivery_mode, s.result, si.status AS integrity
       FROM sessions s LEFT JOIN exams x ON x.id::text = s.composition->>'examId' LEFT JOIN session_integrity si ON si.session_id = s.id
       WHERE s.session_type = 'mocktest' AND s.delivery_mode IN ('mock', 'certified') AND s.completed_at IS NOT NULL
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND coalesce(s.composition->>'testTypeId', x.test_type_id) = $1 AND s.result->>'cefrLevel' IS NOT NULL`,
      [testTypeId],
    )
  ).rows;
  const skills = ["speaking", "listening", "reading", "writing"];
  const withAll = sessions.filter((s) => skills.every((k) => typeof s.result?.skillPercents?.[k] === "number"));
  const bySkill = Object.fromEntries(
    skills.map((k) => {
      const xs = sessions.map((s) => s.result?.skillPercents?.[k]).filter((x): x is number => typeof x === "number");
      return [k, { n: xs.length, mean: round(mean(xs)), sd: round(sd(xs)) }];
    }),
  );
  const levels: Record<string, number> = {};
  for (const s of sessions) levels[s.result.cefrLevel] = (levels[s.result.cefrLevel] ?? 0) + 1;
  const integrity: Record<string, number> = {};
  for (const s of sessions.filter((x) => x.delivery_mode === "certified")) integrity[s.integrity ?? "none"] = (integrity[s.integrity ?? "none"] ?? 0) + 1;
  const appeals = (
    await pool.query(
      `SELECT ra.status, count(*)::int AS n FROM result_appeals ra JOIN sessions s ON s.id = ra.session_id LEFT JOIN exams x ON x.id::text = s.composition->>'examId'
       WHERE coalesce(s.composition->>'testTypeId', x.test_type_id) = $1 GROUP BY 1`,
      [testTypeId],
    )
  ).rows;

  // Items: share right (scored 0.5 or more) and its correlation with the test's overall percent.
  const ids = sessions.map((s) => s.id);
  const answers = ids.length
    ? (
        await pool.query(
          `SELECT a.session_id, a.item_id, it.name AS type, i.cefr_level, sc.content_score, (a.response_text IS NOT NULL OR a.response_uri IS NOT NULL) AS answered
           FROM attempts a JOIN scores sc ON sc.attempt_id = a.id JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
           WHERE a.session_id = ANY($1::uuid[]) AND (sc.status = 'scored' OR (a.response_text IS NULL AND a.response_uri IS NULL))`,
          [ids],
        )
      ).rows
    : [];
  const overallOf = new Map(sessions.map((s) => [s.id, Number(s.result.overallPercent ?? 0)]));
  const perItem = new Map<string, { type: string; level: string | null; right: number[]; total: number[] }>();
  for (const a of answers) {
    const it = perItem.get(a.item_id) ?? { type: a.type as string, level: (a.cefr_level as string | null) ?? null, right: [] as number[], total: [] as number[] };
    it.right.push(a.answered && Number(a.content_score) >= 0.5 ? 1 : 0);
    it.total.push(overallOf.get(a.session_id) ?? 0);
    perItem.set(a.item_id, it);
  }
  const items = [...perItem.entries()]
    .filter(([, v]) => v.right.length >= minAnswers)
    .map(([id, v]) => {
      const p = mean(v.right)!;
      const disc = correlation(v.right, v.total);
      return {
        itemId: id,
        type: v.type,
        level: v.level,
        answers: v.right.length,
        difficulty: round(p * 100),
        discrimination: round(disc, 2),
        flag: p < 0.1 ? "too_hard" : p > 0.95 ? "too_easy" : disc !== null && disc < 0.1 ? "low_discrimination" : null,
      };
    })
    .sort((a, b) => (a.flag ? 0 : 1) - (b.flag ? 0 : 1) || a.answers - b.answers);

  return {
    testTypeId,
    generatedAt: new Date().toISOString(),
    sessions: { mock: sessions.filter((s) => s.delivery_mode === "mock").length, certified: sessions.filter((s) => s.delivery_mode === "certified").length },
    skills: bySkill,
    alpha: round(cronbachAlpha(withAll.map((s) => skills.map((k) => Number(s.result.skillPercents[k])))), 2),
    alphaSessions: withAll.length,
    levels,
    integrity,
    appeals: Object.fromEntries(appeals.map((a) => [a.status, a.n])),
    items: items.slice(0, 300),
    itemsAnalysed: items.length,
    flaggedItems: items.filter((i) => i.flag).length,
    minAnswers,
  };
}

// ---- Appeals ----

export class AppealError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

// The people who review scores: the Super Admin and Edstellar Admins with
// the "score review" permission. Requests go to all of them (one shared queue).
async function scoreReviewers(): Promise<{ id: string; role: string }[]> {
  return (
    await pool.query(
      `SELECT id, role FROM users WHERE deleted_at IS NULL
         AND (role = 'super_admin' OR (role = 'admin' AND coalesce((permissions->>'scoreReview')::boolean, false)))`,
    )
  ).rows;
}
const QUEUE_LINK = (role: string) => (role === "super_admin" ? "/superadmin/quality" : "/admin/quality");

// Asks for a person to review a test's score: a "review" for a placement test
// or a real attempt (the score can change), a "concern" for a practice or mock
// test (noted and used to improve scoring). Once per test, within the appeal
// window. filedBy: a recruiter asking for their candidate.
export async function fileAppeal(userId: string, sessionId: string, reason: string, filedBy?: string): Promise<string> {
  const { appealDays } = await qualitySettings();
  const s = (
    await pool.query(
      `SELECT s.id, s.completed_at, s.session_type, s.delivery_mode, u.tenant_id, u.role,
         coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS name
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2 AND s.completed_at IS NOT NULL`,
      [sessionId, userId],
    )
  ).rows[0];
  if (!s) throw new AppealError("not_found", 404);
  if (Date.now() - new Date(s.completed_at).getTime() > appealDays * 86_400_000) throw new AppealError("too_late");
  const kind = s.session_type === "placement" || s.delivery_mode === "certified" || s.role === "candidate" ? "review" : "concern";
  const r = await pool.query(
    `INSERT INTO result_appeals (session_id, user_id, tenant_id, reason, kind, filed_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (session_id) DO NOTHING RETURNING id`,
    [sessionId, userId, s.tenant_id, reason, kind, filedBy ?? null],
  );
  if (!r.rows[0]) throw new AppealError("already_appealed");
  for (const x of await scoreReviewers()) {
    await notify({
      userId: x.id,
      kind: "result_appeal",
      title: kind === "review" ? `${s.name} asked for a score review` : `${s.name} raised a concern about a score`,
      body: reason.slice(0, 300),
      link: QUEUE_LINK(x.role),
      sentBy: filedBy ?? userId,
    });
  }
  return r.rows[0].id;
}

// One reviewer takes a request, so two people don't review the same test.
export async function claimAppeal(id: string, actorId: string, force = false): Promise<void> {
  const r = await pool.query(
    `UPDATE result_appeals SET assigned_to = $2, assigned_at = now()
     WHERE id = $1 AND status = 'open' AND ($3::boolean OR assigned_to IS NULL OR assigned_to = $2) RETURNING id`,
    [id, actorId, force],
  );
  if (!r.rows[0]) throw new AppealError("already_taken", 409);
}

// Requests left too long go to the Super Admin: nobody took one in 2 days, or
// one taken wasn't decided in 5. Once each.
export async function escalateStaleAppeals(): Promise<number> {
  const r = await pool.query(
    `UPDATE result_appeals SET escalated_at = now()
     WHERE status = 'open' AND escalated_at IS NULL
       AND ((assigned_to IS NULL AND created_at < now() - interval '2 days') OR (assigned_to IS NOT NULL AND created_at < now() - interval '5 days'))
     RETURNING id, assigned_to`,
  );
  if (!r.rows.length) return 0;
  const supers = (await pool.query(`SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL`)).rows;
  for (const sa of supers) {
    await notify({
      userId: sa.id,
      kind: "result_appeal",
      title: `${r.rows.length} score review ${r.rows.length === 1 ? "request is" : "requests are"} waiting too long`,
      body: "Open the score review queue to assign or decide them.",
      link: "/superadmin/quality",
      dedupeKey: `appeal-escalation:${r.rows.map((x) => x.id).sort().join(",")}`,
    });
  }
  return r.rows.length;
}

// A learner's own requests, by test, for the status on their reports.
export async function myAppeals(userId: string) {
  const r = await pool.query(
    `SELECT session_id, kind, status, decision_note, created_at, decided_at, assigned_to IS NOT NULL AS taken FROM result_appeals WHERE user_id = $1`,
    [userId],
  );
  return r.rows.map((x) => ({
    sessionId: x.session_id as string,
    kind: x.kind as string,
    status: x.status === "open" ? (x.taken ? "in_review" : "pending") : (x.status as string),
    note: (x.decision_note as string | null) ?? null,
    createdAt: x.created_at,
    decidedAt: x.decided_at,
  }));
}

// An organization sees its people's requests and outcomes (read-only).
export async function orgAppeals(tenantId: string) {
  const r = await pool.query(
    `SELECT ra.id, ra.session_id, ra.kind, ra.status, ra.reason, ra.decision_note, ra.created_at, ra.decided_at, ra.assigned_to IS NOT NULL AS taken,
       coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS learner, s.test_code
     FROM result_appeals ra JOIN users u ON u.id = ra.user_id JOIN sessions s ON s.id = ra.session_id
     WHERE ra.tenant_id = $1 ORDER BY ra.created_at DESC LIMIT 200`,
    [tenantId],
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    sessionId: x.session_id as string,
    learner: x.learner as string,
    testCode: (x.test_code as string | null) ?? null,
    kind: x.kind as string,
    status: x.status === "open" ? (x.taken ? "in_review" : "pending") : (x.status as string),
    reason: x.reason as string,
    note: (x.decision_note as string | null) ?? null,
    createdAt: x.created_at,
    decidedAt: x.decided_at,
  }));
}

export async function listAppeals(status: "open" | "all") {
  const r = await pool.query(
    `SELECT ra.*, coalesce(nullif(concat_ws(' ', u.first_name, u.last_name), ''), u.email) AS learner, u.email, t.name AS org,
       nullif(concat_ws(' ', rv.first_name, rv.last_name), '') AS reviewer, s.delivery_mode, s.session_type,
       s.completed_at, s.result, s.test_code, si.status AS integrity, c.code AS certificate, c.spica_score, c.cefr_level, c.revoked_at AS certificate_revoked,
       coalesce(c.test_name, tt.name) AS test_name
     FROM result_appeals ra JOIN users u ON u.id = ra.user_id LEFT JOIN users rv ON rv.id = ra.assigned_to LEFT JOIN tenants t ON t.id = ra.tenant_id JOIN sessions s ON s.id = ra.session_id
     LEFT JOIN session_integrity si ON si.session_id = s.id LEFT JOIN certificates c ON c.session_id = s.id
     LEFT JOIN exams x ON x.id::text = s.composition->>'examId' LEFT JOIN test_types tt ON tt.id = coalesce(s.composition->>'testTypeId', x.test_type_id)
     WHERE ($1 = 'all' OR ra.status = 'open') ORDER BY ra.created_at DESC LIMIT 300`,
    [status],
  );
  return r.rows.map((x) => ({
    id: x.id as string,
    sessionId: x.session_id as string,
    learner: x.learner as string,
    email: x.email as string,
    org: (x.org as string | null) ?? null,
    testName: (x.test_name as string | null) ?? null,
    testCode: (x.test_code as string | null) ?? null,
    completedAt: x.completed_at,
    level: (x.cefr_level as string | null) ?? x.result?.cefrLevel ?? null,
    spicaScore: (x.spica_score as number | null) ?? null,
    integrity: (x.integrity as string | null) ?? null,
    certificate: x.certificate && !x.certificate_revoked ? (x.certificate as string) : null,
    reason: x.reason as string,
    kind: x.kind as string,
    testKind: x.session_type === "placement" ? "placement" : ((x.delivery_mode as string | null) ?? "practice"),
    assignedTo: (x.assigned_to as string | null) ?? null,
    reviewer: (x.reviewer as string | null) ?? null,
    escalated: !!x.escalated_at,
    status: x.status as string,
    decisionNote: (x.decision_note as string | null) ?? null,
    createdAt: x.created_at,
    decidedAt: x.decided_at,
  }));
}

// upheld: the result stands. changed: the answers were re-marked, so the
// certificate is withdrawn and issued again from the new scores. new_attempt:
// a free retake (one more attempt, two more weeks).
export async function decideAppeal(id: string, outcome: "upheld" | "changed" | "new_attempt" | "noted", note: string, actorId: string) {
  const a = (await pool.query(`SELECT ra.*, s.entitlement_id, s.delivery_mode, s.session_type FROM result_appeals ra JOIN sessions s ON s.id = ra.session_id WHERE ra.id = $1`, [id])).rows[0];
  if (!a) throw new AppealError("not_found", 404);
  if (a.status !== "open") throw new AppealError("not_open");
  // A concern (practice, mock) is noted or the score stands; re-marking and a
  // free retake are for real attempts.
  if (a.kind === "concern" && outcome !== "noted" && outcome !== "upheld") throw new AppealError("outcome_not_allowed");
  if (a.delivery_mode !== "certified" && (outcome === "changed" || outcome === "new_attempt")) throw new AppealError("outcome_not_allowed");
  await pool.query(
    `UPDATE result_appeals SET status = $2, decision_note = $3, decided_by = $4, decided_at = now(), assigned_to = coalesce(assigned_to, $4), assigned_at = coalesce(assigned_at, now()) WHERE id = $1`,
    [id, outcome, note, actorId],
  );
  if (outcome === "changed") {
    await holdResultCertificate(a.session_id);
    // The sweep issues a new certificate from the new scores.
    await pool.query(`DELETE FROM certificates WHERE session_id = $1 AND kind = 'result'`, [a.session_id]);
    // A level test is decided again from the new scores.
    await pool.query(`UPDATE sessions SET result = jsonb_set(result, '{levelTest,passed}', 'null') WHERE id = $1 AND result ? 'levelTest'`, [a.session_id]);
    await settleLevelTests();
  }
  if (outcome === "new_attempt" && a.entitlement_id) {
    await pool.query(
      `UPDATE entitlements SET attempts_total = attempts_total + 1, ends_at = greatest(ends_at, now() + interval '14 days') WHERE id = $1`,
      [a.entitlement_id],
    );
    accessCache.delete(a.user_id);
  }
  await notify({
    userId: a.user_id,
    kind: "result_appeal",
    title:
      outcome === "noted"
        ? "Your score concern was reviewed"
        : outcome === "upheld"
          ? "Your score review: the result stands"
          : outcome === "changed"
            ? "Your score review: your result was re-marked"
            : "Your score review: you can take the test again",
    body: note,
    link: a.delivery_mode === "certified" ? "/assessment" : a.session_type === "placement" ? "/dashboard" : `/practice-tests/report/${a.session_id}`,
    email: true,
    sentBy: actorId,
  });
}
