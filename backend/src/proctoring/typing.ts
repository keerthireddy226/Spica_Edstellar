// Typing rhythm, compared within one test and with the learner's earlier
// tests. The browser sends, per written answer, only timing statistics: how
// long keys are held (dwell), the gap between keys (flight), and the gap
// for common letter pairs. No text and no key order is sent.
//
// Typing rhythm changes with fatigue, keyboard and language, so this is a
// weak signal on its own and carries a low weight in the risk score. The
// cut-offs are a starting point and not yet calibrated on real learners.
import { pool } from "../db.js";

export const MIN_KEYS_PER_HALF = 150;
const CONSISTENT_BELOW = 0.2;
const INCONSISTENT_ABOVE = 0.35;

type Profile = Record<string, number>;

interface Answer {
  keys: number;
  features: Profile;
}

// Keystroke-weighted average of each feature across answers.
function combine(answers: Answer[]): { keys: number; features: Profile } {
  const sums: Record<string, number> = {};
  const weights: Record<string, number> = {};
  let keys = 0;
  for (const a of answers) {
    keys += a.keys;
    for (const [k, v] of Object.entries(a.features)) {
      if (!Number.isFinite(v) || v <= 0) continue;
      sums[k] = (sums[k] ?? 0) + v * a.keys;
      weights[k] = (weights[k] ?? 0) + a.keys;
    }
  }
  const features: Profile = {};
  for (const k of Object.keys(sums)) features[k] = Math.round(sums[k] / weights[k]);
  return { keys, features };
}

// Median relative difference over the features both profiles have.
export function profileDistance(a: Profile, b: Profile): number | null {
  const diffs = Object.keys(a)
    .filter((k) => b[k] !== undefined)
    .map((k) => Math.abs(a[k] - b[k]) / ((a[k] + b[k]) / 2))
    .sort((x, y) => x - y);
  if (diffs.length < 3) return null;
  return Math.round(diffs[Math.floor(diffs.length / 2)] * 100) / 100;
}

function verdict(d: number | null): "consistent" | "uncertain" | "inconsistent" | null {
  if (d === null) return null;
  return d < CONSISTENT_BELOW ? "consistent" : d > INCONSISTENT_ABOVE ? "inconsistent" : "uncertain";
}

export interface TypingCheck {
  decision: "consistent" | "uncertain" | "inconsistent" | "insufficient_typing";
  keys: number;
  withinSession: number | null;
  vsHistory: number | null;
  historySessions: number;
  profile: Profile;
}

export async function runTypingCheck(sessionId: string): Promise<TypingCheck | null> {
  const si = (await pool.query(`SELECT user_id, policy, biometric_opt_out FROM session_integrity WHERE session_id = $1`, [sessionId])).rows[0];
  if (!si?.policy?.typingPattern || si.biometric_opt_out) return null;
  const rows = await pool.query(
    `SELECT detail FROM proctoring_events WHERE session_id = $1 AND type = 'typing_profile' AND detail IS NOT NULL ORDER BY coalesce(client_at, created_at)`,
    [sessionId],
  );
  const answers: Answer[] = rows.rows
    .map((r) => {
      const { keys, ...rest } = r.detail as Record<string, unknown>;
      const features: Profile = {};
      for (const [k, v] of Object.entries(rest)) if (typeof v === "number") features[k] = v;
      return { keys: Number(keys) || 0, features };
    })
    .filter((a) => a.keys >= 20);

  const all = combine(answers);
  // Halves by keystrokes, in the order the answers were written.
  let running = 0;
  const first: Answer[] = [];
  const second: Answer[] = [];
  for (const a of answers) {
    (running < all.keys / 2 ? first : second).push(a);
    running += a.keys;
  }
  const h1 = combine(first);
  const h2 = combine(second);
  const withinSession = h1.keys >= MIN_KEYS_PER_HALF && h2.keys >= MIN_KEYS_PER_HALF ? profileDistance(h1.features, h2.features) : null;

  // The learner's last three tests that had enough typing.
  const history = await pool.query(
    `SELECT checks->'typing'->'profile' AS profile FROM session_integrity
     WHERE user_id = $1 AND session_id <> $2 AND checks->'typing'->>'decision' = 'consistent'
     ORDER BY created_at DESC LIMIT 3`,
    [si.user_id, sessionId],
  );
  const past = combine(history.rows.filter((r) => r.profile).map((r) => ({ keys: 1, features: r.profile as Profile })));
  const vsHistory = all.keys >= MIN_KEYS_PER_HALF && history.rows.length > 0 ? profileDistance(all.features, past.features) : null;

  const verdicts = [verdict(withinSession), verdict(vsHistory)].filter(Boolean);
  const decision: TypingCheck["decision"] =
    verdicts.length === 0 ? "insufficient_typing" : verdicts.includes("inconsistent") ? "inconsistent" : verdicts.includes("uncertain") ? "uncertain" : "consistent";
  const check: TypingCheck = { decision, keys: all.keys, withinSession, vsHistory, historySessions: history.rows.length, profile: all.features };
  await pool.query(`UPDATE session_integrity SET checks = checks || jsonb_build_object('typing', $2::jsonb) WHERE session_id = $1`, [sessionId, JSON.stringify(check)]);
  return check;
}
