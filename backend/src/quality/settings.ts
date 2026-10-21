// Assessment settings Spica staff can change: level test pass marks, the
// wait before a new level test, how many real tests a question may appear
// in, and how long a learner has to appeal a result.
import { pool } from "../db.js";

export interface QualitySettings {
  levelPassOverall: number;
  levelSkillMin: number;
  levelRetakeDays: number;
  exposureCap: number;
  appealDays: number;
}

const KEYS: Record<keyof QualitySettings, string> = {
  levelPassOverall: "level_pass_overall",
  levelSkillMin: "level_skill_min",
  levelRetakeDays: "level_retake_days",
  exposureCap: "exposure_cap",
  appealDays: "appeal_days",
};
export const DEFAULT_SETTINGS: QualitySettings = { levelPassOverall: 70, levelSkillMin: 50, levelRetakeDays: 7, exposureCap: 40, appealDays: 14 };

let cached: { at: number; value: QualitySettings } | null = null;

export async function qualitySettings(): Promise<QualitySettings> {
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const r = await pool.query(`SELECT key, value FROM assessment_settings`);
  const byKey = new Map(r.rows.map((x) => [x.key as string, Number(x.value)]));
  const value = Object.fromEntries(
    (Object.keys(KEYS) as (keyof QualitySettings)[]).map((k) => [k, byKey.get(KEYS[k]) ?? DEFAULT_SETTINGS[k]]),
  ) as unknown as QualitySettings;
  cached = { at: Date.now(), value };
  return value;
}

export async function saveQualitySettings(changes: Partial<QualitySettings>, actorId: string): Promise<QualitySettings> {
  for (const [k, v] of Object.entries(changes) as [keyof QualitySettings, number][]) {
    if (v === undefined) continue;
    await pool.query(
      `INSERT INTO assessment_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [KEYS[k], v, actorId],
    );
  }
  cached = null;
  return qualitySettings();
}
