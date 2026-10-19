// "My path" in Practice Modules: the level a learner works at in each
// question type and skill. It starts at their level-test level for that
// skill, moves up once most of a level's sets are done well, moves down after
// two weak sets in a row, and a full mock exam can raise it.
import { pool } from "../db.js";
import { isTrulyCorrect } from "../placement/fluencySignals.js";
import { passThresholdForLevel } from "../placement/cefr.js";
import type { SkillTag } from "../gamification/stats.js";

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];
const rank = (l: string) => LEVELS.indexOf(l as Level);
const isLevel = (l: unknown): l is Level => typeof l === "string" && rank(l) >= 0;

// A level is passed with this many of its sets done (or all, if fewer) at
// this average score.
export const PASS_SETS = 7;
export const PASS_ACCURACY = 0.7;
// Two finished sets in a row at or below this move the path down.
export const WEAK_ACCURACY = 0.4;

// Unit names start with their level ("B1 - Intermediate").
const unitLevel = (name: string): Level | null => (isLevel(name.slice(0, 2)) ? (name.slice(0, 2) as Level) : null);

interface Unit {
  id: string;
  name: string;
  level: Level;
}

// The question types with sets for this skill, and their level units.
async function skillTypes(skill: SkillTag): Promise<{ id: string; name: string; units: Unit[] }[]> {
  const r = await pool.query(
    `SELECT it.id, it.name, u.id AS unit_id, u.name AS unit_name
     FROM item_types it JOIN units u ON u.item_type_id = it.id
     WHERE $1 = ANY(it.skills)
       AND EXISTS (SELECT 1 FROM sets st JOIN items i ON i.set_id = st.id
                   WHERE st.unit_id = u.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $1))
     ORDER BY it.name, u.order_index`,
    [skill],
  );
  const by = new Map<string, { id: string; name: string; units: Unit[] }>();
  for (const x of r.rows) {
    const level = unitLevel(x.unit_name);
    if (!level) continue;
    const t = by.get(x.id) ?? { id: x.id as string, name: x.name as string, units: [] as Unit[] };
    t.units.push({ id: x.unit_id, name: x.unit_name, level });
    by.set(x.id, t);
  }
  return [...by.values()];
}

async function latestPlacement(userId: string) {
  return (await pool.query(`SELECT cefr_level, skill_levels, taken_at FROM placements WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 1`, [userId]))
    .rows[0] as { cefr_level: string | null; skill_levels: Record<string, string | null> | null; taken_at: Date } | undefined;
}

// Each type's path level for this skill. A type without one starts at the
// level-test level for the skill; a newer level test re-seeds levels that
// came from the previous one.
export async function pathLevels(userId: string, skill: SkillTag, typeIds: string[]): Promise<Map<string, Level>> {
  const placement = await latestPlacement(userId);
  const seed: Level = isLevel(placement?.skill_levels?.[skill]) ? (placement!.skill_levels![skill] as Level) : isLevel(placement?.cefr_level) ? (placement!.cefr_level as Level) : "A1";
  const rows = (
    await pool.query(`SELECT item_type_id, level, source, updated_at FROM learner_type_levels WHERE user_id = $1 AND skill = $2`, [userId, skill])
  ).rows as { item_type_id: string; level: Level; source: string; updated_at: Date }[];
  const out = new Map<string, Level>();
  const toSeed: string[] = [];
  for (const id of typeIds) {
    const row = rows.find((r) => r.item_type_id === id);
    const stale = row && row.source === "placement" && placement && new Date(placement.taken_at) > new Date(row.updated_at);
    if (!row || stale) toSeed.push(id);
    out.set(id, !row || stale ? seed : row.level);
  }
  if (toSeed.length) {
    await pool.query(
      `INSERT INTO learner_type_levels (user_id, item_type_id, skill, level, source)
       SELECT $1, unnest($2::text[]), $3, $4, 'placement'
       ON CONFLICT (user_id, item_type_id, skill) DO UPDATE SET level = EXCLUDED.level, source = 'placement', updated_at = now()`,
      [userId, toSeed, skill, seed],
    );
  }
  return out;
}

async function setLevel(userId: string, itemTypeId: string, skill: string, level: Level, source: string) {
  await pool.query(
    `INSERT INTO learner_type_levels (user_id, item_type_id, skill, level, source) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, item_type_id, skill) DO UPDATE SET level = $4, source = $5, updated_at = now()`,
    [userId, itemTypeId, skill, level, source],
  );
}

interface SetStat {
  setId: string;
  setName: string;
  unitId: string;
  orderIndex: number;
  // Latest finished run, if any.
  sessionId: string | null;
  completedAt: Date | null;
  accuracy: number | null;
}

