// A learner's current level, worked out the same way everywhere an
// organization sees it (batch analytics and its CSVs, the Batch report,
// program monitoring and plans). The most trusted result wins:
//   1. a valid final assessment certificate (not revoked, not expired);
//   2. else the latest level test they passed (the level it tested);
//   3. else the latest finished mock test with a level;
//   4. else the latest placement test, unless it was confirmed as fraud.
// Batch-friendly: one query per source for any number of learners.
import { pool } from "../db.js";

export type LevelSource = "final_assessment" | "level_test" | "mock" | "placement";

// Most trusted first.
export const LEVEL_ORDER: LevelSource[] = ["final_assessment", "level_test", "mock", "placement"];

export const SKILLS = ["listening", "speaking", "reading", "writing"] as const;

export interface LevelReading {
  source: LevelSource;
  // When the result was given (ISO).
  at: string;
  level: string;
  skills: Record<string, string>;
  // Each skill's share right and the overall share, where known (for Spica scores).
  skillPercents: Record<string, number | null> | null;
  overallPercent: number | null;
  // A certificate's own Spica scores.
  score: number | null;
  skillScores: Record<string, { level: string; score: number }> | null;
  // The test session behind it, when there is one.
  sessionId: string | null;
}

// The first source in LEVEL_ORDER that has a level.
export function pickCurrentLevel(found: Partial<Record<LevelSource, LevelReading | null | undefined>>): LevelReading | null {
  for (const s of LEVEL_ORDER) {
    const r = found[s];
    if (r?.level) return r;
  }
  return null;
}

// Older placements stored each skill as { level, cappedByGap }, newer ones as "B1".
export function skillLevelsOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const s of SKILLS) {
    const v = (raw as Record<string, unknown>)[s];
    const level = typeof v === "object" && v !== null ? (v as { level?: unknown }).level : v;
    if (typeof level === "string" && level) out[s] = level;
  }
  return out;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const iso = (d: unknown): string => new Date(d as string).toISOString();

// Each learner's current level (learners with no level at all are left out).
// testTypeId: only mock tests of this test count (a program's own test).
export async function currentLevels(userIds: string[], opts: { testTypeId?: string | null } = {}): Promise<Map<string, LevelReading>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const [certs, levelTests, mocks, placements] = await Promise.all([
    // Result certificates come only from the final assessment now; older
    // level tests also gave one, so those are left out here.
    pool.query(
      `SELECT DISTINCT ON (c.user_id) c.user_id, c.cefr_level, c.spica_score, c.skill_scores, c.issued_at, c.session_id
       FROM certificates c LEFT JOIN sessions s ON s.id = c.session_id
       WHERE c.user_id = ANY($1::uuid[]) AND c.kind = 'result' AND c.revoked_at IS NULL AND (c.valid_until IS NULL OR c.valid_until >= current_date)
         AND c.cefr_level IS NOT NULL AND s.composition->>'levelTest' IS NULL
       ORDER BY c.user_id, c.issued_at DESC`,
      [ids],
    ),
    // Passed level tests (still being scored or failed don't count), not set
    // aside part way and not judged a proctoring violation.
    pool.query(
      `SELECT DISTINCT ON (s.user_id) s.user_id, s.id, s.completed_at, s.composition->>'levelTest' AS level, s.result->'levelTest' AS lt
       FROM sessions s LEFT JOIN session_integrity si ON si.session_id = s.id
       WHERE s.user_id = ANY($1::uuid[]) AND s.delivery_mode = 'certified' AND s.completed_at IS NOT NULL
         AND s.composition->>'levelTest' IS NOT NULL AND s.result->'levelTest'->>'passed' = 'true'
         AND NOT coalesce((s.composition->>'abandoned')::boolean, false) AND coalesce(si.status, '') <> 'violation'
       ORDER BY s.user_id, s.completed_at DESC`,
      [ids],
    ),
    pool.query(
      `SELECT DISTINCT ON (s.user_id) s.user_id, s.id, s.completed_at, s.result
       FROM sessions s LEFT JOIN exams e ON e.id::text = s.composition->>'examId'
       WHERE s.user_id = ANY($1::uuid[]) AND s.session_type = 'mocktest' AND s.delivery_mode = 'mock' AND s.completed_at IS NOT NULL
         AND s.result->>'cefrLevel' IS NOT NULL AND NOT coalesce((s.composition->>'abandoned')::boolean, false)
         AND ($2::text IS NULL OR coalesce(s.composition->>'testTypeId', e.test_type_id) = $2)
       ORDER BY s.user_id, s.completed_at DESC`,
      [ids, opts.testTypeId ?? null],
    ),
    pool.query(
      `SELECT DISTINCT ON (user_id) user_id, taken_at, cefr_level, skill_levels, skill_percents, overall_percent, session_id
       FROM placements WHERE user_id = ANY($1::uuid[]) AND status <> 'fraud_confirmed' AND cefr_level IS NOT NULL
       ORDER BY user_id, taken_at DESC`,
      [ids],
    ),
  ]);

  const byUser = new Map<string, Partial<Record<LevelSource, LevelReading>>>();
  const put = (userId: string, r: LevelReading) => byUser.set(userId, { ...(byUser.get(userId) ?? {}), [r.source]: r });

  for (const c of certs.rows) {
    const skillScores = (c.skill_scores ?? null) as LevelReading["skillScores"];
    put(c.user_id, {
      source: "final_assessment",
      at: iso(c.issued_at),
      level: c.cefr_level,
      skills: Object.fromEntries(Object.entries(skillScores ?? {}).filter(([, v]) => v?.level).map(([k, v]) => [k, v.level])),
      skillPercents: null,
      overallPercent: null,
      score: num(c.spica_score),
      skillScores,
      sessionId: c.session_id ?? null,
    });
  }
  for (const t of levelTests.rows) {
    // Passing needs every skill's share right above the mark, so each skill
    // tested is at the test's level.
    const percents = (t.lt?.skillPercents ?? {}) as Record<string, number | null>;
    put(t.user_id, {
      source: "level_test",
      at: iso(t.completed_at),
      level: t.level,
      skills: Object.fromEntries(Object.entries(percents).filter(([, v]) => typeof v === "number").map(([k]) => [k, t.level as string])),
      skillPercents: percents,
      overallPercent: num(t.lt?.overallPercent),
      score: null,
      skillScores: null,
      sessionId: t.id,
    });
  }
  for (const m of mocks.rows) {
    put(m.user_id, {
      source: "mock",
      at: iso(m.completed_at),
      level: m.result.cefrLevel,
      skills: skillLevelsOf(m.result.skillLevels),
      skillPercents: m.result.skillPercents ?? null,
      overallPercent: num(m.result.overallPercent),
      score: null,
      skillScores: null,
      sessionId: m.id,
    });
  }
  for (const p of placements.rows) {
    put(p.user_id, {
      source: "placement",
      at: iso(p.taken_at),
      level: p.cefr_level,
      skills: skillLevelsOf(p.skill_levels),
      skillPercents: p.skill_percents ?? null,
      overallPercent: num(p.overall_percent),
      score: null,
      skillScores: null,
      sessionId: p.session_id ?? null,
    });
  }

  const out = new Map<string, LevelReading>();
  for (const [userId, found] of byUser) {
    const r = pickCurrentLevel(found);
    if (r) out.set(userId, r);
  }
  return out;
}

// One learner's current level.
export async function currentLevel(userId: string, opts: { testTypeId?: string | null } = {}): Promise<LevelReading | null> {
  return (await currentLevels([userId], opts)).get(userId) ?? null;
}