// Every set of the given units for this skill, with the learner's latest
// finished run and its score (skipped answers count as wrong).
async function setStats(userId: string, skill: SkillTag, unitIds: string[]): Promise<SetStat[]> {
  if (!unitIds.length) return [];
  const sets = (
    await pool.query(
      `SELECT DISTINCT ON (st.id) st.id, st.name, st.unit_id, st.order_index, se.id AS session_id, se.completed_at,
         jsonb_array_length(coalesce(se.composition->'itemIds', '[]'::jsonb)) AS total
       FROM sets st
       LEFT JOIN sessions se ON se.composition->>'setId' = st.id::text AND se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL
       WHERE st.unit_id = ANY($2::uuid[])
         AND EXISTS (SELECT 1 FROM items i WHERE i.set_id = st.id AND i.status = 'approved' AND (i.skill_tag IS NULL OR i.skill_tag = $3))
       ORDER BY st.id, se.completed_at DESC NULLS LAST`,
      [userId, unitIds, skill],
    )
  ).rows;
  const sessionIds = sets.map((s) => s.session_id).filter(Boolean);
  const right = new Map<string, number>();
  if (sessionIds.length) {
    const scored = await pool.query(
      `SELECT a.session_id, sc.content_score, sc.manner_scores, i.cefr_level, it.input_method
       FROM attempts a JOIN scores sc ON sc.attempt_id = a.id AND sc.status = 'scored'
       JOIN items i ON i.id = a.item_id JOIN item_types it ON it.id = i.item_type_id
       WHERE a.session_id = ANY($1::uuid[])`,
      [sessionIds],
    );
    for (const x of scored.rows) {
      if (isTrulyCorrect(Number(x.content_score), x.cefr_level, x.input_method, x.manner_scores, passThresholdForLevel)) {
        right.set(x.session_id, (right.get(x.session_id) ?? 0) + 1);
      }
    }
  }
  return sets
    .map((s) => ({
      setId: s.id,
      setName: s.name,
      unitId: s.unit_id,
      orderIndex: s.order_index,
      sessionId: s.session_id,
      completedAt: s.completed_at,
      accuracy: s.session_id ? (right.get(s.session_id) ?? 0) / Math.max(1, Number(s.total)) : null,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

export function levelProgress(sets: Pick<SetStat, "sessionId" | "accuracy">[]) {
  const done = sets.filter((s) => s.sessionId);
  const accuracy = done.length ? done.reduce((n, s) => n + (s.accuracy ?? 0), 0) / done.length : null;
  const need = Math.min(PASS_SETS, sets.length);
  return { setsTotal: sets.length, setsDone: done.length, accuracy, passed: done.length >= need && (accuracy ?? 0) >= PASS_ACCURACY };
}

export interface PathType {
  itemTypeId: string;
  typeName: string;
  level: Level;
  unitId: string;
  unitName: string;
  setsTotal: number;
  setsDone: number;
  // Average score of the finished sets at this level, 0-100.
  accuracy: number | null;
  // Sets still to finish before the level can be passed.
  setsToLevelUp: number;
}

export interface PathSet {
  setId: string;
  setName: string;
  itemTypeId: string;
  typeName: string;
  unitId: string;
  unitName: string;
  level: Level;
  // Every set at this level is done: this one is a retake of the weakest.
  retake: boolean;
}

export interface SkillPath {
  skill: SkillTag;
  // The level most of this skill's types are at.
  level: Level;
  types: PathType[];
  next: PathSet | null;
}

export async function skillPath(userId: string, skill: SkillTag): Promise<SkillPath> {
  const types = await skillTypes(skill);
  const levels = await pathLevels(userId, skill, types.map((t) => t.id));
  const units = types.map((t) => {
    const level = levels.get(t.id)!;
    // The path level, or the nearest level this type has.
    const unit = t.units.find((u) => u.level === level) ?? [...t.units].sort((a, b) => Math.abs(rank(a.level) - rank(level)) - Math.abs(rank(b.level) - rank(level)))[0];
    return { type: t, unit };
  });
  const stats = await setStats(userId, skill, units.map((u) => u.unit.id));
  const pathTypes: (PathType & { sets: SetStat[] })[] = units.map(({ type, unit }) => {
    const sets = stats.filter((s) => s.unitId === unit.id);
    const p = levelProgress(sets);
    return {
      itemTypeId: type.id,
      typeName: type.name,
      level: unit.level,
      unitId: unit.id,
      unitName: unit.name,
      setsTotal: p.setsTotal,
      setsDone: p.setsDone,
      accuracy: p.accuracy === null ? null : Math.round(p.accuracy * 100),
      setsToLevelUp: Math.max(0, Math.min(PASS_SETS, p.setsTotal) - p.setsDone),
      sets,
    };
  });

  const counts = new Map<Level, number>();
  for (const t of pathTypes) counts.set(t.level, (counts.get(t.level) ?? 0) + 1);
  const level = [...counts.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]?.[0] ?? "A1";

  // The type practised last in this skill waits its turn.
  const last = (
    await pool.query(
      `SELECT u.item_type_id FROM sessions se JOIN sets st ON st.id::text = se.composition->>'setId' JOIN units u ON u.id = st.unit_id
       WHERE se.user_id = $1 AND se.session_type = 'practice' AND se.completed_at IS NOT NULL AND se.composition->>'skill' = $2
       ORDER BY se.completed_at DESC LIMIT 1`,
      [userId, skill],
    )
  ).rows[0]?.item_type_id;

  // Next: the type with the fewest sets done at its level, weaker scores first.
  let next: PathSet | null = null;
  let best = Infinity;
  for (const t of pathTypes) {
    const open = t.sets.find((s) => !s.sessionId);
    const pick = open ?? [...t.sets].filter((s) => s.sessionId).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0];
    if (!pick) continue;
    const score = t.setsDone + (t.accuracy === null ? 2 : (t.accuracy / 100) * 4) + (open ? 0 : 10) + (t.itemTypeId === last ? 3 : 0);
    if (score < best) {
      best = score;
      next = { setId: pick.setId, setName: pick.setName, itemTypeId: t.itemTypeId, typeName: t.typeName, unitId: t.unitId, unitName: t.unitName, level: t.level, retake: !open };
    }
  }
  return { skill, level, types: pathTypes.map(({ sets: _sets, ...t }) => t), next };
}

export interface PathChange {
  itemTypeId: string;
  typeName: string;
  skill: string;
  from: Level;
  to: Level;
  direction: "up" | "down";
}

// After a finished set: pass the level (all-but-a-few sets done well) or
// step down (two weak sets in a row at the path level). Sets done above the
// path level count too, so a learner who stretches ahead can skip forward.
export async function updatePathAfterSet(userId: string, setId: string, skill: SkillTag): Promise<PathChange | null> {
  const s = (
    await pool.query(
      `SELECT u.id AS unit_id, u.name AS unit_name, u.item_type_id, it.name AS type_name
       FROM sets st JOIN units u ON u.id = st.unit_id JOIN item_types it ON it.id = u.item_type_id WHERE st.id = $1`,
      [setId],
    )
  ).rows[0];
  const setLevelOf = s ? unitLevel(s.unit_name) : null;
  if (!s || !setLevelOf) return null;
  const types = await skillTypes(skill);
  const type = types.find((t) => t.id === s.item_type_id);
  if (!type) return null;
  const current = (await pathLevels(userId, skill, [type.id])).get(type.id)!;
  const stats = await setStats(userId, skill, [s.unit_id]);
  const progress = levelProgress(stats);

  if (rank(setLevelOf) >= rank(current) && progress.passed) {
    const up = type.units.find((u) => rank(u.level) > rank(setLevelOf))?.level;
    if (up && rank(up) > rank(current)) {
      await setLevel(userId, type.id, skill, up, "progress");
      return { itemTypeId: type.id, typeName: type.name, skill, from: current, to: up, direction: "up" };
    }
    return null;
  }
  if (setLevelOf === current) {
    const lastTwo = stats.filter((x) => x.sessionId).sort((a, b) => +new Date(b.completedAt!) - +new Date(a.completedAt!)).slice(0, 2);
    const down = [...type.units].reverse().find((u) => rank(u.level) < rank(current))?.level;
    if (lastTwo.length === 2 && lastTwo.every((x) => (x.accuracy ?? 0) <= WEAK_ACCURACY) && down) {
      await setLevel(userId, type.id, skill, down, "progress");
      return { itemTypeId: type.id, typeName: type.name, skill, from: current, to: down, direction: "down" };
    }
  }
  return null;
}

// A full mock exam's level per skill lifts any path below it (never lowers).
export async function raisePathFromMock(userId: string, skillLevels: Record<string, string | null> | null) {
  if (!skillLevels) return;
  for (const [skill, level] of Object.entries(skillLevels)) {
    if (!isLevel(level) || !["listening", "speaking", "reading", "writing"].includes(skill)) continue;
    const types = await skillTypes(skill as SkillTag);
    const levels = await pathLevels(userId, skill as SkillTag, types.map((t) => t.id));
    for (const t of types) {
      if (rank(levels.get(t.id)!) < rank(level) && t.units.some((u) => u.level === level)) await setLevel(userId, t.id, skill, level, "mock");
    }
  }
}

// Each skill's path level, for Overview and the Roadmap.
export async function pathSummary(userId: string): Promise<Record<SkillTag, Level>> {
  const out = {} as Record<SkillTag, Level>;
  for (const skill of ["listening", "speaking", "reading", "writing"] as SkillTag[]) out[skill] = (await skillPath(userId, skill)).level;
  return out;
}
